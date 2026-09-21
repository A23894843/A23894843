-- Abhinandan Portfolio — Admin Control System
-- Phase 1-4: CAPTCHA-backed forms, profiles, admin approvals/permissions,
-- public queries/replies, audit logging.
-- Run after the existing supabase/schema.sql.

create extension if not exists pgcrypto;

-- -----------------------------
-- Profiles / roles
-- -----------------------------
alter table public.profiles add column if not exists phone text default '';
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
    check(role in('owner','admin','support'));

-- Existing approved admins remain admins. The first owner must be bootstrapped once
-- with the SQL comment at the bottom of this migration.

-- -----------------------------
-- Permission catalog
-- -----------------------------
create table if not exists public.admin_permissions(
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    permission text not null check(permission in(
        'VIEW_DASHBOARD',
        'MANAGE_PROFILE',
        'MANAGE_DOCUMENTS',
        'VIEW_QUERIES',
        'REPLY_QUERIES',
        'MANAGE_ADMINS',
        'APPROVE_ADMINS',
        'VIEW_AUDIT_LOG'
    )),
    granted_by uuid references public.profiles(id),
    created_at timestamptz not null default now(),
    unique(user_id, permission)
);

-- -----------------------------
-- Public contact/query system
-- -----------------------------
create table if not exists public.queries(
    id uuid primary key default gen_random_uuid(),
    name text not null check(char_length(name) between 1 and 100),
    email text not null check(char_length(email) between 3 and 320),
    subject text not null check(char_length(subject) between 1 and 160),
    message text not null check(char_length(message) between 1 and 8000),
    status text not null default 'open' check(status in('open','replied','closed','spam')),
    created_at timestamptz not null default now(),
    replied_at timestamptz,
    replied_by uuid references public.profiles(id)
);

create table if not exists public.query_replies(
    id uuid primary key default gen_random_uuid(),
    query_id uuid not null references public.queries(id) on delete cascade,
    admin_id uuid not null references public.profiles(id),
    message text not null check(char_length(message) between 1 and 8000),
    delivery_status text not null default 'stored' check(delivery_status in('stored','sent','failed')),
    created_at timestamptz not null default now()
);

