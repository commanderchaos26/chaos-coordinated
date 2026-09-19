import { supabase } from './supabase';

export type TimeClockAction = 'check_in' | 'check_out';

export async function punchTimeClock(companyId: string, action: TimeClockAction) {
  const { data, error } = await supabase.rpc('timeclock_punch', {
    p_company_id: companyId,
    p_action: action,
  });
  if (error) throw error;
  return data as { ok: boolean; clocked_in: boolean; event: any };
}

export async function generatePreviousWeekPayroll(companyId: string) {
  const { data, error } = await supabase.rpc('payroll_generate_previous_week', {
    p_company_id: companyId,
    p_reference_date: null,
  });
  if (error) throw error;
  return data as { ok: boolean; export_count: number };
}

export async function getPayrollDownload(exportId: string) {
  const { data, error } = await supabase.functions.invoke('payroll-file', {
    body: { export_id: exportId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.message || data.error);
  return data as { ok: boolean; file_name: string; signed_url: string; expires_in: number; total_hours: number };
}
