export const LIVE_ASSIGNMENT_STATUSES = new Set(['offered', 'accepted', 'active', 'paused', 'submitted']);
export const TERMINAL_ASSIGNMENT_STATUSES = new Set(['declined', 'completed', 'cancelled']);
export const TERMINAL_WORK_ORDER_STATUSES = new Set(['completed', 'cancelled']);

export function normalizeStatus(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

export function isLiveAssignmentStatus(value: string | null | undefined) {
  return LIVE_ASSIGNMENT_STATUSES.has(normalizeStatus(value));
}

export function isTerminalAssignmentStatus(value: string | null | undefined) {
  return TERMINAL_ASSIGNMENT_STATUSES.has(normalizeStatus(value));
}

export function isTerminalWorkOrderStatus(value: string | null | undefined) {
  return TERMINAL_WORK_ORDER_STATUSES.has(normalizeStatus(value));
}

export function selectCurrentAssignment<T extends { status?: string | null }>(
  assignments: T[],
  workOrderStatus?: string | null,
): T | null {
  const live = assignments.find((assignment) => isLiveAssignmentStatus(assignment.status));
  if (live) return live;
  return isTerminalWorkOrderStatus(workOrderStatus) ? assignments[0] ?? null : null;
}
