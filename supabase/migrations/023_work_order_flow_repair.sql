-- Work-order lifecycle repair.
-- Fixes manual creation, adds retry-safe creation, repairs creator visibility,
-- keeps status history in sync, requeues declined/cancelled assignments,
-- and adds targeted queue/FK indexes.

create or replace function public.operations_create_work_order(
  p_company_id uuid,
  p_property_id uuid,
  p_title text,
  p_building_id uuid default null,
  p_unit_id uuid default null,
  p_turnover_id uuid default null,
  p_work_site_id uuid default null,
  p_department_id uuid default null,
  p_description text default null,
  p_room_area text default null,
  p_issue_category text default null,
  p_required_skill_snapshot jsonb default '[]'::jsonb,
  p_priority public.work_priority default 'normal'::public.work_priority,
  p_occupancy_blocking boolean default false,
  p_blocking_phase text default null,
  p_estimated_minutes integer default null,
  p_due_at timestamptz default null,
  p_source_type text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_employee_id(p_company_id);
  v_row public.work_orders%rowtype;
  v_building_id uuid := p_building_id;
  v_unit public.units%rowtype;
begin
  if v_actor is null then raise exception 'not_a_company_member'; end if;
  if not private.has_company_role(
    p_company_id,
    array['owner','operations_manager','supervisor','dispatcher','crew_lead']::public.app_role[]
  ) then raise exception 'insufficient_permission'; end if;
  if nullif(trim(p_title),'') is null then raise exception 'work_order_title_required'; end if;
  if length(trim(p_title)) > 240 then raise exception 'work_order_title_too_long'; end if;
  if not exists(
    select 1 from public.properties p
    where p.id=p_property_id and p.company_id=p_company_id and p.active
  ) then raise exception 'property_not_found'; end if;

  if p_unit_id is not null then
    select * into v_unit
    from public.units u
    where u.id=p_unit_id
      and u.company_id=p_company_id
      and u.property_id=p_property_id
      and u.active;
    if not found then raise exception 'unit_not_found'; end if;
    if v_building_id is null then v_building_id := v_unit.building_id; end if;
    if v_building_id <> v_unit.building_id then raise exception 'unit_building_mismatch'; end if;
  end if;

  if v_building_id is not null and not exists(
    select 1 from public.buildings b
    where b.id=v_building_id
      and b.company_id=p_company_id
      and b.property_id=p_property_id
      and b.active
  ) then raise exception 'building_not_found'; end if;

  if p_department_id is not null and not exists(
    select 1 from public.departments d
    where d.id=p_department_id and d.company_id=p_company_id and d.active
  ) then raise exception 'department_not_found'; end if;

  if p_work_site_id is not null and not exists(
    select 1 from public.work_sites s
    where s.id=p_work_site_id
      and s.company_id=p_company_id
      and (s.property_id is null or s.property_id=p_property_id)
      and s.active
  ) then raise exception 'work_site_not_found'; end if;

  if p_turnover_id is not null and not exists(
    select 1 from public.turnovers t
    where t.id=p_turnover_id
      and t.company_id=p_company_id
      and t.property_id=p_property_id
  ) then raise exception 'turnover_not_found'; end if;

  if p_estimated_minutes is not null and p_estimated_minutes <= 0
    then raise exception 'invalid_estimated_minutes';
  end if;
  if jsonb_typeof(coalesce(p_required_skill_snapshot,'[]'::jsonb)) <> 'array'
    then raise exception 'required_skills_must_be_array';
  end if;

  insert into public.work_orders(
    company_id,property_id,building_id,unit_id,turnover_id,work_site_id,department_id,
    source_type,title,description,room_area,issue_category,required_skill_snapshot,
    status,priority,occupancy_blocking,blocking_phase,estimated_minutes,due_at,created_by
  )
  values(
    p_company_id,p_property_id,v_building_id,p_unit_id,p_turnover_id,p_work_site_id,p_department_id,
    case when p_source_type in ('manual','ai_walkthrough','walkthrough','import') then p_source_type else 'manual' end,
    trim(p_title),nullif(trim(p_description),''),nullif(trim(p_room_area),''),nullif(trim(p_issue_category),''),
    coalesce(p_required_skill_snapshot,'[]'::jsonb),'new',coalesce(p_priority,'normal'),
    coalesce(p_occupancy_blocking,false),nullif(trim(p_blocking_phase),''),
    p_estimated_minutes,p_due_at,v_actor
  )
  returning * into v_row;

  insert into public.work_order_status_events(
    company_id,work_order_id,from_status,to_status,reason,actor_employee_id,created_at
  )
  values(
    p_company_id,v_row.id,null,'new','Work order created',v_actor,clock_timestamp()
  );

  insert into public.audit_events(
    company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,after_data
  )
  values(
    p_company_id,auth.uid(),v_actor,'work_order.created','work_order',v_row.id,to_jsonb(v_row)
  );

  return jsonb_build_object('ok',true,'work_order',to_jsonb(v_row));
end;
$$;

create or replace function public.operations_create_work_order_v2(
  p_company_id uuid,
  p_property_id uuid,
  p_title text,
  p_building_id uuid default null,
  p_unit_id uuid default null,
  p_turnover_id uuid default null,
  p_work_site_id uuid default null,
  p_department_id uuid default null,
  p_description text default null,
  p_room_area text default null,
  p_issue_category text default null,
  p_required_skill_snapshot jsonb default '[]'::jsonb,
  p_priority public.work_priority default 'normal'::public.work_priority,
  p_occupancy_blocking boolean default false,
  p_blocking_phase text default null,
  p_estimated_minutes integer default null,
  p_due_at timestamptz default null,
  p_source_type text default 'manual',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_actor uuid := private.current_employee_id(p_company_id);
  v_record public.operation_records%rowtype;
  v_result jsonb;
  v_response jsonb;
  v_target_id uuid;
begin
  if v_user is null or v_actor is null then raise exception 'not_a_company_member'; end if;
  if nullif(trim(p_idempotency_key),'') is null then raise exception 'idempotency_key_required'; end if;
  if length(trim(p_idempotency_key)) > 200 then raise exception 'idempotency_key_too_long'; end if;

  select * into v_record
  from public.operation_records
  where company_id=p_company_id
    and actor_user_id=v_user
    and operation_name='operations_create_work_order_v2'
    and idempotency_key=trim(p_idempotency_key);

  if found and v_record.status='succeeded' and v_record.response_payload is not null then
    return v_record.response_payload || jsonb_build_object('idempotent',true);
  end if;

  insert into public.operation_records(
    company_id,actor_user_id,operation_name,idempotency_key,target_type,status
  )
  values(
    p_company_id,v_user,'operations_create_work_order_v2',trim(p_idempotency_key),'work_order','pending'
  )
  on conflict(company_id,actor_user_id,operation_name,idempotency_key) do nothing
  returning * into v_record;

  if not found then
    select * into v_record
    from public.operation_records
    where company_id=p_company_id
      and actor_user_id=v_user
      and operation_name='operations_create_work_order_v2'
      and idempotency_key=trim(p_idempotency_key)
    for update;

    if v_record.status='succeeded' and v_record.response_payload is not null then
      return v_record.response_payload || jsonb_build_object('idempotent',true);
    end if;
    raise exception 'work_order_create_in_progress';
  end if;

  v_result := public.operations_create_work_order(
    p_company_id,p_property_id,p_title,p_building_id,p_unit_id,p_turnover_id,
    p_work_site_id,p_department_id,p_description,p_room_area,p_issue_category,
    p_required_skill_snapshot,p_priority,p_occupancy_blocking,p_blocking_phase,
    p_estimated_minutes,p_due_at,p_source_type
  );

  v_target_id := (v_result->'work_order'->>'id')::uuid;
  v_response := v_result || jsonb_build_object('idempotent',false);

  update public.operation_records
  set target_id=v_target_id,
      status='succeeded',
      response_code='created',
      response_payload=v_response,
      completed_at=clock_timestamp()
  where id=v_record.id;

  return v_response;
end;
$$;

revoke all on function public.operations_create_work_order_v2(
  uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,
  public.work_priority,boolean,text,integer,timestamptz,text,text
) from public, anon;
grant execute on function public.operations_create_work_order_v2(
  uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,
  public.work_priority,boolean,text,integer,timestamptz,text,text
) to authenticated;

create or replace function private.can_view_work_order(p_work_order_id uuid,p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.has_company_role(
      p_company_id,
      array['owner','operations_manager','supervisor','dispatcher']::public.app_role[]
    )
    or exists(
      select 1
      from public.work_orders w
      where w.id=p_work_order_id
        and w.company_id=p_company_id
        and w.created_by=private.current_employee_id(p_company_id)
    )
    or exists(
      select 1
      from public.assignments a
      where a.company_id=p_company_id
        and a.work_order_id=p_work_order_id
        and a.employee_id=private.current_employee_id(p_company_id)
        and a.status not in ('declined','cancelled'::public.assignment_status)
    )
$$;

create or replace function private.log_work_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_actor uuid;
begin
  if new.status is not distinct from old.status then return new; end if;

  v_actor := private.current_employee_id(new.company_id);
  v_reason := case new.status
    when 'new' then 'Returned to dispatch queue'
    when 'assigned' then 'Work order assigned'
    when 'in_progress' then 'Work started'
    when 'pending_parts' then 'Waiting for parts'
    when 'blocked' then 'Work order blocked'
    when 'awaiting_verification' then 'Awaiting verification'
    when 'completed' then 'Work completed'
    when 'cancelled' then 'Work order cancelled'
    else 'Work-order status changed'
  end;

  insert into public.work_order_status_events(
    company_id,work_order_id,from_status,to_status,reason,actor_employee_id,created_at
  )
  values(
    new.company_id,new.id,old.status,new.status,v_reason,v_actor,clock_timestamp()
  );

  return new;
end;
$$;

drop trigger if exists log_work_order_status_change on public.work_orders;
create trigger log_work_order_status_change
after update of status on public.work_orders
for each row
when(old.status is distinct from new.status)
execute function private.log_work_order_status_change();

create or replace function public.dispatch_assignment_response(
  p_company_id uuid,
  p_assignment_id uuid,
  p_response text,
  p_decline_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_employee_id(p_company_id);
  v_manager boolean := private.has_company_role(
    p_company_id,
    array['owner','operations_manager','supervisor','dispatcher']::public.app_role[]
  );
  v_old public.assignments%rowtype;
  v_row public.assignments%rowtype;
begin
  if v_actor is null then raise exception 'not_a_company_member'; end if;
  if p_response not in ('accepted','declined') then raise exception 'invalid_assignment_response'; end if;
  if p_response='declined' and nullif(trim(p_decline_reason),'') is null
    then raise exception 'decline_reason_required';
  end if;

  select * into v_old
  from public.assignments
  where id=p_assignment_id and company_id=p_company_id
  for update;
  if not found then raise exception 'assignment_not_found'; end if;
  if v_old.employee_id<>v_actor and not v_manager then raise exception 'insufficient_permission'; end if;
  if v_old.status<>'offered' then raise exception 'invalid_assignment_response_state'; end if;

  update public.assignments
  set status=p_response::public.assignment_status,
      accepted_at=case when p_response='accepted' then clock_timestamp() else accepted_at end,
      decline_reason=case when p_response='declined' then trim(p_decline_reason) else null end,
      revision=revision+1
  where id=p_assignment_id
  returning * into v_row;

  if p_response='declined'
     and not exists(
       select 1 from public.assignments a
       where a.company_id=p_company_id
         and a.work_order_id=v_old.work_order_id
         and a.status in ('offered','accepted','active','paused','submitted')
     )
  then
    update public.work_orders
    set status='new',revision=revision+1,updated_at=clock_timestamp()
    where id=v_old.work_order_id
      and company_id=p_company_id
      and status not in ('new','completed','cancelled');
  end if;

  update public.employee_notifications
  set read_at=coalesce(read_at,clock_timestamp()),
      acknowledged_at=coalesce(acknowledged_at,clock_timestamp())
  where company_id=p_company_id
    and employee_id=v_old.employee_id
    and assignment_id=p_assignment_id;

  insert into public.audit_events(
    company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,
    before_data,after_data,reason
  )
  values(
    p_company_id,auth.uid(),v_actor,'assignment.'||p_response,'assignment',p_assignment_id,
    to_jsonb(v_old),to_jsonb(v_row),
    case when p_response='declined' then trim(p_decline_reason) end
  );

  return jsonb_build_object('ok',true,'assignment',to_jsonb(v_row));
end;
$$;

create or replace function public.dispatch_transition_assignment(
  p_company_id uuid,
  p_assignment_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

with latest as(
  select distinct on(e.work_order_id)
    e.work_order_id,
    e.to_status
  from public.work_order_status_events e
  order by e.work_order_id,e.created_at desc,e.id desc
)
insert into public.work_order_status_events(
  company_id,work_order_id,from_status,to_status,reason,actor_employee_id,created_at
)
select
  w.company_id,
  w.id,
  l.to_status,
  w.status,
  'Status history synchronized during work-order flow repair; earlier transitions were not recorded.',
  null,
  clock_timestamp()
from public.work_orders w
join latest l on l.work_order_id=w.id
where l.to_status is distinct from w.status;

create index if not exists work_orders_queue_created_idx
  on public.work_orders(company_id,status,created_at desc);
create index if not exists work_orders_property_idx
  on public.work_orders(property_id);
create index if not exists work_orders_building_idx
  on public.work_orders(building_id)
  where building_id is not null;
create index if not exists work_orders_unit_idx
  on public.work_orders(unit_id)
  where unit_id is not null;
create index if not exists work_orders_department_idx
  on public.work_orders(department_id)
  where department_id is not null;
create index if not exists work_orders_work_site_idx
  on public.work_orders(work_site_id)
  where work_site_id is not null;
create index if not exists work_order_dependencies_depends_on_idx
  on public.work_order_dependencies(depends_on_work_order_id);
create index if not exists work_order_status_events_company_idx
  on public.work_order_status_events(company_id,created_at desc);
