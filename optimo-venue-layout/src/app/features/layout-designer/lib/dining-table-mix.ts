import type { CenterpieceElement, DiningTableShape } from '../models/layout-element.model';
import {
  countDiningTablesThatFit,
  maxDiningChairLengthForBlock,
  maxDiningTableDimsForBlock,
  type DiningTableCapacityDimsOptions,
} from './dining-tables';

/** Shapes offered by the "Multiple shapes" picker. Add future shapes here only. */
export const DINING_TABLE_MIX_SHAPES: readonly { shape: DiningTableShape; label: string }[] = [
  { shape: 'round', label: 'Round' },
  { shape: 'rectangular', label: 'Rectangular' },
];

export function diningTableShapeLabel(shape: DiningTableShape): string {
  return DINING_TABLE_MIX_SHAPES.find((s) => s.shape === shape)?.label ?? shape;
}

/** One shape lane of a mixed-shape block: its own geometry, chairs and count. */
export interface DiningTableMixEntry {
  shape: DiningTableShape;
  widthM: number;
  depthM: number;
  seats: number;
  chairWidthM: number;
  chairLengthM: number;
  count: number;
}

/** Measurements every shape lane shares (table gap and keep-outs). */
export interface DiningTableMixSharedOptions {
  gapM: number;
  featureClearanceM: number;
  wallClearanceM: number;
  template?: 'grid' | 'staggered' | 'banquet';
  includeAnchoredFeatures?: boolean;
}

export interface DiningTableMixShapeCapacity {
  shape: DiningTableShape;
  count: number;
  seats: number;
  /** Tables of this shape that fit when it is the only shape in the block. */
  soloMaxCount: number;
  /** Tables of this shape that still fit alongside the other lanes' current counts. */
  maxCount: number;
  /** Fraction of the block this lane consumes, 0..1. */
  share: number;
  overBudget: boolean;
  maxWidthM: number;
  maxDepthM: number;
  maxChairLengthM: number;
}

export interface DiningTableMixCapacity {
  shapes: DiningTableMixShapeCapacity[];
  totalCount: number;
  totalSeats: number;
  /** Combined share of the block. Above 1 means the mix cannot be placed. */
  utilisation: number;
  fits: boolean;
}

export function diningMixCapacityOptions(
  entry: DiningTableMixEntry,
  shared: DiningTableMixSharedOptions,
): DiningTableCapacityDimsOptions & { chairLengthM: number } {
  return {
    shape: entry.shape,
    widthM: entry.widthM,
    depthM: entry.shape === 'round' ? entry.widthM : entry.depthM,
    gapM: shared.gapM,
    chairLengthM: entry.chairLengthM,
    featureClearanceM: shared.featureClearanceM,
    wallClearanceM: shared.wallClearanceM,
    template: shared.template ?? 'grid',
    includeAnchoredFeatures: shared.includeAnchoredFeatures ?? true,
  };
}

/**
 * Interconnected capacity for a mixed-shape block.
 *
 * Each shape is measured alone against the real block geometry (features, keep-outs
 * and walls included), which gives its solo maximum. A lane placed at `count` then
 * consumes `count / soloMax` of the block, so the lanes compete for one shared budget
 * of 1.0. That keeps every lane's ceiling reactive: raising the round count lowers
 * what rectangular can still take, and lowering it hands the space straight back.
 */
export function computeDiningTableMixCapacity(
  element: CenterpieceElement,
  entries: readonly DiningTableMixEntry[],
  shared: DiningTableMixSharedOptions,
): DiningTableMixCapacity {
  const solo = entries.map((entry) =>
    Math.max(0, countDiningTablesThatFit(element, diningMixCapacityOptions(entry, shared))),
  );
  const shares = entries.map((entry, i) => {
    const max = solo[i] ?? 0;
    if (max > 0) {
      return Math.max(0, entry.count) / max;
    }
    return entry.count > 0 ? Number.POSITIVE_INFINITY : 0;
  });
  const utilisation = shares.reduce((sum, share) => sum + share, 0);

  const shapes = entries.map((entry, i): DiningTableMixShapeCapacity => {
    const soloMaxCount = solo[i] ?? 0;
    const options = diningMixCapacityOptions(entry, shared);
    const othersShare = utilisation - (shares[i] ?? 0);
    const remaining = Number.isFinite(othersShare) ? Math.max(0, 1 - othersShare) : 0;
    const maxCount = soloMaxCount > 0 ? Math.floor(soloMaxCount * remaining + 1e-9) : 0;
    const dims = maxDiningTableDimsForBlock(element, options);
    return {
      shape: entry.shape,
      count: entry.count,
      seats: entry.count * entry.seats,
      soloMaxCount,
      maxCount,
      share: shares[i] ?? 0,
      overBudget: entry.count > maxCount,
      maxWidthM: dims.widthM,
      maxDepthM: entry.shape === 'round' ? dims.widthM : dims.depthM,
      maxChairLengthM: maxDiningChairLengthForBlock(element, options),
    };
  });

  return {
    shapes,
    totalCount: entries.reduce((sum, entry) => sum + Math.max(0, entry.count), 0),
    totalSeats: entries.reduce((sum, entry) => sum + Math.max(0, entry.count) * entry.seats, 0),
    utilisation,
    fits: utilisation <= 1 + 1e-9,
  };
}

/**
 * Pull counts back inside the shared budget after a measurement grows.
 * The lane the user just touched keeps its value; the others give way, newest first.
 */
export function clampDiningTableMixCounts(
  element: CenterpieceElement,
  entries: readonly DiningTableMixEntry[],
  shared: DiningTableMixSharedOptions,
  protectedShape?: DiningTableShape,
): DiningTableMixEntry[] {
  const next = entries.map((entry) => ({ ...entry }));
  for (let pass = 0; pass < next.length + 1; pass += 1) {
    const capacity = computeDiningTableMixCapacity(element, next, shared);
    if (capacity.fits) {
      break;
    }
    const worst = capacity.shapes
      .map((shapeCapacity, index) => ({ shapeCapacity, index }))
      .filter(({ shapeCapacity }) => shapeCapacity.count > shapeCapacity.maxCount)
      .sort((a, b) => {
        const aProtected = a.shapeCapacity.shape === protectedShape ? 1 : 0;
        const bProtected = b.shapeCapacity.shape === protectedShape ? 1 : 0;
        if (aProtected !== bProtected) {
          return aProtected - bProtected;
        }
        return b.shapeCapacity.share - a.shapeCapacity.share;
      })[0];
    if (!worst) {
      break;
    }
    const entry = next[worst.index]!;
    const target = Math.max(0, worst.shapeCapacity.maxCount);
    if (target >= entry.count) {
      entry.count = Math.max(0, entry.count - 1);
    } else {
      entry.count = target;
    }
    if (entry.count <= 0 && next.every((e) => e.count <= 0)) {
      break;
    }
  }
  return next;
}
