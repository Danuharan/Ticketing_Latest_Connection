import { VenueLayoutConfig } from './venue-layout-config.model';

/** Row for a parking layout card (includes layout for thumbnail preview). */
export interface ParkingLayoutTemplateSummary {
  id: string;
  venue_layout_template_id: string;
  name: string;
  description: string | null;
  layout_schema_version: number;
  layout_config: VenueLayoutConfig;
  element_count: number;
  block_count: number;
  seat_count: number;
  updated_at: string;
  created_at: string;
}

/** Lightweight parking row for venue list cards (no layout_config). */
export interface ParkingLayoutTemplateLink {
  id: string;
  venue_layout_template_id: string;
  name: string;
}

/** Full parking layout template row including layout_config. */
export interface ParkingLayoutTemplate {
  id: string;
  venue_layout_template_id: string;
  name: string;
  description: string | null;
  layout_config: VenueLayoutConfig;
  layout_schema_version: number;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateParkingTemplateInput {
  venueLayoutTemplateId: string;
  name: string;
  description?: string;
  layoutConfig: VenueLayoutConfig;
}

export interface UpdateParkingTemplateInput {
  name?: string;
  description?: string;
  layoutConfig?: VenueLayoutConfig;
}
