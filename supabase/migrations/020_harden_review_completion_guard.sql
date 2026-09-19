-- Prevent legacy or direct assignment transitions from completing AI work
-- that still requires management review, and re-check dependencies at completion.

create or replace function private.guard_assignment_work_order()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_is_entering_guarded_state boolean;
begin
  v_is_entering_guarded_state := tg_op='INSERT' or (
    tg_op='UPDATE'
    and new.status in ('offered','accepted','active','completed')
    and new.status is distinct from old.status
  );

  if v_is_entering_guarded_state and exists(
    select 1
    from public.ai_walkthrough_issues i
    where i.company_id=new.company_id
      and i.work_order_id=new.work_order_id
      and i.needs_review=true
  ) then
    raise exception 'work_order_needs_review';
  end if;

  if new.status in ('active','completed')
     and (tg_op='INSERT' or new.status is distinct from old.status)
     and exists(
       select 1
       from public.work_order_dependencies d
       join public.work_orders prerequisite
         on prerequisite.id=d.depends_on_work_order_id
        and prerequisite.company_id=d.company_id
       where d.company_id=new.company_id
         and d.work_order_id=new.work_order_id
         and prerequisite.status<>'completed'
     )
  then
    raise exception 'work_order_dependency_incomplete';
  end if;

  return new;
end
$$;

drop trigger if exists guard_assignment_work_order on public.assignments;
create trigger guard_assignment_work_order
before insert or update on public.assignments
for each row execute function private.guard_assignment_work_order();
