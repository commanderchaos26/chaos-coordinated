-- Make employee availability advisory for management dispatch.
-- The existing RPC signature is preserved for older app builds, but schedule
-- conflicts no longer block an otherwise authorized assignment or require a reason.
-- All existing role, employee-account, AI-review, company-status, and reassignment
-- safeguards remain in place.

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
 v_replaced public.assignments%rowtype;
 v_cancelled public.assignments%rowtype;
 v_start timestamptz:=coalesce(p_scheduled_start,now());
 v_end timestamptz:=coalesce(p_scheduled_end,coalesce(p_scheduled_start,now())+interval '1 hour');
 v_conflicts jsonb;
 v_dedupe text;
 v_cancel_dedupe text;
 v_created boolean:=false;
 v_reassigned_count integer:=0;
 v_work_order_status public.work_order_status;
begin
 if v_actor is null then raise exception 'not_a_company_member'; end if;
 if not private.has_company_role(
   p_company_id,
   array['owner','operations_manager','supervisor','dispatcher']::public.app_role[]
 ) then raise exception 'insufficient_permission'; end if;
 if v_end<=v_start then raise exception 'invalid_schedule_window'; end if;

 select * into v_wo
 from public.work_orders
 where id=p_work_order_id and company_id=p_company_id
 for update;
 if not found then raise exception 'work_order_not_found'; end if;
 if v_wo.status in ('completed','cancelled') then raise exception 'work_order_not_assignable'; end if;

 if exists(
   select 1
   from public.ai_walkthrough_issues i
   where i.company_id=p_company_id
     and i.work_order_id=p_work_order_id
     and i.needs_review=true
 ) then raise exception 'work_order_needs_review'; end if;

 select * into v_emp
 from public.employees
 where id=p_employee_id and company_id=p_company_id;
 if not found or v_emp.employment_status<>'active' then raise exception 'employee_not_active'; end if;

 if not exists(
   select 1
   from public.employee_account_links l
   where l.company_id=p_company_id
     and l.employee_id=p_employee_id
     and l.status='active'
 ) then raise exception 'employee_account_not_active'; end if;

 v_conflicts := private.employee_schedule_conflicts(
   p_company_id,p_employee_id,v_start,v_end,p_work_order_id
 );
 -- Availability is advisory. Management may dispatch work despite a schedule
 -- conflict without inventing an override reason. The conflicts are retained
 -- in the RPC response for visibility/auditing.

 -- Lock the existing assignment for the requested employee, if any.
 select * into v_old
 from public.assignments a
 where a.company_id=p_company_id
   and a.work_order_id=p_work_order_id
   and a.employee_id=p_employee_id
   and a.status in ('offered','accepted','active','paused','submitted')
 order by a.created_at desc
 limit 1
 for update;

 -- A work order is single-owner at the assignment level. Reassignment is atomic:
 -- every other live assignment is cancelled before the new/current one is retained.
 for v_replaced in
   select *
   from public.assignments a
   where a.company_id=p_company_id
     and a.work_order_id=p_work_order_id
     and a.employee_id<>p_employee_id
     and a.status in ('offered','accepted','active','paused','submitted')
   order by a.created_at
   for update
 loop
   update public.assignments
   set status='cancelled',
       revision=revision+1
   where id=v_replaced.id
   returning * into v_cancelled;

   v_reassigned_count:=v_reassigned_count+1;
   v_cancel_dedupe:='assignment:'||v_cancelled.id::text||':cancelled:v'||v_cancelled.revision::text;

   insert into public.employee_notifications(
     company_id,employee_id,notification_type,title,body,priority,
     entity_type,entity_id,assignment_id,dedupe_key,payload
   )
   values(
     p_company_id,v_cancelled.employee_id,'assignment.cancelled',
     'Assignment reassigned',
     v_wo.title,
     v_wo.priority::text,
     'work_order',p_work_order_id,v_cancelled.id,v_cancel_dedupe,
     jsonb_build_object(
       'work_order_id',p_work_order_id,
       'assignment_id',v_cancelled.id,
       'reason','reassigned',
       'replacement_employee_id',p_employee_id
     )
   )
   on conflict(company_id,employee_id,dedupe_key) do nothing;

   insert into public.outbox_events(
     company_id,event_type,aggregate_type,aggregate_id,dedupe_key,payload,status
   )
   values(
     p_company_id,'assignment.cancelled','assignment',v_cancelled.id,v_cancel_dedupe,
     jsonb_build_object(
       'employee_id',v_cancelled.employee_id,
       'work_order_id',p_work_order_id,
       'assignment_id',v_cancelled.id,
       'title','Assignment reassigned',
       'body',v_wo.title,
       'reason','reassigned',
       'replacement_employee_id',p_employee_id
     ),
     'pending'
   )
   on conflict(company_id,dedupe_key) do nothing;

   insert into public.audit_events(
     company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,
     before_data,after_data,reason
   )
   values(
     p_company_id,auth.uid(),v_actor,'assignment.cancelled','assignment',v_cancelled.id,
     to_jsonb(v_replaced),to_jsonb(v_cancelled),'Reassigned to another employee'
   );
 end loop;

 if v_old.id is not null then
   update public.assignments
   set scheduled_start=coalesce(p_scheduled_start,v_old.scheduled_start),
       scheduled_end=coalesce(p_scheduled_end,v_old.scheduled_end),
       revision=v_old.revision+1
   where id=v_old.id
   returning * into v_assignment;
 else
   insert into public.assignments(
     company_id,work_order_id,employee_id,status,assignment_type,
     scheduled_start,scheduled_end,created_by
   )
   values(
     p_company_id,p_work_order_id,p_employee_id,'offered','task',
     p_scheduled_start,p_scheduled_end,v_actor
   )
   returning * into v_assignment;
   v_created:=true;
 end if;

 v_work_order_status:=case
   when v_assignment.status in ('active','paused') then 'in_progress'::public.work_order_status
   when v_assignment.status='submitted' then 'awaiting_verification'::public.work_order_status
   else 'assigned'::public.work_order_status
 end;

 update public.work_orders
 set status=v_work_order_status,
     revision=revision+1,
     updated_at=now()
 where id=p_work_order_id;

 if v_created then
   v_dedupe:='assignment:'||v_assignment.id::text||':offered:v'||v_assignment.revision::text;

   insert into public.employee_notifications(
     company_id,employee_id,notification_type,title,body,priority,
     entity_type,entity_id,assignment_id,dedupe_key,payload
   )
   values(
     p_company_id,p_employee_id,'assignment.offered','New work order assigned',
     v_wo.title,v_wo.priority::text,'work_order',p_work_order_id,
     v_assignment.id,v_dedupe,
     jsonb_build_object(
       'work_order_id',p_work_order_id,
       'assignment_id',v_assignment.id,
       'priority',v_wo.priority,
       'scheduled_start',v_assignment.scheduled_start,
       'scheduled_end',v_assignment.scheduled_end
     )
   )
   on conflict(company_id,employee_id,dedupe_key) do nothing;

   insert into public.outbox_events(
     company_id,event_type,aggregate_type,aggregate_id,dedupe_key,payload,status
   )
   values(
     p_company_id,'assignment.offered','assignment',v_assignment.id,v_dedupe,
     jsonb_build_object(
       'employee_id',p_employee_id,
       'work_order_id',p_work_order_id,
       'assignment_id',v_assignment.id,
       'title','New work order assigned',
       'body',v_wo.title,
       'priority',v_wo.priority
     ),
     'pending'
   )
   on conflict(company_id,dedupe_key) do nothing;
 end if;

 insert into public.audit_events(
   company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,
   before_data,after_data,reason
 )
 values(
   p_company_id,auth.uid(),v_actor,
   case when v_created then 'assignment.offered' else 'assignment.updated' end,
   'assignment',v_assignment.id,
   case when v_old.id is null then null else to_jsonb(v_old) end,
   to_jsonb(v_assignment),
   nullif(trim(p_override_reason),'')
 );

 return jsonb_build_object(
   'ok',true,
   'assignment',to_jsonb(v_assignment),
   'availability_conflicts_overridden',v_conflicts,
   'availability_conflicts_observed',v_conflicts,
   'reassigned_count',v_reassigned_count,
   'created',v_created
 );
end
$$;

revoke all on function public.dispatch_assign_work_order(
  uuid,uuid,uuid,timestamptz,timestamptz,boolean,text
) from public,anon;
grant execute on function public.dispatch_assign_work_order(
  uuid,uuid,uuid,timestamptz,timestamptz,boolean,text
) to authenticated;
