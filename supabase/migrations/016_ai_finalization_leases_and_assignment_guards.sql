alter table public.ai_walkthrough_sessions
  add column if not exists finalization_started_at timestamptz,
  add column if not exists finalization_lease_until timestamptz;

create unique index if not exists ai_walkthrough_sessions_finalization_key_uidx
  on public.ai_walkthrough_sessions(company_id,finalization_key)
  where finalization_key is not null;

create index if not exists ai_walkthrough_sessions_recovery_idx
  on public.ai_walkthrough_sessions(company_id,started_by,status,started_at desc);

create or replace function private.clear_ai_finalization_lease()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.status in ('completed','failed','cancelled') then new.finalization_lease_until:=null; end if;
  return new;
end
$$;

drop trigger if exists clear_ai_finalization_lease on public.ai_walkthrough_sessions;
create trigger clear_ai_finalization_lease
before update on public.ai_walkthrough_sessions
for each row execute function private.clear_ai_finalization_lease();

create or replace function public.ai_walkthrough_claim_finalization(
  p_company_id uuid,
  p_session_id uuid,
  p_finalization_key text,
  p_lease_seconds integer default 180
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=private.current_employee_id(p_company_id);
  v_session public.ai_walkthrough_sessions%rowtype;
  v_key text:=nullif(trim(coalesce(p_finalization_key,'')),'');
  v_lease integer:=greatest(60,least(coalesce(p_lease_seconds,180),600));
begin
  if v_actor is null then raise exception 'not_a_company_member'; end if;
  if not private.has_employee_feature_permission(p_company_id,v_actor,'ai_walkthrough') then raise exception 'ai_walkthrough_permission_required'; end if;
  if v_key is null then raise exception 'finalization_key_required'; end if;

  select * into v_session
  from public.ai_walkthrough_sessions
  where id=p_session_id and company_id=p_company_id
  for update;
  if not found then raise exception 'walkthrough_not_found'; end if;

  if v_session.started_by<>v_actor
     and not private.has_company_role(p_company_id,array['owner','operations_manager','supervisor','dispatcher']::public.app_role[])
  then raise exception 'insufficient_permission'; end if;

  if v_session.finalization_key is not null and v_session.finalization_key<>v_key then raise exception 'finalization_key_mismatch'; end if;

  if v_session.status='completed' then
    return jsonb_build_object('ok',true,'claim_granted',false,'completed',true,'in_progress',false,'session',to_jsonb(v_session));
  end if;

  if v_session.status='processing'
     and v_session.finalization_lease_until is not null
     and v_session.finalization_lease_until>now()
  then
    return jsonb_build_object('ok',true,'claim_granted',false,'completed',false,'in_progress',true,
      'lease_until',v_session.finalization_lease_until,'session',to_jsonb(v_session));
  end if;

  if v_session.status not in ('recording','failed','processing') then raise exception 'walkthrough_not_ready'; end if;

  update public.ai_walkthrough_sessions
  set finalization_key=coalesce(finalization_key,v_key),
      status='processing',
      error_message=null,
      finalization_started_at=coalesce(finalization_started_at,now()),
      finalization_lease_until=now()+make_interval(secs=>v_lease),
      revision=revision+1,
      updated_at=now()
  where id=p_session_id
  returning * into v_session;

  return jsonb_build_object('ok',true,'claim_granted',true,'completed',false,'in_progress',false,
    'lease_until',v_session.finalization_lease_until,'session',to_jsonb(v_session));
end
$$;

revoke all on function public.ai_walkthrough_claim_finalization(uuid,uuid,text,integer) from public,anon;
grant execute on function public.ai_walkthrough_claim_finalization(uuid,uuid,text,integer) to authenticated;

create or replace function private.validate_ai_walkthrough_issue_row()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_skill jsonb;
  v_skill_id uuid;
  v_reason text;
begin
  if length(coalesce(new.issue_key,''))=0 or length(new.issue_key)>120 then raise exception 'invalid_issue_key'; end if;
  if length(coalesce(new.title,''))=0 or length(new.title)>240 then raise exception 'invalid_issue_title'; end if;
  if new.description is not null and length(new.description)>1200 then raise exception 'issue_description_too_long'; end if;
  if new.room_area is not null and length(new.room_area)>120 then raise exception 'issue_room_area_too_long'; end if;
  if new.issue_category is not null and length(new.issue_category)>120 then raise exception 'issue_category_too_long'; end if;
  if new.estimated_minutes is not null and (new.estimated_minutes<1 or new.estimated_minutes>1440) then raise exception 'invalid_estimated_minutes'; end if;
  if new.confidence is not null and (new.confidence<0 or new.confidence>1) then raise exception 'invalid_issue_confidence'; end if;

  if jsonb_typeof(coalesce(new.required_skill_snapshot,'[]'::jsonb))<>'array' then raise exception 'required_skills_must_be_array'; end if;
  if jsonb_array_length(coalesce(new.required_skill_snapshot,'[]'::jsonb))>12 then raise exception 'too_many_required_skills'; end if;

  for v_skill in select value from jsonb_array_elements(coalesce(new.required_skill_snapshot,'[]'::jsonb))
  loop
    if jsonb_typeof(v_skill)<>'object'
       or jsonb_typeof(v_skill->'skill_id')<>'string'
       or nullif(trim(v_skill->>'skill_id'),'') is null
    then raise exception 'invalid_required_skill'; end if;
    begin
      v_skill_id:=(v_skill->>'skill_id')::uuid;
    exception when others then
      raise exception 'invalid_required_skill_id';
    end;
    if not exists(select 1 from public.skills s where s.id=v_skill_id and s.company_id=new.company_id and s.active=true) then
      raise exception 'required_skill_not_found';
    end if;
  end loop;

  if jsonb_typeof(coalesce(new.depends_on_issue_keys,'[]'::jsonb))<>'array' then raise exception 'dependencies_must_be_array'; end if;
  if jsonb_array_length(coalesce(new.depends_on_issue_keys,'[]'::jsonb))>20 then raise exception 'too_many_dependencies'; end if;
  if jsonb_typeof(coalesce(new.source_chunk_sequences,'[]'::jsonb))<>'array' then raise exception 'source_chunks_must_be_array'; end if;
  if jsonb_array_length(coalesce(new.source_chunk_sequences,'[]'::jsonb))>100 then raise exception 'too_many_source_chunks'; end if;

  if tg_op='INSERT' and (new.department_id is null or coalesce(new.confidence,0)<0.70) then
    new.needs_review:=true;
    v_reason:=coalesce(nullif(trim(new.review_reason),''),'');
    if new.department_id is null and position('No active company department' in v_reason)=0 then
      v_reason:=concat_ws('; ',nullif(v_reason,''),'No active company department could be assigned with confidence');
    end if;
    if coalesce(new.confidence,0)<0.70 and position('below the automatic-accept threshold' in v_reason)=0 then
      v_reason:=concat_ws('; ',nullif(v_reason,''),'AI confidence is below the automatic-accept threshold');
    end if;
    new.review_reason:=nullif(v_reason,'');
    new.status:='review_required';
  elsif tg_op='UPDATE' and new.needs_review=false and new.department_id is null then
    raise exception 'department_required_to_resolve_review';
  end if;

  return new;
end
$$;

drop trigger if exists validate_ai_walkthrough_issue_row on public.ai_walkthrough_issues;
create trigger validate_ai_walkthrough_issue_row
before insert or update on public.ai_walkthrough_issues
for each row execute function private.validate_ai_walkthrough_issue_row();

create or replace function private.guard_assignment_work_order()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_is_entering_guarded_state boolean;
begin
  v_is_entering_guarded_state:=tg_op='INSERT' or (
    tg_op='UPDATE' and new.status in ('offered','accepted','active') and new.status is distinct from old.status
  );

  if v_is_entering_guarded_state and exists(
    select 1 from public.ai_walkthrough_issues i
    where i.company_id=new.company_id and i.work_order_id=new.work_order_id and i.needs_review=true
  ) then raise exception 'work_order_needs_review'; end if;

  if new.status='active'
     and (tg_op='INSERT' or new.status is distinct from old.status)
     and exists(
       select 1
       from public.work_order_dependencies d
       join public.work_orders prerequisite on prerequisite.id=d.depends_on_work_order_id and prerequisite.company_id=d.company_id
       where d.company_id=new.company_id and d.work_order_id=new.work_order_id and prerequisite.status<>'completed'
     )
  then raise exception 'work_order_dependency_incomplete'; end if;

  return new;
end
$$;

drop trigger if exists guard_assignment_work_order on public.assignments;
create trigger guard_assignment_work_order
before insert or update on public.assignments
for each row execute function private.guard_assignment_work_order();

create or replace function public.dispatch_transition_assignment(
  p_company_id uuid,
  p_assignment_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
 v_actor uuid:=private.current_employee_id(p_company_id);
 v_manager boolean:=private.has_company_role(p_company_id,array['owner','operations_manager','supervisor','dispatcher']::public.app_role[]);
 v_old public.assignments%rowtype;
 v_row public.assignments%rowtype;
 v_status public.assignment_status;
 v_wo_status public.work_order_status;
 v_event text;
begin
 if v_actor is null then raise exception 'not_a_company_member'; end if;
 select * into v_old from public.assignments where id=p_assignment_id and company_id=p_company_id for update;
 if not found then raise exception 'assignment_not_found'; end if;
 if v_old.employee_id<>v_actor and not v_manager then raise exception 'insufficient_permission'; end if;
 if p_action in ('complete','cancel') and not v_manager then raise exception 'insufficient_permission'; end if;

 if p_action='start' then
   if v_old.status not in ('accepted','paused') then raise exception 'invalid_assignment_transition'; end if;
   if exists(select 1 from public.ai_walkthrough_issues i where i.company_id=p_company_id and i.work_order_id=v_old.work_order_id and i.needs_review=true)
   then raise exception 'work_order_needs_review'; end if;
   if exists(
     select 1 from public.work_order_dependencies d
     join public.work_orders prerequisite on prerequisite.id=d.depends_on_work_order_id and prerequisite.company_id=d.company_id
     where d.company_id=p_company_id and d.work_order_id=v_old.work_order_id and prerequisite.status<>'completed'
   ) then raise exception 'work_order_dependency_incomplete'; end if;
   v_status:='active';v_wo_status:='in_progress';v_event:='assignment.started';
 elsif p_action='pause' then
   if v_old.status<>'active' then raise exception 'invalid_assignment_transition'; end if;
   v_status:='paused';v_event:='assignment.paused';
 elsif p_action='submit' then
   if v_old.status not in ('active','paused') then raise exception 'invalid_assignment_transition'; end if;
   v_status:='submitted';v_wo_status:='awaiting_verification';v_event:='assignment.submitted';
 elsif p_action='complete' then
   if v_old.status<>'submitted' then raise exception 'invalid_assignment_transition'; end if;
   v_status:='completed';v_wo_status:='completed';v_event:='assignment.completed';
 elsif p_action='cancel' then
   if v_old.status in ('completed','cancelled') then raise exception 'assignment_already_final'; end if;
   v_status:='cancelled';v_event:='assignment.cancelled';
 else raise exception 'invalid_assignment_action'; end if;

 update public.assignments
 set status=v_status,
     started_at=case when p_action='start' then coalesce(started_at,now()) else started_at end,
     submitted_at=case when p_action='submit' then now() else submitted_at end,
     completed_at=case when p_action='complete' then now() else completed_at end,
     revision=revision+1
 where id=p_assignment_id
 returning * into v_row;

 if v_wo_status is not null then
   update public.work_orders set status=v_wo_status,revision=revision+1
   where id=v_old.work_order_id and company_id=p_company_id;
 end if;

 insert into public.audit_events(company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,before_data,after_data,reason)
 values(p_company_id,auth.uid(),v_actor,v_event,'assignment',p_assignment_id,to_jsonb(v_old),to_jsonb(v_row),nullif(trim(p_reason),''));

 return jsonb_build_object('ok',true,'assignment',to_jsonb(v_row));
end
$$;

revoke all on function public.dispatch_transition_assignment(uuid,uuid,text,text) from public,anon;
grant execute on function public.dispatch_transition_assignment(uuid,uuid,text,text) to authenticated;

create or replace function public.ai_walkthrough_mark_failed(
  p_company_id uuid,
  p_session_id uuid,
  p_error_message text default null
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
  select * into v_session from public.ai_walkthrough_sessions where id=p_session_id and company_id=p_company_id for update;
  if not found then raise exception 'walkthrough_not_found'; end if;
  if v_session.started_by<>v_actor
     and not private.has_company_role(p_company_id,array['owner','operations_manager','supervisor','dispatcher']::public.app_role[])
  then raise exception 'insufficient_permission'; end if;
  if v_session.status='completed' then raise exception 'walkthrough_already_completed'; end if;

  update public.ai_walkthrough_sessions
  set status='failed',
      error_message=left(nullif(trim(p_error_message),''),1000),
      finalization_lease_until=null,
      revision=revision+1,
      updated_at=now()
  where id=p_session_id
  returning * into v_session;

  insert into public.audit_events(company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,after_data)
  values(p_company_id,auth.uid(),v_actor,'ai_walkthrough.failed','ai_walkthrough_session',p_session_id,to_jsonb(v_session));

  return jsonb_build_object('ok',true,'session',to_jsonb(v_session));
end
$$;

revoke all on function public.ai_walkthrough_mark_failed(uuid,uuid,text) from public,anon;
grant execute on function public.ai_walkthrough_mark_failed(uuid,uuid,text) to authenticated;
