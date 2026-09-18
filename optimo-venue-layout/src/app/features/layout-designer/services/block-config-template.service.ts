import { Injectable, inject, signal } from '@angular/core';

import { SupabaseService } from '../../../core/services/supabase.service';
import {
  BlockConfigTemplate,
  BlockDiningConfigSnapshot,
  BlockGaConfigSnapshot,
  BlockSeatingConfigSnapshot,
} from '../models/block-config-template.model';
import { BlockTypeId } from '../models/block-type.model';
import { CenterpieceElement, BlockGridElement, CanvasConfig } from '../models/layout-element.model';
import { resolveBlockGridShapeDraw } from '../lib/block-shape-geometry';
import { materializeBlockGridSeatOverrides } from '../lib/seat-layout';

// ---------------------------------------------------------------------------
// DB row shape (matches block_config_templates table)
// ---------------------------------------------------------------------------
interface BlockConfigTemplateRow {
  id: string;
  created_by: string;
  name: string;
  block_type: string;
  shape_type: string;
  physical_width_m: number | null;
  physical_length_m: number | null;
  side_count: number | null;
  config: {
    seating?: BlockSeatingConfigSnapshot;
    dining?: BlockDiningConfigSnapshot;
    ga?: BlockGaConfigSnapshot;
  };
  created_at: string;
  updated_at: string;
}

const BLOCK_CONFIG_SELECT =
  'id, created_by, name, block_type, shape_type, physical_width_m, physical_length_m, side_count, config, created_at, updated_at';

/** Resolves DB shape_type from element shape or seating geometry hints. */
export function resolveBlockShapeType(input: {
  shapeType?: string | null;
  seating?: BlockSeatingConfigSnapshot | null;
}): string {
  const explicit = input.shapeType?.trim();
  if (explicit) {
    return explicit;
  }
  const sides = input.seating?.customSideLengthsM?.length ?? 0;
  if (sides >= 3) {
    return 'custom';
  }
  return 'rectangle';
}

