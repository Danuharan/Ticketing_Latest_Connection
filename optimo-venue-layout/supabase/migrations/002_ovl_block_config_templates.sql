-- =============================================================================
-- OVL Migration 002 — block_config_templates
--
-- Reusable per-block-type configurations (seating / dining-table / general-admission).
-- Replaces the localStorage-based BlockConfigTemplateService.
--
-- Each row = one saved config for one block type.
-- The block references it via appliedConfigId (stored inside layout_config JSONB).
--
-- Run in Supabase SQL Editor after 001_ovl_initial_schema.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.block_config_templates (
  id            uuid    primary key default gen_random_uuid(),
  created_by    uuid    not null default auth.uid() references public.profiles (id) on delete restrict,

  -- Human-readable name chosen by the admin (e.g. "Lower tier curved seating")
  name          text    not null,

  -- 'seating' | 'dining-table' | 'general-admission'
  block_type    text    not null,

  -- Snapshot of the block's configuration.
  -- Exactly one of the top-level keys (seating / dining / ga) will be present.
  -- Shape mirrors BlockConfigTemplate in block-config-template.model.ts:
  --   { "seating": { physicalLengthM, rows, seatsPerRow, seatLayout, ... } }
  --   { "dining":  { diningTables, tableGridMode, diningStage, ... } }
  --   { "ga":      { gaConfiguredSides: [{logicalId, label}], gaMaxParticipants } }
  config        jsonb   not null default '{}',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint block_config_templates_name_not_blank
    check (char_length(trim(name)) between 1 and 200),

  constraint block_config_templates_block_type_valid
    check (block_type in ('seating', 'dining-table', 'general-admission')),

  constraint block_config_templates_config_is_object
    check (jsonb_typeof(config) = 'object')
);

comment on table public.block_config_templates is
  'Reusable block configurations saved by an admin. One row per named config per block type.';

comment on column public.block_config_templates.config is
  'Snapshot of block settings. Key = seating | dining | ga. Shape matches Angular BlockConfigTemplate.';

comment on column public.block_config_templates.block_type is
  'seating | dining-table | general-admission — mirrors BlockTypeId in Angular.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Primary lookup: list configs owned by the current user, filtered by block_type
create index if not exists block_config_templates_owner_type_idx
  on public.block_config_templates (created_by, block_type, name);

-- ---------------------------------------------------------------------------
-- Updated-at trigger (reuse the function from migration 001)
-- ---------------------------------------------------------------------------
drop trigger if exists block_config_templates_set_updated_at
  on public.block_config_templates;

create trigger block_config_templates_set_updated_at
  before update on public.block_config_templates
  for each row execute function public.ovl_set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — owner-only CRUD
-- ---------------------------------------------------------------------------
alter table public.block_config_templates enable row level security;

drop policy if exists "block_config_templates_select_own" on public.block_config_templates;
create policy "block_config_templates_select_own"
  on public.block_config_templates for select
  to authenticated
  using (created_by = auth.uid());

drop policy if exists "block_config_templates_insert_own" on public.block_config_templates;
create policy "block_config_templates_insert_own"
  on public.block_config_templates for insert
  to authenticated
  with check (created_by = auth.uid());

drop policy if exists "block_config_templates_update_own" on public.block_config_templates;
create policy "block_config_templates_update_own"
  on public.block_config_templates for update
  to authenticated
  using  (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists "block_config_templates_delete_own" on public.block_config_templates;
create policy "block_config_templates_delete_own"
  on public.block_config_templates for delete
  to authenticated
  using (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants (Supabase Data API)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete
  on public.block_config_templates
  to authenticated;

revoke all on public.block_config_templates from anon;
