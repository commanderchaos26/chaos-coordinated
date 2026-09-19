insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('payroll-exports','payroll-exports',false,5242880,array['text/plain'])
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;
