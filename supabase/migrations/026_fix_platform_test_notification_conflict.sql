-- Correct the QA notification conflict target for the composite unique key.
create or replace function public.platform_seed_test_flow(
  p_company_id uuid,
  p_test_account_id uuid,
  p_created_by_employee_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_company_status text;
  v_employee_id uuid;
  v_property_id uuid;
  v_building_id uuid;
  v_unit_id uuid;
  v_turnover_id uuid;
  v_work_order_id uuid;
  v_assignment_id uuid;
  v_artifact public.platform_test_artifacts%rowtype;
begin
  select status into v_company_status from public.companies where id=p_company_id;
  if v_company_status <> 'active' then raise exception 'company_suspended'; end if;

  select employee_id into v_employee_id
  from public.platform_test_accounts
  where id=p_test_account_id and company_id=p_company_id and active=true;
  if v_employee_id is null then raise exception 'test_account_not_found'; end if;

  select * into v_artifact
  from public.platform_test_artifacts
  where company_id=p_company_id and test_account_id=p_test_account_id and status='active'
  order by created_at desc limit 1;

  if found then
    return jsonb_build_object(
      'ok',true,'idempotent',true,
      'artifact',to_jsonb(v_artifact)
    );
  end if;

  select id into v_property_id
  from public.properties
  where company_id=p_company_id and name='[TEST] Chaos QA' and active=true
  order by created_at desc limit 1;

  if v_property_id is null then
    insert into public.properties(company_id,name,timezone,active)
    values(p_company_id,'[TEST] Chaos QA','America/Detroit',true)
    returning id into v_property_id;
  end if;

  select id into v_building_id
  from public.buildings
  where company_id=p_company_id and property_id=v_property_id and name='[TEST] Building' and active=true
  limit 1;

  if v_building_id is null then
    insert into public.buildings(company_id,property_id,name,code,active)
    values(p_company_id,v_property_id,'[TEST] Building','TEST',true)
    returning id into v_building_id;
  end if;

  select id into v_unit_id
  from public.units
  where company_id=p_company_id and building_id=v_building_id and unit_number='TEST-001' and active=true
  limit 1;

  if v_unit_id is null then
    insert into public.units(company_id,property_id,building_id,unit_number,layout_name,active)
    values(p_company_id,v_property_id,v_building_id,'TEST-001','QA Test Unit',true)
    returning id into v_unit_id;
  end if;

  insert into public.turnovers(
    company_id,property_id,building_id,unit_id,status,rough_clean_required,
    workflow_policy_version,created_by
  )
  values(
    p_company_id,v_property_id,v_building_id,v_unit_id,'intake',false,
    '2026.09-test',p_created_by_employee_id
  )
  returning id into v_turnover_id;

  insert into public.phase_runs(company_id,turnover_id,phase_key,cycle,state)
  values
    (p_company_id,v_turnover_id,'walkthrough',1,'pending'),
    (p_company_id,v_turnover_id,'maintenance',1,'pending'),
    (p_company_id,v_turnover_id,'drying',1,'pending'),
    (p_company_id,v_turnover_id,'paint',1,'pending'),
    (p_company_id,v_turnover_id,'final_clean',1,'pending'),
    (p_company_id,v_turnover_id,'inspection',1,'pending');

  insert into public.turnover_status_events(
    company_id,turnover_id,from_status,to_status,reason,actor_employee_id
  )
  values(
    p_company_id,v_turnover_id,null,'intake','QA test turnover created',p_created_by_employee_id
  );

  insert into public.work_orders(
    company_id,property_id,building_id,unit_id,turnover_id,
    source_type,title,description,status,priority,created_by
  )
  values(
    p_company_id,v_property_id,v_building_id,v_unit_id,v_turnover_id,
    'manual','[TEST] Turnover verification',
    'QA-only work order used to verify technician dispatch and completion.',
    'assigned','normal',p_created_by_employee_id
  )
  returning id into v_work_order_id;

  insert into public.work_order_status_events(
    company_id,work_order_id,from_status,to_status,reason,actor_employee_id
  )
  values(
    p_company_id,v_work_order_id,null,'assigned','QA test work order assigned',p_created_by_employee_id
  );

  insert into public.assignments(
    company_id,work_order_id,employee_id,status,assignment_type,created_by
  )
  values(
    p_company_id,v_work_order_id,v_employee_id,'offered','task',p_created_by_employee_id
  )
  returning id into v_assignment_id;

  insert into public.employee_notifications(
    company_id,employee_id,notification_type,title,body,priority,
    entity_type,entity_id,assignment_id,dedupe_key,payload
  )
  values(
    p_company_id,v_employee_id,'assignment_offered','QA test assignment',
    'A test turnover assignment is ready for end-to-end verification.','normal',
    'assignment',v_assignment_id,v_assignment_id,
    'qa-assignment-'||v_assignment_id::text,
    jsonb_build_object('test',true,'work_order_id',v_work_order_id,'turnover_id',v_turnover_id)
  )
  on conflict(company_id,employee_id,dedupe_key) do nothing;

  insert into public.platform_test_artifacts(
    company_id,test_account_id,property_id,building_id,unit_id,
    turnover_id,work_order_id,assignment_id
  )
  values(
    p_company_id,p_test_account_id,v_property_id,v_building_id,v_unit_id,
    v_turnover_id,v_work_order_id,v_assignment_id
  )
  returning * into v_artifact;

  return jsonb_build_object('ok',true,'idempotent',false,'artifact',to_jsonb(v_artifact));
end;
$$;

revoke all on function public.platform_seed_test_flow(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.platform_seed_test_flow(uuid,uuid,uuid) to service_role;
