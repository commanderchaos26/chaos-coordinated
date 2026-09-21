import { supabase } from './supabase';

type RpcParams = Record<string, unknown>;
const COMMAND_TIMEOUT_MS = 15_000;
const inFlight = new Map<string, Promise<unknown>>();

function messageFrom(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
    const record = value as { message?: unknown; details?: unknown; hint?: unknown; error?: unknown; code?: unknown };
    const candidate = record.message ?? record.details ?? record.hint ?? record.error ?? record.code;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return 'The operation could not be completed.';
}

function translateKnownError(raw: string): string {
  const message = raw.toLowerCase();
  if (message.includes('work_order_title_required')) return 'Enter a work-order title.';
  if (message.includes('work_order_title_too_long')) return 'The work-order title must be 240 characters or fewer.';
  if (message.includes('idempotency_key_required')) return 'The work-order save token is missing. Try saving again.';
  if (message.includes('work_order_create_in_progress')) return 'This work order is already being saved. Wait a moment and try again.';
  if (message.includes('unit_building_mismatch')) return 'The selected unit does not belong to the selected building.';
  if (message.includes('unit_not_found')) return 'The selected unit is no longer available.';
  if (message.includes('building_not_found')) return 'The selected building is no longer available.';
  if (message.includes('property_not_found')) return 'The selected property is no longer available.';
  if (message.includes('department_not_found')) return 'The selected department is no longer available.';
  if (message.includes('work_site_not_found')) return 'The selected worksite is no longer available.';
  if (message.includes('turnover_not_found')) return 'The linked turnover is no longer available.';
  if (message.includes('invalid_estimated_minutes')) return 'Estimated minutes must be greater than zero.';
  if (message.includes('insufficient_permission')) return 'You do not have permission to perform that operation.';
  return raw;
}

async function rpc<T = unknown>(name: string, params: RpcParams): Promise<T> {
  const key = JSON.stringify({ name, params });
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const request = (async () => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        supabase.rpc(name, params),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('The request timed out. The server may still have saved it; retrying is safe.')),
            COMMAND_TIMEOUT_MS,
          );
        }),
      ]);

      const { data, error } = response as { data: unknown; error: unknown };
      if (error) throw new Error(translateKnownError(messageFrom(error)));
      if (data && typeof data === 'object' && 'ok' in data && (data as { ok?: unknown }).ok === false) {
        throw new Error(translateKnownError(messageFrom(data)));
      }
      return data as T;
    } catch (cause) {
      if (cause instanceof Error) throw cause;
      throw new Error(translateKnownError(messageFrom(cause)));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  })();

  inFlight.set(key, request);
  void request.then(
    () => inFlight.delete(key),
    () => inFlight.delete(key),
  );
  return request;
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

export function archiveProperty(params: {
  p_company_id: string;
  p_property_id: string;
}) {
  return rpc('operations_archive_property', params);
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

export type CreatedWorkOrder = {
  id: string;
  title: string;
  status: string;
  priority: string;
  created_at: string;
};

export type CreateWorkOrderResult = {
  ok: boolean;
  idempotent: boolean;
  work_order: CreatedWorkOrder & Record<string, unknown>;
};

export function createWorkOrder(params: {
  p_company_id: string;
  p_property_id: string;
  p_title: string;
  p_idempotency_key: string;
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
  return rpc<CreateWorkOrderResult>('operations_create_work_order_v2', params);
}
