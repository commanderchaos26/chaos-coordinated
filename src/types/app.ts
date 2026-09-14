export type AppRole =
  | 'owner'
  | 'operations_manager'
  | 'supervisor'
  | 'dispatcher'
  | 'crew_lead'
  | 'technician'
  | 'client_viewer';

export type Membership = {
  companyId: string;
  companyName: string;
  employeeId: string;
  displayName: string;
  roles: AppRole[];
};
