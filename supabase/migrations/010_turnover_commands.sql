-- Turnover command surface: secure creation and controlled phase/status transitions.
create or replace function public.turnover_create(
  p_company_id uuid,
  p_property_id uuid,
  p_building_id uuid,
  p_unit_id uuid,
  p_target_completion_at timestamptz default null,
  p_move_in_at timestamptz default null,
  p_rough_clean_required boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid := private.current_employee_id(p_company_id);
  v_turnover public.turnovers%rowtype;
  v_work_site_id uuid;
  v_correlation uuid := gen_random_uuid();
begin
  if v_actor is null then raise exception 'not_a_company_member'; end if;
  if not private.has_company_role(p_company_id, array['owner','operations_manager','supervisor','dispatcher']::public.app_role[]) then
    raise exception 'insufficient_permission';
  end if;
  if p_property_id is null or p_unit_id is null then raise exception 'property_and_unit_required'; end if;
  if not exists(select 1 from public.properties p where p.id=p_property_id and p.company_id=p_company_id) then raise exception 'property_not_found'; end if;

  if p_building_id is null then
    select u.building_id into p_building_id
    from public.units u join public.buildings b on b.id=u.building_id
    where u.id=p_unit_id and u.company_id=p_company_id and b.property_id=p_property_id and b.company_id=p_company_id;
  end if;

  if p_building_id is null or not exists(
    select 1
    from public.units u join public.buildings b on b.id=u.building_id and b.company_id=u.company_id
    where u.id=p_unit_id and u.company_id=p_company_id and b.id=p_building_id and b.property_id=p_property_id
  ) then raise exception 'unit_building_mismatch'; end if;

  if exists(
    select 1 from public.turnovers t
    where t.company_id=p_company_id and t.unit_id=p_unit_id and t.status not in ('cancelled','closed')
  ) then raise exception 'active_turnover_exists'; end if;

  select ws.id into v_work_site_id
  from public.work_sites ws
  where ws.company_id=p_company_id and ws.property_id=p_property_id and ws.active=true
  order by ws.updated_at desc limit 1;

  insert into public.turnovers(
    company_id,property_id,building_id,unit_id,work_site_id,status,
    target_completion_at,move_in_at,rough_clean_required,workflow_policy_version,created_by
  ) values(
    p_company_id,p_property_id,p_building_id,p_unit_id,v_work_site_id,'intake',
    p_target_completion_at,p_move_in_at,coalesce(p_rough_clean_required,false),'2026.09',v_actor
  ) returning * into v_turnover;

  insert into public.phase_runs(company_id,turnover_id,phase_key,cycle,state)
  values
    (p_company_id,v_turnover.id,'walkthrough',1,'pending'),
    (p_company_id,v_turnover.id,'maintenance',1,'pending'),
    (p_company_id,v_turnover.id,'drying',1,'pending'),
    (p_company_id,v_turnover.id,'paint',1,'pending'),
    (p_company_id,v_turnover.id,'final_clean',1,'pending'),
    (p_company_id,v_turnover.id,'inspection',1,'pending');

  if coalesce(p_rough_clean_required,false) then
    insert into public.phase_runs(company_id,turnover_id,phase_key,cycle,state)
    values(p_company_id,v_turnover.id,'rough_clean',1,'pending');
  end if;

  insert into public.turnover_status_events(company_id,turnover_id,from_status,to_status,reason,actor_employee_id,correlation_id)
  values(p_company_id,v_turnover.id,null,'intake','Turnover created',v_actor,v_correlation);

  insert into public.audit_events(company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,after_data,correlation_id)
  values(p_company_id,auth.uid(),v_actor,'turnover.created','turnover',v_turnover.id,to_jsonb(v_turnover),v_correlation);

  return jsonb_build_object('ok',true,'turnover',to_jsonb(v_turnover));
end
$$;

create or replace function public.turnover_transition(
  p_company_id uuid,
  p_turnover_id uuid,
  p_to_status public.turnover_status,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid := private.current_employee_id(p_company_id);
  v_turnover public.turnovers%rowtype;
  v_from public.turnover_status;
  v_allowed boolean := false;
  v_correlation uuid := gen_random_uuid();
  v_phase text;
begin
  if v_actor is null then raise exception 'not_a_company_member'; end if;
  if not private.has_company_role(p_company_id, array['owner','operations_manager','supervisor','dispatcher']::public.app_role[]) then
    raise exception 'insufficient_permission';
  end if;

  select * into v_turnover from public.turnovers
  where id=p_turnover_id and company_id=p_company_id for update;
  if not found then raise exception 'turnover_not_found'; end if;

  v_from := v_turnover.status;
  if v_from = p_to_status then return jsonb_build_object('ok',true,'idempotent',true,'turnover',to_jsonb(v_turnover)); end if;

  v_allowed :=
    (v_from='intake' and p_to_status='walkthrough_assigned') or
    (v_from='walkthrough_assigned' and p_to_status='walkthrough_in_progress') or
    (v_from='walkthrough_in_progress' and p_to_status='walkthrough_review') or
    (v_from='walkthrough_review' and p_to_status='maintenance_active') or
    (v_from='maintenance_active' and p_to_status in ('mud_texture_drying','ready_for_paint')) or
    (v_from='mud_texture_drying' and p_to_status='ready_for_paint') or
    (v_from='ready_for_paint' and p_to_status='painting_active') or
    (v_from='painting_active' and p_to_status in ('paint_drying','ready_for_final_clean')) or
    (v_from='paint_drying' and p_to_status='ready_for_final_clean') or
    (v_from='ready_for_final_clean' and p_to_status='cleaning_active') or
    (v_from='cleaning_active' and p_to_status='awaiting_inspection') or
    (v_from='awaiting_inspection' and p_to_status in ('ready_for_occupancy','maintenance_active')) or
    (v_from='ready_for_occupancy' and p_to_status='closed') or
    (v_from not in ('closed','cancelled') and p_to_status='cancelled');

  if not v_allowed then raise exception 'invalid_turnover_transition'; end if;
  if p_to_status='cancelled' and nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'cancel_reason_required'; end if;

  update public.turnovers
  set status=p_to_status,
      cancelled_reason=case when p_to_status='cancelled' then nullif(trim(p_reason),'') else cancelled_reason end,
      revision=revision+1, updated_at=now()
  where id=p_turnover_id returning * into v_turnover;

  insert into public.turnover_status_events(company_id,turnover_id,from_status,to_status,reason,actor_employee_id,correlation_id)
  values(p_company_id,p_turnover_id,v_from,p_to_status,nullif(trim(coalesce(p_reason,'')),''),v_actor,v_correlation);

  v_phase := case
    when p_to_status in ('walkthrough_assigned','walkthrough_in_progress','walkthrough_review') then 'walkthrough'
    when p_to_status='maintenance_active' then 'maintenance'
    when p_to_status in ('mud_texture_drying','ready_for_paint') then 'drying'
    when p_to_status in ('painting_active','paint_drying') then 'paint'
    when p_to_status in ('ready_for_final_clean','cleaning_active') then 'final_clean'
    when p_to_status in ('awaiting_inspection','ready_for_occupancy') then 'inspection'
    else null
  end;

  if v_phase is not null then
    update public.phase_runs set state='complete',updated_at=now()
    where turnover_id=p_turnover_id and company_id=p_company_id and state='active' and phase_key<>v_phase;
    update public.phase_runs set state='active',updated_at=now()
    where turnover_id=p_turnover_id and company_id=p_company_id and phase_key=v_phase and cycle=1;
  end if;

  insert into public.audit_events(company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,before_data,after_data,correlation_id)
  values(
    p_company_id,auth.uid(),v_actor,'turnover.status_changed','turnover',p_turnover_id,
    jsonb_build_object('status',v_from),
    jsonb_build_object('status',p_to_status,'reason',nullif(trim(coalesce(p_reason,'')),'')),
    v_correlation
  );

  return jsonb_build_object('ok',true,'turnover',to_jsonb(v_turnover));
end
$$;

revoke all on function public.turnover_create(uuid,uuid,uuid,uuid,timestamptz,timestamptz,boolean) from public, anon;
grant execute on function public.turnover_create(uuid,uuid,uuid,uuid,timestamptz,timestamptz,boolean) to authenticated;
revoke all on function public.turnover_transition(uuid,uuid,public.turnover_status,text) from public, anon;
grant execute on function public.turnover_transition(uuid,uuid,public.turnover_status,text) to authenticated;
