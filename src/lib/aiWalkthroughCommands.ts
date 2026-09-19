import { supabase } from './supabase';

type RpcParams = Record<string, unknown>;
const COMMAND_TIMEOUT_MS = 20_000;
const AI_FINALIZE_TIMEOUT_MS = 90_000;

function messageFrom(value: unknown) {
  if (value instanceof Error) return value.message;
  if (value && typeof value === 'object' && 'message' in value && typeof (value as { message?: unknown }).message === 'string') return (value as { message: string }).message;
  return 'The AI walkthrough request could not be completed.';
}

async function messageFromFunctionError(value: unknown) {
  if (value && typeof value === 'object' && 'context' in value) {
    const context = (value as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const payload = await context.clone().json() as { message?: unknown; error?: unknown };
        if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();
        if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error.trim();
      } catch {
        try {
          const text = await context.clone().text();
          if (text.trim()) return text.trim();
        } catch { /* use generic error below */ }
      }
    }
  }
  return messageFrom(value);
}

function translateKnownError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('insufficient_permission') || normalized.includes('ai_walkthrough_permission_required')) return 'AI Walkthrough access has not been granted to this employee profile.';
  if (normalized.includes('property_not_found')) return 'The selected property is no longer available.';
  if (normalized.includes('building_not_found')) return 'The selected building does not belong to this property.';
  if (normalized.includes('unit_not_found')) return 'The selected unit does not belong to this property.';
  if (normalized.includes('unit_building_mismatch')) return 'The selected unit and building do not match.';
  if (normalized.includes('walkthrough_not_found')) return 'That walkthrough could not be found.';
  if (normalized.includes('walkthrough_not_recording')) return 'That walkthrough is no longer accepting observations.';
  if (normalized.includes('walkthrough_already_completed')) return 'That walkthrough has already created its work orders.';
  if (normalized.includes('finalization_in_progress')) return 'This walkthrough is already being finalized. Wait a moment, then reopen or retry to load the completed results.';
  if (normalized.includes('finalization_key_mismatch')) return 'This walkthrough already has a different finalization request in progress. Reopen it to recover the existing session.';
  if (normalized.includes('results_read_failed')) return 'The work orders were created, but the result list could not be loaded. Reopen the walkthrough to recover the results.';
  if (normalized.includes('transcript_text_required')) return 'Say or enter an observation before saving it.';
  if (normalized.includes('no_walkthrough_observations')) return 'Add at least one observation before finishing the walkthrough.';
  if (normalized.includes('gemini_not_configured') || normalized.includes('openai_not_configured')) return 'The AI service key has not been connected to Chaos Coordinated yet.';
  if (normalized.includes('resource_exhausted') || normalized.includes('rate limit') || normalized.includes('quota')) return 'The free AI service limit has been reached for now. Wait a little and try again.';
  if (normalized.includes('api key not valid') || normalized.includes('api_key_invalid') || normalized.includes('invalid api key')) return 'The configured AI service key is invalid. Update the server-side AI key and try again.';
  if (normalized.includes('account is not active') || normalized.includes('billing details') || normalized.includes('credit_balance_exhausted')) return 'The configured paid AI provider is not active. Chaos Coordinated can continue using its free Gemini provider when configured.';
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
  finalization_key: string | null;
  finalization_started_at?: string | null;
  finalization_lease_until?: string | null;
  updated_at?: string | null;
};

export type AiWalkthroughCreatedIssue = {
  id: string;
  issue_key: string;
  title: string;
  room_area: string | null;
  priority: string;
  department_id: string | null;
  confidence: number | null;
  needs_review: boolean;
  review_reason: string | null;
  work_order_id: string | null;
  status: string;
  depends_on_issue_keys: string[];
};

export type AiWalkthroughFinalizeResult = {
  ok: boolean;
  idempotent?: boolean;
  session_id?: string;
  summary: string | null;
  model?: string;
  request_id?: string | null;
  created?: Array<{ issue_id: string; issue_key: string; work_order_id: string }>;
  issues: AiWalkthroughCreatedIssue[];
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

export async function finalizeAiWalkthrough(params: {
  companyId: string;
  sessionId: string;
  finalizationKey: string;
}) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await runRpc('ai_walkthrough_prepare_finalization', {
      p_company_id: params.companyId,
      p_session_id: params.sessionId,
      p_finalization_key: params.finalizationKey,
    });

    const response = await Promise.race([
      supabase.functions.invoke('finalize-ai-walkthrough', {
        body: {
          company_id: params.companyId,
          session_id: params.sessionId,
          finalization_key: params.finalizationKey,
        },
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('AI finalization is still running. Reopen this walkthrough or retry in a moment; the same finalization request will be recovered safely.')),
          AI_FINALIZE_TIMEOUT_MS,
        );
      }),
    ]);
    if (response.error) throw new Error(translateKnownError(await messageFromFunctionError(response.error)));
    const data = response.data as AiWalkthroughFinalizeResult & { error?: string; message?: string };
    if (data?.error) throw new Error(data.message || data.error);
    return data;
  } catch (error) {
    throw new Error(translateKnownError(messageFrom(error)));
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function loadAiWalkthroughRecovery(companyId: string, employeeId: string) {
  const sessionSelect = 'id,company_id,property_id,building_id,unit_id,turnover_id,work_site_id,status,started_by,started_at,finalized_at,ai_summary,model_name,error_message,finalization_key,finalization_started_at,finalization_lease_until,updated_at';

  let { data: session, error } = await supabase
    .from('ai_walkthrough_sessions')
    .select(sessionSelect)
    .eq('company_id', companyId)
    .eq('started_by', employeeId)
    .in('status', ['recording', 'processing', 'failed'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  if (!session) {
    const recentCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const recent = await supabase
      .from('ai_walkthrough_sessions')
      .select(sessionSelect)
      .eq('company_id', companyId)
      .eq('started_by', employeeId)
      .eq('status', 'completed')
      .not('finalization_key', 'is', null)
      .gte('finalized_at', recentCutoff)
      .order('finalized_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent.error) throw recent.error;
    session = recent.data;
  }

  if (!session) return null;

  const chunksResult = await supabase
    .from('ai_walkthrough_transcript_chunks')
    .select('id,sequence_no,transcript_text,source,captured_at')
    .eq('company_id', companyId)
    .eq('session_id', session.id)
    .order('sequence_no');

  if (chunksResult.error) throw chunksResult.error;

  let result: AiWalkthroughFinalizeResult | null = null;
  if (session.status === 'completed') {
    const issuesResult = await supabase
      .from('ai_walkthrough_issues')
      .select('id,issue_key,title,room_area,priority,department_id,confidence,needs_review,review_reason,work_order_id,status,depends_on_issue_keys')
      .eq('company_id', companyId)
      .eq('session_id', session.id)
      .order('created_at');
    if (issuesResult.error) throw issuesResult.error;

    result = {
      ok: true,
      idempotent: true,
      session_id: session.id,
      summary: session.ai_summary ?? null,
      issues: (issuesResult.data ?? []) as AiWalkthroughCreatedIssue[],
    };
  }

  return {
    session: session as AiWalkthroughSession,
    chunks: (chunksResult.data ?? []) as Array<{ id: string; sequence_no: number; transcript_text: string; source: string; captured_at: string }>,
    result,
  };
}
