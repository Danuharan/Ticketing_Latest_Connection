import type { VenueLayoutConfig } from '../../../core/models/venue-layout-config.model';
import type { BlockSeatingConfigSnapshot } from '../../layout-designer/models/block-config-template.model';
import { getSeatingBlockStoredStats } from '../../layout-designer/lib/custom-shape-seats';
import {
  extractSeatingSnapshot,
  seatingSnapshotToPatch,
} from '../../layout-designer/services/block-config-template.service';
import type { CenterpieceElement, LayoutElement } from '../../layout-designer/models/layout-element.model';
import { isCenterpiece } from '../../layout-designer/models/layout-element.model';

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
  'blockViewpointManuallySet',
  'seatStartSide',
  'labelOffsetXPct',
  'labelOffsetYPct',
  'seatFacingDeg',
  'borderGapM',
  'interactiveSeatingLocked',
  'gaConfiguredSides',
  'customSideNames',
  'appliedConfigId',
  'appliedConfigName',
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
      (snapshot.seatsPerRow != null && snapshot.seatsPerRow > 0) ||
      (snapshot.gaConfiguredSides?.length ?? 0) > 0 ||
      (snapshot.customSideLengthsM?.length ?? 0) > 0,
  );
}

/** Ensures every seating block has a stable uuid for venue_block_configurations.block_id. */
export function ensureVenueBlockIds(layout: VenueLayoutConfig): VenueLayoutConfig {
  const next = structuredClone(layout);
  for (const el of next.elements) {
    if (!isCenterpiece(el)) {
      continue;
    }
    if (!el.venueBlockId) {
      el.venueBlockId = crypto.randomUUID();
    }
  }
  return next;
}

/** Collect seating payloads to persist outside layout_config. */
export function collectBlockSeatingEntries(layout: VenueLayoutConfig): BlockSeatingPersistEntry[] {
  const entries: BlockSeatingPersistEntry[] = [];
  for (const el of layout.elements) {
    if (!isCenterpiece(el)) {
      continue;
    }
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
  if (!isCenterpiece(el)) {
    return el;
  }
  const copy = { ...el } as CenterpieceElement;
  // Read before stripping — getSeatingBlockStoredStats needs the seating fields,
  // and falls back to the summary the element was loaded with when they are absent.
  const summary = getSeatingBlockStoredStats(el);
  for (const key of SEATING_FIELD_KEYS) {
    delete copy[key];
  }
  if (summary.totalSeats > 0 || summary.rows > 0) {
    copy.seatingSummary = summary;
  } else {
    delete copy.seatingSummary;
  }
  // Keep geometry + venueBlockId / blockType on the shell; seating lives in block configs.
  return copy;
}

export interface BlockSeatingConfigRow {
  element_id: string;
  block_id: string;
  master_config_template_id: string | null;
  config: { seating?: BlockSeatingConfigSnapshot };
}

/**
 * Fields a stored config contributes back to its shell element. Used both when
 * hydrating a whole layout and when fetching one block on demand.
 */
export function seatingRowToElementPatch(
  row: BlockSeatingConfigRow,
  el: CenterpieceElement,
): Partial<CenterpieceElement> | null {
  const s = row.config?.seating;
  if (!s) {
    return null;
  }
  return {
    ...seatingSnapshotToPatch(s),
    // Legacy rows kept these on the shell — prefer snapshot, fall back to shell.
    gaConfiguredSides: s.gaConfiguredSides ?? el.gaConfiguredSides,
    customSideNames: s.customSideNames ?? el.customSideNames,
    appliedConfigName: s.appliedConfigName ?? el.appliedConfigName,
    seatStartSide: s.seatStartSide ?? el.seatStartSide,
    blockViewpointManuallySet: s.blockViewpointManuallySet ?? el.blockViewpointManuallySet,
    venueBlockId: row.block_id,
    appliedConfigId: row.master_config_template_id ?? el.appliedConfigId,
    blockType: el.blockType ?? 'seating',
  };
}

/** Merges per-block seating configs back onto layout elements (by element_id). */
export function mergeSeatingIntoLayout(
  layout: VenueLayoutConfig,
  configs: BlockSeatingConfigRow[],
): VenueLayoutConfig {
  const byElement = new Map(configs.map((row) => [row.element_id, row]));
  const next = structuredClone(layout);
  next.elements = next.elements.map((el) => {
    if (!isCenterpiece(el)) {
      return el;
    }
    const row = byElement.get(el.id);
    const patch = row ? seatingRowToElementPatch(row, el) : null;
    return patch ? { ...el, ...patch } : el;
  });
  return next;
}
