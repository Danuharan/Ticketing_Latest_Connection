-- =============================================================================
-- OVL Migration 003 — parking_layout_templates
--
-- Parking layouts are a SEPARATE 2D canvas from the venue's stadium layout —
-- not embedded inside venue_layout_templates.layout_config.elements. One venue
-- layout can have multiple linked parking layouts (one-to-many via FK).
--
-- Run in Supabase SQL Editor after 001_ovl_initial_schema.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.parking_layout_templates (
  id uuid primary key default gen_random_uuid(),

  -- Parent venue — deleting the venue deletes its linked parking layouts.
  venue_layout_template_id uuid not null
    references public.venue_layout_templates (id) on delete cascade,

  -- Ownership
  created_by uuid not null references public.profiles (id) on delete restrict,
  updated_by uuid references public.profiles (id) on delete set null,

  name text not null,
  description text,

  -- Full layout document from Angular LayoutCanvasService export.
  -- Same contract as venue_layout_templates.layout_config:
  -- { "version": 1, "canvas": { "width": 1000, "height": 700 }, "elements": [ ... ] }
  layout_config jsonb not null,
  layout_schema_version integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint parking_layout_templates_name_not_blank
    check (char_length(trim(name)) between 1 and 200),

  constraint parking_layout_templates_description_length
    check (description is null or char_length(description) <= 2000),

  constraint parking_layout_templates_layout_config_object
    check (jsonb_typeof(layout_config) = 'object'),

  constraint parking_layout_templates_layout_config_required_keys
    check (
      layout_config ? 'version'
      and layout_config ? 'canvas'
      and layout_config ? 'elements'
      and jsonb_typeof(layout_config -> 'elements') = 'array'
    ),

  constraint parking_layout_templates_schema_version_positive
    check (layout_schema_version >= 1)
);

comment on table public.parking_layout_templates is
  'Parking-lot 2D layouts. Each row is its own canvas, linked to a venue_layout_templates row via FK — never embedded inside the venue''s own layout_config.';

comment on column public.parking_layout_templates.venue_layout_template_id is
  'Parent venue this parking layout belongs to. One venue can have many parking layouts.';

comment on column public.parking_layout_templates.layout_config is
  'Serialized layout: version, canvas, elements[]. Same shape/contract as venue_layout_templates.layout_config.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- "Connected parking layouts" list for one venue, newest first
create index if not exists parking_layout_templates_venue_idx
  on public.parking_layout_templates (venue_layout_template_id, updated_at desc);

-- Owner-wide list (Venue Layouts library page groups this by venue client-side)
create index if not exists parking_layout_templates_owner_idx
  on public.parking_layout_templates (created_by, updated_at desc);

-- ---------------------------------------------------------------------------
-- Updated-at trigger (reuse the function from migration 001)
-- ---------------------------------------------------------------------------
drop trigger if exists parking_layout_templates_set_updated_at
  on public.parking_layout_templates;

create trigger parking_layout_templates_set_updated_at
  before update on public.parking_layout_templates
  for each row execute function public.ovl_set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — owner-only CRUD (same shape as venue_layout_templates)
-- ---------------------------------------------------------------------------
alter table public.parking_layout_templates enable row level security;

drop policy if exists "parking_layout_templates_select_own" on public.parking_layout_templates;
create policy "parking_layout_templates_select_own"
  on public.parking_layout_templates for select
  to authenticated
  using (created_by = auth.uid());

drop policy if exists "parking_layout_templates_insert_own" on public.parking_layout_templates;
create policy "parking_layout_templates_insert_own"
  on public.parking_layout_templates for insert
  to authenticated
  with check (created_by = auth.uid());

drop policy if exists "parking_layout_templates_update_own" on public.parking_layout_templates;
create policy "parking_layout_templates_update_own"
  on public.parking_layout_templates for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists "parking_layout_templates_delete_own" on public.parking_layout_templates;
create policy "parking_layout_templates_delete_own"
  on public.parking_layout_templates for delete
  to authenticated
  using (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants (Supabase Data API)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete
  on public.parking_layout_templates
  to authenticated;

revoke all on public.parking_layout_templates from anon;