-- -----------------------------
-- Audit log
-- -----------------------------
create table if not exists public.audit_logs(
    id uuid primary key default gen_random_uuid(),
    actor_id uuid references public.profiles(id) on delete set null,
    action text not null,
    target_type text,
    target_id uuid,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

-- -----------------------------
-- Security helpers
-- -----------------------------
create or replace function public.is_approved_admin(p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path=public
as $$
    select exists(
        select 1 from public.profiles
        where id=p_user and status='approved' and role in('owner','admin','support')
    );
$$;

create or replace function public.has_permission(p_permission text, p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path=public
as $$
    select exists(
        select 1 from public.profiles p
        where p.id=p_user
          and p.status='approved'
          and (
              p.role='owner'
              or exists(
                  select 1 from public.admin_permissions ap
                  where ap.user_id=p_user and ap.permission=p_permission
              )
          )
    );
$$;

-- -----------------------------
-- Admin RPCs: all security-sensitive mutations happen here.
-- -----------------------------
create or replace function public.admin_list_users()
returns table(
    id uuid,
    display_name text,
    email text,
    phone text,
    role text,
    status text,
    created_at timestamptz,
    updated_at timestamptz,
    permissions text[]
)
language plpgsql security definer set search_path=public
as $$
begin
    if not public.has_permission('MANAGE_ADMINS') then
        raise exception 'Not authorized';
    end if;
    return query
    select p.id,p.display_name,u.email,p.phone,p.role,p.status,p.created_at,p.updated_at,
           coalesce(array_agg(ap.permission) filter(where ap.permission is not null),'{}')
    from public.profiles p
    join auth.users u on u.id=p.id
    left join public.admin_permissions ap on ap.user_id=p.id
    group by p.id,u.email;
end;
$$;

create or replace function public.admin_set_status(p_user uuid,p_status text)
returns boolean
language plpgsql security definer set search_path=public
as $$
begin
    if not public.has_permission('APPROVE_ADMINS') then raise exception 'Not authorized'; end if;
    if p_user=auth.uid() then raise exception 'You cannot change your own approval status'; end if;
    if p_status not in('approved','disabled','pending') then raise exception 'Invalid status'; end if;
    update public.profiles set status=p_status,updated_at=now() where id=p_user;
    if not found then raise exception 'User not found'; end if;
    insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
    values(auth.uid(),'ADMIN_STATUS_CHANGED','profile',p_user,jsonb_build_object('status',p_status));
    return true;
end;
$$;

create or replace function public.admin_set_permissions(p_user uuid,p_permissions text[])
returns boolean
language plpgsql security definer set search_path=public
as $$
declare perm text;
begin
    if not public.has_permission('MANAGE_ADMINS') then raise exception 'Not authorized'; end if;
    if p_user=auth.uid() then raise exception 'You cannot change your own permissions'; end if;
    if exists(select 1 from public.profiles where id=p_user and role='owner') then
        raise exception 'Owner permissions cannot be edited here';
    end if;
    foreach perm in array coalesce(p_permissions,'{}') loop
        if perm not in('VIEW_DASHBOARD','MANAGE_PROFILE','MANAGE_DOCUMENTS','VIEW_QUERIES','REPLY_QUERIES','MANAGE_ADMINS','APPROVE_ADMINS','VIEW_AUDIT_LOG') then
            raise exception 'Invalid permission';
        end if;
    end loop;
    delete from public.admin_permissions where user_id=p_user;
    insert into public.admin_permissions(user_id,permission,granted_by)
    select p_user,perm,auth.uid() from unnest(coalesce(p_permissions,'{}')) perm;
    insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
    values(auth.uid(),'ADMIN_PERMISSIONS_CHANGED','profile',p_user,jsonb_build_object('permissions',p_permissions));
    return true;
end;
$$;

create or replace function public.admin_update_profile(p_display_name text,p_phone text)
returns boolean
language plpgsql security definer set search_path=public
as $$
begin
    if not public.has_permission('MANAGE_PROFILE') then raise exception 'Not authorized'; end if;
    update public.profiles set display_name=left(trim(coalesce(p_display_name,'')),80),phone=left(trim(coalesce(p_phone,'')),40),updated_at=now() where id=auth.uid();
    insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
    values(auth.uid(),'PROFILE_UPDATED','profile',auth.uid(),jsonb_build_object('display_name',left(trim(coalesce(p_display_name,'')),80)));
    return true;
end;
$$;

create or replace function public.admin_my_profile()
returns table(id uuid,display_name text,phone text,role text,status text,created_at timestamptz,updated_at timestamptz,email text,permissions text[])
language sql security definer set search_path=public
as $$
    select p.id,p.display_name,p.phone,p.role,p.status,p.created_at,p.updated_at,u.email,
           coalesce((select array_agg(ap.permission) from public.admin_permissions ap where ap.user_id=p.id),'{}')
    from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid();
$$;

-- -----------------------------
-- RLS
-- -----------------------------
alter table public.admin_permissions enable row level security;
alter table public.queries enable row level security;
alter table public.query_replies enable row level security;
alter table public.audit_logs enable row level security;

create policy "permission read own" on public.admin_permissions for select using(user_id=auth.uid() or public.has_permission('MANAGE_ADMINS'));
create policy "profile own update" on public.profiles for update using(id=auth.uid()) with check(id=auth.uid());

-- Queries/replies/audit are intentionally accessed by the server API with the secret key.
-- This prevents anonymous callers from writing directly to these tables.
-- No anon/authenticated insert/select policies are created here.

create policy "audit read" on public.audit_logs for select using(public.has_permission('VIEW_AUDIT_LOG'));

-- Make existing profile policies compatible with the expanded roles.
drop policy if exists "profile read" on public.profiles;
drop policy if exists "admin update profiles" on public.profiles;
create policy "profile read" on public.profiles for select using(id=auth.uid() or public.has_permission('MANAGE_ADMINS'));
create policy "admin update profiles" on public.profiles for update using(id=auth.uid() or public.has_permission('MANAGE_ADMINS')) with check(id=auth.uid() or public.has_permission('MANAGE_ADMINS'));

-- Give approved existing admins dashboard/profile access. Owner automatically has all permissions.
insert into public.admin_permissions(user_id,permission,granted_by)
select id,'VIEW_DASHBOARD',id from public.profiles where status='approved' and role='admin'
on conflict do nothing;
insert into public.admin_permissions(user_id,permission,granted_by)
select id,'MANAGE_PROFILE',id from public.profiles where status='approved' and role='admin'
on conflict do nothing;

-- First account bootstrap (run manually ONCE after identifying the correct auth user):
-- update public.profiles set role='owner', status='approved' where id='YOUR_AUTH_USER_UUID';
-- The owner automatically receives every permission through has_permission().

-- -----------------------------
-- Document access now follows granular permissions.
-- -----------------------------
drop policy if exists "admin read docs" on public.documents;
drop policy if exists "admin insert docs" on public.documents;
drop policy if exists "admin delete docs" on public.documents;
create policy "admin read docs" on public.documents for select using(public.has_permission('MANAGE_DOCUMENTS'));
create policy "admin insert docs" on public.documents for insert with check(public.has_permission('MANAGE_DOCUMENTS'));
create policy "admin delete docs" on public.documents for delete using(public.has_permission('MANAGE_DOCUMENTS'));

drop policy if exists "admin upload" on storage.objects;
drop policy if exists "admin storage read" on storage.objects;
drop policy if exists "admin storage delete" on storage.objects;
create policy "admin upload" on storage.objects for insert with check(bucket_id='documents' and public.has_permission('MANAGE_DOCUMENTS'));
create policy "admin storage read" on storage.objects for select using(bucket_id='documents' and public.has_permission('MANAGE_DOCUMENTS'));
create policy "admin storage delete" on storage.objects for delete using(bucket_id='documents' and public.has_permission('MANAGE_DOCUMENTS'));
