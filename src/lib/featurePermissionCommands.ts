import { supabase } from './supabase';

export type FeaturePermissionKey = 'ai_walkthrough';

export async function setEmployeeFeaturePermission(params: {
  companyId: string;
  employeeId: string;
  permissionKey: FeaturePermissionKey;
  enabled: boolean;
}) {
  const { data, error } = await supabase.rpc('workforce_set_employee_feature_permission', {
    p_company_id: params.companyId,
    p_employee_id: params.employeeId,
    p_permission_key: params.permissionKey,
    p_enabled: params.enabled,
  });
  if (error) throw error;
  return data as { ok: boolean; enabled: boolean; permission_key: string; employee_id: string };
}

export async function loadMyFeaturePermissions(companyId: string, employeeId: string) {
  const { data, error } = await supabase
    .from('employee_feature_permissions')
    .select('permission_key')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .is('revoked_at', null);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.permission_key as FeaturePermissionKey));
}
