import { supabase } from './supabase';

type RpcParams = Record<string, unknown>;
const COMMAND_TIMEOUT_MS = 20_000;

function messageFrom(value: unknown) {
  if (value instanceof Error) return value.message;
  if (value && typeof value === 'object' && 'message' in value && typeof (value as { message?: unknown }).message === 'string') return (value as { message: string }).message;
  return 'The AI walkthrough request could not be completed.';
}

function translateKnownError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('insufficient_permission')) return 'Your current role cannot run an AI walkthrough.';
  if (normalized.includes('property_not_found')) return 'The selected property is no longer available.';
  if (normalized.includes('building_not_found')) return 'The selected building does not belong to this property.';
  if (normalized.includes('unit_not_found')) return 'The selected unit does not belong to this property.';
  if (normalized.includes('unit_building_mismatch')) return 'The selected unit and building do not match.';
  if (normalized.includes('walkthrough_not_found')) return 'That walkthrough could not be found.';
  if (normalized.includes('walkthrough_not_recording')) return 'That walkthrough is no longer accepting observations.';
  if (normalized.includes('walkthrough_already_completed')) return 'That walkthrough has already created its work orders.';
  if (normalized.includes('transcript_text_required')) return 'Say or enter an observation before saving it.';
  return message;
}

async function runRpc<T>(name: string, params: RpcParams): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      supabase.rpc(name, params),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('The AI walkthrough request timed out. Please try again.')), COMMAND_TIMEOUT_MS);
      }),
    ]);
    const { data, error } = response as { data: T | null; error: unknown };
    if (error) throw error;
    return data as T;
  } catch (error) {
    throw new Error(translateKnownError(messageFrom(error)));
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export type AiWalkthroughSession = {
  id: string;
  company_id: string;
  property_id: string;
  building_id: string | null;
  unit_id: string | null;
  turnover_id: string | null;
  work_site_id: string | null;
  status: 'recording' | 'processing' | 'completed' | 'failed' | 'cancelled';
  started_by: string;
  started_at: string;
  finalized_at: string | null;
  ai_summary: string | null;
  model_name: string | null;
  error_message: string | null;
};

export async function startAiWalkthrough(params: {
  p_company_id: string;
  p_property_id: string;
  p_building_id?: string | null;
  p_unit_id?: string | null;
  p_turnover_id?: string | null;
  p_work_site_id?: string | null;
}) {
  return runRpc<{ ok: boolean; session: AiWalkthroughSession }>('ai_walkthrough_start', params);
}

export async function appendAiWalkthroughChunk(params: {
  p_company_id: string;
  p_session_id: string;
  p_transcript_text: string;
  p_source?: 'speech' | 'typed' | 'correction' | 'system';
  p_is_final?: boolean;
  p_captured_at?: string | null;
}) {
  return runRpc<{ ok: boolean; chunk: { id: string; sequence_no: number; transcript_text: string } }>('ai_walkthrough_append_chunk', params);
}

export async function markAiWalkthroughProcessing(params: { p_company_id: string; p_session_id: string }) {
  return runRpc<{ ok: boolean; session: AiWalkthroughSession }>('ai_walkthrough_mark_processing', params);
}

export async function commitAiWalkthroughInterpretation(params: {
  p_company_id: string;
  p_session_id: string;
  p_finalization_key: string;
  p_model_name: string;
  p_model_request_id?: string | null;
  p_summary?: string | null;
  p_issues: Array<Record<string, unknown>>;
}) {
  return runRpc<{ ok: boolean; idempotent: boolean; session_id: string; created: Array<{ issue_id: string; issue_key: string; work_order_id: string }> }>('ai_walkthrough_commit_interpretation', params);
}
