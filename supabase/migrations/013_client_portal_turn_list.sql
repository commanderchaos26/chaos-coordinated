create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  name text not null,
  phone text,
  email text,
  billing_email text,
  notes text,
  active boolean not null default true,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clients_company_name_idx on public.clients(company_id, name);

create table if not exists public.client_properties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete restrict,
  is_primary boolean not null default false,
  access_instructions text,
  client_rules text,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(company_id, client_id, property_id)
);

create table if not exists public.client_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  property_id uuid references public.properties(id) on delete restrict,
  document_type text not null check (document_type in ('contract','turn_list')),
  version_no integer not null default 1 check (version_no > 0),
  original_file_name text not null,
  storage_bucket text not null default 'client-documents',
  storage_path text not null,
  mime_type text,
  byte_size bigint,
  status text not null default 'preparing' check (status in ('preparing','uploaded','scanning','scanned','failed')),
  effective_date date,
  expires_at date,
  ai_summary text,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(company_id, storage_path)
);

create index if not exists client_documents_client_idx on public.client_documents(company_id, client_id, created_at desc);

create table if not exists public.turn_list_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete restrict,
  document_id uuid not null references public.client_documents(id) on delete restrict,
  status text not null default 'uploaded' check (status in ('uploaded','scanning','review','committed','failed')),
  total_items integer not null default 0,
  pending_count integer not null default 0,
  needs_review_count integer not null default 0,
  error_message text,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  scanned_at timestamptz,
  committed_at timestamptz,
  unique(company_id, document_id)
);

