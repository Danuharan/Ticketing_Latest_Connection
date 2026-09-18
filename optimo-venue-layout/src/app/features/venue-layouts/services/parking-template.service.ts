import { Injectable, inject } from '@angular/core';

import { countLayoutStats } from '../lib/layout-stats';
import { VenueLayoutConfig } from '../../../core/models/venue-layout-config.model';
import {
  CreateParkingTemplateInput,
  ParkingLayoutTemplate,
  ParkingLayoutTemplateLink,
  ParkingLayoutTemplateSummary,
  UpdateParkingTemplateInput,
} from '../../../core/models/parking-layout-template.model';
import { AuthService } from '../../../core/services/auth.service';
import { SupabaseService } from '../../../core/services/supabase.service';

interface ParkingTemplateRow {
  id: string;
  venue_layout_template_id: string;
  name: string;
  description: string | null;
  layout_config: unknown;
  layout_schema_version: number;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Parking layouts are a separate 2D canvas from the venue's stadium layout — their own
 * table, linked to venue_layout_templates via a foreign key, never embedded inside the
 * venue's own layout_config.elements.
 */
@Injectable({ providedIn: 'root' })
export class ParkingTemplateService {
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);

  /** All parking layouts linked to one venue, newest first. */
  async listForVenue(venueId: string): Promise<ParkingLayoutTemplateSummary[]> {
    const { data, error } = await this.supabase
      .from('parking_layout_templates')
      .select(
        'id, venue_layout_template_id, name, description, layout_schema_version, layout_config, updated_at, created_at',
      )
      .eq('venue_layout_template_id', venueId)
      .order('updated_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => this.rowToSummary(row as ParkingTemplateRow));
  }

  /** Parking layout names for venue list cards — no layout_config payload. */
  async listLinksForVenues(venueIds: string[]): Promise<ParkingLayoutTemplateLink[]> {
    if (venueIds.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase
      .from('parking_layout_templates')
      .select('id, venue_layout_template_id, name')
      .in('venue_layout_template_id', venueIds)
      .order('updated_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as ParkingLayoutTemplateLink[];
  }

  /** Every parking layout owned by the current user, across all venues (RLS-scoped). */
  async listAllMine(): Promise<ParkingLayoutTemplateSummary[]> {
    const { data, error } = await this.supabase
      .from('parking_layout_templates')
      .select(
        'id, venue_layout_template_id, name, description, layout_schema_version, layout_config, updated_at, created_at',
      )
      .order('updated_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => this.rowToSummary(row as ParkingTemplateRow));
  }

  async getTemplateById(id: string): Promise<ParkingLayoutTemplate> {
    const { data, error } = await this.supabase
      .from('parking_layout_templates')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return this.rowToTemplate(data as ParkingTemplateRow);
  }

  async createTemplate(input: CreateParkingTemplateInput): Promise<string> {
    const userId = this.requireUserId();
    this.validateLayout(input.layoutConfig);

    const { data, error } = await this.supabase
      .from('parking_layout_templates')
      .insert({
        venue_layout_template_id: input.venueLayoutTemplateId,
        created_by: userId,
        updated_by: userId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        layout_config: input.layoutConfig,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? 'Unable to save parking layout.');
    }

    return data.id as string;
  }

  async updateTemplate(id: string, input: UpdateParkingTemplateInput): Promise<void> {
    const userId = this.requireUserId();
    const patch: Record<string, unknown> = { updated_by: userId };

    if (input.name !== undefined) {
      patch['name'] = input.name.trim();
    }
    if (input.description !== undefined) {
      patch['description'] = input.description.trim() || null;
    }
    if (input.layoutConfig !== undefined) {
      this.validateLayout(input.layoutConfig);
      patch['layout_config'] = input.layoutConfig;
    }

    const { error } = await this.supabase.from('parking_layout_templates').update(patch).eq('id', id);
    if (error) {
      throw new Error(error.message);
    }
  }

  async deleteTemplate(id: string): Promise<void> {
    const { error } = await this.supabase.from('parking_layout_templates').delete().eq('id', id);
    if (error) {
      throw new Error(error.message);
    }
  }

  private rowToSummary(row: ParkingTemplateRow): ParkingLayoutTemplateSummary {
    const layout = row.layout_config as VenueLayoutConfig;
    this.validateLayout(layout);

    const stats = countLayoutStats(layout);

    return {
      id: row.id,
      venue_layout_template_id: row.venue_layout_template_id,
      name: row.name,
      description: row.description,
      layout_schema_version: row.layout_schema_version,
      layout_config: layout,
      element_count: stats.element_count,
      block_count: stats.block_count,
      seat_count: stats.seat_count,
      updated_at: row.updated_at,
      created_at: row.created_at,
    };
  }

  private rowToTemplate(row: ParkingTemplateRow): ParkingLayoutTemplate {
    const layout = row.layout_config as VenueLayoutConfig;
    this.validateLayout(layout);

    return {
      id: row.id,
      venue_layout_template_id: row.venue_layout_template_id,
      name: row.name,
      description: row.description,
      layout_config: layout,
      layout_schema_version: row.layout_schema_version,
      created_by: row.created_by,
      updated_by: row.updated_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private requireUserId(): string {
    const id = this.auth.user()?.id;
    if (!id) {
      throw new Error('You must be logged in to manage parking layouts.');
    }
    return id;
  }

  private validateLayout(layout: VenueLayoutConfig): void {
    if (layout.version !== 1 || !Array.isArray(layout.elements) || !layout.canvas) {
      throw new Error('Invalid layout configuration.');
    }
  }
}
