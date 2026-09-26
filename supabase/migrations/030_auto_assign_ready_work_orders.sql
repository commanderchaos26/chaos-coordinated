-- Automatically dispatch eligible work orders to the best available employee.
-- Manual/bulk dispatch remains available as an override.
-- Employee schedule conflicts are ranking signals only; they do not block dispatch.

create or replace function private.auto_assign_work_order(
  p_company_id uuid,
  p_work_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wo public.work_orders%rowtype;
  v_employee_id uuid;
  v_assignment public.assignments%rowtype;
  v_actor uuid;
  v_dedupe text;
  v_conflicts jsonb := '[]'::jsonb;
  v_start timestamptz := clock_timestamp();
  v_end timestamptz;
begin
  select * into v_wo
  from public.work_orders
  where id=p_work_order_id and company_id=p_company_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'skipped','work_order_not_found');
  end if;

  if v_wo.status <> 'new' then
    return jsonb_build_object('ok',true,'skipped','work_order_not_new');
  end if;

  if not exists(
    select 1 from public.companies c
    where c.id=p_company_id and c.status='active'
  ) then
    return jsonb_build_object('ok',true,'skipped','company_not_active');
  end if;

  if exists(
    select 1 from public.assignments a
    where a.company_id=p_company_id
      and a.work_order_id=p_work_order_id
      and a.status in ('offered','accepted','active','paused','submitted')
  ) then
    return jsonb_build_object('ok',true,'skipped','already_assigned');
  end if;

  if exists(
    select 1 from public.ai_walkthrough_issues i
    where i.company_id=p_company_id
      and i.work_order_id=p_work_order_id
      and i.needs_review=true
  ) then
    return jsonb_build_object('ok',true,'skipped','work_order_needs_review');
  end if;

  v_end := v_start + make_interval(mins => greatest(coalesce(v_wo.estimated_minutes,60),1));

  select e.id
  into v_employee_id
  from public.employees e
  where e.company_id=p_company_id
    and e.employment_status='active'
    and exists(
      select 1
      from public.employee_account_links l
      where l.company_id=p_company_id
        and l.employee_id=e.id
        and l.status='active'
    )
    and not exists(
      select 1
      from public.platform_test_accounts pta
      where pta.company_id=p_company_id
        and pta.employee_id=e.id
        and pta.active=true
    )
    and not exists(
      select 1
      from public.assignments previous
      where previous.company_id=p_company_id
        and previous.work_order_id=p_work_order_id
        and previous.employee_id=e.id
        and previous.status in ('declined','cancelled')
    )
  order by
    case when exists(
      select 1
      from public.role_grants rg
      where rg.company_id=p_company_id
        and rg.employee_id=e.id
        and rg.revoked_at is null
        and rg.role in ('technician','crew_lead')
    ) then 1 else 0 end desc,
    case
      when v_wo.department_id is null then 1
      when e.primary_department_id=v_wo.department_id then 1
      when exists(
        select 1
        from public.employee_departments ed
        where ed.company_id=p_company_id
          and ed.employee_id=e.id
          and ed.department_id=v_wo.department_id
          and ed.active=true
      ) then 1
      else 0
    end desc,
    (
      select count(*)
      from public.employee_skills es
      where es.company_id=p_company_id
        and es.employee_id=e.id
        and es.skill_id::text in (
          select skill.value->>'skill_id'
          from jsonb_array_elements(coalesce(v_wo.required_skill_snapshot,'[]'::jsonb)) as skill(value)
          where jsonb_typeof(skill.value)='object'
            and nullif(trim(skill.value->>'skill_id'),'') is not null
        )
    ) desc,
    jsonb_array_length(
      private.employee_schedule_conflicts(
        p_company_id,e.id,v_start,v_end,p_work_order_id
      )
    ) asc,
    (
      select count(*)
      from public.assignments active_assignment
      where active_assignment.company_id=p_company_id
        and active_assignment.employee_id=e.id
        and active_assignment.status in ('offered','accepted','active','paused','submitted')
    ) asc,
    e.display_name asc,
    e.id asc
  limit 1;

  if v_employee_id is null then
    return jsonb_build_object('ok',true,'skipped','no_eligible_employee');
  end if;

  v_conflicts := private.employee_schedule_conflicts(
    p_company_id,v_employee_id,v_start,v_end,p_work_order_id
  );
  v_actor := coalesce(private.current_employee_id(p_company_id),v_wo.created_by);

  begin
    insert into public.assignments(
      company_id,work_order_id,employee_id,status,assignment_type,
      scheduled_start,scheduled_end,created_by
    )
    values(
      p_company_id,p_work_order_id,v_employee_id,'offered','task',
      null,null,v_actor
    )
    returning * into v_assignment;
  exception when unique_violation then
    return jsonb_build_object('ok',true,'skipped','assignment_race_lost');
  end;

  update public.work_orders
  set status='assigned',
      revision=revision+1,
      updated_at=clock_timestamp()
  where id=p_work_order_id and company_id=p_company_id;

  v_dedupe := 'assignment:'||v_assignment.id::text||':offered:v'||v_assignment.revision::text;

  insert into public.employee_notifications(
    company_id,employee_id,notification_type,title,body,priority,
    entity_type,entity_id,assignment_id,dedupe_key,payload
  )
  values(
    p_company_id,v_employee_id,'assignment.offered','New work order assigned',
    v_wo.title,v_wo.priority::text,'work_order',p_work_order_id,
    v_assignment.id,v_dedupe,
    jsonb_build_object(
      'work_order_id',p_work_order_id,
      'assignment_id',v_assignment.id,
      'priority',v_wo.priority,
      'auto_assigned',true,
      'availability_conflicts_observed',v_conflicts
    )
  )
  on conflict(company_id,employee_id,dedupe_key) do nothing;

  insert into public.outbox_events(
    company_id,event_type,aggregate_type,aggregate_id,dedupe_key,payload,status
  )
  values(
    p_company_id,'assignment.offered','assignment',v_assignment.id,v_dedupe,
    jsonb_build_object(
      'employee_id',v_employee_id,
      'work_order_id',p_work_order_id,
      'assignment_id',v_assignment.id,
      'title','New work order assigned',
      'body',v_wo.title,
      'priority',v_wo.priority,
      'auto_assigned',true
    ),
    'pending'
  )
  on conflict(company_id,dedupe_key) do nothing;

  insert into public.audit_events(
    company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,
    after_data,reason
  )
  values(
    p_company_id,auth.uid(),v_actor,'assignment.auto_offered','assignment',
    v_assignment.id,to_jsonb(v_assignment),
    'Automatically assigned using department, skills, schedule, and workload ranking'
  );

  return jsonb_build_object(
    'ok',true,
    'auto_assigned',true,
    'employee_id',v_employee_id,
    'assignment',to_jsonb(v_assignment),
    'availability_conflicts_observed',v_conflicts
  );
