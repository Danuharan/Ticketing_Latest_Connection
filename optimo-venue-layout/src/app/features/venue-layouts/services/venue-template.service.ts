import { Injectable, inject } from '@angular/core';

import { countLayoutStats } from '../lib/layout-stats';
import { buildLayoutThumbnailDataUrl } from '../lib/layout-preview-thumbnail';
import {
  mergeSeatingIntoLayout,
  stripSeatingFromLayout,
  type BlockSeatingConfigRow,
} from '../lib/layout-seating-split';
import { VenueLayoutConfig } from '../../../core/models/venue-layout-config.model';
import {
  CreateVenueTemplateInput,
  UpdateVenueTemplateInput,
  VenueLayoutTemplate,
  VenueLayoutTemplateListPage,
  VenueLayoutTemplateSummary,
} from '../../../core/models/venue-layout-template.model';
import { AuthService } from '../../../core/services/auth.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { VenueBlockConfigurationService } from './venue-block-configuration.service';
import { VenueLayoutImageService } from './venue-layout-image.service';

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  layout_config: unknown;
  layout_schema_version: number;
  status: VenueLayoutTemplate['status'];
  element_count: number | null;
  block_count: number | null;
  seat_count: number | null;
  preview_thumbnail: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

interface TemplateListRow {
  id: string;
  name: string;
  description: string | null;
  layout_schema_version: number;
  status: VenueLayoutTemplate['status'];
  element_count: number | null;
  block_count: number | null;
  seat_count: number | null;
  preview_thumbnail: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable({ providedIn: 'root' })
export class VenueTemplateService {
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);
  private readonly images = inject(VenueLayoutImageService);
  private readonly blockConfigs = inject(VenueBlockConfigurationService);

  /** List templates with layout_config for card preview thumbnails. */
  async listMyTemplates(): Promise<VenueLayoutTemplateSummary[]> {
    const page = await this.listMyTemplatesPage(0, 10_000);
    return page.items;
  }

