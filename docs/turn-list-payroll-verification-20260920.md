# Turn-list and payroll verification — September 20, 2026

Reviewed main at `832b1133cf08ef19c73e60bd03b232dd364d73bb`, including `3285964`, `d23cb5d`, and `832b113`. Inspected the deployed `client-document`, `scan-turn-list`, and `payroll-file` functions and the live database.

## Conclusion and applied fix

The three commits only partially fixed the failures. The two screen changes display plain-object Supabase errors; they do not change the failing operations. Migration 022 is applied and grants authenticated SELECT access, but left the Edge Functions' service role without table privileges.

Reproduced `42501: permission denied for table payroll_exports` by executing a SELECT as `service_role`. All six feature tables lacked service-role access. This also prevents `client-document` from reading clients and preparing uploads, and prevents `scan-turn-list` from reading/writing imports.

Applied `20260920215712_grant_feature_service_access` to project `twmjnbktebpaqwlsrgiy`. The matching migration in this branch grants only the operations used by the deployed functions:

| Tables | New service_role privileges |
| --- | --- |
| payroll_exports, clients, client_properties | SELECT |
| client_documents, turn_list_imports | SELECT, INSERT, UPDATE |
| turn_list_items | SELECT, INSERT, DELETE |

RLS, authenticated/anonymous grants, user roles, app features, and screens are unchanged. No application rebuild is needed for this database fix. No application or Edge Function code was deployed.

## Verification performed

- Before change: service-role payroll SELECT failed with 42501.
- Preflight: transaction-local grants allowed all six reads and zero-row UPDATE/DELETE operations; rolled back.
- After applying migration: service-role reads succeeded on all six tables.
- Under an existing owner's authenticated claims: payroll SELECT returned three exports; payroll generation returned `ok: true, export_count: 3`. Generation and its audit writes were rolled back.
- Under service_role: inserted a synthetic document, import, and apartment item; updated document/import state and exercised item DELETE. Under the owner's authenticated claims: `client_commit_turn_list_import` returned `pending_count: 1, needs_review_count: 0`; verified the resulting queue row had unit and turnover IDs. Entire transaction rolled back.
- Confirmed zero documents/imports remained after rollback and the existing three payroll exports remained.
- Authenticated nonmember claims saw zero protected rows. RLS remains enabled on all six tables.
- Committed public key and URL returned HTTP 200 from `/auth/v1/settings`. Anonymous REST reads of payroll/imports returned HTTP 401 / SQLSTATE 42501, as expected.
- `npm ci --ignore-scripts`, `npm run typecheck`, and `git diff --check` passed. No dependencies changed.
- Security advisor reviewed: existing warnings about authenticated SECURITY DEFINER RPCs and disabled leaked-password protection; informational no-policy notices on internal tables. No RLS-disabled feature tables. These notices do not justify weakening the existing permissions.

SQL role/claim tests exercise database authorization, not actual HTTP JWT validation or a signed-in mobile session.

## Remaining findings and verification limits

1. **Payroll filtering hides records:** `app/(app)/payroll.tsx` filters exports against current active account links. One of the three current exports is hidden. Generation includes active/leave employees regardless of an active login link. Historical files can disappear when a link is disabled. This is a client filtering rule, not a SELECT/RLS failure. Retained pending a decision on whether payroll should include unlinked employees.
2. **Scan writes can fail silently:** `scan-turn-list/index.ts` does not check errors on initial status updates, deletion of old draft/review items, final status updates, audit insertion, or the final item read. It also deletes and reinserts in separate requests, without a scan lease/transaction. A failure or concurrent rescan can leave partial state. The grant fix removes the reproduced permission blocker but does not make rescanning atomic.
3. **Success alerts can conceal reload failures:** both screens' `load()` functions catch errors internally, so callers can display a success alert after a failed refresh. Payroll download errors also remain generic because `timeClockCommands.ts` does not decode a non-2xx Edge Function response body; server catches discard plain-object database messages.
4. **File size mismatch:** upload accepts up to 50 MiB; scan rejects documents above 20 MiB. Such a document can upload successfully and then fail scanning. Existing small-file features are unchanged.
5. **Environment:** `.env.example`, all EAS profiles, and Android CI target `twmjnbktebpaqwlsrgiy`, which contains the app tables. The second available project, `ogvpexsnhyywmhqwstai`, has no public app tables. A local `.env` or already installed APK pointing there would fail; the installed APK's embedded settings were not available to inspect.
6. **Gemini remains unverified:** scan requires server-side `GEMINI_API_KEY` and optionally `GEMINI_MODEL` (code fallback `gemini-3.8-flash`). Secret presence, selected model availability, quota, and actual extraction were not verified. Do not put Gemini or service-role secrets in `EXPO_PUBLIC_*` variables.
7. **Storage/mobile limits:** both private buckets exist, and all three functions are deployed with JWT verification. No authorized user session was available to test device file reads, signed upload/download URLs, gateway JWT handling, or a real Gemini request. No credentials were reset and no sessions were fabricated. A full end-to-end success claim would require those tests.
8. **Payroll schedule:** active cron job is `0 13 * * 4`, invoking `payroll_generate_previous_week_service()`. The function calculates the prior Monday–Friday period using company timezone. The schedule itself is fixed UTC. The calculation attributes an overnight shift entirely to its check-in date and ignores unmatched punches; those business rules were not changed or comprehensively tested.

## Rollback and migration handling

The applied change is only additive grants. To revert this exact change, revoke SELECT on payroll_exports/clients/client_properties, SELECT/INSERT/UPDATE on client_documents/turn_list_imports, and SELECT/INSERT/DELETE on turn_list_items **from service_role only**. This restores the reproduced failure and should only be used for deliberate rollback. Do not revoke authenticated access or disable RLS.

The new migration filename matches the live migration version. Older repository migrations use short numeric prefixes while the live history uses timestamped versions; do not blindly push the entire historic migration directory without reconciling that pre-existing history mismatch.