// ---------------------------------------------------------------------------
// Row → model
// ---------------------------------------------------------------------------
function rowToModel(row: BlockConfigTemplateRow): BlockConfigTemplate {
  return {
    id: row.id,
    name: row.name,
    blockType: row.block_type as BlockTypeId,
    seating: row.config.seating,
    dining: row.config.dining,
    ga: row.config.ga,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Snapshot extractors (pure functions, used by other services)
// ---------------------------------------------------------------------------

/** Extracts seating configuration from a customized block for reuse. */
export function extractSeatingSnapshot(el: CenterpieceElement): BlockSeatingConfigSnapshot {
  return {
    physicalLengthM: el.physicalLengthM,
    physicalWidthM: el.physicalWidthM,
    chairLengthM: el.chairLengthM,
    chairWidthM: el.chairWidthM,
    seatGapM: el.seatGapM,
    rowGapM: el.rowGapM,
    // Always capture (even undefined) so Cancel can clear aisles Auto Fill wrote.
    autoFillAisles: el.autoFillAisles ? structuredClone(el.autoFillAisles) : undefined,
    code: el.code,
    rows: el.rows,
    seatsPerRow: el.seatsPerRow,
    rowLabelStyle: el.rowLabelStyle,
    seatLayout: el.seatLayout ? structuredClone(el.seatLayout) : undefined,
    seatPositionOverrides: el.seatPositionOverrides
      ? structuredClone(el.seatPositionOverrides)
      : undefined,
    autoFillStraightSeatPositions: el.autoFillStraightSeatPositions
      ? structuredClone(el.autoFillStraightSeatPositions)
      : undefined,
    customSeatBlocks: el.customSeatBlocks ? structuredClone(el.customSeatBlocks) : undefined,
    customSideLengthsM: el.customSideLengthsM ? [...el.customSideLengthsM] : undefined,
    dragSeatsMode: el.dragSeatsMode,
    dragSeatsStadiumSideIndex: el.dragSeatsStadiumSideIndex,
    dragSeatsStadiumSideIndices: el.dragSeatsStadiumSideIndices
      ? [...el.dragSeatsStadiumSideIndices]
      : undefined,
    dragSeatsFirstRowSeatCount: el.dragSeatsFirstRowSeatCount,
    customLineSeatRows: el.customLineSeatRows
      ? structuredClone(el.customLineSeatRows)
      : undefined,
    perSeatPlacementMode: el.perSeatPlacementMode,
    arrangeByRowMode: el.arrangeByRowMode,
    dragFillSeatsMode: el.dragFillSeatsMode,
    arrangeByRowRows: el.arrangeByRowRows ? structuredClone(el.arrangeByRowRows) : undefined,
    defineByRowColumnMode: el.defineByRowColumnMode,
    defineByRowColumnRows: el.defineByRowColumnRows,
    defineByRowColumnColumns: el.defineByRowColumnColumns,
    blockViewpointAngleDeg: el.blockViewpointAngleDeg,
    labelOffsetXPct: el.labelOffsetXPct,
    labelOffsetYPct: el.labelOffsetYPct,
  };
}

/**
 * Builds a BlockSeatingConfigSnapshot for a Block Grid using the existing snapshot shape.
 * Individual seats are stored in `seatPositionOverrides` (element-local %), same as centerpieces.
 */
export function extractBlockGridSeatingSnapshot(
  el: BlockGridElement,
  canvas: CanvasConfig,
): BlockSeatingConfigSnapshot {
  const rows = el.seatLayout?.rows ?? el.rows;
  const seatsPerRow = el.seatLayout?.seatsPerRow ?? el.seatsPerRow;
  const rowLabelStyle = el.seatLayout?.rowLabelStyle ?? el.rowLabelStyle;
  const resolved = resolveBlockGridShapeDraw(el, canvas);
  const seatPositionOverrides = materializeBlockGridSeatOverrides(
    resolved.rect,
    rows,
    seatsPerRow,
    rowLabelStyle,
  );
  const seatLayout = {
    ...(el.seatLayout ? structuredClone(el.seatLayout) : {}),
    rows,
    seatsPerRow,
    rowLabelStyle,
  };

  return {
    code: el.code,
    rows,
    seatsPerRow,
    rowLabelStyle,
    seatLayout,
    seatPositionOverrides,
  };
}

/** Applies a saved seating snapshot onto a block element patch. */
export function seatingSnapshotToPatch(
  snapshot: BlockSeatingConfigSnapshot,
): Partial<CenterpieceElement> {
  return structuredClone(snapshot);
}

/** Extracts dining table configuration from a customized block for reuse. */
export function extractDiningSnapshot(el: CenterpieceElement): BlockDiningConfigSnapshot {
  return {
    customSideLengthsM: el.customSideLengthsM ? [...el.customSideLengthsM] : undefined,
    customSideNames: el.customSideNames ? [...el.customSideNames] : undefined,
    dragSeatsStadiumSideIndex: el.dragSeatsStadiumSideIndex,
    blockViewpointAngleDeg: el.blockViewpointAngleDeg,
    labelOffsetXPct: el.labelOffsetXPct,
    labelOffsetYPct: el.labelOffsetYPct,
    diningTables: el.diningTables ? structuredClone(el.diningTables) : undefined,
    tableGridMode: el.tableGridMode,
    tableGridRows: el.tableGridRows,
    tableGridColumns: el.tableGridColumns,
    defaultDiningTableShape: el.defaultDiningTableShape,
    defaultTableSeats: el.defaultTableSeats,
    defaultTableWidthM: el.defaultTableWidthM,
    defaultTableDepthM: el.defaultTableDepthM,
    defaultTableGapM: el.defaultTableGapM,
    appliedDiningLayoutTemplateId: el.appliedDiningLayoutTemplateId,
    diningLayoutGeneration: el.diningLayoutGeneration
      ? { ...el.diningLayoutGeneration }
      : undefined,
    chairWidthM: el.chairWidthM,
    chairLengthM: el.chairLengthM,
    diningLayoutReferenceImage: el.diningLayoutReferenceImage
      ? structuredClone(el.diningLayoutReferenceImage)
      : undefined,
    diningStage: el.diningStage ? structuredClone(el.diningStage) : undefined,
    diningFoodPrepare: el.diningFoodPrepare ? structuredClone(el.diningFoodPrepare) : undefined,
    diningEntrance: el.diningEntrance ? structuredClone(el.diningEntrance) : undefined,
    diningExit: el.diningExit ? structuredClone(el.diningExit) : undefined,
    diningSharedAccessPoint: el.diningSharedAccessPoint
      ? structuredClone(el.diningSharedAccessPoint)
      : undefined,
    diningAccessMode: el.diningAccessMode,
    defaultDiningEntranceWidthM: el.defaultDiningEntranceWidthM,
    defaultDiningExitWidthM: el.defaultDiningExitWidthM,
    defaultDiningSharedAccessWidthM: el.defaultDiningSharedAccessWidthM,
    diningAccessPoints: el.diningAccessPoints ? structuredClone(el.diningAccessPoints) : undefined,
    diningServiceRoutes: el.diningServiceRoutes ? structuredClone(el.diningServiceRoutes) : undefined,
    defaultServiceRouteWidthM: el.defaultServiceRouteWidthM,
    diningServiceRouteClearanceM: el.diningServiceRouteClearanceM,
  };
}

/** Applies a saved dining snapshot onto a block element patch. */
export function diningSnapshotToPatch(
  snapshot: BlockDiningConfigSnapshot,
): Partial<CenterpieceElement> {
  return structuredClone(snapshot);
}

/** Extracts General Admission configuration from a block for reuse. */
export function extractGaSnapshot(el: CenterpieceElement): BlockGaConfigSnapshot {
  return {
    gaConfiguredSides: el.gaConfiguredSides ? structuredClone(el.gaConfiguredSides) : undefined,
    gaMaxParticipants: el.gaMaxParticipants,
  };
}

/** Applies a saved GA snapshot onto a block element patch. */
export function gaSnapshotToPatch(snapshot: BlockGaConfigSnapshot): Partial<CenterpieceElement> {
  return structuredClone(snapshot);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class BlockConfigTemplateService {
  private readonly db = inject(SupabaseService).client;

  private readonly templatesState = signal<BlockConfigTemplate[]>([]);
  readonly templates = this.templatesState.asReadonly();

  /** Whether a network load is currently in progress (initial or forced refresh). */
  readonly loading = signal(false);

  /** True after at least one successful load this session. */
  private readonly loaded = signal(false);

  /**
   * True after the first load attempt finishes (success or failure).
   * Prevents ensureLoaded from retrying on incidental calls after a failed fetch.
   * Cleared by reloadTemplates() for intentional retry.
   */
  private readonly loadAttempted = signal(false);

  /** Shared in-flight promise so concurrent callers reuse one request. */
  private activeLoad: Promise<void> | null = null;

  listByType(blockType: BlockTypeId): BlockConfigTemplate[] {
    return this.templates()
      .filter((item) => item.blockType === blockType)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getById(id: string): BlockConfigTemplate | null {
    return this.templates().find((item) => item.id === id) ?? null;
  }

  /**
   * Load templates once per session (or while a load is already in flight).
   * Ordinary block property edits must call this — not forceReload — so they
   * never flip `loading` or hit Supabase again.
   */
  ensureLoaded(): Promise<void> {
    if (this.loaded() || this.loadAttempted()) {
      return Promise.resolve();
    }
    return this.loadTemplatesInternal(false);
  }

  /** Force a network refresh (after intentional library changes / retry). */
  reloadTemplates(): Promise<void> {
    this.loaded.set(false);
    this.loadAttempted.set(false);
    return this.loadTemplatesInternal(true);
  }

  /**
   * @deprecated Prefer `ensureLoaded()` for workspace open and `reloadTemplates()`
   * for intentional refresh. Kept as an alias of `reloadTemplates()` for callers
   * that previously always hit the network.
   */
  async loadTemplates(): Promise<void> {
    return this.reloadTemplates();
  }

  private loadTemplatesInternal(force: boolean): Promise<void> {
    if (!force && (this.loaded() || this.loadAttempted())) {
      return Promise.resolve();
    }
    if (this.activeLoad) {
      return this.activeLoad;
    }

    this.loading.set(true);
    this.activeLoad = (async () => {
      try {
        const { data, error } = await this.db
          .from('block_config_templates')
          .select(BLOCK_CONFIG_SELECT)
          .order('name', { ascending: true });

        if (error) {
          throw error;
        }
        this.templatesState.set(
          (data as BlockConfigTemplateRow[]).map(rowToModel),
        );
        this.loaded.set(true);
      } finally {
        this.loadAttempted.set(true);
        this.loading.set(false);
        this.activeLoad = null;
      }
    })();

    return this.activeLoad;
  }

  /** Save (insert or update) a block config template. Returns the saved template. */
  async saveTemplate(input: {
    name: string;
    blockType: BlockTypeId;
    /** Element shape id, e.g. custom / rectangle / hexagon. */
    shapeType?: string | null;
    seating?: BlockSeatingConfigSnapshot;
    dining?: BlockDiningConfigSnapshot;
    ga?: BlockGaConfigSnapshot;
    existingId?: string | null;
  }): Promise<BlockConfigTemplate> {
    const trimmed = input.name.trim();
    if (!trimmed) {
      throw new Error('Configuration name is required.');
    }

    const config: BlockConfigTemplateRow['config'] = {};
    if (input.seating) {
      config.seating = structuredClone(input.seating);
    }
    if (input.dining) {
      config.dining = structuredClone(input.dining);
    }
    if (input.ga) {
      config.ga = structuredClone(input.ga);
    }

    const shapeType = resolveBlockShapeType({
      shapeType: input.shapeType,
      seating: input.seating,
    });
    const physicalWidthM = input.seating?.physicalWidthM ?? null;
    const physicalLengthM = input.seating?.physicalLengthM ?? null;
    const sideCount = input.seating?.customSideLengthsM?.length ?? null;
    const matchingFields = {
      shape_type: shapeType,
      physical_width_m: physicalWidthM,
      physical_length_m: physicalLengthM,
      side_count: sideCount && sideCount >= 1 ? sideCount : null,
    };

    const { data: { session } } = await this.db.auth.getSession();
    const userId = session?.user.id;
    if (!userId) {
      throw new Error('Not authenticated. Please sign in.');
    }

    const existingId = input.existingId?.trim() || null;
    const existing = existingId ? this.getById(existingId) : null;

    let row: BlockConfigTemplateRow;

    if (existing && existing.blockType === input.blockType) {
      // Update existing row
      const { data, error } = await this.db
        .from('block_config_templates')
        .update({ name: trimmed, config, updated_by: userId, ...matchingFields })
        .eq('id', existing.id)
        .select(BLOCK_CONFIG_SELECT)
        .single();

      if (error) {
        throw error;
      }
      row = data as BlockConfigTemplateRow;
    } else {
      // Insert new row — created_by + shape_type must be set explicitly.
      const { data, error } = await this.db
        .from('block_config_templates')
        .insert({
          name: trimmed,
          block_type: input.blockType,
          config,
          created_by: userId,
          updated_by: userId,
          ...matchingFields,
        })
        .select(BLOCK_CONFIG_SELECT)
        .single();

      if (error) {
        throw error;
      }
      row = data as BlockConfigTemplateRow;
    }

    const saved = rowToModel(row);

    // Update local signal cache
    this.templatesState.update((items) => {
      const idx = items.findIndex((t) => t.id === saved.id);
      if (idx >= 0) {
        const next = [...items];
        next[idx] = saved;
        return next;
      }
      return [...items, saved];
    });

    return saved;
  }

  /** Delete a template by id. */
  async deleteTemplate(id: string): Promise<void> {
    const { error } = await this.db
      .from('block_config_templates')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }
    this.templatesState.update((items) => items.filter((t) => t.id !== id));
  }
}
