import { runDispatchRpc } from './dispatchCommands';

export type ScheduleExceptionKind = 'unavailable' | 'pto' | 'sick' | 'training' | 'restricted';
export type ScheduleRecurrence = 'one_off' | 'weekly';

export function setCompanyScheduleDay(params: {
  p_company_id: string;
  p_weekday: number;
  p_is_workday: boolean;
  p_start_time?: string | null;
  p_end_time?: string | null;
}) {
  return runDispatchRpc('schedule_set_company_day', params);
}

export function addScheduleException(params: {
  p_company_id: string;
  p_employee_id: string;
  p_kind: ScheduleExceptionKind;
  p_recurrence: ScheduleRecurrence;
  p_starts_at?: string | null;
  p_ends_at?: string | null;
  p_weekday?: number | null;
  p_start_time?: string | null;
  p_end_time?: string | null;
  p_effective_from?: string | null;
  p_effective_to?: string | null;
  p_note?: string | null;
  p_approve?: boolean;
}) {
  return runDispatchRpc('schedule_add_exception', params);
}

export function approveScheduleException(params: { p_company_id: string; p_exception_id: string }) {
  return runDispatchRpc('schedule_approve_exception', params);
}

export function removeScheduleException(params: { p_company_id: string; p_exception_id: string }) {
  return runDispatchRpc('schedule_remove_exception', params);
}
