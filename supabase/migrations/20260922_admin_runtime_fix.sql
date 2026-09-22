-- Runtime compatibility fix for the rebuilt Admin Control Center.
-- Run this after the clean rebuild SQL.
-- It does NOT touch auth.users and does NOT touch /admin/config.js.

-- Keep the private documents bucket available.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do update set public = false;

-- The earlier function cleanup may have removed storage policies that depended on has_permission().
drop policy if exists "admin upload" on storage.objects;
drop policy if exists "admin storage read" on storage.objects;
drop policy if exists "admin storage delete" on storage.objects;
drop policy if exists "admin storage update" on storage.objects;

create policy "admin upload"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'documents'
    and (select public.has_permission('MANAGE_DOCUMENTS'))
);

create policy "admin storage read"
on storage.objects
for select
to authenticated
using (
    bucket_id = 'documents'
    and (select public.has_permission('MANAGE_DOCUMENTS'))
);

create policy "admin storage update"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'documents'
    and (select public.has_permission('MANAGE_DOCUMENTS'))
)
with check (
    bucket_id = 'documents'
    and (select public.has_permission('MANAGE_DOCUMENTS'))
);

create policy "admin storage delete"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'documents'
    and (select public.has_permission('MANAGE_DOCUMENTS'))
);

-- Ensure the current query/reply status values match the application.
alter table public.queries
    drop constraint if exists queries_status_check;

alter table public.queries
    add constraint queries_status_check
    check (status in ('new','read','replied','closed','spam'));

-- Rebuild the trigger function defensively so future signups create pending profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, display_name, role, status)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'display_name', ''),
        'admin',
        'pending'
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

-- Verify the key runtime objects.
select table_name
from information_schema.tables
where table_schema='public'
  and table_name in ('profiles','admin_permissions','documents','queries','query_replies','audit_logs')
order by table_name;