  /** Paginated list — metadata + thumbnail only (no layout_config). */
  async listMyTemplatesPage(offset: number, limit: number): Promise<VenueLayoutTemplateListPage> {
    const from = offset;
    const to = offset + limit - 1;

    const { data, error, count } = await this.supabase
      .from('venue_layout_templates')
      .select(
        'id, name, description, status, layout_schema_version, element_count, block_count, seat_count, preview_thumbnail, updated_at, created_at',
        { count: 'exact' },
      )
      .order('updated_at', { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    return {
      items: (data ?? []).map((row) => this.rowToListSummary(row as TemplateListRow)),
      total: count ?? 0,
    };
  }

  /**
   * @param options.withSeating When false, per-block seating configs are not
   *   fetched and `layout_config` stays a geometry shell. The designer uses this
   *   and pulls each block's seating when the user opens it.
   */
  async getTemplateById(
    id: string,
    options?: { withSeating?: boolean },
  ): Promise<VenueLayoutTemplate> {
    const { data, error } = await this.supabase
      .from('venue_layout_templates')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return this.rowToTemplate(
      await this.hydrateRow(data as TemplateRow, options?.withSeating !== false),
    );
  }

  /** One block's stored seating, for on-demand hydration in the designer. */
  async getBlockSeatingRow(
    venueId: string,
    elementId: string,
  ): Promise<BlockSeatingConfigRow | null> {
    return this.blockConfigs.getForElement(venueId, elementId);
  }

  async createTemplate(input: CreateVenueTemplateInput): Promise<string> {
    const userId = this.requireUserId();
    this.validateLayout(input.layoutConfig);
    const fullLayout = structuredClone(input.layoutConfig);
    const metadata = this.buildListMetadata(fullLayout);
    const venueName = input.name.trim();

    // Insert shell first (no seats) so FK for venue_block_configurations exists.
    const shellWithoutImage = stripSeatingFromLayout(fullLayout);
    if (shellWithoutImage.referenceImage) {
      delete shellWithoutImage.referenceImage.dataUrl;
    }

    const { data, error } = await this.supabase
      .from('venue_layout_templates')
      .insert({
        created_by: userId,
        updated_by: userId,
        name: venueName,
        description: input.description?.trim() || null,
        layout_config: shellWithoutImage,
        status: input.status ?? 'draft',
        ...metadata,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? 'Unable to save template.');
    }

    const newId = data.id as string;
    await this.persistShellAndSeating(newId, venueName, fullLayout, userId);
    return newId;
  }

  async updateTemplate(id: string, input: UpdateVenueTemplateInput): Promise<void> {
    const userId = this.requireUserId();
    const patch: Record<string, unknown> = { updated_by: userId };

    if (input.name !== undefined) {
      patch['name'] = input.name.trim();
    }
    if (input.description !== undefined) {
      patch['description'] = input.description.trim() || null;
    }
    if (input.status !== undefined) {
      patch['status'] = input.status;
    }

    if (input.layoutConfig !== undefined) {
      this.validateLayout(input.layoutConfig);
      const fullLayout = structuredClone(input.layoutConfig);
      // Counts come from each block's stored summary, so they stay correct even
      // when seating was not fetched. The thumbnail cannot be, so keep the old one.
      const metadata = this.buildListMetadata(fullLayout);
      if (input.hasUnfetchedSeating) {
        delete (metadata as Partial<typeof metadata>).preview_thumbnail;
      }
      Object.assign(patch, metadata);
      const venueName =
        input.name?.trim() ||
        (await this.fetchVenueName(id)) ||
        'Venue';
      await this.persistShellAndSeating(id, venueName, fullLayout, userId, {
        deletedElementIds: input.deletedBlockElementIds,
      });
    }

    const { error } = await this.supabase.from('venue_layout_templates').update(patch).eq('id', id);
    if (error) {
      throw new Error(error.message);
    }
  }

  async deleteTemplate(id: string): Promise<void> {
    const { error } = await this.supabase.from('venue_layout_templates').delete().eq('id', id);
    if (error) {
      throw new Error(error.message);
    }
  }

  /**
   * Writes seating to block_config_templates + venue_block_configurations,
   * and geometry-only shell to venue_layout_templates.layout_config.
   */
  private async persistShellAndSeating(
    venueId: string,
    venueName: string,
    fullLayout: VenueLayoutConfig,
    userId: string,
    options?: { deletedElementIds?: readonly string[] },
  ): Promise<void> {
    const stamped = await this.blockConfigs.syncFromLayout(venueId, fullLayout, venueName, options);
    const shell = stripSeatingFromLayout(stamped);
    const layoutConfig = await this.images.prepareLayoutForPersist(shell, venueId);
    const { error } = await this.supabase
      .from('venue_layout_templates')
      .update({ layout_config: layoutConfig, updated_by: userId })
      .eq('id', venueId);
    if (error) {
      throw new Error(error.message);
    }
  }

  private async fetchVenueName(id: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('venue_layout_templates')
      .select('name')
      .eq('id', id)
      .maybeSingle();
    return (data?.name as string | undefined) ?? null;
  }

  private buildListMetadata(layout: VenueLayoutConfig): {
    element_count: number;
    block_count: number;
    seat_count: number;
    preview_thumbnail: string;
  } {
    const stats = countLayoutStats(layout);
    return {
      element_count: stats.element_count,
      block_count: stats.block_count,
      seat_count: stats.seat_count,
      preview_thumbnail: buildLayoutThumbnailDataUrl(layout),
    };
  }

  private rowToListSummary(row: TemplateListRow): VenueLayoutTemplateSummary {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      layout_schema_version: row.layout_schema_version,
      element_count: row.element_count ?? 0,
      block_count: row.block_count ?? 0,
      seat_count: row.seat_count ?? 0,
      preview_thumbnail: row.preview_thumbnail,
      updated_at: row.updated_at,
      created_at: row.created_at,
    };
  }

  private requireUserId(): string {
    const id = this.auth.user()?.id;
    if (!id) {
      throw new Error('You must be logged in to manage templates.');
    }
    return id;
  }

  private validateLayout(layout: VenueLayoutConfig): void {
    if (layout.version !== 1 || !Array.isArray(layout.elements) || !layout.canvas) {
      throw new Error('Invalid layout configuration.');
    }
  }

  private async hydrateRow(row: TemplateRow, withSeating: boolean): Promise<TemplateRow> {
    let layout = row.layout_config as VenueLayoutConfig;
    if (withSeating) {
      const configs = await this.blockConfigs.listForVenue(row.id);
      if (configs.length > 0) {
        layout = mergeSeatingIntoLayout(layout, configs);
      }
    }
    const hydrated = await this.images.hydrateLayoutForDisplay(layout);
    return { ...row, layout_config: hydrated };
  }

  private rowToTemplate(row: TemplateRow): VenueLayoutTemplate {
    const layout = row.layout_config as VenueLayoutConfig;
    this.validateLayout(layout);

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      layout_config: layout,
      layout_schema_version: row.layout_schema_version,
      status: row.status,
      created_by: row.created_by,
      updated_by: row.updated_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
