-- Add safe property deletion through archival.
-- Historical records remain intact; active work must be resolved first.

create or replace function public.operations_archive_property(
  p_company_id uuid,
  p_property_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := private.current_employee_id(p_company_id);
  v_property public.properties%rowtype;
  v_after public.properties%rowtype;
  v_open_work integer;
  v_open_turnovers integer;
begin
  if v_actor is null then
    raise exception 'not_a_company_member';
  end if;

  if not private.has_company_role(
    p_company_id,
    array['owner','operations_manager']::public.app_role[]
  ) then
    raise exception 'insufficient_permission';
  end if;

  select *
    into v_property
    from public.properties
   where id = p_property_id
     and company_id = p_company_id
     and active
   for update;

  if not found then
    raise exception 'property_not_found';
  end if;

  select count(*)
    into v_open_work
    from public.work_orders
   where company_id = p_company_id
     and property_id = p_property_id
     and status not in ('completed'::public.work_order_status, 'cancelled'::public.work_order_status);

  if v_open_work > 0 then
    raise exception 'property_has_active_work:%', v_open_work;
  end if;

  select count(*)
    into v_open_turnovers
    from public.turnovers
   where company_id = p_company_id
     and property_id = p_property_id
     and status not in ('cancelled'::public.turnover_status, 'closed'::public.turnover_status);

  if v_open_turnovers > 0 then
    raise exception 'property_has_active_turnovers:%', v_open_turnovers;
  end if;

  update public.work_site_boundary_versions
     set effective_to = coalesce(effective_to, now())
   where company_id = p_company_id
     and work_site_id in (
       select id
         from public.work_sites
        where company_id = p_company_id
          and property_id = p_property_id
          and active
     )
     and effective_to is null;

  update public.work_sites
     set active = false
   where company_id = p_company_id
     and property_id = p_property_id
     and active;

  update public.units
     set active = false
   where company_id = p_company_id
     and property_id = p_property_id
     and active;

  update public.buildings
     set active = false
   where company_id = p_company_id
     and property_id = p_property_id
     and active;

  update public.properties
     set active = false,
         updated_at = now()
   where id = p_property_id
     and company_id = p_company_id
  returning * into v_after;

  insert into public.audit_events(
    company_id,
    actor_user_id,
    actor_employee_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data
  )
  values(
    p_company_id,
    auth.uid(),
    v_actor,
    'property.archived',
    'property',
    p_property_id,
    to_jsonb(v_property),
    to_jsonb(v_after)
  );

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'archived', true
  );
end;
$function$;

revoke all on function public.operations_archive_property(uuid, uuid) from public;
revoke all on function public.operations_archive_property(uuid, uuid) from anon;
grant execute on function public.operations_archive_property(uuid, uuid) to authenticated;
