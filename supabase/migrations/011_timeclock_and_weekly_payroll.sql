create table if not exists public.payroll_exports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  week_start date not null,
  week_end date not null,
  file_name text not null,
  content text not null,
  daily_hours jsonb not null default '{}'::jsonb,
  total_hours numeric(10,2) not null default 0,
  generated_at timestamptz not null default now(),
  generated_by text not null default 'scheduled',
  unique(company_id, employee_id, week_start)
);

create index if not exists payroll_exports_company_week_idx
  on public.payroll_exports(company_id, week_start desc, employee_id);

alter table public.payroll_exports enable row level security;

drop policy if exists payroll_exports_management_select on public.payroll_exports;
create policy payroll_exports_management_select
on public.payroll_exports
for select
to authenticated
using (
  private.has_company_role(
    company_id,
    array['owner','operations_manager']::public.app_role[]
  )
);

create or replace function public.timeclock_punch(
  p_company_id uuid,
  p_action public.attendance_action
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_employee uuid := private.current_employee_id(p_company_id);
  v_last public.attendance_events%rowtype;
  v_event public.attendance_events%rowtype;
  v_correlation uuid := gen_random_uuid();
begin
  if v_employee is null then raise exception 'not_a_company_member'; end if;
  if p_action not in ('check_in','check_out') then raise exception 'invalid_timeclock_action'; end if;

  if not exists (
    select 1 from public.employees e
    where e.id=v_employee and e.company_id=p_company_id and e.employment_status='active'
  ) then
    raise exception 'employee_not_active';
  end if;

  select * into v_last
  from public.attendance_events
  where company_id=p_company_id and employee_id=v_employee
    and action in ('check_in','check_out')
  order by occurred_at desc, created_at desc
  limit 1;

  if p_action='check_in' and v_last.id is not null and v_last.action='check_in' then
    raise exception 'already_clocked_in';
  end if;

  if p_action='check_out' and (v_last.id is null or v_last.action<>'check_in') then
    raise exception 'not_clocked_in';
  end if;

  insert into public.attendance_events(
    company_id,employee_id,action,occurred_at,source,note
  )
  values(
    p_company_id,v_employee,p_action,now(),'mobile_self_service',null
  )
  returning * into v_event;

  insert into public.audit_events(
    company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,after_data,correlation_id
  )
  values(
    p_company_id,auth.uid(),v_employee,
    case when p_action='check_in' then 'timeclock.clock_in' else 'timeclock.clock_out' end,
    'attendance_event',v_event.id,to_jsonb(v_event),v_correlation
  );

  return jsonb_build_object('ok',true,'event',to_jsonb(v_event),'clocked_in',p_action='check_in');
end
$$;

revoke all on function public.timeclock_punch(uuid,public.attendance_action) from public, anon;
grant execute on function public.timeclock_punch(uuid,public.attendance_action) to authenticated;

create or replace function public.payroll_generate_previous_week_service(
  p_company_id uuid default null,
  p_reference_date date default null
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  c record;
  e record;
  v_reference_date date;
  v_week_start date;
  v_week_end date;
  v_monday numeric(10,2);
  v_tuesday numeric(10,2);
  v_wednesday numeric(10,2);
  v_thursday numeric(10,2);
  v_friday numeric(10,2);
  v_total numeric(10,2);
  v_first text;
  v_last text;
  v_file_name text;
  v_content text;
  v_count integer := 0;
begin
  for c in
    select id, timezone
    from public.companies
    where status='active'
      and (p_company_id is null or id=p_company_id)
  loop
    v_reference_date := coalesce(p_reference_date, (now() at time zone coalesce(c.timezone,'UTC'))::date);
    v_week_start := date_trunc('week', v_reference_date::timestamp)::date - 7;
    v_week_end := v_week_start + 4;

    for e in
      select id, display_name
      from public.employees
      where company_id=c.id
        and employment_status in ('active','leave')
      order by display_name
    loop
      with ordered as (
        select
          action,
          occurred_at,
          lead(action) over(order by occurred_at, created_at) as next_action,
          lead(occurred_at) over(order by occurred_at, created_at) as next_at
        from public.attendance_events
        where company_id=c.id
          and employee_id=e.id
          and occurred_at >= ((v_week_start - 1)::timestamp at time zone coalesce(c.timezone,'UTC'))
          and occurred_at < (((v_week_end + 2)::date)::timestamp at time zone coalesce(c.timezone,'UTC'))
          and action in ('check_in','check_out')
      ),
      pairs as (
        select
          (occurred_at at time zone coalesce(c.timezone,'UTC'))::date as work_date,
          greatest(0, extract(epoch from (next_at-occurred_at))/3600.0) as hours
        from ordered
        where action='check_in'
          and next_action='check_out'
          and next_at is not null
      )
      select
        coalesce(round(sum(hours) filter (where work_date=v_week_start),2),0),
        coalesce(round(sum(hours) filter (where work_date=v_week_start+1),2),0),
        coalesce(round(sum(hours) filter (where work_date=v_week_start+2),2),0),
        coalesce(round(sum(hours) filter (where work_date=v_week_start+3),2),0),
        coalesce(round(sum(hours) filter (where work_date=v_week_start+4),2),0)
      into v_monday,v_tuesday,v_wednesday,v_thursday,v_friday
      from pairs
      where work_date between v_week_start and v_week_end;

      v_total := coalesce(v_monday,0)+coalesce(v_tuesday,0)+coalesce(v_wednesday,0)+coalesce(v_thursday,0)+coalesce(v_friday,0);

      v_first := split_part(regexp_replace(trim(e.display_name), '\s+', ' ', 'g'), ' ', 1);
      v_last := split_part(regexp_replace(trim(e.display_name), '\s+', ' ', 'g'), ' ', 2);
      if nullif(v_last,'') is null then v_last := 'Employee'; end if;
      v_file_name := regexp_replace(trim(v_first || ' ' || v_last), '[^A-Za-z0-9 _-]', '', 'g') || '.txt';

      v_content :=
        'Employee: ' || trim(v_first || ' ' || v_last) || E'\n' ||
        'Payroll period: ' || to_char(v_week_start,'Mon DD, YYYY') || ' - ' || to_char(v_week_end,'Mon DD, YYYY') || E'\n\n' ||
        'Monday: ' || to_char(coalesce(v_monday,0),'FM999990.00') || E' hours\n' ||
        'Tuesday: ' || to_char(coalesce(v_tuesday,0),'FM999990.00') || E' hours\n' ||
        'Wednesday: ' || to_char(coalesce(v_wednesday,0),'FM999990.00') || E' hours\n' ||
        'Thursday: ' || to_char(coalesce(v_thursday,0),'FM999990.00') || E' hours\n' ||
        'Friday: ' || to_char(coalesce(v_friday,0),'FM999990.00') || E' hours\n\n' ||
        'Total Hours: ' || to_char(coalesce(v_total,0),'FM999990.00') || E'\n';

      insert into public.payroll_exports(
        company_id,employee_id,week_start,week_end,file_name,content,daily_hours,total_hours,generated_at,generated_by
      )
      values(
        c.id,e.id,v_week_start,v_week_end,v_file_name,v_content,
        jsonb_build_object(
          'monday',coalesce(v_monday,0),
          'tuesday',coalesce(v_tuesday,0),
          'wednesday',coalesce(v_wednesday,0),
          'thursday',coalesce(v_thursday,0),
          'friday',coalesce(v_friday,0)
        ),
        coalesce(v_total,0),now(),'scheduled'
      )
      on conflict(company_id,employee_id,week_start)
      do update set
        week_end=excluded.week_end,
        file_name=excluded.file_name,
        content=excluded.content,
        daily_hours=excluded.daily_hours,
        total_hours=excluded.total_hours,
        generated_at=now();

      v_count := v_count + 1;
    end loop;
  end loop;

  return v_count;
end
$$;

revoke all on function public.payroll_generate_previous_week_service(uuid,date) from public, anon, authenticated;

create or replace function public.payroll_generate_previous_week(
  p_company_id uuid,
  p_reference_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid := private.current_employee_id(p_company_id);
  v_count integer;
begin
  if v_actor is null then raise exception 'not_a_company_member'; end if;
  if not private.has_company_role(p_company_id, array['owner','operations_manager']::public.app_role[]) then
    raise exception 'insufficient_permission';
  end if;

  v_count := public.payroll_generate_previous_week_service(p_company_id,p_reference_date);

  insert into public.audit_events(
    company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,after_data
  )
  values(
    p_company_id,auth.uid(),v_actor,'payroll.generated','company',p_company_id,
    jsonb_build_object('export_count',v_count,'reference_date',p_reference_date)
  );

  return jsonb_build_object('ok',true,'export_count',v_count);
end
$$;

revoke all on function public.payroll_generate_previous_week(uuid,date) from public, anon;
grant execute on function public.payroll_generate_previous_week(uuid,date) to authenticated;

create extension if not exists pg_cron;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='weekly-payroll-thursday' limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'weekly-payroll-thursday',
    '0 13 * * 4',
    'select public.payroll_generate_previous_week_service();'
  );
end
$$;
