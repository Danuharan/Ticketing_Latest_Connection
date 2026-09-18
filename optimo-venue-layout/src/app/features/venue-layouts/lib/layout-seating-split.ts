import type { VenueLayoutConfig } from '../../../core/models/venue-layout-config.model';
import type { BlockSeatingConfigSnapshot } from '../../layout-designer/models/block-config-template.model';
import {
  extractBlockGridSeatingSnapshot,
  extractSeatingSnapshot,
  seatingSnapshotToPatch,
} from '../../layout-designer/services/block-config-template.service';
import type {
  BlockGridElement,
  CenterpieceElement,
  LayoutElement,
} from '../../layout-designer/models/layout-element.model';
import { isBlockGrid, isCenterpiece } from '../../layout-designer/models/layout-element.model';

/** Seating fields that belong in venue_block_configurations / block_config_templates — not layout_config. */
const SEATING_FIELD_KEYS: Array<keyof CenterpieceElement> = [
  'physicalLengthM',
  'physicalWidthM',
  'chairLengthM',
  'chairWidthM',
  'seatGapM',
  'rowGapM',
  'autoFillAisles',
  'code',
  'rows',
  'seatsPerRow',
  'rowLabelStyle',
  'seatLayout',
  'seatPositionOverrides',
  'autoFillStraightSeatPositions',
  'customSeatBlocks',
  'customSideLengthsM',
  'dragSeatsMode',
  'dragSeatsStadiumSideIndex',
  'dragSeatsStadiumSideIndices',
  'dragSeatsFirstRowSeatCount',
  'customLineSeatRows',
  'perSeatPlacementMode',
  'arrangeByRowMode',
  'dragFillSeatsMode',
  'arrangeByRowRows',
  'defineByRowColumnMode',
  'defineByRowColumnRows',
  'defineByRowColumnColumns',
  'blockViewpointAngleDeg',
  'labelOffsetXPct',
  'labelOffsetYPct',
  'seatFacingDeg',
  'borderGapM',
  'interactiveSeatingLocked',
];

/** Block Grid seating fields stripped from layout_config shell (same tables as centerpieces). */
const BLOCK_GRID_SEATING_FIELD_KEYS: Array<keyof BlockGridElement> = [
  'code',
  'rows',
  'seatsPerRow',
  'rowLabelStyle',
  'seatLayout',
  'seatPositionOverrides',
];

export interface BlockSeatingPersistEntry {
  elementId: string;
  venueBlockId: string;
  blockType: 'seating';
  label: string;
  shapeType: string;
  appliedConfigId?: string;
  seating: BlockSeatingConfigSnapshot;
}

function hasPersistedSeating(snapshot: BlockSeatingConfigSnapshot): boolean {
  return Boolean(
    snapshot.seatLayout ||
      snapshot.customSeatBlocks?.length ||
      (snapshot.seatPositionOverrides && Object.keys(snapshot.seatPositionOverrides).length > 0) ||
      snapshot.customLineSeatRows?.length ||
      (snapshot.rows != null && snapshot.rows > 0) ||
      (snapshot.seatsPerRow != null && snapshot.seatsPerRow > 0),
  );
}

/** Ensures every seating block has a stable uuid for venue_block_configurations.block_id. */
export function ensureVenueBlockIds(layout: VenueLayoutConfig): VenueLayoutConfig {
  const next = structuredClone(layout);
  for (const el of next.elements) {
    if (isCenterpiece(el)) {
      if (!el.venueBlockId) {
        el.venueBlockId = crypto.randomUUID();
      }
      continue;
    }
    if (isBlockGrid(el) && !el.venueBlockId) {
      const rows = el.seatLayout?.rows ?? el.rows;
      const seatsPerRow = el.seatLayout?.seatsPerRow ?? el.seatsPerRow;
      if ((rows ?? 0) > 0 && (seatsPerRow ?? 0) > 0) {
        el.venueBlockId = crypto.randomUUID();
      }
    }
  }
  return next;
}

