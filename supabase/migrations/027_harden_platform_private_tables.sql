
do $$
declare
  v_table text;
  v_policy text;
begin
  foreach v_table in array array[
    'platform_owner_grants',
    'platform_license_events',
    'platform_test_accounts',
    'platform_test_artifacts'
  ]
  loop
    v_policy := v_table || '_deny_client_access';
    if not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename=v_table and policyname=v_policy
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (false) with check (false)',
        v_policy,
        v_table
      );
    end if;
  end loop;
end
$$;

create index if not exists platform_license_events_company_created_idx
  on public.platform_license_events(company_id, created_at desc);

create index if not exists platform_test_accounts_company_active_idx
  on public.platform_test_accounts(company_id, active, created_at desc);

create index if not exists platform_test_artifacts_account_status_idx
  on public.platform_test_artifacts(test_account_id, status, created_at desc);
