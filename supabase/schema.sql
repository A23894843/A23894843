create extension if not exists pgcrypto;

create table if not exists public.profiles(
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null default '',
    role text not null default 'admin' check(role='admin'),
    status text not null default 'pending' check(status in('pending','approved','disabled')),
    created_at timestamptz not null default now()
);

create table if not exists public.documents(
    id uuid primary key default gen_random_uuid(),
    title text not null,
    type text not null check(type in('cv','report','certificate')),
    storage_path text not null unique,
    download_allowed boolean not null default false,
    visibility text not null default 'public'
        check(visibility in('public','private')),
    created_by uuid not null references public.profiles(id),
    created_at timestamptz not null default now()
);



-- =========================================================
-- DOCUMENT VISIBILITY
-- Existing documents remain public. Private documents are
-- visible/readable only to approved admins through RLS.
-- =========================================================

alter table public.documents
    add column if not exists visibility text not null default 'public';

alter table public.documents
    drop constraint if exists documents_visibility_check;

alter table public.documents
    add constraint documents_visibility_check
    check(visibility in('public','private'));

alter table public.profiles enable row level security; 
alter table public.documents enable row level security;

create or replace function public.is_approved_admin() 
returns boolean language sql stable security definer set search_path=public as $$ 
    select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and status='approved'); 
$$;

create policy "profile read" on public.profiles for select using(id=auth.uid() or public.is_approved_admin());
create policy "admin update profiles" on public.profiles for update using(public.is_approved_admin()) with check(public.is_approved_admin());

create policy "admin read docs" on public.documents for select using(public.is_approved_admin());
create policy "admin insert docs" on public.documents for insert with check(public.is_approved_admin());
create policy "admin delete docs" on public.documents for delete using(public.is_approved_admin());

insert into storage.buckets(id,name,public) values('documents','documents',false) on conflict(id) do update set public=false;

create policy "admin upload" on storage.objects for insert with check(bucket_id='documents' and public.is_approved_admin());
create policy "admin storage read" on storage.objects for select using(bucket_id='documents' and public.is_approved_admin());
create policy "admin storage delete" on storage.objects for delete using(bucket_id='documents' and public.is_approved_admin());

-- =========================================================
-- BUG FIX: Auth Trigger
-- Automatically creates a pending profile when a user signs up
-- =========================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', ''),
    'admin',
    'pending'
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- After the first signup, bootstrap that account manually via Supabase SQL editor:
-- UPDATE public.profiles SET status='approved' WHERE id='AUTH_USER_UUID';
