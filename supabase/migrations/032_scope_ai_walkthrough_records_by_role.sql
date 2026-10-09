-- Restrict sensitive AI walkthrough transcripts/results to authorized personnel.
-- Prior policies let every active company member read every walkthrough,
-- transcript, and generated issue, even without AI or task assignment rights.
-- Keep access for the session's author and management; allow employees to read
-- issue metadata only for work orders they are authorized to view.
begin;

alter policy ai_walkthrough_sessions_company_select
on public.ai_walkthrough_sessions
using (
  private.has_company_role(
    company_id,
    array['owner','operations_manager','supervisor','dispatcher']::public.app_role[]
  )
  or started_by = private.current_employee_id(company_id)
);

alter policy ai_walkthrough_chunks_company_select
on public.ai_walkthrough_transcript_chunks
using (
  private.has_company_role(
    company_id,
    array['owner','operations_manager','supervisor','dispatcher']::public.app_role[]
  )
  or exists (
    select 1 from public.ai_walkthrough_sessions s
    where s.company_id = ai_walkthrough_transcript_chunks.company_id
      and s.id = ai_walkthrough_transcript_chunks.session_id
      and s.started_by = private.current_employee_id(s.company_id)
  )
);

alter policy ai_walkthrough_issues_company_select
on public.ai_walkthrough_issues
using (
  private.has_company_role(
    company_id,
    array['owner','operations_manager','supervisor','dispatcher']::public.app_role[]
  )
  or exists (
    select 1 from public.ai_walkthrough_sessions s
    where s.company_id = ai_walkthrough_issues.company_id
      and s.id = ai_walkthrough_issues.session_id
      and s.started_by = private.current_employee_id(s.company_id)
  )
  or (
    work_order_id is not null
    and private.can_view_work_order(work_order_id, company_id)
  )
);

commit;
