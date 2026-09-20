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

  /** One block's seating, fetched when the user opens that block. */
  async getForElement(
    venueLayoutTemplateId: string,
    elementId: string,
  ): Promise<VenueBlockConfigRow | null> {
    const { data, error } = await this.db
      .from('venue_block_configurations')
      .select(
        'id, venue_layout_template_id, block_id, element_id, master_config_template_id, source_master_version, block_type, config_schema_version, config, created_by, updated_by',
      )
      .eq('venue_layout_template_id', venueLayoutTemplateId)
      .eq('element_id', elementId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }
    return (data as VenueBlockConfigRow | null) ?? null;
  }

  /**
   * Persists seating into block_config_templates + venue_block_configurations.
   * Returns layout with venueBlockId / appliedConfigId stamped for the geometry shell.
   */
  async syncFromLayout(
    venueLayoutTemplateId: string,
    layout: VenueLayoutConfig,
    venueName: string,
    options?: { deletedElementIds?: readonly string[] },
  ): Promise<VenueLayoutConfig> {
    const userId = this.requireUserId();
    const withIds = ensureVenueBlockIds(layout);
    const entries = collectBlockSeatingEntries(withIds);
    const existing = await this.listForVenue(venueLayoutTemplateId);
    const existingByElement = new Map(existing.map((row) => [row.element_id, row]));

    // Only blocks the caller reports as deleted are removed. A block whose seating
    // was never fetched has no entry below, and must keep its stored config.
    const deleted = new Set(options?.deletedElementIds ?? []);
    const toDelete = existing.filter((row) => deleted.has(row.element_id));
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
      // Persist display name on seating so it survives layout_config strip.
      entry.seating = {
        ...entry.seating,
        appliedConfigName: entry.seating.appliedConfigName ?? entry.label,
      };
      const prev = existingByElement.get(entry.elementId);

      // Untouched blocks skip both writes, so editing one block in a 100-block
      // venue costs one update instead of two hundred.
      if (
        prev &&
        prev.block_type === entry.blockType &&
        seatingConfigsEqual(prev.config?.seating, entry.seating)
      ) {
        this.stampShellIdentity(withIds, entry, prev.block_id, prev.master_config_template_id);
        continue;
      }

      const masterId = await this.upsertMasterTemplate(entry, venueName, userId);
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

      this.stampShellIdentity(withIds, entry, blockId, masterId);
    }

    return withIds;
  }

  /** Copies row identity onto the in-memory layout so layout_config keeps the link. */
  private stampShellIdentity(
    layout: VenueLayoutConfig,
    entry: BlockSeatingPersistEntry,
    blockId: string,
    masterConfigId: string | null,
  ): void {
    const el = layout.elements.find((item) => item.id === entry.elementId);
    if (el && el.type === 'centerpiece') {
      el.venueBlockId = blockId;
      if (masterConfigId) {
        el.appliedConfigId = masterConfigId;
      }
      el.appliedConfigName = entry.label;
      el.blockType = 'seating';
    }
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

/** Key order and absent-vs-undefined differences must not read as an edit. */
function canonicalizeConfig(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeConfig);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) {
        out[key] = canonicalizeConfig(source[key]);
      }
    }
    return out;
  }
  return value;
}

function seatingConfigsEqual(
  a: BlockSeatingConfigSnapshot | undefined,
  b: BlockSeatingConfigSnapshot | undefined,
): boolean {
  return (
    JSON.stringify(canonicalizeConfig(a ?? null)) === JSON.stringify(canonicalizeConfig(b ?? null))
  );
}
