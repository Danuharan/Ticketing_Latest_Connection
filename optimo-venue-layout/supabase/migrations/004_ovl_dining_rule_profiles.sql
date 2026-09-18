-- =============================================================================
-- OVL Migration 004 — dining_rule_profiles
--
-- Reusable operational spacing / occupancy rules for dining layout generation.
-- Values are venue defaults only — not legal/fire-code claims.
-- =============================================================================

create table if not exists public.dining_rule_profiles (
  id            uuid    primary key default gen_random_uuid(),
  created_by    uuid    not null default auth.uid() references public.profiles (id) on delete restrict,

  name          text    not null,
  is_default    boolean not null default false,

  minimum_table_clearance_m   numeric(6,2) not null default 0.60,
  minimum_chair_clearance_m   numeric(6,2) not null default 0.20,
  wall_clearance_m            numeric(6,2) not null default 0.40,
  guest_aisle_width_m         numeric(6,2) not null default 0.90,
  main_guest_aisle_width_m    numeric(6,2) not null default 1.20,
  waiter_aisle_width_m        numeric(6,2) not null default 0.80,
  service_route_clearance_m   numeric(6,2) not null default 0.60,
  entrance_clearance_m        numeric(6,2) not null default 1.00,
  exit_clearance_m            numeric(6,2) not null default 1.00,
  stage_clearance_m           numeric(6,2) not null default 0.80,
  food_prep_clearance_m       numeric(6,2) not null default 0.80,
  obstacle_clearance_m        numeric(6,2) not null default 0.40,
  maximum_occupancy           integer,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint dining_rule_profiles_name_not_blank
    check (char_length(trim(name)) between 1 and 200)
);

comment on table public.dining_rule_profiles is
  'Editable dining layout spacing defaults. Not a legal compliance certificate.';

create unique index if not exists dining_rule_profiles_one_default_per_owner
  on public.dining_rule_profiles (created_by)
  where is_default;

drop trigger if exists dining_rule_profiles_set_updated_at
  on public.dining_rule_profiles;

create trigger dining_rule_profiles_set_updated_at
  before update on public.dining_rule_profiles
  for each row execute function public.ovl_set_updated_at();

alter table public.dining_rule_profiles enable row level security;

drop policy if exists "dining_rule_profiles_select_own" on public.dining_rule_profiles;
create policy "dining_rule_profiles_select_own"
  on public.dining_rule_profiles for select
  using (created_by = auth.uid());

drop policy if exists "dining_rule_profiles_insert_own" on public.dining_rule_profiles;
create policy "dining_rule_profiles_insert_own"
  on public.dining_rule_profiles for insert
  with check (created_by = auth.uid());

drop policy if exists "dining_rule_profiles_update_own" on public.dining_rule_profiles;
create policy "dining_rule_profiles_update_own"
  on public.dining_rule_profiles for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists "dining_rule_profiles_delete_own" on public.dining_rule_profiles;
create policy "dining_rule_profiles_delete_own"
  on public.dining_rule_profiles for delete
  using (created_by = auth.uid());
