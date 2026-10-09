-- Demo release integrity and least-privilege fix.
-- Baseline main e971dbd (2026-09-26); staged on isolated branch.
-- Keeps management review of all records, but technicians can only read
-- evidence of work they performed (or their own uploads).
-- Does not alter previously completed orders or delete any data.
begin;

alter policy evidence_links_company_select on public.evidence_links
using (
  private.has_company_role(
    company_id,
    array['owner','operations_manager','supervisor','dispatcher']::public.app_role[]
  )
  or (
    entity_type = 'assignment'
    and exists (
      select 1 from public.assignments a
      where a.company_id = evidence_links.company_id
        and a.id = evidence_links.entity_id
        and a.employee_id = private.current_employee_id(evidence_links.company_id)
    )
  )
  or (
    entity_type = 'work_order'
    and purpose = 'completion'
    and exists (
      select 1 from public.assignments a
      where a.company_id = evidence_links.company_id
        and a.work_order_id = evidence_links.entity_id
        and a.employee_id = private.current_employee_id(evidence_links.company_id)
        and a.status not in ('declined','cancelled'::public.assignment_status)
    )
  )
  or (
    entity_type = 'work_order'
    and purpose is distinct from 'completion'
    and private.can_view_work_order(evidence_links.entity_id, evidence_links.company_id)
  )
  or (
    entity_type = 'turnover'
    and purpose is distinct from 'completion'
    and private.can_view_turnover(evidence_links.entity_id, evidence_links.company_id)
  )
);

alter policy evidence_files_company_select on public.evidence_files
using (
  private.has_company_role(
    company_id,
    array['owner','operations_manager','supervisor','dispatcher']::public.app_role[]
  )
  or captured_by = private.current_employee_id(company_id)
  or exists (
    select 1 from public.evidence_links l
    where l.company_id = evidence_files.company_id
      and l.evidence_file_id = evidence_files.id
  )
);

CREATE OR REPLACE FUNCTION public.dispatch_transition_assignment(p_company_id uuid, p_assignment_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := private.current_employee_id(p_company_id);
  v_manager boolean := private.has_company_role(
    p_company_id,
    array['owner','operations_manager','supervisor','dispatcher']::public.app_role[]
  );
  v_old public.assignments%rowtype;
  v_row public.assignments%rowtype;
  v_status public.assignment_status;
  v_wo_status public.work_order_status;
  v_event text;
  v_handoff_released boolean := false;
begin
  if v_actor is null then raise exception 'not_a_company_member'; end if;

  select * into v_old
  from public.assignments
  where id=p_assignment_id and company_id=p_company_id
  for update;
  if not found then raise exception 'assignment_not_found'; end if;
  if v_old.employee_id<>v_actor and not v_manager then raise exception 'insufficient_permission'; end if;
  if p_action in ('complete','cancel') and not v_manager then raise exception 'insufficient_permission'; end if;

  -- A turnover is not complete until the worker has actually uploaded evidence.
  -- Check persisted files/links rather than trusting a client-side photo counter.
  if p_action in ('submit','complete')
     and exists (
       select 1 from public.work_orders w
       where w.id = v_old.work_order_id
         and w.company_id = p_company_id
         and w.turnover_id is not null
     )
     and not exists (
       select 1
       from public.evidence_links el
       join public.evidence_files ef
         on ef.id = el.evidence_file_id
        and ef.company_id = el.company_id
       where el.company_id = p_company_id
         and el.entity_type = 'assignment'
         and el.entity_id = p_assignment_id
         and el.purpose = 'completion'
         and ef.media_type = 'photo'
         and ef.storage_bucket = 'work-evidence'
     )
  then
    raise exception 'Take and upload at least one completion photo before completing this turnover.';
  end if;

  if p_action='start' then
    if v_old.status not in ('accepted','paused') then raise exception 'invalid_assignment_transition'; end if;
    if exists(
      select 1 from public.ai_walkthrough_issues i
      where i.company_id=p_company_id
        and i.work_order_id=v_old.work_order_id
        and i.needs_review=true
    ) then raise exception 'work_order_needs_review'; end if;
    if exists(
      select 1
      from public.work_order_dependencies d
      join public.work_orders prerequisite
        on prerequisite.id=d.depends_on_work_order_id
       and prerequisite.company_id=d.company_id
      where d.company_id=p_company_id
        and d.work_order_id=v_old.work_order_id
        and prerequisite.status<>'completed'
    ) then raise exception 'work_order_dependency_incomplete'; end if;
    v_status:='active';
    v_wo_status:='in_progress';
    v_event:='assignment.started';

  elsif p_action='pause' then
    if v_old.status<>'active' then raise exception 'invalid_assignment_transition'; end if;
    v_status:='paused';
    v_event:='assignment.paused';

  elsif p_action='submit' then
    if v_old.status not in ('active','paused') then raise exception 'invalid_assignment_transition'; end if;
    v_status:='completed';
    v_wo_status:='completed';
    v_event:='assignment.completed';
    v_handoff_released:=true;

  elsif p_action='complete' then
    if v_old.status<>'submitted' then raise exception 'invalid_assignment_transition'; end if;
    v_status:='completed';
    v_wo_status:='completed';
    v_event:='assignment.completed';
    v_handoff_released:=true;

  elsif p_action='cancel' then
    if v_old.status in ('completed','cancelled') then raise exception 'assignment_already_final'; end if;
    v_status:='cancelled';
    v_wo_status:='new';
    v_event:='assignment.cancelled';

  else
    raise exception 'invalid_assignment_action';
  end if;

  update public.assignments
  set status=v_status,
      started_at=case when p_action='start' then coalesce(started_at,clock_timestamp()) else started_at end,
      submitted_at=case when p_action='submit' then clock_timestamp() else submitted_at end,
      completed_at=case when p_action in ('submit','complete') then coalesce(completed_at,clock_timestamp()) else completed_at end,
      revision=revision+1
  where id=p_assignment_id
  returning * into v_row;

  if p_action='cancel'
     and exists(
       select 1 from public.assignments a
       where a.company_id=p_company_id
         and a.work_order_id=v_old.work_order_id
         and a.id<>p_assignment_id
         and a.status in ('offered','accepted','active','paused','submitted')
     )
  then
    v_wo_status:=null;
  end if;

  if v_wo_status is not null then
    update public.work_orders
    set status=v_wo_status,revision=revision+1,updated_at=clock_timestamp()
    where id=v_old.work_order_id
      and company_id=p_company_id
      and status is distinct from v_wo_status;
  end if;

  insert into public.audit_events(
    company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,
    before_data,after_data,reason
  )
  values(
    p_company_id,auth.uid(),v_actor,v_event,'assignment',p_assignment_id,
    to_jsonb(v_old),to_jsonb(v_row),nullif(trim(p_reason),'')
  );

  return jsonb_build_object(
    'ok',true,
    'assignment',to_jsonb(v_row),
    'handoff_released',v_handoff_released,
    'final_unit_approval_required',true
  );
end;
$function$;

commit;
