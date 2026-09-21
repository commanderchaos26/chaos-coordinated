-- Targeted covering indexes surfaced by the Supabase performance advisor
-- for the work-order / assignment lifecycle.

create index if not exists assignments_company_idx
  on public.assignments(company_id);

create index if not exists work_order_dependencies_company_idx
  on public.work_order_dependencies(company_id);

create index if not exists work_order_status_events_actor_employee_idx
  on public.work_order_status_events(actor_employee_id)
  where actor_employee_id is not null;

create index if not exists employee_notifications_assignment_idx
  on public.employee_notifications(assignment_id)
  where assignment_id is not null;

create index if not exists location_events_assignment_idx
  on public.location_events(assignment_id)
  where assignment_id is not null;

create index if not exists location_events_work_order_idx
  on public.location_events(work_order_id)
  where work_order_id is not null;