create table if not exists public.turn_list_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  import_id uuid not null references public.turn_list_imports(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete restrict,
  source_document_id uuid not null references public.client_documents(id) on delete restrict,
  source_page integer,
  building_label text not null,
  unit_number text not null,
  normalized_building text not null,
  normalized_unit text not null,
  building_id uuid references public.buildings(id) on delete restrict,
  unit_id uuid references public.units(id) on delete restrict,
  turnover_id uuid references public.turnovers(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','pending','needs_review','processed','skipped')),
  confidence numeric(5,4),
  review_reason text,
  raw_text text,
  walkthrough_session_id uuid references public.ai_walkthrough_sessions(id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists turn_list_items_import_location_uidx
  on public.turn_list_items(import_id, normalized_building, normalized_unit);
create index if not exists turn_list_items_pending_idx
  on public.turn_list_items(company_id, status, property_id, building_id, unit_id);

alter table public.clients enable row level security;
alter table public.client_properties enable row level security;
alter table public.client_documents enable row level security;
alter table public.turn_list_imports enable row level security;
alter table public.turn_list_items enable row level security;

drop policy if exists clients_management_select on public.clients;
create policy clients_management_select on public.clients for select to authenticated using (
  private.has_company_role(company_id, array['owner','operations_manager','supervisor']::public.app_role[])
);

drop policy if exists client_properties_management_select on public.client_properties;
create policy client_properties_management_select on public.client_properties for select to authenticated using (
  private.has_company_role(company_id, array['owner','operations_manager','supervisor']::public.app_role[])
);

drop policy if exists client_documents_management_select on public.client_documents;
create policy client_documents_management_select on public.client_documents for select to authenticated using (
  private.has_company_role(company_id, array['owner','operations_manager','supervisor']::public.app_role[])
);

drop policy if exists turn_list_imports_management_select on public.turn_list_imports;
create policy turn_list_imports_management_select on public.turn_list_imports for select to authenticated using (
  private.has_company_role(company_id, array['owner','operations_manager','supervisor']::public.app_role[])
);

drop policy if exists turn_list_items_authorized_select on public.turn_list_items;
create policy turn_list_items_authorized_select on public.turn_list_items for select to authenticated using (
  private.has_company_role(company_id, array['owner','operations_manager','supervisor','dispatcher']::public.app_role[])
  or exists (
    select 1 from public.employee_feature_permissions efp
    where efp.company_id=turn_list_items.company_id
      and efp.employee_id=private.current_employee_id(turn_list_items.company_id)
      and efp.permission_key='ai_walkthrough'
      and efp.revoked_at is null
  )
);

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
begin
  if v_actor is null then raise exception 'not_a_company_member'; end if;
  if not private.has_company_role(p_company_id, array['owner','operations_manager']::public.app_role[]) then
    raise exception 'insufficient_permission';
  end if;
  if nullif(trim(coalesce(p_client_name,'')),'') is null then raise exception 'client_name_required'; end if;
  if nullif(trim(coalesce(p_address_line1,'')),'') is null then raise exception 'property_address_required'; end if;

  v_property_name := coalesce(nullif(trim(coalesce(p_property_name,'')),''), trim(p_address_line1));

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

  return jsonb_build_object('ok',true,'client',to_jsonb(v_client),'property',to_jsonb(v_property));
end
$$;

revoke all on function public.client_create_with_property(uuid,text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.client_create_with_property(uuid,text,text,text,text,text,text,text,text,text) to authenticated;

create or replace function public.client_commit_turn_list_import(p_company_id uuid,p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid := private.current_employee_id(p_company_id);
  v_import public.turn_list_imports%rowtype;
  r record;
  v_building_id uuid;
  v_unit_id uuid;
  v_turnover_id uuid;
  v_work_site_id uuid;
  v_pending integer := 0;
  v_review integer := 0;
begin
  if v_actor is null then raise exception 'not_a_company_member'; end if;
  if not private.has_company_role(p_company_id, array['owner','operations_manager']::public.app_role[]) then raise exception 'insufficient_permission'; end if;

  select * into v_import from public.turn_list_imports where id=p_import_id and company_id=p_company_id for update;
  if not found then raise exception 'turn_list_import_not_found'; end if;
  if v_import.status not in ('review','committed') then raise exception 'turn_list_import_not_ready'; end if;

  select ws.id into v_work_site_id from public.work_sites ws
  where ws.company_id=p_company_id and ws.property_id=v_import.property_id and ws.active=true
  order by ws.updated_at desc limit 1;

  for r in
    select * from public.turn_list_items
    where import_id=p_import_id and company_id=p_company_id and status in ('draft','needs_review')
    order by building_label,unit_number
  loop
    if nullif(trim(r.building_label),'') is null or nullif(trim(r.unit_number),'') is null or coalesce(r.confidence,0)<0.65 then
      update public.turn_list_items set status='needs_review',
        review_reason=coalesce(review_reason,'Building or unit could not be read with enough confidence.'),updated_at=now()
      where id=r.id;
      continue;
    end if;

    select b.id into v_building_id from public.buildings b
    where b.company_id=p_company_id and b.property_id=v_import.property_id and b.active=true
      and (lower(trim(b.name))=r.normalized_building or lower(trim(coalesce(b.code,'')))=r.normalized_building)
    order by b.created_at limit 1;

    if v_building_id is null then
      insert into public.buildings(company_id,property_id,name,code,active)
      values(p_company_id,v_import.property_id,trim(r.building_label),trim(r.building_label),true)
      returning id into v_building_id;
    end if;

    select u.id into v_unit_id from public.units u
    where u.company_id=p_company_id and u.property_id=v_import.property_id and u.building_id=v_building_id and u.active=true
      and lower(trim(u.unit_number))=r.normalized_unit
    order by u.created_at limit 1;

    if v_unit_id is null then
      insert into public.units(company_id,property_id,building_id,unit_number,active)
      values(p_company_id,v_import.property_id,v_building_id,trim(r.unit_number),true)
      returning id into v_unit_id;
    end if;

    select t.id into v_turnover_id from public.turnovers t
    where t.company_id=p_company_id and t.unit_id=v_unit_id and t.status not in ('cancelled','closed')
    order by t.created_at desc limit 1;

    if v_turnover_id is null then
      insert into public.turnovers(company_id,property_id,building_id,unit_id,work_site_id,status,rough_clean_required,workflow_policy_version,created_by)
      values(p_company_id,v_import.property_id,v_building_id,v_unit_id,v_work_site_id,'intake',false,'2026.09',v_actor)
      returning id into v_turnover_id;

      insert into public.phase_runs(company_id,turnover_id,phase_key,cycle,state)
      values
        (p_company_id,v_turnover_id,'walkthrough',1,'pending'),
        (p_company_id,v_turnover_id,'maintenance',1,'pending'),
        (p_company_id,v_turnover_id,'drying',1,'pending'),
        (p_company_id,v_turnover_id,'paint',1,'pending'),
        (p_company_id,v_turnover_id,'final_clean',1,'pending'),
        (p_company_id,v_turnover_id,'inspection',1,'pending');

      insert into public.turnover_status_events(company_id,turnover_id,from_status,to_status,reason,actor_employee_id,correlation_id)
      values(p_company_id,v_turnover_id,null,'intake','Created from client turn-list import',v_actor,gen_random_uuid());
    end if;

    update public.turn_list_items set building_id=v_building_id,unit_id=v_unit_id,turnover_id=v_turnover_id,
      status='pending',review_reason=null,updated_at=now()
    where id=r.id;

    v_building_id:=null; v_unit_id:=null; v_turnover_id:=null;
  end loop;

  select count(*) filter(where status='pending'),count(*) filter(where status='needs_review')
  into v_pending,v_review from public.turn_list_items where import_id=p_import_id and company_id=p_company_id;

  update public.turn_list_imports set status='committed',pending_count=v_pending,needs_review_count=v_review,
    committed_at=coalesce(committed_at,now()) where id=p_import_id;

  insert into public.audit_events(company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,after_data)
  values(p_company_id,auth.uid(),v_actor,'turn_list.committed','turn_list_import',p_import_id,
    jsonb_build_object('pending_count',v_pending,'needs_review_count',v_review));

  return jsonb_build_object('ok',true,'pending_count',v_pending,'needs_review_count',v_review);
end
$$;

revoke all on function public.client_commit_turn_list_import(uuid,uuid) from public, anon;
grant execute on function public.client_commit_turn_list_import(uuid,uuid) to authenticated;

create or replace function public.turn_list_mark_processed(p_company_id uuid,p_item_id uuid,p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid := private.current_employee_id(p_company_id);
  v_item public.turn_list_items%rowtype;
begin
  if v_actor is null then raise exception 'not_a_company_member'; end if;

  select * into v_item from public.turn_list_items where id=p_item_id and company_id=p_company_id for update;
  if not found then raise exception 'turn_list_item_not_found'; end if;

  if not exists(
    select 1 from public.ai_walkthrough_sessions s
    where s.id=p_session_id and s.company_id=p_company_id and s.started_by=v_actor and s.status='completed'
      and s.property_id=v_item.property_id and s.building_id=v_item.building_id and s.unit_id=v_item.unit_id
  ) then raise exception 'walkthrough_not_completed_for_turn'; end if;

  if not exists(
    select 1 from public.ai_walkthrough_issues i
    where i.company_id=p_company_id and i.session_id=p_session_id and i.work_order_id is not null
  ) then raise exception 'no_work_orders_created_for_turn'; end if;

  update public.turn_list_items set status='processed',walkthrough_session_id=p_session_id,processed_at=now(),updated_at=now()
  where id=p_item_id;

  update public.turn_list_imports x
  set pending_count=(select count(*) from public.turn_list_items i where i.import_id=x.id and i.status='pending'),
      needs_review_count=(select count(*) from public.turn_list_items i where i.import_id=x.id and i.status='needs_review')
  where x.id=v_item.import_id;

  insert into public.audit_events(company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,after_data)
  values(p_company_id,auth.uid(),v_actor,'turn_list.processed','turn_list_item',p_item_id,jsonb_build_object('session_id',p_session_id));

  return jsonb_build_object('ok',true,'item_id',p_item_id,'status','processed');
end
$$;

revoke all on function public.turn_list_mark_processed(uuid,uuid,uuid) from public, anon;
grant execute on function public.turn_list_mark_processed(uuid,uuid,uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('client-documents','client-documents',false,52428800,array['application/pdf','image/jpeg','image/png','image/webp','text/plain'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
