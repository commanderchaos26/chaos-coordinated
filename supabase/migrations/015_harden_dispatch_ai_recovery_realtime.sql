-- Hardening discovered during isolated workflow testing.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='assignments') then
    alter publication supabase_realtime add table public.assignments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='work_orders') then
    alter publication supabase_realtime add table public.work_orders;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='employee_notifications') then
    alter publication supabase_realtime add table public.employee_notifications;
  end if;
end $$;

create or replace function private.enforce_ai_walkthrough_issue_limit()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if (select count(*) from public.ai_walkthrough_issues where session_id=new.session_id) >= 50 then
    raise exception 'ai_issue_limit_exceeded';
  end if;
  return new;
end
$$;

drop trigger if exists ai_walkthrough_issue_limit on public.ai_walkthrough_issues;
create trigger ai_walkthrough_issue_limit
before insert on public.ai_walkthrough_issues
for each row execute function private.enforce_ai_walkthrough_issue_limit();

create or replace function private.prevent_work_order_dependency_cycle()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.work_order_id=new.depends_on_work_order_id then
    raise exception 'self_dependency_not_allowed';
  end if;

  if exists (
    with recursive upstream(id) as (
      select d.depends_on_work_order_id
      from public.work_order_dependencies d
      where d.company_id=new.company_id and d.work_order_id=new.depends_on_work_order_id
      union
      select d.depends_on_work_order_id
      from public.work_order_dependencies d
      join upstream u on d.work_order_id=u.id
      where d.company_id=new.company_id
    )
    select 1 from upstream where id=new.work_order_id
  ) then
    raise exception 'dependency_cycle_not_allowed';
  end if;

  return new;
end
$$;

drop trigger if exists prevent_work_order_dependency_cycle on public.work_order_dependencies;
create trigger prevent_work_order_dependency_cycle
before insert or update on public.work_order_dependencies
for each row execute function private.prevent_work_order_dependency_cycle();

