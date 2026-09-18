-- =============================================================================
-- Optimo Venue Layout (OVL) — Production schema
-- Angular app: optimo-venue-layout
--
-- Run this in Supabase SQL Editor (new project, empty database).
-- Does NOT depend on the Tkting prototype / membership tables.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 2. Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ovl_user_role') then
    create type public.ovl_user_role as enum ('admin', 'viewer');
  end if;

  if not exists (select 1 from pg_type where typname = 'ovl_template_status') then
    create type public.ovl_template_status as enum ('draft', 'published', 'archived');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Profiles (one row per Supabase Auth user)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role public.ovl_user_role not null default 'admin',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_email_not_blank check (char_length(trim(email)) > 0)
);

comment on table public.profiles is
  'OVL admin users. Linked 1:1 to auth.users. Used by RLS for template ownership.';

create index if not exists profiles_role_idx on public.profiles (role) where is_active = true;

-- ---------------------------------------------------------------------------
-- 4. Venue layout templates (saved designer work)
-- ---------------------------------------------------------------------------
create table if not exists public.venue_layout_templates (
  id uuid primary key default gen_random_uuid(),

  -- Ownership
  created_by uuid not null references public.profiles (id) on delete restrict,
  updated_by uuid references public.profiles (id) on delete set null,

  -- Searchable metadata (also duplicated inside layout_config for portability)
  name text not null,
  description text,

  -- Full layout document from Angular LayoutCanvasService export
  -- Expected shape:
  -- {
  --   "version": 1,
  --   "canvas": { "width": 1000, "height": 700 },
  --   "elements": [ ... LayoutElement[] ... ]
  -- }
  layout_config jsonb not null,
  layout_schema_version integer not null default 1,

  status public.ovl_template_status not null default 'draft',

  -- Soft delete (production: never hard-delete customer layouts by accident)
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint venue_layout_templates_name_not_blank
    check (char_length(trim(name)) between 1 and 200),

  constraint venue_layout_templates_description_length
    check (description is null or char_length(description) <= 2000),

  constraint venue_layout_templates_layout_config_object
    check (jsonb_typeof(layout_config) = 'object'),

  constraint venue_layout_templates_layout_config_required_keys
    check (
      layout_config ? 'version'
      and layout_config ? 'canvas'
      and layout_config ? 'elements'
      and jsonb_typeof(layout_config -> 'elements') = 'array'
    ),

  constraint venue_layout_templates_schema_version_positive
    check (layout_schema_version >= 1)
);

comment on table public.venue_layout_templates is
  'Reusable venue layouts designed in OVL. layout_config stores the full canvas JSON.';

comment on column public.venue_layout_templates.layout_config is
  'Serialized layout: version, canvas, elements[]. Geometry is %-based (see Angular layout-element.model.ts).';

comment on column public.venue_layout_templates.status is
  'draft = work in progress, published = ready to use, archived = hidden from default lists.';

-- List page: active templates for a user, newest first
create index if not exists venue_layout_templates_owner_list_idx
  on public.venue_layout_templates (created_by, updated_at desc)
  where deleted_at is null;

create index if not exists venue_layout_templates_status_idx
  on public.venue_layout_templates (created_by, status)
  where deleted_at is null;

-- Optional: JSON path queries later (e.g. count elements)
create index if not exists venue_layout_templates_layout_config_gin_idx
  on public.venue_layout_templates using gin (layout_config);

-- ---------------------------------------------------------------------------
-- 5. Updated-at trigger (shared)
-- ---------------------------------------------------------------------------
create or replace function public.ovl_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.ovl_set_updated_at();

drop trigger if exists venue_layout_templates_set_updated_at on public.venue_layout_templates;
create trigger venue_layout_templates_set_updated_at
  before update on public.venue_layout_templates
  for each row execute function public.ovl_set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Auto-create profile when a new user signs up (Supabase Auth)
-- ---------------------------------------------------------------------------
create or replace function public.ovl_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_ovl on auth.users;
create trigger on_auth_user_created_ovl
  after insert on auth.users
  for each row execute function public.ovl_handle_new_user();

-- ---------------------------------------------------------------------------
-- 7. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.venue_layout_templates enable row level security;

-- Profiles: users read/update only their own row
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Templates: owner-only CRUD on non-deleted rows
drop policy if exists "templates_select_own" on public.venue_layout_templates;
create policy "templates_select_own"
  on public.venue_layout_templates for select
  to authenticated
  using (created_by = auth.uid() and deleted_at is null);

drop policy if exists "templates_insert_own" on public.venue_layout_templates;
create policy "templates_insert_own"
  on public.venue_layout_templates for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and deleted_at is null
  );

drop policy if exists "templates_update_own" on public.venue_layout_templates;
create policy "templates_update_own"
  on public.venue_layout_templates for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists "templates_delete_own" on public.venue_layout_templates;
create policy "templates_delete_own"
  on public.venue_layout_templates for delete
  to authenticated
  using (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- 8. Soft-delete helper (call from app instead of hard DELETE)
-- ---------------------------------------------------------------------------
create or replace function public.ovl_archive_template(p_template_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.venue_layout_templates
  set
    status = 'archived',
    deleted_at = now(),
    deleted_by = auth.uid()
  where id = p_template_id
    and created_by = auth.uid()
    and deleted_at is null;

  if not found then
    raise exception 'Template not found or access denied';
  end if;
end;
$$;

comment on function public.ovl_archive_template(uuid) is
  'Soft-delete a template. Prefer this over DELETE in production.';

grant execute on function public.ovl_archive_template(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. List helper (lightweight rows for Venue Layouts page — no big JSON)
-- ---------------------------------------------------------------------------
create or replace function public.ovl_list_my_templates()
returns table (
  id uuid,
  name text,
  description text,
  status public.ovl_template_status,
  layout_schema_version integer,
  element_count integer,
  updated_at timestamptz,
  created_at timestamptz
)
language sql
security invoker
stable
set search_path = public
as $$
  select
    t.id,
    t.name,
    t.description,
    t.status,
    t.layout_schema_version,
    coalesce(jsonb_array_length(t.layout_config -> 'elements'), 0) as element_count,
    t.updated_at,
    t.created_at
  from public.venue_layout_templates t
  where t.created_by = auth.uid()
    and t.deleted_at is null
  order by t.updated_at desc;
$$;

grant execute on function public.ovl_list_my_templates() to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Grants (Supabase Data API)
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.venue_layout_templates to authenticated;

-- anon role: no access to these tables (login required)
revoke all on public.profiles from anon;
revoke all on public.venue_layout_templates from anon;
