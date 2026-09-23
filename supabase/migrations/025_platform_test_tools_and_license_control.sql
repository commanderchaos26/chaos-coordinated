-- Platform QA tooling and non-destructive company suspension control.
-- Suspension keeps authentication/read access available while blocking operational writes.

alter table public.companies
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_by_user_id uuid,
  add column if not exists suspension_reason text;

create table if not exists public.platform_owner_grants (
  user_id uuid primary key,
  label text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_owner_grants enable row level security;
revoke all on table public.platform_owner_grants from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_owner_grants to service_role;

create table if not exists public.platform_license_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  actor_user_id uuid not null,
  from_status text not null,
  to_status text not null check (to_status in ('active','suspended')),
  reason text,
  created_at timestamptz not null default now()
);

alter table public.platform_license_events enable row level security;
revoke all on table public.platform_license_events from public, anon, authenticated;
grant select, insert on table public.platform_license_events to service_role;

create table if not exists public.platform_test_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null unique references public.employees(id),
  auth_user_id uuid not null unique,
  email text not null,
  label text not null default 'QA Technician',
  active boolean not null default true,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  unique(company_id,email)
);

alter table public.platform_test_accounts enable row level security;
revoke all on table public.platform_test_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_test_accounts to service_role;

create table if not exists public.platform_test_artifacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  test_account_id uuid not null references public.platform_test_accounts(id),
  property_id uuid references public.properties(id),
  building_id uuid references public.buildings(id),
  unit_id uuid references public.units(id),
  turnover_id uuid references public.turnovers(id),
  work_order_id uuid references public.work_orders(id),
  assignment_id uuid references public.assignments(id),
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

alter table public.platform_test_artifacts enable row level security;
revoke all on table public.platform_test_artifacts from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_test_artifacts to service_role;

create or replace function private.enforce_company_active()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_company_id uuid;
  v_status text;
begin
  v_company_id := case when tg_op='DELETE' then old.company_id else new.company_id end;
  select c.status into v_status from public.companies c where c.id=v_company_id;
  if v_status is null then
    raise exception 'company_not_found' using errcode='42501';
  end if;
  if v_status <> 'active' then
    raise exception 'company_suspended' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare
  v_table text;
begin
  for v_table in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema=c.table_schema and t.table_name=c.table_name
    where c.table_schema='public'
      and c.column_name='company_id'
      and t.table_type='BASE TABLE'
      and c.table_name not in (
        'audit_events',
        'operation_records',
        'outbox_events',
        'employee_account_links',
        'employee_notifications',
        'attendance_events',
        'payroll_exports',
        'push_devices',
        'platform_license_events',
        'platform_test_accounts',
        'platform_test_artifacts'
      )
  loop
    execute format('drop trigger if exists company_active_write_guard on public.%I', v_table);
    execute format(
      'create trigger company_active_write_guard before insert or update or delete on public.%I for each row execute function private.enforce_company_active()',
      v_table
    );
  end loop;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='companies'
  ) then
    alter publication supabase_realtime add table public.companies;
  end if;
end
$$;

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

create or replace function public.platform_retire_test_account(
  p_company_id uuid,
  p_test_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_company_status text;
  v_employee_id uuid;
begin
  select status into v_company_status from public.companies where id=p_company_id;
  if v_company_status <> 'active' then raise exception 'company_suspended'; end if;

  select employee_id into v_employee_id
  from public.platform_test_accounts
  where id=p_test_account_id and company_id=p_company_id;
  if v_employee_id is null then raise exception 'test_account_not_found'; end if;

  update public.assignments a
  set status='cancelled',completed_at=coalesce(completed_at,clock_timestamp()),updated_at=clock_timestamp()
  where a.id in (
    select assignment_id from public.platform_test_artifacts
    where company_id=p_company_id and test_account_id=p_test_account_id and assignment_id is not null
  ) and a.status not in ('completed','cancelled');

  update public.work_orders w
  set status='cancelled',revision=revision+1,updated_at=clock_timestamp()
  where w.id in (
    select work_order_id from public.platform_test_artifacts
    where company_id=p_company_id and test_account_id=p_test_account_id and work_order_id is not null
  ) and w.status not in ('completed','cancelled');

  update public.turnovers t
  set status='cancelled',cancelled_reason='QA test retired',revision=revision+1,updated_at=clock_timestamp()
  where t.id in (
    select turnover_id from public.platform_test_artifacts
    where company_id=p_company_id and test_account_id=p_test_account_id and turnover_id is not null
  ) and t.status not in ('closed','cancelled');

  update public.properties p
  set active=false,updated_at=clock_timestamp()
  where p.id in (
    select property_id from public.platform_test_artifacts
    where company_id=p_company_id and test_account_id=p_test_account_id and property_id is not null
  );

  update public.role_grants
  set revoked_at=coalesce(revoked_at,clock_timestamp())
  where company_id=p_company_id and employee_id=v_employee_id and revoked_at is null;

  update public.employee_account_links
  set status='closed',suspended_at=coalesce(suspended_at,clock_timestamp()),updated_at=clock_timestamp()
  where company_id=p_company_id and employee_id=v_employee_id;

  update public.employees
  set employment_status='inactive',end_date=coalesce(end_date,current_date),updated_at=clock_timestamp()
  where company_id=p_company_id and id=v_employee_id;

  update public.platform_test_artifacts
  set status='retired',retired_at=coalesce(retired_at,clock_timestamp())
  where company_id=p_company_id and test_account_id=p_test_account_id and status='active';

  update public.platform_test_accounts
  set active=false,retired_at=coalesce(retired_at,clock_timestamp())
  where company_id=p_company_id and id=p_test_account_id;

  return jsonb_build_object('ok',true,'employee_id',v_employee_id);
end;
$$;

revoke all on function public.platform_retire_test_account(uuid,uuid) from public, anon, authenticated;
grant execute on function public.platform_retire_test_account(uuid,uuid) to service_role;
