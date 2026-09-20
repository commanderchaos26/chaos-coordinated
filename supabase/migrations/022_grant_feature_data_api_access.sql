grant select on table public.payroll_exports
to authenticated;

grant select on table
  public.clients,
  public.client_properties,
  public.client_documents,
  public.turn_list_imports,
  public.turn_list_items
to authenticated;
