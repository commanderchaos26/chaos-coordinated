-- Restore least-privilege Data API access used by the mobile app and service finalizer.
-- RLS remains enabled and continues to scope authenticated notification reads.

grant select on table public.employee_notifications
to authenticated;

grant select on table public.ai_walkthrough_issues
to service_role;
