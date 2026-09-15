import { supabase } from './supabase';

type CommandBase = { company_id: string; action: string };
export type OrganizationCommand =
  | (CommandBase & { action: 'create_department'; name: string; code: string })
  | (CommandBase & { action: 'update_department'; department_id: string; name?: string; code?: string; active?: boolean })
  | (CommandBase & { action: 'assign_department'; employee_id: string; department_id: string; is_primary: boolean })
  | (CommandBase & { action: 'remove_department_assignment'; employee_id: string; department_id: string })
  | (CommandBase & { action: 'create_crew'; name: string; notes?: string; lead_employee_id?: string; property_id?: string })
  | (CommandBase & { action: 'update_crew'; crew_id: string; name?: string; notes?: string; active?: boolean })
  | (CommandBase & { action: 'assign_crew_member'; crew_id: string; employee_id: string; member_role?: string })
  | (CommandBase & { action: 'remove_crew_member'; crew_id: string; employee_id: string })
  | (CommandBase & { action: 'set_crew_lead'; crew_id: string; employee_id: string | null });

const COMMAND_TIMEOUT_MS = 15_000;
const inFlight = new Map<string, Promise<unknown>>();

async function responseDetail(response: Response | undefined) {
  if (!response) return null;
  try {
    const payload = await response.clone().json() as { error?: unknown; message?: unknown; detail?: unknown };
    return payload.detail ?? payload.message ?? payload.error ?? null;
  } catch {
    try { return await response.clone().text(); } catch { return null; }
  }
}

function readableError(error: unknown, detail: unknown) {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail && typeof detail === 'object') {
    try { return JSON.stringify(detail); } catch { /* fall through to the SDK message */ }
  }
  return error instanceof Error ? error.message : 'The organization change could not be completed.';
}

export function runOrganizationCommand(command: OrganizationCommand) {
  const key = JSON.stringify(command);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const request = (async () => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        supabase.functions.invoke('manage-organization', { body: command }),
        new Promise<never>((_, reject) => { timeoutId = setTimeout(() => reject(new Error('The organization request timed out. Please try again.')), COMMAND_TIMEOUT_MS); }),
      ]);
      if (result.error) {
        const detail = await responseDetail('context' in result.error ? result.error.context : undefined);
        throw new Error(readableError(result.error, detail));
      }
      return result.data;
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error(readableError(error, null));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  })();
  inFlight.set(key, request);
  void request.then(() => inFlight.delete(key), () => inFlight.delete(key));
  return request;
}