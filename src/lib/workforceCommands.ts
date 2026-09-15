import { supabase } from './supabase';

type CommandBase = { company_id: string; action: string };

export type WorkforceCommand =
  | (CommandBase & { action: 'create_skill'; name: string; category?: string; description?: string })
  | (CommandBase & {
      action: 'update_employee_profile';
      employee_id: string;
      display_name?: string;
      employee_number?: string;
      preferred_phone?: string;
      employment_status?: 'active' | 'inactive' | 'leave';
      floater_eligible?: boolean;
    })
  | (CommandBase & {
      action: 'assign_skill';
      employee_id: string;
      skill_id: string;
      proficiency: number;
      verification_status: 'self_reported' | 'verified' | 'expired' | 'rejected';
      notes?: string;
      expires_at?: string;
    })
  | (CommandBase & { action: 'remove_skill'; employee_id: string; skill_id: string });

const COMMAND_TIMEOUT_MS = 15_000;

async function detailFromResponse(response: Response | undefined) {
  if (!response) return null;
  try {
    const payload = await response.clone().json() as { error?: unknown; message?: unknown; detail?: unknown };
    return payload.detail ?? payload.message ?? payload.error ?? null;
  } catch {
    try { return await response.clone().text(); } catch { return null; }
  }
}

function readableError(error: unknown, detail: unknown) {
  if (detail) {
    if (typeof detail === 'string') return detail;
    try { return JSON.stringify(detail); } catch { /* use the SDK message below */ }
  }
  return error instanceof Error ? error.message : 'The workforce command could not be completed.';
}

export async function runWorkforceCommand(command: WorkforceCommand) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      supabase.functions.invoke('manage-workforce', { body: command }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('The workforce command timed out. Please try again.')), COMMAND_TIMEOUT_MS);
      }),
    ]);
    if (result.error) {
      const detail = await detailFromResponse('context' in result.error ? result.error.context : undefined);
      throw new Error(readableError(result.error, detail));
    }
    return result.data;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(readableError(error, null));
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
