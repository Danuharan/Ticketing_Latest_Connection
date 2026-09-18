-- List-page metadata: precomputed stats + lightweight preview thumbnail (no layout_config in list queries).

alter table public.venue_layout_templates
  add column if not exists element_count integer,
  add column if not exists block_count integer,
  add column if not exists seat_count integer,
  add column if not exists preview_thumbnail text;

comment on column public.venue_layout_templates.element_count is
  'Cached element count for list cards — updated whenever layout_config is saved.';

comment on column public.venue_layout_templates.block_count is
  'Cached block count for list cards — updated whenever layout_config is saved.';

comment on column public.venue_layout_templates.seat_count is
  'Cached seat count for list cards — updated whenever layout_config is saved.';

comment on column public.venue_layout_templates.preview_thumbnail is
  'SVG data URL thumbnail for list cards — block/sector shapes only, no per-seat geometry.';

alter table public.venue_layout_templates
  drop constraint if exists venue_layout_templates_element_count_non_negative;

alter table public.venue_layout_templates
  add constraint venue_layout_templates_element_count_non_negative
  check (element_count is null or element_count >= 0);

alter table public.venue_layout_templates
  drop constraint if exists venue_layout_templates_block_count_non_negative;

alter table public.venue_layout_templates
  add constraint venue_layout_templates_block_count_non_negative
  check (block_count is null or block_count >= 0);

alter table public.venue_layout_templates
  drop constraint if exists venue_layout_templates_seat_count_non_negative;

alter table public.venue_layout_templates
  add constraint venue_layout_templates_seat_count_non_negative
  check (seat_count is null or seat_count >= 0);
