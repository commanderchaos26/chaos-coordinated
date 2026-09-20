-- Server-only access required by payroll-file, client-document and scan-turn-list.
-- Keep authenticated/anon grants and all RLS policies unchanged.
grant select on table public.payroll_exports, public.clients, public.client_properties to service_role;
grant select, insert, update on table public.client_documents, public.turn_list_imports to service_role;
grant select, insert, delete on table public.turn_list_items to service_role;
