-- Keep archived properties out of active workflows and allow their names to be reused.
-- Also make client creation retry-safe after a successful commit with a lost mobile response.

alter table public.properties
  drop constraint if exists properties_company_id_name_key;

create unique index if not exists properties_company_active_name_uidx
  on public.properties(company_id, name)
  where active = true;

create or replace function private.require_active_property_reference()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.property_id is not null
     and not exists (
       select 1
       from public.properties p
       where p.id = new.property_id
         and p.company_id = new.company_id
         and p.active = true
     )
  then
    raise exception 'property_archived';
  end if;

  return new;
end
$$;

drop trigger if exists require_active_property_buildings on public.buildings;
create trigger require_active_property_buildings
before insert or update of property_id on public.buildings
for each row execute function private.require_active_property_reference();

drop trigger if exists require_active_property_units on public.units;
create trigger require_active_property_units
before insert or update of property_id on public.units
for each row execute function private.require_active_property_reference();

drop trigger if exists require_active_property_work_sites on public.work_sites;
create trigger require_active_property_work_sites
before insert or update of property_id on public.work_sites
for each row execute function private.require_active_property_reference();

drop trigger if exists require_active_property_turnovers on public.turnovers;
create trigger require_active_property_turnovers
before insert or update of property_id on public.turnovers
for each row execute function private.require_active_property_reference();

drop trigger if exists require_active_property_work_orders on public.work_orders;
create trigger require_active_property_work_orders
before insert or update of property_id on public.work_orders
for each row execute function private.require_active_property_reference();

drop trigger if exists require_active_property_client_properties on public.client_properties;
create trigger require_active_property_client_properties
before insert or update of property_id on public.client_properties
for each row execute function private.require_active_property_reference();

drop trigger if exists require_active_property_client_documents on public.client_documents;
create trigger require_active_property_client_documents
before insert or update of property_id on public.client_documents
for each row execute function private.require_active_property_reference();

drop trigger if exists require_active_property_turn_list_imports on public.turn_list_imports;
create trigger require_active_property_turn_list_imports
before insert or update of property_id on public.turn_list_imports
for each row execute function private.require_active_property_reference();

drop trigger if exists require_active_property_turn_list_items on public.turn_list_items;
create trigger require_active_property_turn_list_items
before insert or update of property_id on public.turn_list_items
for each row execute function private.require_active_property_reference();

drop trigger if exists require_active_property_ai_walkthrough_sessions on public.ai_walkthrough_sessions;
create trigger require_active_property_ai_walkthrough_sessions
before insert or update of property_id on public.ai_walkthrough_sessions
for each row execute function private.require_active_property_reference();

create or replace function public.client_create_with_property(
  p_company_id uuid,
  p_client_name text,
  p_phone text default null,
  p_email text default null,
  p_property_name text default null,
  p_address_line1 text default null,
  p_city text default null,
  p_region text default null,
  p_postal_code text default null,
  p_country_code text default 'US'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid := private.current_employee_id(p_company_id);
  v_client public.clients%rowtype;
  v_property public.properties%rowtype;
  v_property_name text;
  v_existing_client_id uuid;
  v_existing_property_id uuid;
begin
  if v_actor is null then raise exception 'not_a_company_member'; end if;
  if not private.has_company_role(p_company_id, array['owner','operations_manager']::public.app_role[]) then
    raise exception 'insufficient_permission';
  end if;
  if nullif(trim(coalesce(p_client_name,'')),'') is null then raise exception 'client_name_required'; end if;
  if nullif(trim(coalesce(p_address_line1,'')),'') is null then raise exception 'property_address_required'; end if;

  v_property_name := coalesce(nullif(trim(coalesce(p_property_name,'')),''), trim(p_address_line1));

  -- Serialize same-company/same-property-name creation so two mobile retries
  -- cannot both pass the existence check before one commits.
  perform pg_advisory_xact_lock(
    hashtextextended(p_company_id::text || '|' || v_property_name, 0)
  );

  select c.id, p.id
    into v_existing_client_id, v_existing_property_id
  from public.clients c
  join public.client_properties cp
    on cp.company_id = c.company_id
   and cp.client_id = c.id
  join public.properties p
    on p.company_id = cp.company_id
   and p.id = cp.property_id
  where c.company_id = p_company_id
    and c.active = true
    and p.active = true
    and trim(c.name) = trim(p_client_name)
    and coalesce(nullif(trim(c.phone),''),'') = coalesce(nullif(trim(coalesce(p_phone,'')),''),'')
    and coalesce(lower(nullif(trim(c.email),'')),'') = coalesce(lower(nullif(trim(coalesce(p_email,'')),'')),'')
    and p.name = v_property_name
    and coalesce(trim(p.address_line1),'') = trim(p_address_line1)
    and coalesce(trim(p.city),'') = coalesce(nullif(trim(coalesce(p_city,'')),''),'')
    and coalesce(trim(p.region),'') = coalesce(nullif(trim(coalesce(p_region,'')),''),'')
    and coalesce(trim(p.postal_code),'') = coalesce(nullif(trim(coalesce(p_postal_code,'')),''),'')
    and p.country_code = coalesce(nullif(trim(coalesce(p_country_code,'')),''),'US')
  order by c.created_at desc
  limit 1;

  if v_existing_client_id is not null and v_existing_property_id is not null then
    select * into v_client from public.clients where id = v_existing_client_id;
    select * into v_property from public.properties where id = v_existing_property_id;
    return jsonb_build_object(
      'ok', true,
      'client', to_jsonb(v_client),
      'property', to_jsonb(v_property),
      'already_existed', true
    );
  end if;

  if exists (
    select 1
    from public.properties p
    where p.company_id = p_company_id
      and p.name = v_property_name
      and p.active = true
  ) then
    raise exception 'property_name_already_exists';
  end if;

  insert into public.clients(company_id,name,phone,email,billing_email,created_by)
  values(
    p_company_id,trim(p_client_name),nullif(trim(coalesce(p_phone,'')),''),
    nullif(trim(coalesce(p_email,'')),''),nullif(trim(coalesce(p_email,'')),''),
    v_actor
  )
  returning * into v_client;

  insert into public.properties(
    company_id,name,address_line1,city,region,postal_code,country_code,timezone,active
  )
  values(
    p_company_id,v_property_name,trim(p_address_line1),
    nullif(trim(coalesce(p_city,'')),''),nullif(trim(coalesce(p_region,'')),''),
    nullif(trim(coalesce(p_postal_code,'')),''),coalesce(nullif(trim(coalesce(p_country_code,'')),''),'US'),
    (select timezone from public.companies where id=p_company_id),true
  )
  returning * into v_property;

  insert into public.client_properties(company_id,client_id,property_id,is_primary,created_by)
  values(p_company_id,v_client.id,v_property.id,true,v_actor);

  insert into public.audit_events(company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,after_data)
  values(
    p_company_id,auth.uid(),v_actor,'client.created','client',v_client.id,
    jsonb_build_object('client',to_jsonb(v_client),'property',to_jsonb(v_property))
  );

  return jsonb_build_object(
    'ok', true,
    'client', to_jsonb(v_client),
    'property', to_jsonb(v_property),
    'already_existed', false
  );
end
$$;

revoke all on function public.client_create_with_property(uuid,text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.client_create_with_property(uuid,text,text,text,text,text,text,text,text,text) to authenticated;