create or replace function public.ai_walkthrough_resolve_issue(
  p_company_id uuid,
  p_issue_id uuid,
  p_department_id uuid default null,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=private.current_employee_id(p_company_id);
  v_issue public.ai_walkthrough_issues%rowtype;
  v_department uuid;
begin
  if v_actor is null then raise exception 'not_a_company_member'; end if;
  if not private.has_company_role(p_company_id,array['owner','operations_manager','supervisor']::public.app_role[]) then
    raise exception 'insufficient_permission';
  end if;

  select * into v_issue
  from public.ai_walkthrough_issues
  where id=p_issue_id and company_id=p_company_id
  for update;
  if not found then raise exception 'ai_issue_not_found'; end if;

  v_department:=coalesce(p_department_id,v_issue.department_id);
  if v_department is null then raise exception 'department_required_to_resolve_review'; end if;
  if not exists(select 1 from public.departments d where d.id=v_department and d.company_id=p_company_id and d.active=true) then
    raise exception 'department_not_found';
  end if;

  update public.ai_walkthrough_issues
  set department_id=v_department,
      needs_review=false,
      status='created',
      review_reason=case
        when nullif(trim(coalesce(p_review_note,'')),'') is null then review_reason
        else concat_ws('; ',review_reason,'Management review: '||trim(p_review_note))
      end,
      updated_at=now()
  where id=p_issue_id
  returning * into v_issue;

  update public.work_orders
  set department_id=v_department,revision=revision+1
  where id=v_issue.work_order_id and company_id=p_company_id;

  insert into public.audit_events(company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,after_data,reason)
  values(p_company_id,auth.uid(),v_actor,'ai_walkthrough.issue_review_resolved','ai_walkthrough_issue',p_issue_id,
         to_jsonb(v_issue),nullif(trim(coalesce(p_review_note,'')),''));

  return jsonb_build_object('ok',true,'issue',to_jsonb(v_issue));
end
$$;

revoke all on function public.ai_walkthrough_resolve_issue(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.ai_walkthrough_resolve_issue(uuid,uuid,uuid,text) to authenticated;

create or replace function public.ai_walkthrough_prepare_finalization(
  p_company_id uuid,
  p_session_id uuid,
  p_finalization_key text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=private.current_employee_id(p_company_id);
  v_session public.ai_walkthrough_sessions%rowtype;
begin
  if v_actor is null then raise exception 'not_a_company_member'; end if;
  if nullif(trim(coalesce(p_finalization_key,'')),'') is null then raise exception 'finalization_key_required'; end if;

  select * into v_session
  from public.ai_walkthrough_sessions
  where id=p_session_id and company_id=p_company_id
  for update;
  if not found then raise exception 'walkthrough_not_found'; end if;
  if v_session.started_by<>v_actor
     and not private.has_company_role(p_company_id,array['owner','operations_manager','supervisor','dispatcher']::public.app_role[])
  then raise exception 'insufficient_permission'; end if;

  if v_session.status='completed' and v_session.finalization_key<>trim(p_finalization_key) then
    raise exception 'walkthrough_already_completed';
  end if;
  if v_session.finalization_key is not null and v_session.finalization_key<>trim(p_finalization_key) then
    raise exception 'finalization_key_mismatch';
  end if;
  if exists(
    select 1 from public.ai_walkthrough_sessions s
    where s.company_id=p_company_id
      and s.finalization_key=trim(p_finalization_key)
      and s.id<>p_session_id
  ) then raise exception 'finalization_key_in_use'; end if;

  update public.ai_walkthrough_sessions
  set finalization_key=coalesce(finalization_key,trim(p_finalization_key)),
      revision=revision+1
  where id=p_session_id
  returning * into v_session;

  return jsonb_build_object('ok',true,'session',to_jsonb(v_session));
end
$$;

revoke all on function public.ai_walkthrough_prepare_finalization(uuid,uuid,text) from public,anon;
grant execute on function public.ai_walkthrough_prepare_finalization(uuid,uuid,text) to authenticated;

create or replace function public.dispatch_assign_work_order(
  p_company_id uuid,
  p_work_order_id uuid,
  p_employee_id uuid,
  p_scheduled_start timestamptz default null,
  p_scheduled_end timestamptz default null,
  p_override_availability boolean default false,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
 v_actor uuid:=private.current_employee_id(p_company_id);
 v_wo public.work_orders%rowtype;
 v_emp public.employees%rowtype;
 v_assignment public.assignments%rowtype;
 v_old public.assignments%rowtype;
 v_start timestamptz:=coalesce(p_scheduled_start,now());
 v_end timestamptz:=coalesce(p_scheduled_end,coalesce(p_scheduled_start,now())+interval '1 hour');
 v_conflicts jsonb;
 v_dedupe text;
begin
 if v_actor is null then raise exception 'not_a_company_member'; end if;
 if not private.has_company_role(p_company_id,array['owner','operations_manager','supervisor','dispatcher']::public.app_role[]) then raise exception 'insufficient_permission'; end if;
 if v_end<=v_start then raise exception 'invalid_schedule_window'; end if;

 select * into v_wo from public.work_orders where id=p_work_order_id and company_id=p_company_id for update;
 if not found then raise exception 'work_order_not_found'; end if;
 if v_wo.status in ('completed','cancelled') then raise exception 'work_order_not_assignable'; end if;

 if exists(
   select 1 from public.ai_walkthrough_issues i
   where i.company_id=p_company_id and i.work_order_id=p_work_order_id and i.needs_review=true
 ) then raise exception 'work_order_needs_review'; end if;

 select * into v_emp from public.employees where id=p_employee_id and company_id=p_company_id;
 if not found or v_emp.employment_status<>'active' then raise exception 'employee_not_active'; end if;
 if not exists(select 1 from public.employee_account_links l where l.company_id=p_company_id and l.employee_id=p_employee_id and l.status='active') then raise exception 'employee_account_not_active'; end if;

 v_conflicts := private.employee_schedule_conflicts(p_company_id,p_employee_id,v_start,v_end,p_work_order_id);
 if jsonb_array_length(v_conflicts)>0 and not p_override_availability then raise exception 'employee_unavailable'; end if;
 if jsonb_array_length(v_conflicts)>0 and p_override_availability and nullif(trim(p_override_reason),'') is null then raise exception 'override_reason_required'; end if;

 select * into v_old from public.assignments a
 where a.company_id=p_company_id and a.work_order_id=p_work_order_id and a.employee_id=p_employee_id
   and a.status in ('offered','accepted','active','paused','submitted')
 order by a.created_at desc limit 1 for update;

 if found then
  update public.assignments
  set scheduled_start=coalesce(p_scheduled_start,v_old.scheduled_start),
      scheduled_end=coalesce(p_scheduled_end,v_old.scheduled_end),
      revision=v_old.revision+1
  where id=v_old.id returning * into v_assignment;
 else
  insert into public.assignments(company_id,work_order_id,employee_id,status,assignment_type,scheduled_start,scheduled_end,created_by)
  values(p_company_id,p_work_order_id,p_employee_id,'offered','task',p_scheduled_start,p_scheduled_end,v_actor)
  returning * into v_assignment;
 end if;

 update public.work_orders set status='assigned',revision=revision+1 where id=p_work_order_id;

 v_dedupe:='assignment:'||v_assignment.id::text||':offered:v'||v_assignment.revision::text;
 insert into public.employee_notifications(company_id,employee_id,notification_type,title,body,priority,entity_type,entity_id,assignment_id,dedupe_key,payload)
 values(p_company_id,p_employee_id,'assignment.offered','New work order assigned',v_wo.title,v_wo.priority::text,'work_order',p_work_order_id,v_assignment.id,v_dedupe,
 jsonb_build_object('work_order_id',p_work_order_id,'assignment_id',v_assignment.id,'priority',v_wo.priority,'scheduled_start',v_assignment.scheduled_start,'scheduled_end',v_assignment.scheduled_end))
 on conflict(company_id,employee_id,dedupe_key) do nothing;

 insert into public.outbox_events(company_id,event_type,aggregate_type,aggregate_id,dedupe_key,payload,status)
 values(p_company_id,'assignment.offered','assignment',v_assignment.id,v_dedupe,
 jsonb_build_object('employee_id',p_employee_id,'work_order_id',p_work_order_id,'assignment_id',v_assignment.id,'title','New work order assigned','body',v_wo.title,'priority',v_wo.priority),'pending')
 on conflict(company_id,dedupe_key) do nothing;

 insert into public.audit_events(company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,before_data,after_data,reason)
 values(p_company_id,auth.uid(),v_actor,'assignment.offered','assignment',v_assignment.id,
 case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_assignment),nullif(trim(p_override_reason),''));

 return jsonb_build_object('ok',true,'assignment',to_jsonb(v_assignment),'availability_conflicts_overridden',v_conflicts);
end
$$;
