import { supabase } from './supabase';

export type Employee = { id: string; company_id: string; employee_number: string | null; display_name: string; preferred_phone: string | null; primary_department_id: string | null; employment_status: string; floater_eligible: boolean; start_date: string | null; end_date: string | null };
export type EmployeeLink = { employee_id: string; intended_email: string | null; status: string | null };
export type EmployeeRole = { employee_id: string; role: string };
export type Department = { id: string; name: string; code: string | null; active?: boolean };
export type EmployeeDepartment = { employee_id: string; department_id: string; is_primary: boolean; active: boolean };
export type Skill = { id: string; name: string; category: string | null; description: string | null; active: boolean };
export type EmployeeSkill = { id: string; employee_id: string; skill_id: string; proficiency: string | null; verification_status: string | null; verified_by: string | null; verified_at: string | null; expires_at: string | null; notes: string | null };
export type Crew = { id: string; name: string; notes?: string | null; lead_employee_id: string | null; property_id?: string | null; active?: boolean };
export type CrewMember = { crew_id: string; employee_id: string; member_role: string | null; active: boolean };
export type AvailabilityPeriod = { employee_id: string; kind: string; starts_at: string; ends_at: string | null; reason: string | null };
export type EmployeeFeaturePermission = { employee_id: string; permission_key: string; granted_at: string; revoked_at: string | null };

async function loadCompanyRows(companyId: string) {
  const results = await Promise.all([
    supabase.from('employees').select('id,company_id,employee_number,display_name,preferred_phone,primary_department_id,employment_status,floater_eligible,start_date,end_date').eq('company_id', companyId).order('display_name'),
    supabase.from('employee_account_links').select('employee_id,intended_email,status').eq('company_id', companyId),
    supabase.from('role_grants').select('employee_id,role').eq('company_id', companyId).is('revoked_at', null),
    supabase.from('departments').select('id,name,code').eq('company_id', companyId).eq('active', true).order('name'),
    supabase.from('employee_departments').select('employee_id,department_id,is_primary,active').eq('company_id', companyId).eq('active', true),
    supabase.from('skills').select('id,name,category,description,active').eq('company_id', companyId).eq('active', true).order('name'),
    supabase.from('employee_skills').select('id,employee_id,skill_id,proficiency,verification_status,verified_by,verified_at,expires_at,notes').eq('company_id', companyId),
    supabase.from('crews').select('id,name,lead_employee_id').eq('company_id', companyId).eq('active', true).order('name'),
    supabase.from('crew_members').select('crew_id,employee_id,member_role,active').eq('company_id', companyId).eq('active', true),
  ]);
  const failure = results.find((result) => result.error);
  if (failure?.error) throw failure.error;
  const [employees, links, roles, departments, employeeDepartments, skills, employeeSkills, crews, crewMembers] = results;

  // Feature permissions are supplemental profile metadata. A permission-read problem
  // must never make the core employee directory unusable.
  const featurePermissionResult = await supabase
    .from('employee_feature_permissions')
    .select('employee_id,permission_key,granted_at,revoked_at')
    .eq('company_id', companyId)
    .is('revoked_at', null);

  return {
    employees: (employees.data ?? []) as Employee[], links: (links.data ?? []) as EmployeeLink[], roles: (roles.data ?? []) as EmployeeRole[],
    departments: (departments.data ?? []) as Department[], employeeDepartments: (employeeDepartments.data ?? []) as EmployeeDepartment[],
    skills: (skills.data ?? []) as Skill[], employeeSkills: (employeeSkills.data ?? []) as EmployeeSkill[], crews: (crews.data ?? []) as Crew[], crewMembers: (crewMembers.data ?? []) as CrewMember[],
    featurePermissions: featurePermissionResult.error ? [] : (featurePermissionResult.data ?? []) as EmployeeFeaturePermission[],
  };
}

export function loadEmployeeDirectory(companyId: string) { return loadCompanyRows(companyId); }

export async function loadOrganizationData(companyId: string) {
  const [departments, crews, employees, employeeDepartments, crewMembers] = await Promise.all([
    supabase.from('departments').select('id,name,code,active').eq('company_id', companyId).order('name'),
    supabase.from('crews').select('id,name,notes,lead_employee_id,property_id,active').eq('company_id', companyId).order('name'),
    supabase.from('employees').select('id,display_name,employee_number,employment_status').eq('company_id', companyId).order('display_name'),
    supabase.from('employee_departments').select('employee_id,department_id,is_primary,active').eq('company_id', companyId),
    supabase.from('crew_members').select('crew_id,employee_id,member_role,active').eq('company_id', companyId),
  ]);
  const failure = [departments, crews, employees, employeeDepartments, crewMembers].find((result) => result.error);
  if (failure?.error) throw failure.error;
  return {
    departments: (departments.data ?? []) as Department[],
    crews: (crews.data ?? []) as Crew[],
    employees: (employees.data ?? []) as Pick<Employee, 'id' | 'display_name' | 'employee_number' | 'employment_status'>[],
    employeeDepartments: (employeeDepartments.data ?? []) as EmployeeDepartment[],
    crewMembers: (crewMembers.data ?? []) as CrewMember[],
  };
}

export async function loadEmployeeDetail(companyId: string, employeeId: string) {
  const data = await loadCompanyRows(companyId);
  const { data: availability, error } = await supabase.from('availability_periods').select('employee_id,kind,starts_at,ends_at,reason').eq('employee_id', employeeId).order('starts_at');
  if (error) throw error;
  return { ...data, availability: (availability ?? []) as AvailabilityPeriod[] };
}

export function accountStatus(status: string | null | undefined) {
  const normalized = status?.toLowerCase();
  if (normalized === 'active' || normalized === 'suspended' || normalized === 'closed') return normalized;
  if (normalized === 'invited' || normalized === 'pending') return 'invited';
  return 'not linked';
}

export function formatStatus(value: string | null | undefined) { return (value ?? 'unknown').replaceAll('_', ' '); }
