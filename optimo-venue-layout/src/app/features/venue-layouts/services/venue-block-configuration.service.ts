import { Injectable, inject } from '@angular/core';

import { AuthService } from '../../../core/services/auth.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import type { BlockSeatingConfigSnapshot } from '../../layout-designer/models/block-config-template.model';
import { resolveBlockShapeType } from '../../layout-designer/services/block-config-template.service';
import type { VenueLayoutConfig } from '../../../core/models/venue-layout-config.model';
import {
  collectBlockSeatingEntries,
  ensureVenueBlockIds,
  type BlockSeatingPersistEntry,
} from '../lib/layout-seating-split';

interface VenueBlockConfigRow {
  id: string;
  venue_layout_template_id: string;
  block_id: string;
  element_id: string;
  master_config_template_id: string | null;
  source_master_version: number | null;
  block_type: string;
  config_schema_version: number;
  config: { seating?: BlockSeatingConfigSnapshot };
  created_by: string;
  updated_by: string | null;
}

@Injectable({ providedIn: 'root' })
export class VenueBlockConfigurationService {
  private readonly db = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);

  async listForVenue(venueLayoutTemplateId: string): Promise<VenueBlockConfigRow[]> {
    const { data, error } = await this.db
      .from('venue_block_configurations')
      .select(
        'id, venue_layout_template_id, block_id, element_id, master_config_template_id, source_master_version, block_type, config_schema_version, config, created_by, updated_by',
      )
      .eq('venue_layout_template_id', venueLayoutTemplateId);

    if (error) {
      throw new Error(error.message);
    }
    return (data ?? []) as VenueBlockConfigRow[];
  }

  /**
   * Persists seating into block_config_templates + venue_block_configurations.
   * Returns layout with venueBlockId / appliedConfigId stamped for the geometry shell.
   */
  async syncFromLayout(
    venueLayoutTemplateId: string,
    layout: VenueLayoutConfig,
    venueName: string,
  ): Promise<VenueLayoutConfig> {
    const userId = this.requireUserId();
    const withIds = ensureVenueBlockIds(layout);
    const entries = collectBlockSeatingEntries(withIds);
    const existing = await this.listForVenue(venueLayoutTemplateId);
    const existingByElement = new Map(existing.map((row) => [row.element_id, row]));

    const keepElementIds = new Set(entries.map((e) => e.elementId));
    const toDelete = existing.filter((row) => !keepElementIds.has(row.element_id));
    if (toDelete.length > 0) {
      const { error: deleteError } = await this.db
        .from('venue_block_configurations')
        .delete()
        .in(
          'id',
          toDelete.map((row) => row.id),
        );
      if (deleteError) {
        throw new Error(deleteError.message);
      }
    }

    for (const entry of entries) {
      const masterId = await this.upsertMasterTemplate(entry, venueName, userId);
      const prev = existingByElement.get(entry.elementId);
      const blockId = prev?.block_id ?? entry.venueBlockId;
      const config = { seating: entry.seating };

      if (prev) {
        const { error } = await this.db
          .from('venue_block_configurations')
          .update({
            block_id: blockId,
            element_id: entry.elementId,
            master_config_template_id: masterId,
            block_type: entry.blockType,
            config,
            updated_by: userId,
          })
          .eq('id', prev.id);
        if (error) {
          throw new Error(error.message);
        }
      } else {
        const { error } = await this.db.from('venue_block_configurations').insert({
          venue_layout_template_id: venueLayoutTemplateId,
          block_id: blockId,
          element_id: entry.elementId,
          master_config_template_id: masterId,
          block_type: entry.blockType,
          config_schema_version: 1,
          config,
          created_by: userId,
          updated_by: userId,
        });
        if (error) {
          throw new Error(error.message);
        }
      }

      // Stamp shell identity onto the in-memory layout for layout_config persist.
      const el = withIds.elements.find((item) => item.id === entry.elementId);
      if (el && el.type === 'centerpiece') {
        el.venueBlockId = blockId;
        el.appliedConfigId = masterId;
        el.appliedConfigName = entry.label;
        el.blockType = 'seating';
      }
    }

    return withIds;
  }

  private async upsertMasterTemplate(
    entry: BlockSeatingPersistEntry,
    venueName: string,
    userId: string,
  ): Promise<string> {
    const shapeType = resolveBlockShapeType({
      shapeType: entry.shapeType,
      seating: entry.seating,
    });
    const physicalWidthM = entry.seating.physicalWidthM ?? null;
    const physicalLengthM = entry.seating.physicalLengthM ?? null;
    const sideCount = entry.seating.customSideLengthsM?.length ?? null;
    const matchingFields = {
      shape_type: shapeType,
      physical_width_m: physicalWidthM,
      physical_length_m: physicalLengthM,
      side_count: sideCount && sideCount >= 1 ? sideCount : null,
    };
    const config = { seating: entry.seating };
    const name = `${venueName.trim() || 'Venue'} · ${entry.label}`.slice(0, 180);

    if (entry.appliedConfigId) {
      const { data, error } = await this.db
        .from('block_config_templates')
        .update({
          name,
          config,
          updated_by: userId,
          ...matchingFields,
        })
        .eq('id', entry.appliedConfigId)
        .select('id')
        .maybeSingle();
      if (error) {
        throw new Error(error.message);
      }
      if (data?.id) {
        return data.id as string;
      }
    }

    const { data, error } = await this.db
      .from('block_config_templates')
      .insert({
        name,
        block_type: entry.blockType,
        config,
        created_by: userId,
        updated_by: userId,
        ...matchingFields,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? 'Unable to save block_config_templates row.');
    }
    return data.id as string;
  }

  private requireUserId(): string {
    const id = this.auth.user()?.id;
    if (!id) {
      throw new Error('You must be logged in to save block seating.');
    }
    return id;
  }
}
