import { supabase } from './supabase';

async function rpc<T = any>(name: string, params: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(error.message || `Could not run ${name}.`);
  return data as T;
}

export function createProperty(params: {
  p_company_id: string;
  p_name: string;
  p_address_line1?: string | null;
  p_address_line2?: string | null;
  p_city?: string | null;
  p_region?: string | null;
  p_postal_code?: string | null;
  p_country_code?: string | null;
  p_timezone?: string | null;
}) {
  return rpc('operations_create_property', params);
}

export function createBuilding(params: {
  p_company_id: string;
  p_property_id: string;
  p_name: string;
  p_code?: string | null;
}) {
  return rpc('operations_create_building', params);
}

export function createUnit(params: {
  p_company_id: string;
  p_property_id: string;
  p_building_id: string;
  p_unit_number: string;
  p_layout_name?: string | null;
}) {
  return rpc('operations_create_unit', params);
}

export function setCircleGeofence(params: {
  p_company_id: string;
  p_property_id: string;
  p_label: string;
  p_latitude: number;
  p_longitude: number;
  p_radius_meters: number;
  p_max_accuracy_meters?: number | null;
}) {
  return rpc('operations_set_circle_geofence', params);
}

export function createWorkOrder(params: {
  p_company_id: string;
  p_property_id: string;
  p_title: string;
  p_building_id?: string | null;
  p_unit_id?: string | null;
  p_turnover_id?: string | null;
  p_work_site_id?: string | null;
  p_department_id?: string | null;
  p_description?: string | null;
  p_room_area?: string | null;
  p_issue_category?: string | null;
  p_required_skill_snapshot?: unknown[];
  p_priority?: 'low' | 'normal' | 'high' | 'emergency';
  p_occupancy_blocking?: boolean;
  p_blocking_phase?: string | null;
  p_estimated_minutes?: number | null;
  p_due_at?: string | null;
  p_source_type?: string;
}) {
  return rpc('operations_create_work_order', params);
}