end
$$;

revoke all on function private.auto_assign_work_order(uuid,uuid)
from public,anon,authenticated;

create or replace function private.auto_assign_work_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- AI/walkthrough work orders are assigned only after their issue row exists,
  -- so review_required can never be bypassed during finalization.
  if tg_op='INSERT'
     and new.source_type in ('ai_walkthrough','walkthrough')
  then
    return new;
  end if;

  if new.status='new' then
    perform private.auto_assign_work_order(new.company_id,new.id);
  end if;
  return new;
end
$$;

revoke all on function private.auto_assign_work_order_change()
from public,anon,authenticated;

drop trigger if exists auto_assign_work_order_change on public.work_orders;
create trigger auto_assign_work_order_change
after insert or update of status,department_id,required_skill_snapshot
on public.work_orders
for each row
execute function private.auto_assign_work_order_change();

create or replace function private.auto_assign_ai_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.needs_review=false then
    perform private.auto_assign_work_order(new.company_id,new.work_order_id);
  end if;
  return new;
end
$$;

revoke all on function private.auto_assign_ai_issue()
from public,anon,authenticated;

drop trigger if exists auto_assign_ai_issue on public.ai_walkthrough_issues;
create trigger auto_assign_ai_issue
after insert or update of needs_review,department_id
on public.ai_walkthrough_issues
for each row
execute function private.auto_assign_ai_issue();
