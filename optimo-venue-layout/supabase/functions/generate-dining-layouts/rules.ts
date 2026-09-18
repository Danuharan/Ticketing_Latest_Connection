import type { DiningLayoutRules, DiningTableType, OccupiedFootprint, PlacedTable } from './types.ts';
import { DEFAULT_DINING_LAYOUT_RULES } from './types.ts';

export function normalizeRules(input?: Partial<DiningLayoutRules> | null): DiningLayoutRules {
  return {
    ...DEFAULT_DINING_LAYOUT_RULES,
    ...(input ?? {}),
  };
}

function chairReachM(type: DiningTableType): number {
  return Math.max(0.2, type.chairDepthM * 0.5);
}

/**
 * Tabletop + chairs only. Does not include table-to-table gap.
 * Use this against walls, Stage, Food Prep, access, obstacles.
 */
export function physicalDiningFootprint(type: DiningTableType): {
  physicalHalfWidthM: number;
  physicalHalfDepthM: number;
} {
  const chairReach = chairReachM(type);
  if (type.shape === 'round') {
    const r = type.widthM / 2 + chairReach;
    return { physicalHalfWidthM: r, physicalHalfDepthM: r };
  }
  return {
    physicalHalfWidthM: type.widthM / 2 + chairReach,
    physicalHalfDepthM: type.depthM / 2 + chairReach,
  };
}

/**
 * Physical dining unit plus half of the configured table gap on each side.
 * Use ONLY for table↔table collision / lattice pitch.
 *
 * Spacing semantics:
 * - tableGap / minimumTableToTableClearanceM: clear space between occupied units
 * - wallClearanceM / stageClearanceM / foodPrepClearanceM / entranceClearanceM /
 *   exitClearanceM: static-feature buffers, applied once, never via tableGap
 * - guest/main/waiter aisle widths: explicit corridor bands only
 */
export function pairwiseDiningFootprint(
  type: DiningTableType,
  rules: DiningLayoutRules,
): OccupiedFootprint {
  const physical = physicalDiningFootprint(type);
  const gapHalf = Math.max(0, rules.minimumTableToTableClearanceM) / 2;
  return {
    physicalHalfWidthM: physical.physicalHalfWidthM,
    physicalHalfDepthM: physical.physicalHalfDepthM,
    spacingHalfWidthM: physical.physicalHalfWidthM + gapHalf,
    spacingHalfDepthM: physical.physicalHalfDepthM + gapHalf,
  };
}

/** @deprecated Use pairwiseDiningFootprint. Kept as the complete footprint object. */
export function occupiedFootprint(
  type: DiningTableType,
  rules: DiningLayoutRules,
): OccupiedFootprint {
  return pairwiseDiningFootprint(type, rules);
}

export function makePlacedTable(
  type: DiningTableType,
  footprint: OccupiedFootprint,
  xM: number,
  yM: number,
  rotationDeg: number,
): PlacedTable {
  const swap = type.shape !== 'round' && Math.abs(rotationDeg % 180) === 90;
  return {
    xM,
    yM,
    rotationDeg: type.shape === 'round' ? 0 : rotationDeg,
    type,
    physicalHalfWidthM: swap ? footprint.physicalHalfDepthM : footprint.physicalHalfWidthM,
    physicalHalfDepthM: swap ? footprint.physicalHalfWidthM : footprint.physicalHalfDepthM,
    spacingHalfWidthM: swap ? footprint.spacingHalfDepthM : footprint.spacingHalfWidthM,
    spacingHalfDepthM: swap ? footprint.spacingHalfWidthM : footprint.spacingHalfDepthM,
  };
}

export function allowedTableTypes(catalogue: DiningTableType[]): DiningTableType[] {
  const allowed = catalogue.filter((t) => t.allowed !== false && t.widthM > 0 && t.capacity > 0);
  return allowed.length > 0 ? allowed : catalogue.filter((t) => t.widthM > 0);
}
