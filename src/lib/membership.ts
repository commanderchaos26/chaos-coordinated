import type { Membership, AppRole } from '../types/app';
import { supabase } from './supabase';

export async function loadMembership(): Promise<Membership | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data: links, error: linkError } = await supabase
    .from('employee_account_links')
    .select('company_id, employee_id, status')
    .eq('user_id', auth.user.id)
    .eq('status', 'active')
    .limit(1);
  if (linkError) throw linkError;
  const link = links?.[0];
  if (!link) return null;

  const [{ data: employee, error: employeeError }, { data: company, error: companyError }, { data: roleRows, error: roleError }] = await Promise.all([
    supabase.from('employees').select('display_name').eq('id', link.employee_id).single(),
    supabase.from('companies').select('name').eq('id', link.company_id).single(),
    supabase.from('role_grants').select('role').eq('company_id', link.company_id).eq('employee_id', link.employee_id).is('revoked_at', null),
  ]);
  if (employeeError) throw employeeError;
  if (companyError) throw companyError;
  if (roleError) throw roleError;

  return {
    companyId: link.company_id,
    companyName: company.name,
    employeeId: link.employee_id,
    displayName: employee.display_name,
    roles: (roleRows ?? []).map((row) => row.role as AppRole),
  };
}

export async function completeAdmission() {
  const { data, error } = await supabase.functions.invoke('complete-admission', { body: {} });
  if (error) throw error;
  return data;
}
