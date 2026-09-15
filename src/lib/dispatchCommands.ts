import { supabase } from './supabase';

type RpcParams = Record<string, unknown>;
const COMMAND_TIMEOUT_MS = 15_000;
const inFlight = new Map<string, Promise<unknown>>();

function readableMessage(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (raw && typeof raw === 'object') {
    const message = (raw as { message?: unknown; detail?: unknown; error?: unknown }).message ?? (raw as { message?: unknown; detail?: unknown; error?: unknown }).detail ?? (raw as { message?: unknown; detail?: unknown; error?: unknown }).error;
    if (typeof message === 'string' && message.trim()) return message.trim();
    try { return JSON.stringify(raw); } catch { return 'The dispatch request could not be completed.'; }
  }
  return 'The dispatch request could not be completed.';
}

function translateKnownError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('employee_unavailable')) return 'This employee is unavailable during the chosen time window. Add an override reason to authorize the assignment.';
  if (normalized.includes('override_reason_required')) return 'An override reason is required when assigning during an availability conflict.';
  if (normalized.includes('invalid_assignment_transition')) return 'That assignment update is not valid for the current status.';
  if (normalized.includes('decline_reason_required')) return 'A reason is required when declining an assignment.';
  if (normalized.includes('insufficient_permission')) return 'You do not have permission to perform that operation.';
  return message;
}

async function extractRpcError(error: unknown): Promise<string> {
  if (!error) return 'The dispatch request could not be completed.';
  if (error instanceof Error) return translateKnownError(readableMessage(error.message));
  if (typeof error === 'object') {
    const record = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const candidate = record.message ?? record.details ?? record.hint ?? record.code;
    if (typeof candidate === 'string') return translateKnownError(candidate);
  }
  return translateKnownError(readableMessage(error));
}

export async function runDispatchRpc<T = unknown>(rpcName: string, params: RpcParams): Promise<T> {
  const payload = JSON.stringify({ rpcName, params });
  const existing = inFlight.get(payload);
  if (existing) return existing as Promise<T>;

  const request = (async () => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        supabase.rpc(rpcName, params),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('The dispatch request timed out. Please try again.')), COMMAND_TIMEOUT_MS);
        }),
      ]);
      return response as T;
    } catch (error) {
      throw new Error(await extractRpcError(error));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  })();

  inFlight.set(payload, request);
  void request.finally(() => inFlight.delete(payload));
  return request;
}

export type AvailabilityKind = 'available' | 'unavailable' | 'pto' | 'sick' | 'training' | 'restricted';

export function submitAvailability(params: {
  p_company_id: string;
  p_employee_id: string;
  p_kind: AvailabilityKind;
  p_starts_at: string;
  p_ends_at?: string | null;
  p_reason?: string | null;
  p_approve?: boolean;
}) {
  return runDispatchRpc('dispatch_submit_availability', params);
}

export function approveAvailability(params: { p_company_id: string; p_period_id: string }) {
  return runDispatchRpc('dispatch_approve_availability', params);
}

export function removeAvailability(params: { p_company_id: string; p_period_id: string }) {
  return runDispatchRpc('dispatch_remove_availability', params);
}

export function assignWorkOrder(params: {
  p_company_id: string;
  p_work_order_id: string;
  p_employee_id: string;
  p_scheduled_start?: string | null;
  p_scheduled_end?: string | null;
  p_override_availability?: boolean;
  p_override_reason?: string | null;
}) {
  return runDispatchRpc('dispatch_assign_work_order', params);
}

export function respondToAssignment(params: {
  p_company_id: string;
  p_assignment_id: string;
  p_response: 'accepted' | 'declined';
  p_decline_reason?: string | null;
}) {
  return runDispatchRpc('dispatch_assignment_response', params);
}

export function transitionAssignment(params: {
  p_company_id: string;
  p_assignment_id: string;
  p_action: 'start' | 'pause' | 'submit' | 'complete' | 'cancel';
  p_reason?: string | null;
}) {
  return runDispatchRpc('dispatch_transition_assignment', params);
}

export function markNotification(params: { p_company_id: string; p_notification_id: string; p_acknowledge: boolean }) {
  return runDispatchRpc('dispatch_mark_notification', params);
}

export function registerPushDevice(params: {
  p_company_id: string;
  p_expo_push_token: string;
  p_platform: 'ios' | 'android' | 'web';
  p_device_label?: string | null;
}) {
  return runDispatchRpc('dispatch_register_push_device', params);
}
