import { supabase } from './supabase';

export type TurnoverStatus =
  | 'intake'
  | 'walkthrough_assigned'
  | 'walkthrough_in_progress'
  | 'walkthrough_review'
  | 'maintenance_active'
  | 'mud_texture_drying'
  | 'ready_for_paint'
  | 'painting_active'
  | 'paint_drying'
  | 'ready_for_final_clean'
  | 'cleaning_active'
  | 'awaiting_inspection'
  | 'ready_for_occupancy'
  | 'cancelled'
  | 'closed';

async function rpc<T>(name: string, params: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data as T;
}

export function createTurnover(params: {
  p_company_id: string;
  p_property_id: string;
  p_building_id: string;
  p_unit_id: string;
  p_target_completion_at?: string | null;
  p_move_in_at?: string | null;
  p_rough_clean_required?: boolean;
}) {
  return rpc<{ ok: boolean; turnover: any }>('turnover_create', {
    p_target_completion_at: null,
    p_move_in_at: null,
    p_rough_clean_required: false,
    ...params,
  });
}

export function transitionTurnover(params: {
  p_company_id: string;
  p_turnover_id: string;
  p_to_status: TurnoverStatus;
  p_reason?: string | null;
}) {
  return rpc<{ ok: boolean; turnover: any }>('turnover_transition', {
    p_reason: null,
    ...params,
  });
}
