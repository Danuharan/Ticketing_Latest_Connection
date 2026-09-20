import { VenueLayoutConfig } from './venue-layout-config.model';

export type VenueTemplateStatus = 'draft' | 'published' | 'archived';

/** Row for the Venue Layouts list card (lightweight — no layout_config). */
export interface VenueLayoutTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  status: VenueTemplateStatus;
  layout_schema_version: number;
  element_count: number;
  block_count: number;
  seat_count: number;
  preview_thumbnail: string | null;
  updated_at: string;
  created_at: string;
}

/** Paginated list response from Supabase. */
export interface VenueLayoutTemplateListPage {
  items: VenueLayoutTemplateSummary[];
  total: number;
}

/** Full template row including layout_config. */
export interface VenueLayoutTemplate {
  id: string;
  name: string;
  description: string | null;
  layout_config: VenueLayoutConfig;
  layout_schema_version: number;
  status: VenueTemplateStatus;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateVenueTemplateInput {
  name: string;
  description?: string;
  layoutConfig: VenueLayoutConfig;
  status?: VenueTemplateStatus;
}

export interface UpdateVenueTemplateInput {
  name?: string;
  description?: string;
  layoutConfig?: VenueLayoutConfig;
  status?: VenueTemplateStatus;
  /** Blocks the user deleted — their venue_block_configurations rows are removed. */
  deletedBlockElementIds?: readonly string[];
  /**
   * True when `layoutConfig` still has blocks whose seating was never fetched.
   * The saved thumbnail is then left alone, since it cannot be redrawn without
   * every block's seats.
   */
  hasUnfetchedSeating?: boolean;
}
