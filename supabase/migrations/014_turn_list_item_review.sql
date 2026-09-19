create or replace function public.client_update_turn_list_item(
  p_company_id uuid,
  p_item_id uuid,
  p_building_label text,
  p_unit_number text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid := private.current_employee_id(p_company_id);
  v_item public.turn_list_items%rowtype;
  v_building text := lower(trim(coalesce(p_building_label,'')));
  v_unit text := lower(trim(coalesce(p_unit_number,'')));
begin
  if v_actor is null then raise exception 'not_a_company_member'; end if;
  if not private.has_company_role(p_company_id, array['owner','operations_manager']::public.app_role[]) then
    raise exception 'insufficient_permission';
  end if;
  if v_building='' or v_unit='' then raise exception 'building_and_unit_required'; end if;

  select * into v_item from public.turn_list_items
  where id=p_item_id and company_id=p_company_id for update;
  if not found then raise exception 'turn_list_item_not_found'; end if;
  if v_item.status not in ('draft','needs_review') then raise exception 'turn_list_item_not_editable'; end if;

  if exists(
    select 1 from public.turn_list_items i
    where i.import_id=v_item.import_id and i.id<>p_item_id
      and i.normalized_building=v_building and i.normalized_unit=v_unit
  ) then raise exception 'duplicate_turn_list_item'; end if;

  update public.turn_list_items
  set building_label=trim(p_building_label),unit_number=trim(p_unit_number),
      normalized_building=v_building,normalized_unit=v_unit,confidence=1,
      status='draft',review_reason=null,updated_at=now()
  where id=p_item_id returning * into v_item;

  insert into public.audit_events(company_id,actor_user_id,actor_employee_id,action,entity_type,entity_id,after_data)
  values(p_company_id,auth.uid(),v_actor,'turn_list.item_corrected','turn_list_item',p_item_id,
    jsonb_build_object('building',v_item.building_label,'unit',v_item.unit_number));

  return jsonb_build_object('ok',true,'item',to_jsonb(v_item));
end
$$;

revoke all on function public.client_update_turn_list_item(uuid,uuid,text,text) from public, anon;
grant execute on function public.client_update_turn_list_item(uuid,uuid,text,text) to authenticated;