/** Collect seating payloads to persist outside layout_config. */
export function collectBlockSeatingEntries(layout: VenueLayoutConfig): BlockSeatingPersistEntry[] {
  const entries: BlockSeatingPersistEntry[] = [];
  for (const el of layout.elements) {
    if (isCenterpiece(el)) {
      if (el.blockType && el.blockType !== 'seating') {
        continue;
      }
      const seating = extractSeatingSnapshot(el);
      if (!hasPersistedSeating(seating)) {
        continue;
      }
      const venueBlockId = el.venueBlockId ?? crypto.randomUUID();
      el.venueBlockId = venueBlockId;
      entries.push({
        elementId: el.id,
        venueBlockId,
        blockType: 'seating',
        label: (el.label || el.name || el.code || el.id).trim() || el.id,
        shapeType: el.shape || 'custom',
        appliedConfigId: el.appliedConfigId,
        seating,
      });
      continue;
    }

    if (!isBlockGrid(el)) {
      continue;
    }

    const seating = extractBlockGridSeatingSnapshot(el, layout.canvas);
    if (!hasPersistedSeating(seating)) {
      continue;
    }
    const venueBlockId = el.venueBlockId ?? crypto.randomUUID();
    el.venueBlockId = venueBlockId;
    // Keep materialized overrides on the in-memory element so strip/merge stay consistent.
    el.seatLayout = seating.seatLayout;
    el.seatPositionOverrides = seating.seatPositionOverrides;
    entries.push({
      elementId: el.id,
      venueBlockId,
      blockType: 'seating',
      label: (el.label || el.name || el.code || el.id).trim() || el.id,
      shapeType: el.shape ?? 'square',
      appliedConfigId: el.appliedConfigId,
      seating,
    });
  }
  return entries;
}

/** Removes seating snapshot fields from elements so layout_config stays a geometry shell. */
export function stripSeatingFromLayout(layout: VenueLayoutConfig): VenueLayoutConfig {
  const next = structuredClone(layout);
  next.elements = next.elements.map((el) => stripSeatingFromElement(el));
  return next;
}

function stripSeatingFromElement(el: LayoutElement): LayoutElement {
  if (isCenterpiece(el)) {
    const copy = { ...el } as CenterpieceElement;
    for (const key of SEATING_FIELD_KEYS) {
      delete copy[key];
    }
    return copy;
  }
  if (isBlockGrid(el)) {
    const copy = { ...el } as BlockGridElement;
    for (const key of BLOCK_GRID_SEATING_FIELD_KEYS) {
      delete copy[key];
    }
    return copy;
  }
  return el;
}

/** Merges per-block seating configs back onto layout elements (by element_id). */
export function mergeSeatingIntoLayout(
  layout: VenueLayoutConfig,
  configs: Array<{
    element_id: string;
    block_id: string;
    master_config_template_id: string | null;
    config: { seating?: BlockSeatingConfigSnapshot };
  }>,
): VenueLayoutConfig {
  const byElement = new Map(configs.map((row) => [row.element_id, row]));
  const next = structuredClone(layout);
  next.elements = next.elements.map((el) => {
    const row = byElement.get(el.id);
    if (!row?.config?.seating) {
      return el;
    }

    if (isCenterpiece(el)) {
      return {
        ...el,
        ...seatingSnapshotToPatch(row.config.seating),
        venueBlockId: row.block_id,
        appliedConfigId: row.master_config_template_id ?? el.appliedConfigId,
        blockType: el.blockType ?? 'seating',
      };
    }

    if (isBlockGrid(el)) {
      const seating = row.config.seating;
      return {
        ...el,
        code: seating.code ?? el.code ?? 'B01',
        rows: seating.rows ?? el.rows ?? seating.seatLayout?.rows ?? 0,
        seatsPerRow: seating.seatsPerRow ?? el.seatsPerRow ?? seating.seatLayout?.seatsPerRow ?? 0,
        rowLabelStyle:
          seating.rowLabelStyle ?? el.rowLabelStyle ?? seating.seatLayout?.rowLabelStyle ?? 'letter',
        seatLayout: seating.seatLayout ? structuredClone(seating.seatLayout) : el.seatLayout,
        seatPositionOverrides: seating.seatPositionOverrides
          ? structuredClone(seating.seatPositionOverrides)
          : el.seatPositionOverrides,
        venueBlockId: row.block_id,
        appliedConfigId: row.master_config_template_id ?? el.appliedConfigId,
      };
    }

    return el;
  });
  return next;
}
