-- Remove routine per-work-order approval gates.
-- Employees completing assigned work now complete the work order immediately.
-- Dependency-gated downstream work becomes eligible as soon as its prerequisites are complete.
-- Final unit approval remains a separate turnover-level inspection after final cleaning.

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
 v_handoff_released boolean:=false;
begin
 if v_actor is null then raise exception 'not_a_company_member'; end if;
 select * into v_old from public.assignments where id=p_assignment_id and company_id=p_company_id for update;
 if not found then raise exception 'assignment_not_found'; end if;
 if v_old.employee_id<>v_actor and not v_manager then raise exception 'insufficient_permission'; end if;

 -- "complete" is retained only as a management compatibility path for legacy submitted rows.
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

   -- Routine department work no longer waits for a supervisor verification step.
   -- Completing the employee submission completes the work order, which releases
   -- any downstream work-order dependencies immediately.
   v_status:='completed';
   v_wo_status:='completed';
   v_event:='assignment.completed';
   v_handoff_released:=true;

 elsif p_action='complete' then
   if v_old.status<>'submitted' then raise exception 'invalid_assignment_transition'; end if;
   v_status:='completed';v_wo_status:='completed';v_event:='assignment.completed';
   v_handoff_released:=true;

 elsif p_action='cancel' then
   if v_old.status in ('completed','cancelled') then raise exception 'assignment_already_final'; end if;
   v_status:='cancelled';v_event:='assignment.cancelled';

 else raise exception 'invalid_assignment_action'; end if;

 update public.assignments
 set status=v_status,
     started_at=case when p_action='start' then coalesce(started_at,now()) else started_at end,
     submitted_at=case when p_action='submit' then now() else submitted_at end,
     completed_at=case when p_action in ('submit','complete') then coalesce(completed_at,now()) else completed_at end,
     revision=revision+1
 where id=p_assignment_id
 returning * into v_row;

 if v_wo_status is not null then
   update public.work_orders
   set status=v_wo_status,revision=revision+1,updated_at=now()
   where id=v_old.work_order_id and company_id=p_company_id;
 end if;

 insert into public.audit_events(company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,before_data,after_data,reason)
 values(p_company_id,auth.uid(),v_actor,v_event,'assignment',p_assignment_id,to_jsonb(v_old),to_jsonb(v_row),nullif(trim(p_reason),''));

 return jsonb_build_object(
   'ok',true,
   'assignment',to_jsonb(v_row),
   'handoff_released',v_handoff_released,
   'final_unit_approval_required',true
 );
end
$$;

revoke all on function public.dispatch_transition_assignment(uuid,uuid,text,text) from public,anon;
grant execute on function public.dispatch_transition_assignment(uuid,uuid,text,text) to authenticated;

-- Reconcile work that was already waiting in the old verification gate.
-- This does not mark a turnover Ready for Occupancy; final unit approval remains separate.
update public.assignments a
set status='completed',
    completed_at=coalesce(a.completed_at,a.submitted_at,now()),
    revision=a.revision+1
where a.status='submitted'
  and exists (
    select 1
    from public.work_orders wo
    where wo.id=a.work_order_id
      and wo.company_id=a.company_id
      and wo.status='awaiting_verification'
  );

update public.work_orders wo
set status='completed',
    revision=wo.revision+1,
    updated_at=now()
where wo.status='awaiting_verification'
  and exists (
    select 1
    from public.assignments a
    where a.company_id=wo.company_id
      and a.work_order_id=wo.id
      and a.status='completed'
  );
