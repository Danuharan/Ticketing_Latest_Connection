import {
  CenterpieceElement,
  DEFAULT_TABLE_DEPTH_M,
  DEFAULT_TABLE_GAP_M,
  DEFAULT_TABLE_SEATS,
  DEFAULT_TABLE_WIDTH_M,
  DINING_FEATURE_TABLE_CLEARANCE_M,
  DiningTableAccessCategory,
  DiningTableShape,
  DiningTableSpec,
  ElementPosition,
  hasDiningStage,
  hasDiningFoodPrepare,
} from '../models/layout-element.model';
import {
  buildDiningStageRenderNode,
  buildDiningFoodPrepareRenderNode,
  diningAccessClearanceNodes,
  diningFeatureRotationDeg,
  normalizeDiningFeatureRotationDeg,
  resolveDiningFeatureRotationDeg,
} from './dining-stage';
import { seatFacingDegFromViewpoint } from './block-label';
import { logicalMeasureEdgeById } from './block-measure-edges';
import { polygonCanvasPointsFromBlock, viewpointAngleFromCanvasPoint } from './block-viewpoint';
import {
  canvasPointToElementPct,
  pointInPolygon,
} from './custom-shape-seats';
import { PixelRect, rectFromPositionSize } from './geometry';
import {
  pxPerMeter,
  resolveBlockLengthM,
  resolveBlockWidthM,
  resolveChairLengthM,
  resolveChairWidthM,
  spreadCentroidsInSpan,
  spreadCentroidsWithEdgeGap,
  spreadCentroidsWithFixedGap,
} from './physical-dims';
import { buildDiningTableChairArcs, diningTableVisualHalfExtentsM, type DiningTableChairArc } from './dining-table-icon';

let tableCounter = 0;

function nextTableId(): string {
  tableCounter += 1;
  return `tbl-${Date.now().toString(36)}-${tableCounter.toString(36)}`;
}

function elementPctToCanvasPoint(xPct: number, yPct: number, rect: PixelRect): { x: number; y: number } {
  return {
    x: rect.x + (xPct / 100) * rect.width,
    y: rect.y + (yPct / 100) * rect.height,
  };
}

function blockPolygon(element: CenterpieceElement, rect: PixelRect): { x: number; y: number }[] {
  return polygonCanvasPointsFromBlock(element.customPoints ?? [], rect);
}

/** Viewpoint angle (0° = above block) toward the dining stage edge, or the block default. */
export function resolveDiningViewpointAngleDeg(
  element: CenterpieceElement,
  rect: PixelRect,
  stageSideEdgeId?: number | null,
): number {
  const sideId =
    stageSideEdgeId ??
    (hasDiningStage(element) ? element.diningStage?.sideEdgeId : undefined);
  if (sideId != null) {
    const polygon = blockPolygon(element, rect);
    const edge = logicalMeasureEdgeById(polygon, sideId);
    if (edge) {
      return viewpointAngleFromCanvasPoint(rect.cx, rect.cy, edge.midX, edge.midY);
    }
  }
  return element.blockViewpointAngleDeg ?? 0;
}

/** Uniform rotation so every table faces the stage / viewpoint straight-on. */
export function resolveTableRotationFacingStage(
  _tableCanvasX: number,
  _tableCanvasY: number,
  _element: CenterpieceElement,
  _rect: PixelRect,
  viewpointAngleDeg: number,
): number {
  return seatFacingDegFromViewpoint(viewpointAngleDeg);
}

export interface TableGridOptions {
  shape: DiningTableShape;
  seats: number;
  widthM: number;
  depthM: number;
  gapM: number;
  template?: 'grid' | 'staggered' | 'banquet';
  tableCount?: number;
}

export interface TableCountGridOptions extends TableGridOptions {
  tableCount: number;
}

export interface TableGridCapacity {
  rows: number;
  columns: number;
  totalTables: number;
  blockLengthM: number;
  blockWidthM: number;
}

export function resolveDefaultTableShape(el: CenterpieceElement): DiningTableShape {
  return el.defaultDiningTableShape ?? 'round';
}

export function resolveDefaultTableSeats(el: CenterpieceElement): number {
  const v = el.defaultTableSeats;
  return v != null && v > 0 ? v : DEFAULT_TABLE_SEATS;
}

export function resolveDefaultTableWidthM(el: CenterpieceElement): number {
  const v = el.defaultTableWidthM;
  return v != null && v > 0 ? v : DEFAULT_TABLE_WIDTH_M;
}

export function resolveDefaultTableDepthM(el: CenterpieceElement): number {
  const v = el.defaultTableDepthM;
  return v != null && v > 0 ? v : DEFAULT_TABLE_DEPTH_M;
}

export function resolveDefaultTableGapM(el: CenterpieceElement): number {
  const v = el.defaultTableGapM;
  return v != null && v >= 0 ? v : DEFAULT_TABLE_GAP_M;
}

/** Absolute safety cap — real limits come from physical chair/table geometry. */
export const MAX_TABLE_CHAIRS_ABSOLUTE = 99;

/** Clear edge-gap between adjacent chairs around a table (m). */
export const DEFAULT_CHAIR_AROUND_TABLE_GAP_M = 0.15;

export interface TableChairCapacityOptions {
  shape: DiningTableShape;
  tableWidthM: number;
  tableDepthM: number;
  chairWidthM: number;
  chairDepthM: number;
  /**
   * Clear gap between adjacent chair edges (m).
   * ChairSpace = chairWidth + gap. Defaults to {@link DEFAULT_CHAIR_AROUND_TABLE_GAP_M}.
   */
  chairSpacingM?: number;
}

/** Clear gap between adjacent chairs around a table. */
export function resolveChairAroundTableSpacingM(chairWidthM: number, chairSpacingM?: number): number {
  if (chairSpacingM != null && chairSpacingM >= 0) {
    return chairSpacingM;
  }
  void chairWidthM;
  return DEFAULT_CHAIR_AROUND_TABLE_GAP_M;
}

/**
 * Maximum chairs that fit around one table.
 *
 * Round (example): diameter 1.2, chairWidth 0.45, gap 0.15
 *   ChairSpace = 0.45 + 0.15 = 0.60
 *   ChairCount = Floor(π × 1.2 / 0.60) = Floor(3.77 / 0.60) = 6
 *
 * Rectangular: Floor(perimeter / ChairSpace) where perimeter = 2 × (W + D).
 * Chair depth is used for placement/rendering, not this count.
 */
export function computeMaxChairsAroundTable(options: TableChairCapacityOptions): number {
  const tableWidthM = Math.max(0.1, options.tableWidthM);
  const tableDepthM = Math.max(0.1, options.tableDepthM);
  const chairWidthM = Math.max(0.1, options.chairWidthM);
  void options.chairDepthM;
  const gapM = resolveChairAroundTableSpacingM(chairWidthM, options.chairSpacingM);
  const chairSpaceM = chairWidthM + gapM;
  if (chairSpaceM <= 0) {
    return 1;
  }

  if (options.shape === 'round') {
    const circumferenceM = Math.PI * tableWidthM;
    const maxSeats = Math.floor(circumferenceM / chairSpaceM);
    return Math.max(1, Math.min(MAX_TABLE_CHAIRS_ABSOLUTE, maxSeats));
  }

  const perimeterM = 2 * (tableWidthM + tableDepthM);
  const maxSeats = Math.floor(perimeterM / chairSpaceM);
  return Math.max(1, Math.min(MAX_TABLE_CHAIRS_ABSOLUTE, maxSeats));
}

export function resolveMaxTableSeats(
  element: CenterpieceElement,
  table?: Pick<DiningTableSpec, 'shape' | 'widthM' | 'depthM'>,
  chairSpacingM?: number,
): number {
  const shape = table?.shape ?? resolveDefaultTableShape(element);
  const tableWidthM = table?.widthM ?? resolveDefaultTableWidthM(element);
  const tableDepthM =
    shape === 'rectangular'
      ? table?.depthM ?? resolveDefaultTableDepthM(element)
      : tableWidthM;
  return computeMaxChairsAroundTable({
    shape,
    tableWidthM,
    tableDepthM,
    chairWidthM: resolveChairWidthM(element),
    chairDepthM: resolveChairLengthM(element),
    chairSpacingM,
  });
}

export function clampTableSeats(
  seats: number,
  element: CenterpieceElement,
  table?: Pick<DiningTableSpec, 'shape' | 'widthM' | 'depthM'>,
  chairSpacingM?: number,
): number {
  const maxSeats = resolveMaxTableSeats(element, table, chairSpacingM);
  return Math.max(1, Math.min(maxSeats, Math.round(seats)));
}

/** How many rows × columns fit in the block at the given table size and spacing. */
export function computeTableGridCapacity(
  element: CenterpieceElement,
  options: Pick<TableGridOptions, 'shape' | 'widthM' | 'depthM' | 'gapM'> & {
    template?: 'grid' | 'staggered' | 'banquet';
    /** When set, chairs occupy space around each tabletop — same rule as the generator. */
    chairLengthM?: number;
    /** Extra metres subtracted around Stage / Food Prep. Default 0.1 (legacy grid). */
    featureClearanceM?: number;
    /** Wall clearance — must match generate-dining-layouts (default 0.4 m). */
    wallClearanceM?: number;
    /** When false, ignore Stage / Food Prep / access as blocked geometry. */
    includeAnchoredFeatures?: boolean;
  },
): TableGridCapacity {
  const includeFeatures = options.includeAnchoredFeatures !== false;
  const wall = diningWallClearanceM(options.wallClearanceM);
  const subs = includeFeatures
    ? getDiningFeatureSubtractions(element, options.featureClearanceM)
    : { topSubtract: 0, bottomSubtract: 0, leftSubtract: 0, rightSubtract: 0 };
  const blockLengthM = Math.max(
    0.1,
    resolveBlockLengthM(element) - subs.topSubtract - subs.bottomSubtract - wall * 2,
  );
  const blockWidthM = Math.max(
    0.1,
    resolveBlockWidthM(element) - subs.leftSubtract - subs.rightSubtract - wall * 2,
  );
  const gapM = Math.max(0, options.gapM);
  const widthM = Math.max(0.1, options.widthM);
  const depthM = Math.max(0.1, options.depthM);
  const template = options.template ?? 'grid';
  const chairReach = options.chairLengthM != null ? Math.max(0.2, options.chairLengthM * 0.5) : 0;

  const rowFootprintM = (options.shape === 'round' ? widthM : depthM) + chairReach * 2;
  const colFootprintM = widthM + chairReach * 2;

  const rowStep = rowFootprintM + gapM;
  const colStep = colFootprintM + gapM;

  let rows = Math.floor(blockLengthM / rowStep);
  let columns = Math.floor(blockWidthM / colStep);

  // Gap is between tables only — a single table still fits when footprint ≤ net room.
  if ((rows < 1 || columns < 1) && rowFootprintM <= blockLengthM + 1e-9 && colFootprintM <= blockWidthM + 1e-9) {
    rows = 1;
    columns = 1;
  }

  if (rows < 1 || columns < 1) {
    return {
      rows: 0,
      columns: 0,
      totalTables: 0,
      blockLengthM,
      blockWidthM,
    };
  }

  let totalTables = 0;
  const startX = (blockWidthM - (columns * colStep - gapM)) / 2 + colFootprintM / 2;
  const startY = (blockLengthM - (rows * rowStep - gapM)) / 2 + rowFootprintM / 2;
  const blocked = includeFeatures ? anchoredFeatureAabbsM(element, options.featureClearanceM ?? 0.8) : [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      let x = startX + c * colStep;
      const y = startY + r * rowStep;

      if (template === 'staggered' && r % 2 === 1) {
        x += colStep / 2;
      }

      if (x + colFootprintM / 2 > blockWidthM || x - colFootprintM / 2 < 0) {
        continue;
      }

      if (template === 'banquet') {
        const cx = blockWidthM / 2;
        const cy = blockLengthM / 2;
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (dist < Math.min(blockWidthM, blockLengthM) * 0.25) {
          continue;
        }
      }

      const fullX = x + subs.leftSubtract + wall;
      const fullY = y + subs.topSubtract + wall;
      const tableBox = {
        minX: fullX - colFootprintM / 2,
        maxX: fullX + colFootprintM / 2,
        minY: fullY - rowFootprintM / 2,
        maxY: fullY + rowFootprintM / 2,
      };
      if (blocked.some((box) => aabbOverlapM(tableBox, box))) {
        continue;
      }

      totalTables++;
    }
  }

  return {
    rows,
    columns,
    totalTables,
    blockLengthM,
    blockWidthM,
  };
}

export interface TableCountGridPreview {
  rows: number;
  columns: number;
  tableCount: number;
  blockLengthM: number;
  blockWidthM: number;
  gapM: number;
  /** Table width/diameter actually used (may shrink as count rises). */
  effectiveWidthM: number;
  /** Table depth actually used for rectangular tables. */
  effectiveDepthM: number;
  /** Preferred size before scaling down to fit count + spacing. */
  preferredWidthM: number;
  preferredDepthM: number;
  wasScaledDown: boolean;
  wasScaledUp: boolean;
  /** Highest count that still fills the block at the chosen gap. */
  maxFillCount: number;
}

const MIN_TABLE_SIZE_M = 0.6;
const MIN_CHAIR_LENGTH_M = 0.35;
const MIN_CHAIR_WIDTH_M = 0.35;
const MAX_CHAIR_WIDTH_M = 0.8;

export const MIN_DINING_TABLE_SIZE_M = MIN_TABLE_SIZE_M;
export const MIN_DINING_CHAIR_LENGTH_M = MIN_CHAIR_LENGTH_M;
export const MIN_DINING_CHAIR_WIDTH_M = MIN_CHAIR_WIDTH_M;
export const MAX_DINING_CHAIR_WIDTH_M = MAX_CHAIR_WIDTH_M;

/** Same default as generate-dining-layouts `rules.wallClearanceM`. */
export const DEFAULT_DINING_WALL_CLEARANCE_M = 0.4;

export type DiningTableCapacityDimsOptions = Pick<
  TableGridOptions,
  'shape' | 'widthM' | 'depthM' | 'gapM'
> & {
  chairLengthM?: number;
  featureClearanceM?: number;
  /** Clearance from block walls — must match the Edge Function or UI max > operational fit. */
  wallClearanceM?: number;
  template?: 'grid' | 'staggered' | 'banquet';
  includeAnchoredFeatures?: boolean;
};

function roundDiningMetres(value: number): number {
  return Math.round(value * 100) / 100;
}

function diningChairAllowanceM(chairLengthM: number | undefined): number {
  if (chairLengthM == null) {
    return 0;
  }
  return Math.max(0.2, chairLengthM * 0.5) * 2;
}

function diningWallClearanceM(wallClearanceM?: number): number {
  return Math.max(0, wallClearanceM ?? DEFAULT_DINING_WALL_CLEARANCE_M);
}

function diningNetRoomM(
  element: CenterpieceElement,
  featureClearanceM?: number,
  wallClearanceM?: number,
): { netWidthM: number; netLengthM: number } {
  const subs = getDiningFeatureSubtractions(element, featureClearanceM);
  const wall = diningWallClearanceM(wallClearanceM);
  return {
    netWidthM: Math.max(
      0.1,
      resolveBlockWidthM(element) - subs.leftSubtract - subs.rightSubtract - wall * 2,
    ),
    netLengthM: Math.max(
      0.1,
      resolveBlockLengthM(element) - subs.topSubtract - subs.bottomSubtract - wall * 2,
    ),
  };
}

/**
 * Largest tabletop that still fits inside the block with chairs and Stage/Food Prep.
 * One table needs no inter-table gap — only the chair reach around the top.
 *
 * Uses a spatial probe (not edge-strip net-room alone) so a free-rotated Stage’s
 * real AABB shrinks the allowed max, matching what pack/enforce will accept.
 */
export function maxDiningTableDimsForBlock(
  element: CenterpieceElement,
  options: DiningTableCapacityDimsOptions,
): { widthM: number; depthM: number } {
  const shape = options.shape;
  const soft = diningNetRoomM(element, options.featureClearanceM, options.wallClearanceM);
  const chairAllowance = diningChairAllowanceM(options.chairLengthM);
  const softMaxW = Math.max(MIN_TABLE_SIZE_M, soft.netWidthM - chairAllowance);
  const softMaxD = Math.max(MIN_TABLE_SIZE_M, soft.netLengthM - chairAllowance);
  const softCap =
    shape === 'round'
      ? roundDiningMetres(Math.min(softMaxW, softMaxD))
      : null;

  const fits = (widthM: number, depthM: number): boolean =>
    diningUnitFitsSomewhereInBlock(element, {
      shape,
      widthM,
      depthM,
      chairLengthM: options.chairLengthM,
      featureClearanceM: options.featureClearanceM,
      wallClearanceM: options.wallClearanceM,
      includeAnchoredFeatures: options.includeAnchoredFeatures,
    });

  if (shape === 'round') {
    const hi = softCap ?? softMaxW;
    if (!fits(MIN_TABLE_SIZE_M, MIN_TABLE_SIZE_M)) {
      return { widthM: MIN_TABLE_SIZE_M, depthM: MIN_TABLE_SIZE_M };
    }
    if (fits(hi, hi)) {
      return { widthM: hi, depthM: hi };
    }
    let lo = MIN_TABLE_SIZE_M;
    let best = MIN_TABLE_SIZE_M;
    let high = hi;
    for (let i = 0; i < 28; i += 1) {
      const mid = (lo + high) / 2;
      if (fits(mid, mid)) {
        best = mid;
        lo = mid;
      } else {
        high = mid;
      }
    }
    const diameterM = roundDiningMetres(best);
    return { widthM: diameterM, depthM: diameterM };
  }

  if (!fits(MIN_TABLE_SIZE_M, MIN_TABLE_SIZE_M)) {
    return { widthM: MIN_TABLE_SIZE_M, depthM: MIN_TABLE_SIZE_M };
  }
  if (fits(softMaxW, softMaxD)) {
    return {
      widthM: roundDiningMetres(softMaxW),
      depthM: roundDiningMetres(softMaxD),
    };
  }
  let lo = 0;
  let high = 1;
  let bestW = MIN_TABLE_SIZE_M;
  let bestD = MIN_TABLE_SIZE_M;
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + high) / 2;
    const widthM = Math.max(MIN_TABLE_SIZE_M, softMaxW * mid);
    const depthM = Math.max(MIN_TABLE_SIZE_M, softMaxD * mid);
    if (fits(widthM, depthM)) {
      bestW = widthM;
      bestD = depthM;
      lo = mid;
    } else {
      high = mid;
    }
  }
  return {
    widthM: roundDiningMetres(bestW),
    depthM: roundDiningMetres(bestD),
  };
}

/**
 * True when tabletop + chair reach can sit at some in-block centre without
 * overlapping walls (with wall clearance) or Stage / Food Prep / access AABBs.
 */
export function diningUnitFitsSomewhereInBlock(
  element: CenterpieceElement,
  options: Pick<
    DiningTableCapacityDimsOptions,
    | 'shape'
    | 'widthM'
    | 'depthM'
    | 'chairLengthM'
    | 'featureClearanceM'
    | 'wallClearanceM'
    | 'includeAnchoredFeatures'
  >,
): boolean {
  const blockW = resolveBlockWidthM(element);
  const blockL = resolveBlockLengthM(element);
  const wall = diningWallClearanceM(options.wallClearanceM);
  const chairReach =
    options.chairLengthM != null ? Math.max(0.2, options.chairLengthM * 0.5) : 0;
  const widthM = Math.max(0.1, options.widthM);
  const depthM = Math.max(
    0.1,
    options.shape === 'round' ? widthM : (options.depthM ?? widthM),
  );
  const halfW = widthM / 2 + chairReach;
  const halfD = depthM / 2 + chairReach;
  const minX = wall + halfW;
  const maxX = blockW - wall - halfW;
  const minY = wall + halfD;
  const maxY = blockL - wall - halfD;
  if (minX > maxX + 1e-9 || minY > maxY + 1e-9) {
    return false;
  }

  const includeFeatures = options.includeAnchoredFeatures !== false;
  const blocked = includeFeatures
    ? anchoredFeatureAabbsM(element, options.featureClearanceM ?? 0.8)
    : [];

  const steps = 16;
  for (let iy = 0; iy <= steps; iy += 1) {
    for (let ix = 0; ix <= steps; ix += 1) {
      const x = minX + ((maxX - minX) * ix) / steps;
      const y = minY + ((maxY - minY) * iy) / steps;
      const tableBox = {
        minX: x - halfW,
        maxX: x + halfW,
        minY: y - halfD,
        maxY: y + halfD,
      };
      if (!blocked.some((box) => aabbOverlapM(tableBox, box))) {
        return true;
      }
    }
  }
  return false;
}

/** Largest chair depth that still leaves room for the current (or minimum) table. */
export function maxDiningChairLengthForBlock(
  element: CenterpieceElement,
  options: DiningTableCapacityDimsOptions,
): number {
  const tableW = Math.max(MIN_TABLE_SIZE_M, options.widthM);
  const tableD = Math.max(
    MIN_TABLE_SIZE_M,
    options.shape === 'round' ? options.widthM : options.depthM,
  );
  const soft = diningNetRoomM(element, options.featureClearanceM, options.wallClearanceM);
  const softMax = roundDiningMetres(
    Math.max(
      MIN_CHAIR_LENGTH_M,
      Math.min(soft.netWidthM - tableW, soft.netLengthM - tableD),
    ),
  );

  const fits = (chairLengthM: number): boolean =>
    diningUnitFitsSomewhereInBlock(element, {
      shape: options.shape,
      widthM: tableW,
      depthM: tableD,
      chairLengthM,
      featureClearanceM: options.featureClearanceM,
      wallClearanceM: options.wallClearanceM,
      includeAnchoredFeatures: options.includeAnchoredFeatures,
    });

  if (!fits(MIN_CHAIR_LENGTH_M)) {
    return MIN_CHAIR_LENGTH_M;
  }
  if (fits(softMax)) {
    return softMax;
  }
  let lo = MIN_CHAIR_LENGTH_M;
  let high = softMax;
  let best = MIN_CHAIR_LENGTH_M;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + high) / 2;
    if (fits(mid)) {
      best = mid;
      lo = mid;
    } else {
      high = mid;
    }
  }
  return roundDiningMetres(best);
}

export function maxDiningChairWidthForTable(tableWidthM: number): number {
  return roundDiningMetres(Math.max(MIN_CHAIR_WIDTH_M, Math.min(MAX_CHAIR_WIDTH_M, tableWidthM)));
}

/**
 * Keep table + chairs inside the block. Prefer the field the user just changed:
 * growing chairs shrinks the table; growing the table shrinks chairs.
 */
export function fitDiningTableAndChairToBlock(
  element: CenterpieceElement,
  options: DiningTableCapacityDimsOptions & {
    chairWidthM?: number;
    prefer: 'table' | 'chair';
  },
): {
  widthM: number;
  depthM: number;
  chairLengthM: number;
  chairWidthM: number;
} {
  const { netWidthM, netLengthM } = diningNetRoomM(
    element,
    options.featureClearanceM,
    options.wallClearanceM,
  );
  const wantW = Math.max(MIN_TABLE_SIZE_M, options.widthM);
  const wantD = Math.max(MIN_TABLE_SIZE_M, options.depthM);
  const wantChair = Math.max(MIN_CHAIR_LENGTH_M, options.chairLengthM ?? MIN_CHAIR_LENGTH_M);
  const maxChairAtMinTable = roundDiningMetres(
    Math.max(MIN_CHAIR_LENGTH_M, Math.min(netWidthM, netLengthM) - MIN_TABLE_SIZE_M),
  );
  const maxTableWAtMinChair = roundDiningMetres(
    Math.max(MIN_TABLE_SIZE_M, netWidthM - diningChairAllowanceM(MIN_CHAIR_LENGTH_M)),
  );
  const maxTableDAtMinChair = roundDiningMetres(
    Math.max(MIN_TABLE_SIZE_M, netLengthM - diningChairAllowanceM(MIN_CHAIR_LENGTH_M)),
  );

  let widthM = wantW;
  let depthM = wantD;
  let chairLengthM = wantChair;

  if (options.prefer === 'chair') {
    chairLengthM = Math.min(wantChair, maxChairAtMinTable);
    const allowance = diningChairAllowanceM(chairLengthM);
    widthM = Math.min(wantW, Math.max(MIN_TABLE_SIZE_M, netWidthM - allowance));
    depthM = Math.min(wantD, Math.max(MIN_TABLE_SIZE_M, netLengthM - allowance));
  } else {
    widthM = Math.min(wantW, maxTableWAtMinChair);
    depthM = Math.min(wantD, maxTableDAtMinChair);
    const maxChair = roundDiningMetres(
      Math.max(
        MIN_CHAIR_LENGTH_M,
        Math.min(netWidthM - widthM, netLengthM - (options.shape === 'round' ? widthM : depthM)),
      ),
    );
    chairLengthM = Math.min(wantChair, maxChair);
  }

  if (options.shape === 'round') {
    widthM = roundDiningMetres(Math.min(widthM, depthM));
    depthM = widthM;
  } else {
    widthM = roundDiningMetres(widthM);
    depthM = roundDiningMetres(depthM);
  }
  chairLengthM = roundDiningMetres(chairLengthM);

  const maxChairWidth = maxDiningChairWidthForTable(widthM);
  const chairWidthM = roundDiningMetres(
    Math.max(MIN_CHAIR_WIDTH_M, Math.min(maxChairWidth, options.chairWidthM ?? MIN_CHAIR_WIDTH_M)),
  );

  return { widthM, depthM, chairLengthM, chairWidthM };
}

export type DiningWizardPackPrefer = 'table' | 'chair' | 'count';

function diningTablePackCapacity(
  element: CenterpieceElement,
  options: DiningTableCapacityDimsOptions,
): number {
  return computeTableGridCapacity(element, {
    shape: options.shape,
    widthM: options.widthM,
    depthM: options.depthM,
    gapM: options.gapM,
    chairLengthM: options.chairLengthM,
    featureClearanceM: options.featureClearanceM,
    wallClearanceM: options.wallClearanceM,
    template: options.template ?? 'grid',
    includeAnchoredFeatures: options.includeAnchoredFeatures,
  }).totalTables;
}

/** Empty-room lattice count: table + chairs + gap + walls only. */
export function basicGeometricDiningCapacity(
  element: CenterpieceElement,
  options: DiningTableCapacityDimsOptions,
): number {
  return diningTablePackCapacity(element, { ...options, includeAnchoredFeatures: false });
}

/** 2D packing estimate that treats Stage / Food Prep / access as actual blocked rectangles. */
export function estimatedOperationalDiningCapacity(
  element: CenterpieceElement,
  options: DiningTableCapacityDimsOptions,
): number {
  return diningTablePackCapacity(element, { ...options, includeAnchoredFeatures: true });
}

/** How many tables of this exact size fit at the current gap and chair footprint. */
export function countDiningTablesThatFit(
  element: CenterpieceElement,
  options: DiningTableCapacityDimsOptions,
): number {
  return diningTablePackCapacity(element, options);
}

/**
 * Input ceilings for the wizard. While more than one table is requested, size is
 * capped so that field still fits a single table at the *other* current measurement
 * (count then falls). After count is 1, the cap opens to the true 1-table minimum
 * of the other field so growing one shrinks the other down to its practical min.
 */
export function diningWizardInputMaxes(
  element: CenterpieceElement,
  options: DiningTableCapacityDimsOptions & { tableCount?: number },
): {
  maxWidthM: number;
  maxDepthM: number;
  maxChairLengthM: number;
  maxChairWidthM: number;
  maxTableCount: number;
} {
  const tableCount = Math.max(1, Math.round(options.tableCount ?? 1));
  const maxTableCount = countDiningTablesThatFit(element, options);
  const oneTableAtCurrentChairs = maxDiningTableDimsForBlock(element, options);
  const oneTableAtMinChairs = maxDiningTableDimsForBlock(element, {
    ...options,
    chairLengthM: MIN_CHAIR_LENGTH_M,
  });
  const tableMax = tableCount <= 1 ? oneTableAtMinChairs : oneTableAtCurrentChairs;
  const chairMax =
    tableCount <= 1
      ? maxDiningChairLengthForBlock(element, {
          ...options,
          widthM: MIN_TABLE_SIZE_M,
          depthM: MIN_TABLE_SIZE_M,
        })
      : maxDiningChairLengthForBlock(element, options);
  return {
    maxWidthM: tableMax.widthM,
    maxDepthM: tableMax.depthM,
    maxChairLengthM: chairMax,
    maxChairWidthM: maxDiningChairWidthForTable(options.widthM),
    maxTableCount,
  };
}

/**
 * Strict pack: growing table size drops count first; after 1 table, it shrinks
 * chairs to their minimum then hard-stops. Growing chairs does the inverse.
 */
export function resolveDiningWizardPack(
  element: CenterpieceElement,
  options: DiningTableCapacityDimsOptions & {
    chairWidthM?: number;
    tableCount: number;
    prefer: DiningWizardPackPrefer;
  },
): {
  widthM: number;
  depthM: number;
  chairLengthM: number;
  chairWidthM: number;
  tableCount: number;
  maxTableCount: number;
} {
  const shape = options.shape;
  const gapM = options.gapM;
  const featureClearanceM = options.featureClearanceM;
  const wallClearanceM = options.wallClearanceM;
  const template = options.template ?? 'grid';
  const packOpts = (
    widthM: number,
    depthM: number,
    chairLengthM: number,
  ): DiningTableCapacityDimsOptions => ({
    shape,
    widthM,
    depthM,
    gapM,
    chairLengthM,
    featureClearanceM,
    wallClearanceM,
    template,
    includeAnchoredFeatures: options.includeAnchoredFeatures,
  });

  const absTable = maxDiningTableDimsForBlock(element, {
    ...options,
    chairLengthM: MIN_CHAIR_LENGTH_M,
  });

  let widthM = Math.max(MIN_TABLE_SIZE_M, options.widthM);
  let depthM = Math.max(MIN_TABLE_SIZE_M, options.depthM);
  let chairLengthM = Math.max(MIN_CHAIR_LENGTH_M, options.chairLengthM ?? MIN_CHAIR_LENGTH_M);
  let tableCount = Math.max(1, Math.round(options.tableCount));

  const applyRound = (): void => {
    if (shape === 'round') {
      widthM = roundDiningMetres(Math.min(widthM, depthM));
      depthM = widthM;
    } else {
      widthM = roundDiningMetres(widthM);
      depthM = roundDiningMetres(depthM);
    }
    chairLengthM = roundDiningMetres(Math.max(MIN_CHAIR_LENGTH_M, chairLengthM));
  };

  const capacityOf = (w: number, d: number, chair: number): number =>
    diningTablePackCapacity(element, packOpts(w, d, chair));

  const inputMax = diningWizardInputMaxes(element, {
    ...packOpts(widthM, depthM, chairLengthM),
    tableCount,
  });

  if (options.prefer === 'chair') {
    chairLengthM = Math.min(chairLengthM, inputMax.maxChairLengthM);
    applyRound();
    let maxFill = capacityOf(widthM, depthM, chairLengthM);
    if (maxFill >= 1) {
      tableCount = Math.min(tableCount, maxFill);
    } else {
      tableCount = 1;
      const tableFit = scaleDiningTableDimsToFitCount(element, {
        ...packOpts(widthM, depthM, chairLengthM),
        minCount: 1,
      });
      widthM = tableFit.widthM;
      depthM = shape === 'round' ? tableFit.widthM : tableFit.depthM;
      maxFill = tableFit.maxFillCount;
      if (maxFill < 1) {
        const chairFit = scaleChairLengthToFitTableCount(element, {
          ...packOpts(widthM, depthM, chairLengthM),
          chairLengthM,
          minCount: 1,
        });
        chairLengthM = chairFit.chairLengthM;
        maxFill = chairFit.maxFillCount;
      }
      if (maxFill < 1) {
        widthM = absTable.widthM;
        depthM = absTable.depthM;
        chairLengthM = MIN_CHAIR_LENGTH_M;
      }
    }
  } else if (options.prefer === 'count') {
    widthM = Math.min(widthM, absTable.widthM);
    depthM = Math.min(depthM, absTable.depthM);
    applyRound();
    let maxFill = capacityOf(widthM, depthM, chairLengthM);
    if (maxFill < tableCount) {
      const tableFit = scaleDiningTableDimsToFitCount(element, {
        ...packOpts(widthM, depthM, chairLengthM),
        minCount: tableCount,
      });
      if (tableFit.maxFillCount >= tableCount) {
        widthM = tableFit.widthM;
        depthM = shape === 'round' ? tableFit.widthM : tableFit.depthM;
        maxFill = tableFit.maxFillCount;
      } else {
        const chairFit = scaleChairLengthToFitTableCount(element, {
          ...packOpts(tableFit.widthM, tableFit.depthM, chairLengthM),
          chairLengthM,
          minCount: tableCount,
        });
        if (chairFit.maxFillCount >= tableCount) {
          widthM = tableFit.widthM;
          depthM = shape === 'round' ? tableFit.widthM : tableFit.depthM;
          chairLengthM = chairFit.chairLengthM;
          maxFill = chairFit.maxFillCount;
        } else {
          maxFill = Math.max(0, tableFit.maxFillCount, chairFit.maxFillCount);
          tableCount = Math.max(1, maxFill);
          widthM = tableFit.widthM;
          depthM = shape === 'round' ? tableFit.widthM : tableFit.depthM;
        }
      }
    }
  } else {
    widthM = Math.min(widthM, inputMax.maxWidthM);
    depthM = Math.min(depthM, inputMax.maxDepthM);
    applyRound();
    let maxFill = capacityOf(widthM, depthM, chairLengthM);
    if (maxFill >= 1) {
      tableCount = Math.min(tableCount, maxFill);
    } else {
      tableCount = 1;
      const chairFit = scaleChairLengthToFitTableCount(element, {
        ...packOpts(widthM, depthM, chairLengthM),
        chairLengthM,
        minCount: 1,
      });
      chairLengthM = chairFit.chairLengthM;
      maxFill = chairFit.maxFillCount;
      if (maxFill < 1) {
        const tableFit = scaleDiningTableDimsToFitCount(element, {
          ...packOpts(widthM, depthM, chairLengthM),
          minCount: 1,
        });
        widthM = tableFit.widthM;
        depthM = shape === 'round' ? tableFit.widthM : tableFit.depthM;
        maxFill = tableFit.maxFillCount;
      }
      if (maxFill < 1) {
        widthM = absTable.widthM;
        depthM = absTable.depthM;
        chairLengthM = MIN_CHAIR_LENGTH_M;
      }
    }
  }

  applyRound();
  const chairWidthM = roundDiningMetres(
    Math.max(
      MIN_CHAIR_WIDTH_M,
      Math.min(maxDiningChairWidthForTable(widthM), options.chairWidthM ?? MIN_CHAIR_WIDTH_M),
    ),
  );
  const maxTableCount = countDiningTablesThatFit(element, packOpts(widthM, depthM, chairLengthM));
  if (maxTableCount >= 1) {
    tableCount = Math.max(1, Math.min(tableCount, maxTableCount));
  } else {
    tableCount = 1;
  }

  return { widthM, depthM, chairLengthM, chairWidthM, tableCount, maxTableCount };
}

/**
 * Shrink table width/depth (keeping aspect) until at least `minCount` tables fit
 * with chairs + feature clearances. Used by the wizard so generate never gets an
 * impossible size (e.g. diameter larger than the block).
 */
export function scaleDiningTableDimsToFitCount(
  element: CenterpieceElement,
  options: DiningTableCapacityDimsOptions & { minCount: number },
): { widthM: number; depthM: number; maxFillCount: number } {
  const minCount = Math.max(1, Math.round(options.minCount));
  const shape = options.shape;
  const preferredW = Math.max(MIN_TABLE_SIZE_M, options.widthM);
  const preferredD = Math.max(MIN_TABLE_SIZE_M, options.depthM);

  const fillAt = (widthM: number, depthM: number): number => {
    if (minCount <= 1) {
      return diningUnitFitsSomewhereInBlock(element, {
        shape,
        widthM,
        depthM,
        chairLengthM: options.chairLengthM,
        featureClearanceM: options.featureClearanceM,
        wallClearanceM: options.wallClearanceM,
        includeAnchoredFeatures: options.includeAnchoredFeatures,
      })
        ? 1
        : 0;
    }
    return computeTableGridCapacity(element, {
      shape,
      widthM,
      depthM,
      gapM: options.gapM,
      chairLengthM: options.chairLengthM,
      featureClearanceM: options.featureClearanceM,
      wallClearanceM: options.wallClearanceM,
      template: options.template ?? 'grid',
      includeAnchoredFeatures: options.includeAnchoredFeatures,
    }).totalTables;
  };

  const currentFill = fillAt(preferredW, preferredD);
  if (currentFill >= minCount) {
    return { widthM: preferredW, depthM: preferredD, maxFillCount: currentFill };
  }

  const minW = MIN_TABLE_SIZE_M;
  const minD = shape === 'round' ? MIN_TABLE_SIZE_M : MIN_TABLE_SIZE_M;
  const minFill = fillAt(minW, minD);
  if (minFill < minCount) {
    return { widthM: minW, depthM: minD, maxFillCount: minFill };
  }

  let lo = 0;
  let hi = 1;
  let bestW = minW;
  let bestD = minD;
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) / 2;
    const widthM = Math.max(minW, preferredW * mid);
    const depthM = Math.max(minD, preferredD * mid);
    const fill = fillAt(widthM, depthM);
    if (fill >= minCount) {
      bestW = widthM;
      bestD = depthM;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const widthM = Math.round(bestW * 100) / 100;
  const depthM = shape === 'round' ? widthM : Math.round(bestD * 100) / 100;
  return { widthM, depthM, maxFillCount: fillAt(widthM, depthM) };
}

/**
 * Shrink chair depth until the current table size still fits at least `minCount` tables.
 */
export function scaleChairLengthToFitTableCount(
  element: CenterpieceElement,
  options: DiningTableCapacityDimsOptions & {
    chairLengthM: number;
    minCount: number;
  },
): { chairLengthM: number; maxFillCount: number } {
  const minCount = Math.max(1, Math.round(options.minCount));
  const preferred = Math.max(MIN_CHAIR_LENGTH_M, options.chairLengthM);

  const fillAt = (chairLengthM: number): number =>
    computeTableGridCapacity(element, {
      shape: options.shape,
      widthM: options.widthM,
      depthM: options.depthM,
      gapM: options.gapM,
      chairLengthM,
      featureClearanceM: options.featureClearanceM,
      wallClearanceM: options.wallClearanceM,
      template: options.template ?? 'grid',
      includeAnchoredFeatures: options.includeAnchoredFeatures,
    }).totalTables;

  const currentFill = fillAt(preferred);
  if (currentFill >= minCount) {
    return { chairLengthM: preferred, maxFillCount: currentFill };
  }

  const minFill = fillAt(MIN_CHAIR_LENGTH_M);
  if (minFill < minCount) {
    return { chairLengthM: MIN_CHAIR_LENGTH_M, maxFillCount: minFill };
  }

  let lo = MIN_CHAIR_LENGTH_M;
  let hi = preferred;
  let best = MIN_CHAIR_LENGTH_M;
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) / 2;
    if (fillAt(mid) >= minCount) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const chairLengthM = Math.round(best * 100) / 100;
  return { chairLengthM, maxFillCount: fillAt(chairLengthM) };
}

function maxVisualSpanForAxis(spanM: number, count: number, edgeGapM: number): number {
  if (count <= 0) {
    return 0;
  }
  return (spanM - Math.max(0, count - 1) * edgeGapM) / count;
}

function resolveTableSizeToFillCell(
  shape: DiningTableShape,
  seats: number,
  preferredWidthM: number,
  preferredDepthM: number,
  maxVisualWidthM: number,
  maxVisualDepthM: number,
): { widthM: number; depthM: number } | null {
  let lo = MIN_TABLE_SIZE_M / Math.max(preferredWidthM, preferredDepthM, 0.1);
  let hi = 40;
  for (let i = 0; i < 32; i += 1) {
    const scale = (lo + hi) / 2;
    const widthM = preferredWidthM * scale;
    const depthM = preferredDepthM * scale;
    const half = diningTableVisualHalfExtentsM(shape, widthM, depthM, seats);
    const visualW = half.halfWidthM * 2;
    const visualD = half.halfDepthM * 2;
    if (visualW <= maxVisualWidthM + 1e-6 && visualD <= maxVisualDepthM + 1e-6) {
      lo = scale;
    } else {
      hi = scale;
    }
  }
  const widthM = preferredWidthM * lo;
  const depthM = preferredDepthM * lo;
  if (widthM < MIN_TABLE_SIZE_M || (shape === 'rectangular' && depthM < MIN_TABLE_SIZE_M)) {
    return null;
  }
  return { widthM, depthM };
}

type TableCountLayoutOptions = Pick<
  TableCountGridOptions,
  'shape' | 'widthM' | 'depthM' | 'gapM' | 'tableCount' | 'seats'
>;

function computeTableCountGridLayoutCore(
  element: CenterpieceElement,
  options: TableCountLayoutOptions,
): TableCountGridPreview | { error: string } {
  const subs = getDiningFeatureSubtractions(element);
  const blockLengthM = Math.max(0.1, resolveBlockLengthM(element) - subs.topSubtract - subs.bottomSubtract);
  const blockWidthM = Math.max(0.1, resolveBlockWidthM(element) - subs.leftSubtract - subs.rightSubtract);
  const edgeGapM = Math.max(0, options.gapM);
  const preferredWidthM = Math.max(0.1, options.widthM);
  const preferredDepthM = Math.max(0.1, options.depthM);
  const shape = options.shape;
  const seats = clampTableSeats(options.seats, element, {
    shape,
    widthM: preferredWidthM,
    depthM: preferredDepthM,
  });
  const tableCount = Math.max(1, Math.min(500, Math.round(options.tableCount)));

  const { rows, columns } = computeGridDimensionsForCount(tableCount, blockLengthM, blockWidthM);
  if (rows < 1 || columns < 1) {
    return { error: 'Invalid table count.' };
  }

  const maxVisualColM = maxVisualSpanForAxis(blockWidthM, columns, edgeGapM);
  const maxVisualRowM = maxVisualSpanForAxis(blockLengthM, rows, edgeGapM);
  if (maxVisualColM <= 0 || maxVisualRowM <= 0) {
    return { error: 'Spacing is too large for this block and table count.' };
  }

  const sized = resolveTableSizeToFillCell(
    shape,
    seats,
    preferredWidthM,
    preferredDepthM,
    maxVisualColM,
    maxVisualRowM,
  );
  if (!sized) {
    return {
      error: `Cannot fit ${tableCount} tables with ${edgeGapM} m gaps — tables would be smaller than ${MIN_TABLE_SIZE_M} m.`,
    };
  }

  const { widthM: effectiveWidthM, depthM: effectiveDepthM } = sized;
  const wasScaledDown =
    effectiveWidthM < preferredWidthM - 0.001 ||
    (shape === 'rectangular' && effectiveDepthM < preferredDepthM - 0.001);
  const wasScaledUp =
    effectiveWidthM > preferredWidthM + 0.001 ||
    (shape === 'rectangular' && effectiveDepthM > preferredDepthM + 0.001);

  return {
    rows,
    columns,
    tableCount,
    blockLengthM,
    blockWidthM,
    gapM: edgeGapM,
    effectiveWidthM,
    effectiveDepthM,
    preferredWidthM,
    preferredDepthM,
    wasScaledDown,
    wasScaledUp,
    maxFillCount: 0,
  };
}

/** Highest table count that fills the block at the chosen gap (binary search). */
export function computeMaxFillTableCount(
  element: CenterpieceElement,
  options: Omit<TableCountLayoutOptions, 'tableCount'>,
): number {
  let low = 1;
  let high = 500;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const layout = computeTableCountGridLayoutCore(element, { ...options, tableCount: mid });
    if (!('error' in layout)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

/** Grid layout + table dimensions for a count and spacing (fills block; tables shrink when count rises). */
export function computeTableCountGridLayout(
  element: CenterpieceElement,
  options: TableCountLayoutOptions,
): TableCountGridPreview | { error: string } {
  const layout = computeTableCountGridLayoutCore(element, options);
  if ('error' in layout) {
    return layout;
  }
  const maxFillCount = computeMaxFillTableCount(element, options);
  return { ...layout, maxFillCount };
}

function visualBBoxInsidePolygon(
  cx: number,
  cy: number,
  halfWidthPx: number,
  halfHeightPx: number,
  polygon: { x: number; y: number }[],
): boolean {
  const samples = [
    { x: cx - halfWidthPx, y: cy - halfHeightPx },
    { x: cx + halfWidthPx, y: cy - halfHeightPx },
    { x: cx + halfWidthPx, y: cy + halfHeightPx },
    { x: cx - halfWidthPx, y: cy + halfHeightPx },
    { x: cx, y: cy - halfHeightPx },
    { x: cx + halfWidthPx, y: cy },
    { x: cx, y: cy + halfHeightPx },
    { x: cx - halfWidthPx, y: cy },
  ];
  return samples.every((point) => pointInPolygon(point, polygon));
}

/** Picks a row × column grid that matches the block aspect ratio for the requested count. */
export function computeGridDimensionsForCount(
  tableCount: number,
  blockLengthM: number,
  blockWidthM: number,
): { rows: number; columns: number } {
  if (tableCount <= 0) {
    return { rows: 0, columns: 0 };
  }
  if (tableCount === 1) {
    return { rows: 1, columns: 1 };
  }
  const aspect = blockWidthM / Math.max(blockLengthM, 0.001);
  let columns = Math.max(1, Math.ceil(Math.sqrt(tableCount * aspect)));
  let rows = Math.ceil(tableCount / columns);
  while (columns > 1 && (columns - 1) * rows >= tableCount) {
    columns -= 1;
    rows = Math.ceil(tableCount / columns);
  }
  return { rows, columns };
}

export function previewTableCountGrid(
  element: CenterpieceElement,
  options: Pick<TableCountGridOptions, 'shape' | 'widthM' | 'depthM' | 'gapM' | 'tableCount' | 'seats'>,
): TableCountGridPreview | { error: string } {
  return computeTableCountGridLayout(element, options);
}

export function tableLabel(index: number): string {
  return `T${index + 1}`;
}

export interface DiningTableRenderNode {
  tableId: string;
  label: string;
  x: number;
  y: number;
  widthPx: number;
  heightPx: number;
  shape: DiningTableShape;
  seats: number;
  rotationDeg: number;
  selected: boolean;
  chairArcs: DiningTableChairArc[];
  chairArcRadiusPx: number;
  /** Half of chair width (along table edge), in canvas px — from chairWidthM. */
  chairHalfWidthPx: number;
  /** Half of chair depth (away from table), in canvas px — from chairLengthM. */
  chairHalfDepthPx: number;
  strokeWidth: number;
  cornerRadiusPx: number;
  accessCategory?: DiningTableAccessCategory;
  isMerged: boolean;
}

export const DINING_TABLE_ACCESS_STROKE: Record<DiningTableAccessCategory, string> = {
  private: '#7c3aed',
  public: '#2563eb',
  shared: '#059669',
  vip: '#d97706',
};

export function buildDiningTableRenderList(
  element: CenterpieceElement,
  rect: PixelRect,
  selectedTableId: string | null,
  selectedTableIds: string[] = [],
): DiningTableRenderNode[] {
  const tables = element.diningTables ?? [];
  if (tables.length === 0) {
    return [];
  }
  const ppm = pxPerMeter(rect, resolveBlockLengthM(element), resolveBlockWidthM(element));
  const defaultFacing = seatFacingDegFromViewpoint(resolveDiningViewpointAngleDeg(element, rect));

  const selection = new Set(
    selectedTableIds.length > 0
      ? selectedTableIds
      : selectedTableId
        ? [selectedTableId]
        : [],
  );

  return tables.map((table) => {
    const point = elementPctToCanvasPoint(table.xPct, table.yPct, rect);
    const widthPx = table.widthM * ppm;
    const depthM = table.shape === 'rectangular' ? (table.depthM ?? resolveDefaultTableDepthM(element)) : table.widthM;
    const heightPx = depthM * ppm;
    const chairWidthPx = resolveChairWidthM(element) * ppm;
    const chairDepthPx = resolveChairLengthM(element) * ppm;
    const icon = buildDiningTableChairArcs(
      table.shape,
      widthPx,
      heightPx,
      table.seats,
      table.suppressedChairEdges,
      table.seatsByEdge,
      { widthPx: chairWidthPx, depthPx: chairDepthPx },
    );
    return {
      tableId: table.id,
      label: table.label,
      x: point.x,
      y: point.y,
      widthPx,
      heightPx,
      shape: table.shape,
      seats: table.seats,
      rotationDeg: table.rotationDeg ?? defaultFacing,
      selected: selection.has(table.id),
      chairArcs: icon.chairArcs,
      chairArcRadiusPx: icon.chairArcRadiusPx,
      chairHalfWidthPx: icon.chairHalfWidthPx,
      chairHalfDepthPx: icon.chairHalfDepthPx,
      strokeWidth: icon.strokeWidth,
      cornerRadiusPx: icon.cornerRadiusPx,
      accessCategory: table.accessCategory,
      isMerged: Boolean(table.mergeGroupId && (table.mergeRestore?.length ?? 0) >= 2),
    };
  });
}

function canvasPctToCanvasPoint(
  canvasPct: ElementPosition,
  canvas: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: (canvasPct.xPct / 100) * canvas.width,
    y: (canvasPct.yPct / 100) * canvas.height,
  };
}

function clampPointInsidePolygon(
  point: { x: number; y: number },
  polygon: { x: number; y: number }[],
): { x: number; y: number } {
  if (pointInPolygon(point, polygon)) {
    return point;
  }
  let best = polygon[0];
  let bestDist = Infinity;
  for (const vertex of polygon) {
    const d = Math.hypot(point.x - vertex.x, point.y - vertex.y);
    if (d < bestDist) {
      bestDist = d;
      best = vertex;
    }
  }
  return best;
}

export function addTableAtPoint(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  canvasPct: ElementPosition,
  options?: {
    shape?: DiningTableShape;
    seats?: number;
    widthM?: number;
    depthM?: number;
  },
): Partial<CenterpieceElement> {
  const polygon = blockPolygon(element, rect);
  if (polygon.length < 3) {
    return {};
  }
  const canvasPoint = canvasPctToCanvasPoint(canvasPct, canvas);
  let placement = canvasPoint;
  if (!pointInPolygon(placement, polygon)) {
    placement = clampPointInsidePolygon(placement, polygon);
    if (!pointInPolygon(placement, polygon)) {
      return {};
    }
  }
  const pct = canvasPointToElementPct(placement, rect);
  const existing = element.diningTables ?? [];
  const shape = options?.shape ?? resolveDefaultTableShape(element);
  const widthM = options?.widthM ?? resolveDefaultTableWidthM(element);
  const depthM = options?.depthM ?? resolveDefaultTableDepthM(element);
  const seats = clampTableSeats(options?.seats ?? resolveDefaultTableSeats(element), element, {
    shape,
    widthM,
    depthM,
  });
  const viewpointAngleDeg = resolveDiningViewpointAngleDeg(element, rect);
  const table: DiningTableSpec = {
    id: nextTableId(),
    label: tableLabel(existing.length),
    xPct: pct.xPct,
    yPct: pct.yPct,
    shape,
    seats,
    widthM,
    depthM: shape === 'rectangular' ? depthM : undefined,
    rotationDeg: resolveTableRotationFacingStage(
      placement.x,
      placement.y,
      element,
      rect,
      viewpointAngleDeg,
    ),
  };
  return {
    diningTables: [...existing, table],
    tablePlacementMode: true,
    tableGridMode: undefined,
  };
}

/**
 * Auto-arranges tables in a grid from block physical size, table dimensions, and spacing.
 * Rows follow block depth (length); columns follow block width.
 */
export function createAutoTableGrid(
  element: CenterpieceElement,
  rect: PixelRect,
  options: TableGridOptions,
): Partial<CenterpieceElement> | { error: string } {
  const polygon = blockPolygon(element, rect);
  if (polygon.length < 3) {
    return { error: 'Block outline is not valid.' };
  }

  const shape = options.shape;
  const widthM = Math.max(0.1, options.widthM);
  const depthM = Math.max(0.1, options.depthM);
  const gapM = Math.max(0, options.gapM);
  const template = options.template ?? 'grid';
  // Exact chairs-per-table from wizard Step 5 (UI already caps to max fit).
  const seats = Math.max(1, Math.min(MAX_TABLE_CHAIRS_ABSOLUTE, Math.round(options.seats)));

  const capacity = computeTableGridCapacity(element, { shape, widthM, depthM, gapM, template });
  const { rows, columns } = capacity;
  if (rows < 1 || columns < 1) {
    return { error: 'Tables are too large for this block at the chosen spacing.' };
  }

  const viewpointAngleDeg = resolveDiningViewpointAngleDeg(element, rect);
  const thetaDeg = viewpointAngleDeg;
  const rad = (thetaDeg * Math.PI) / 180;
  const dirX = Math.sin(rad);
  const dirY = -Math.cos(rad);
  const perpX = Math.cos(rad);
  const perpY = Math.sin(rad);

  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;

  const subs = getDiningFeatureSubtractions(element);
  const blockLengthM = resolveBlockLengthM(element);
  const blockWidthM = resolveBlockWidthM(element);
  const ppm = pxPerMeter(rect, blockLengthM, blockWidthM);

  const netLength = Math.max(0.1, blockLengthM - subs.topSubtract - subs.bottomSubtract);
  const netWidth = Math.max(0.1, blockWidthM - subs.leftSubtract - subs.rightSubtract);

  const netLengthPx = netLength * ppm;
  const netWidthPx = netWidth * ppm;
  const u_center_offset = ((subs.leftSubtract - subs.rightSubtract) / 2) * ppm;
  const v_center_offset = ((subs.topSubtract - subs.bottomSubtract) / 2) * ppm;

  const xs = spreadCentroidsInSpan(columns, netWidthPx).map(x => x - netWidthPx / 2);
  const ys = spreadCentroidsInSpan(rows, netLengthPx).map(y => y - netLengthPx / 2);

  const tables: DiningTableSpec[] = [];
  let index = 0;
  const routeClearanceM = Math.max(
    element.diningServiceRouteClearanceM ?? 0,
    DINING_FEATURE_TABLE_CLEARANCE_M,
  );
  const tableRadiusM = shape === 'rectangular' ? Math.max(widthM, depthM) / 2 : widthM / 2;
  const visualHalf = diningTableVisualHalfExtentsM(shape, widthM, depthM, seats, {
    widthM: resolveChairWidthM(element),
    depthM: resolveChairLengthM(element),
  });
  const halfWidthPx = visualHalf.halfWidthM * ppm;
  const halfDepthPx = visualHalf.halfDepthM * ppm;

  const stepX = xs.length > 1 ? (xs[1] - xs[0]) : 0;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      let u = xs[col] + u_center_offset;
      const v = ys[row] + v_center_offset;

      if (template === 'staggered' && row % 2 === 1) {
        u += stepX / 2;
      }

      // Project grid offsets from center using the stage viewpoint orientation
      const posX = cx + u * perpX + v * dirX;
      const posY = cy + u * perpY + v * dirY;

      const tableRotationDeg = resolveTableRotationFacingStage(
        posX,
        posY,
        element,
        rect,
        viewpointAngleDeg,
      );

      if (template === 'banquet') {
        const dist = Math.sqrt((posX - cx) ** 2 + (posY - cy) ** 2);
        const danceFloorRadius = Math.min(rect.width, rect.height) * 0.25;
        if (dist < danceFloorRadius) {
          continue;
        }
      }

      // Check inside polygon with table rotation
      if (!isTableInsidePolygon(posX, posY, halfWidthPx, halfDepthPx, tableRotationDeg, polygon)) {
        continue;
      }

      // 1. Stage, food prep & exit — keep 0.1 m clearance from table footprint
      if (isTableOverlappingDiningFeatures(posX, posY, halfWidthPx, halfDepthPx, element, rect, tableRotationDeg)) {
        continue;
      }

      const canvasPoint = { x: posX, y: posY };
      const pct = canvasPointToElementPct(canvasPoint, rect);

      // 2. Service routes — keep 0.1 m clearance from table edge
      if (isTableOverlappingServiceRoutesM(pct.xPct, pct.yPct, tableRadiusM, routeClearanceM, element)) {
        continue;
      }
      tables.push({
        id: nextTableId(),
        label: tableLabel(index),
        xPct: pct.xPct,
        yPct: pct.yPct,
        shape,
        seats,
        widthM,
        depthM: shape === 'rectangular' ? depthM : undefined,
        rotationDeg: tableRotationDeg,
      });
      index += 1;
    }
  }

  let finalTables = tables;
  const requestedCount =
    options.tableCount != null && options.tableCount > 0
      ? Math.max(1, Math.round(options.tableCount))
      : null;
  if (requestedCount != null) {
    finalTables = tables.slice(0, requestedCount);
  }

  if (finalTables.length === 0) {
    return { error: 'No table positions fit inside the block outline. Try smaller tables or less spacing.' };
  }
  // Exact table count from wizard Step 4 — do not silently under-fill.
  if (requestedCount != null && finalTables.length < requestedCount) {
    return {
      error: `Could only place ${finalTables.length} of ${requestedCount} tables with these measurements. Reduce count, table size, or spacing.`,
    };
  }

  return {
    diningTables: finalTables,
    tableGridMode: true,
    tableGridRows: rows,
    tableGridColumns: columns,
    tablePlacementMode: undefined,
    defaultDiningTableShape: shape,
    defaultTableSeats: seats,
    defaultTableWidthM: widthM,
    defaultTableDepthM: depthM,
    defaultTableGapM: gapM,
    blockViewpointAngleDeg: viewpointAngleDeg,
  };
}

function isTableInsidePolygon(
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  rotationDeg: number,
  polygon: { x: number; y: number }[]
): boolean {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const corners = [
    { dx: -halfW, dy: -halfH },
    { dx: halfW, dy: -halfH },
    { dx: halfW, dy: halfH },
    { dx: -halfW, dy: halfH },
  ];

  for (const c of corners) {
    const px = cx + c.dx * cos - c.dy * sin;
    const py = cy + c.dx * sin + c.dy * cos;
    if (!pointInPolygon({ x: px, y: py }, polygon)) {
      return false;
    }
  }

  if (!pointInPolygon({ x: cx, y: cy }, polygon)) {
    return false;
  }

  return true;
}

/**
 * Places an exact number of tables in a grid using the requested centre-to-centre spacing.
 */
export function createTableCountGrid(
  element: CenterpieceElement,
  rect: PixelRect,
  options: TableCountGridOptions,
): Partial<CenterpieceElement> | { error: string } {
  const polygon = blockPolygon(element, rect);
  if (polygon.length < 3) {
    return { error: 'Block outline is not valid.' };
  }

  const shape = options.shape;
  const requestedWidthM = Math.max(0.1, options.widthM);
  const requestedDepthM = Math.max(0.1, options.depthM);
  // Exact chairs-per-table from wizard Step 5 (UI already caps to max fit).
  const seats = Math.max(1, Math.min(MAX_TABLE_CHAIRS_ABSOLUTE, Math.round(options.seats)));
  const edgeGapM = Math.max(0, options.gapM);
  const requestedCount = Math.max(1, Math.min(500, Math.round(options.tableCount)));

  const layout = computeTableCountGridLayout(element, {
    shape,
    widthM: requestedWidthM,
    depthM: requestedDepthM,
    gapM: edgeGapM,
    tableCount: requestedCount,
    seats,
  });
  if ('error' in layout) {
    return { error: layout.error };
  }

  let widthM = layout.effectiveWidthM;
  let depthM = layout.effectiveDepthM;
  const { rows, columns, tableCount, blockLengthM, blockWidthM } = layout;
  const viewpointAngleDeg = resolveDiningViewpointAngleDeg(element, rect);

  const tryPlace = (
    tableWidthM: number,
    tableDepthM: number,
  ): DiningTableSpec[] | null => {
    const ppm = pxPerMeter(rect, blockLengthM, blockWidthM);
    const gapPx = edgeGapM * ppm;
    const visualHalf = diningTableVisualHalfExtentsM(shape, tableWidthM, tableDepthM, seats, {
      widthM: resolveChairWidthM(element),
      depthM: resolveChairLengthM(element),
    });
    const visualWidthPx = visualHalf.halfWidthM * 2 * ppm;
    const visualDepthPx = visualHalf.halfDepthM * 2 * ppm;

    const xs = spreadCentroidsWithEdgeGap(columns, rect.width, gapPx, visualWidthPx);
    const ys = spreadCentroidsWithEdgeGap(rows, rect.height, gapPx, visualDepthPx);
    if (!xs || !ys) {
      return null;
    }

    const tables: DiningTableSpec[] = [];
    const routeClearanceM = Math.max(
      element.diningServiceRouteClearanceM ?? 0,
      DINING_FEATURE_TABLE_CLEARANCE_M,
    );
    const hasRoutes = (element.diningServiceRoutes ?? []).length > 0;
    const tableRadiusM = shape === 'rectangular' ? Math.max(tableWidthM, tableDepthM) / 2 : tableWidthM / 2;

    for (let row = 0; row < rows && tables.length < tableCount; row += 1) {
      for (let col = 0; col < columns && tables.length < tableCount; col += 1) {
        const canvasPoint = { x: rect.x + xs[col], y: rect.y + ys[row] };
        const halfWidthPx = visualHalf.halfWidthM * ppm;
        const halfDepthPx = visualHalf.halfDepthM * ppm;
        if (
          !visualBBoxInsidePolygon(
            canvasPoint.x,
            canvasPoint.y,
            halfWidthPx,
            halfDepthPx,
            polygon,
          )
        ) {
          continue;
        }

        // 1. Stage, food prep & exit — keep 0.1 m clearance from table footprint
        if (isTableOverlappingDiningFeatures(canvasPoint.x, canvasPoint.y, halfWidthPx, halfDepthPx, element, rect)) {
          continue;
        }

        const pct = canvasPointToElementPct(canvasPoint, rect);

        // 2. Service routes — keep 0.1 m clearance from table edge
        if (isTableOverlappingServiceRoutesM(pct.xPct, pct.yPct, tableRadiusM, routeClearanceM, element)) {
          continue;
        }
        tables.push({
          id: nextTableId(),
          label: tableLabel(tables.length),
          xPct: pct.xPct,
          yPct: pct.yPct,
          shape,
          seats,
          widthM: tableWidthM,
          depthM: shape === 'rectangular' ? tableDepthM : undefined,
          rotationDeg: resolveTableRotationFacingStage(
            canvasPoint.x,
            canvasPoint.y,
            element,
            rect,
            viewpointAngleDeg,
          ),
        });
      }
    }
    return tables.length === tableCount ? tables : null;
  };

  let tables = tryPlace(widthM, depthM);
  for (let attempt = 0; !tables && attempt < 24; attempt += 1) {
    widthM *= 0.94;
    depthM *= 0.94;
    if (widthM < MIN_TABLE_SIZE_M || (shape === 'rectangular' && depthM < MIN_TABLE_SIZE_M)) {
      break;
    }
    tables = tryPlace(widthM, depthM);
  }

  if (!tables) {
    return {
      error: `Could not fit all ${tableCount} tables fully inside the block with ${edgeGapM} m gaps. Try fewer tables or less spacing.`,
    };
  }

  return {
    diningTables: tables,
    tableGridMode: true,
    tableGridRows: rows,
    tableGridColumns: columns,
    tablePlacementMode: undefined,
    defaultDiningTableShape: shape,
    defaultTableSeats: seats,
    defaultTableWidthM: widthM,
    defaultTableDepthM: depthM,
    defaultTableGapM: edgeGapM,
    blockViewpointAngleDeg: viewpointAngleDeg,
  };
}

/** @deprecated Use createAutoTableGrid — kept for callers passing explicit row/col counts. */
export function createTableGrid(
  element: CenterpieceElement,
  rect: PixelRect,
  rows: number,
  columns: number,
  options?: {
    shape?: DiningTableShape;
    seats?: number;
    widthM?: number;
    depthM?: number;
    gapM?: number;
  },
): Partial<CenterpieceElement> {
  const shape = options?.shape ?? resolveDefaultTableShape(element);
  const result = createAutoTableGrid(element, rect, {
    shape,
    seats: options?.seats ?? resolveDefaultTableSeats(element),
    widthM: options?.widthM ?? resolveDefaultTableWidthM(element),
    depthM: options?.depthM ?? resolveDefaultTableDepthM(element),
    gapM: options?.gapM ?? resolveDefaultTableGapM(element),
  });
  if ('error' in result) {
    return {};
  }
  return {
    ...result,
    tableGridRows: Math.max(1, Math.min(50, Math.round(rows))),
    tableGridColumns: Math.max(1, Math.min(50, Math.round(columns))),
  };
}

export function removeAllTables(element: CenterpieceElement): Partial<CenterpieceElement> {
  return {
    diningTables: undefined,
    tablePlacementMode: undefined,
    tableGridMode: undefined,
    tableGridRows: undefined,
    tableGridColumns: undefined,
    appliedDiningLayoutTemplateId: undefined,
  };
}

export function deleteTable(
  element: CenterpieceElement,
  tableId: string,
): Partial<CenterpieceElement> {
  const tables = (element.diningTables ?? []).filter((t) => t.id !== tableId);
  if (tables.length === (element.diningTables?.length ?? 0)) {
    return {};
  }
  return { diningTables: tables.length > 0 ? tables : undefined };
}

export function updateTable(
  element: CenterpieceElement,
  tableId: string,
  patch: Partial<Pick<DiningTableSpec, 'seats' | 'shape' | 'widthM' | 'depthM' | 'label' | 'accessCategory'>>,
): Partial<CenterpieceElement> {
  const tables = element.diningTables ?? [];
  const index = tables.findIndex((t) => t.id === tableId);
  if (index < 0) {
    return {};
  }
  const current = tables[index];
  const nextShape = patch.shape ?? current.shape;
  const nextWidthM = patch.widthM ?? current.widthM;
  const nextDepthM =
    nextShape === 'rectangular'
      ? patch.depthM ?? current.depthM ?? resolveDefaultTableDepthM(element)
      : undefined;
  const updated: DiningTableSpec = {
    ...current,
    ...patch,
    widthM: nextWidthM,
    depthM: nextDepthM,
    seats: clampTableSeats(patch.seats ?? current.seats, element, {
      shape: nextShape,
      widthM: nextWidthM,
      depthM: nextDepthM ?? nextWidthM,
    }),
  };
  const next = [...tables];
  next[index] = updated;
  return { diningTables: next };
}

export function moveTableToPoint(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  tableId: string,
  canvasPct: ElementPosition,
): Partial<CenterpieceElement> {
  const polygon = blockPolygon(element, rect);
  if (polygon.length < 3) {
    return {};
  }
  const canvasPoint = canvasPctToCanvasPoint(canvasPct, canvas);
  let placement = canvasPoint;
  if (!pointInPolygon(placement, polygon)) {
    placement = clampPointInsidePolygon(placement, polygon);
    if (!pointInPolygon(placement, polygon)) {
      return {};
    }
  }
  const pct = canvasPointToElementPct(placement, rect);
  const tables = element.diningTables ?? [];
  const index = tables.findIndex((t) => t.id === tableId);
  if (index < 0) {
    return {};
  }
  const next = [...tables];
  next[index] = { ...next[index], xPct: pct.xPct, yPct: pct.yPct };
  return { diningTables: next };
}

/** Visual outer radius (m) from table centre — includes chair arcs. */
export function diningTableOuterRadiusM(
  element: CenterpieceElement,
  table: Pick<DiningTableSpec, 'shape' | 'widthM' | 'depthM' | 'seats'>,
): number {
  const shape = table.shape;
  const widthM = Math.max(0.1, table.widthM);
  const depthM =
    shape === 'rectangular'
      ? Math.max(0.1, table.depthM ?? resolveDefaultTableDepthM(element))
      : widthM;
  const half = diningTableVisualHalfExtentsM(shape, widthM, depthM, table.seats, {
    widthM: resolveChairWidthM(element),
    depthM: resolveChairLengthM(element),
  });
  return Math.max(half.halfWidthM, half.halfDepthM);
}

export interface TableGapViolation {
  otherTableId: string;
  otherLabel: string;
  /** Required clear edge gap (m) from the table-gap setting. */
  requiredGapM: number;
  /** Actual clear edge gap between the two table footprints (m). */
  actualGapM: number;
}

/**
 * True when a candidate table position keeps less than the configured table gap
 * (clear space between visual footprints) from any other table.
 */
export function findTableGapViolation(
  element: CenterpieceElement,
  candidate: {
    tableId: string;
    xPct: number;
    yPct: number;
    shape?: DiningTableShape;
    widthM?: number;
    depthM?: number;
    seats?: number;
  },
  gapM: number = resolveDefaultTableGapM(element),
): TableGapViolation | null {
  const tables = element.diningTables ?? [];
  if (tables.length === 0) {
    return null;
  }
  const requiredGapM = Math.max(0, gapM);
  const blockWidthM = resolveBlockWidthM(element);
  const blockLengthM = resolveBlockLengthM(element);
  const self =
    tables.find((t) => t.id === candidate.tableId) ??
    ({
      id: candidate.tableId,
      label: 'New table',
      shape: candidate.shape ?? resolveDefaultTableShape(element),
      widthM: candidate.widthM ?? resolveDefaultTableWidthM(element),
      depthM: candidate.depthM ?? resolveDefaultTableDepthM(element),
      seats: candidate.seats ?? resolveDefaultTableSeats(element),
      xPct: candidate.xPct,
      yPct: candidate.yPct,
    } as DiningTableSpec);

  const selfShape = candidate.shape ?? self.shape;
  const selfWidthM = candidate.widthM ?? self.widthM;
  const selfDepthM = candidate.depthM ?? self.depthM;
  const selfSeats = candidate.seats ?? self.seats;
  const selfR = diningTableOuterRadiusM(element, {
    shape: selfShape,
    widthM: selfWidthM,
    depthM: selfDepthM,
    seats: selfSeats,
  });
  const selfX = (candidate.xPct / 100) * blockWidthM;
  const selfY = (candidate.yPct / 100) * blockLengthM;

  let worst: TableGapViolation | null = null;
  for (const other of tables) {
    if (other.id === candidate.tableId) {
      continue;
    }
    const otherR = diningTableOuterRadiusM(element, other);
    const otherX = (other.xPct / 100) * blockWidthM;
    const otherY = (other.yPct / 100) * blockLengthM;
    const centerDist = Math.hypot(selfX - otherX, selfY - otherY);
    const actualGapM = centerDist - selfR - otherR;
    if (actualGapM + 1e-6 < requiredGapM) {
      if (!worst || actualGapM < worst.actualGapM) {
        worst = {
          otherTableId: other.id,
          otherLabel: other.label?.trim() || 'another table',
          requiredGapM,
          actualGapM: Math.max(0, actualGapM),
        };
      }
    }
  }
  return worst;
}

export function formatTableGapViolationMessage(violation: TableGapViolation): string {
  return (
    `Tables too close — keep at least ${violation.requiredGapM} m gap ` +
    `(your table gap setting). Clear space to "${violation.otherLabel}" is only ` +
    `${violation.actualGapM.toFixed(2)} m.`
  );
}

export function distanceFromPointToServiceRoutesM(
  xPct: number,
  yPct: number,
  element: CenterpieceElement,
): number {
  const routes = element.diningServiceRoutes ?? [];
  if (routes.length === 0) {
    return Infinity;
  }
  const blockWidthM = resolveBlockWidthM(element);
  const blockLengthM = resolveBlockLengthM(element);

  const px = (xPct / 100) * blockWidthM;
  const py = (yPct / 100) * blockLengthM;

  let minDistance = Infinity;

  for (const route of routes) {
    if (!route.points || route.points.length < 2) {
      continue;
    }
    for (let i = 0; i < route.points.length - 1; i++) {
      const p1 = route.points[i];
      const p2 = route.points[i + 1];

      const x1 = (p1.xPct / 100) * blockWidthM;
      const y1 = (p1.yPct / 100) * blockLengthM;
      const x2 = (p2.xPct / 100) * blockWidthM;
      const y2 = (p2.yPct / 100) * blockLengthM;

      const dist = distToSegment(px, py, x1, y1, x2, y2);
      if (dist < minDistance) {
        minDistance = dist;
      }
    }
  }

  return minDistance;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) {
    return Math.hypot(px - x1, py - y1);
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function isTableOverlappingStage(
  tx: number,
  ty: number,
  thw: number,
  thh: number,
  stage: { x: number; y: number; widthPx: number; heightPx: number; rotationDeg: number },
  tableRotationDeg: number = 0,
  clearancePx: number = 0,
): boolean {
  const rad = (stage.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const shw = stage.widthPx / 2 + clearancePx;
  const shh = stage.heightPx / 2 + clearancePx;
  
  const stagePolygon = [
    { x: stage.x - shw * cos + shh * sin, y: stage.y - shw * sin - shh * cos },
    { x: stage.x + shw * cos + shh * sin, y: stage.y + shw * sin - shh * cos },
    { x: stage.x + shw * cos - shh * sin, y: stage.y + shw * sin + shh * cos },
    { x: stage.x - shw * cos - shh * sin, y: stage.y - shw * sin + shh * cos },
  ];

  if (pointInPolygon({ x: tx, y: ty }, stagePolygon)) {
    return true;
  }

  const tableRad = (tableRotationDeg * Math.PI) / 180;
  const tcos = Math.cos(tableRad);
  const tsin = Math.sin(tableRad);

  const tableCorners = [
    { x: tx - thw * tcos + thh * tsin, y: ty - thw * tsin - thh * tcos },
    { x: tx + thw * tcos + thh * tsin, y: ty + thw * tsin - thh * tcos },
    { x: tx + thw * tcos - thh * tsin, y: ty + thw * tsin + thh * tcos },
    { x: tx - thw * tcos - thh * tsin, y: ty - thw * tsin + thh * tcos },
  ];
  for (const corner of tableCorners) {
    if (pointInPolygon(corner, stagePolygon)) {
      return true;
    }
  }

  if (pointInPolygon({ x: stage.x, y: stage.y }, tableCorners)) {
    return true;
  }

  return false;
}

/** True when a table is within DINING_FEATURE_TABLE_CLEARANCE_M of stage, food prep, or exit. */
function isTableOverlappingDiningFeatures(
  tx: number,
  ty: number,
  thw: number,
  thh: number,
  element: CenterpieceElement,
  rect: PixelRect,
  tableRotationDeg: number = 0,
): boolean {
  const ppm = pxPerMeter(rect, resolveBlockLengthM(element), resolveBlockWidthM(element));
  const clearancePx = DINING_FEATURE_TABLE_CLEARANCE_M * ppm;

  if (hasDiningStage(element)) {
    const stageNode = buildDiningStageRenderNode(element, rect, false);
    if (stageNode) {
      if (isTableOverlappingStage(tx, ty, thw, thh, stageNode, tableRotationDeg, clearancePx)) {
        return true;
      }
    }
  }

  if (hasDiningFoodPrepare(element)) {
    const fpNode = buildDiningFoodPrepareRenderNode(element, rect, false);
    if (fpNode) {
      if (isTableOverlappingStage(tx, ty, thw, thh, fpNode, tableRotationDeg, clearancePx)) {
        return true;
      }
    }
  }

  for (const accessNode of diningAccessClearanceNodes(element, rect)) {
    if (isTableOverlappingStage(tx, ty, thw, thh, accessNode, tableRotationDeg, clearancePx)) {
      return true;
    }
  }

  return false;
}

export function isTableOverlappingServiceRoutesM(
  xPct: number,
  yPct: number,
  tableRadiusM: number,
  clearanceM: number,
  element: CenterpieceElement,
): boolean {
  const routes = element.diningServiceRoutes ?? [];
  if (routes.length === 0) {
    return false;
  }
  const blockWidthM = resolveBlockWidthM(element);
  const blockLengthM = resolveBlockLengthM(element);

  const px = (xPct / 100) * blockWidthM;
  const py = (yPct / 100) * blockLengthM;
  const effectiveClearanceM = Math.max(clearanceM, DINING_FEATURE_TABLE_CLEARANCE_M);

  for (const route of routes) {
    if (!route.points || route.points.length < 2) {
      continue;
    }
    const routeHalfWidthM = (route.widthM ?? 1.0) / 2;
    const requiredDistanceM = tableRadiusM + routeHalfWidthM + effectiveClearanceM;

    for (let i = 0; i < route.points.length - 1; i++) {
      const p1 = route.points[i];
      const p2 = route.points[i + 1];

      const x1 = (p1.xPct / 100) * blockWidthM;
      const y1 = (p1.yPct / 100) * blockLengthM;
      const x2 = (p2.xPct / 100) * blockWidthM;
      const y2 = (p2.yPct / 100) * blockLengthM;

      const dist = distToSegment(px, py, x1, y1, x2, y2);
      if (dist < requiredDistanceM) {
        return true;
      }
    }
  }

  return false;
}

function aabbOverlapM(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/** Axis-aligned bounds of a metre-space rectangle after rotation about its centre. */
export function rotatedFeatureAabbM(
  cx: number,
  cy: number,
  widthM: number,
  depthM: number,
  rotationDeg: number,
  clearanceM = 0,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const hw = widthM / 2 + clearanceM;
  const hd = depthM / 2 + clearanceM;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    { dx: -hw, dy: -hd },
    { dx: hw, dy: -hd },
    { dx: hw, dy: hd },
    { dx: -hw, dy: hd },
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    const x = cx + c.dx * cos - c.dy * sin;
    const y = cy + c.dx * sin + c.dy * cos;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Full-side strip subtraction only when the feature is still flush with its wall.
 * Free-rotated stages must not wipe an entire wall band — that under-counts tables.
 */
export function diningFeatureEdgeStripApplies(
  element: CenterpieceElement,
  spec: {
    sideEdgeId?: number;
    alignment?: string;
    rotationDeg?: number;
  },
  canvas: { width: number; height: number } = { width: 1000, height: 800 },
): boolean {
  if (spec.sideEdgeId == null || (spec.alignment ?? 'edge') !== 'edge') {
    return false;
  }
  if (spec.rotationDeg == null || !Number.isFinite(spec.rotationDeg)) {
    return true;
  }
  const rect = rectFromPositionSize(element.position, element.size, canvas);
  const edgeDeg = diningFeatureRotationDeg(element, rect, spec.sideEdgeId);
  const delta = Math.abs(
    normalizeDiningFeatureRotationDeg(spec.rotationDeg) -
      normalizeDiningFeatureRotationDeg(edgeDeg),
  );
  const shortest = Math.min(delta, 360 - delta);
  return shortest <= 5;
}

/** Actual 2D blocked rectangles for anchored Stage / Food Prep / access — including centre placements. */
export function anchoredFeatureAabbsM(
  element: CenterpieceElement,
  clearanceM = 0.8,
): { minX: number; minY: number; maxX: number; maxY: number }[] {
  const widthM = resolveBlockWidthM(element);
  const lengthM = resolveBlockLengthM(element);
  const rect = rectFromPositionSize(element.position, element.size, { width: 1000, height: 800 });
  const boxes: { minX: number; minY: number; maxX: number; maxY: number }[] = [];
  const push = (
    spec:
      | {
          xPct?: number;
          yPct?: number;
          widthM?: number;
          depthM?: number;
          sideEdgeId?: number;
          rotationDeg?: number;
        }
      | undefined,
  ) => {
    if (!spec || spec.xPct == null || spec.yPct == null || spec.widthM == null || spec.depthM == null) {
      return;
    }
    const cx = (spec.xPct / 100) * widthM;
    const cy = (spec.yPct / 100) * lengthM;
    const rotationDeg = resolveDiningFeatureRotationDeg(element, rect, spec);
    boxes.push(rotatedFeatureAabbM(cx, cy, spec.widthM, spec.depthM, rotationDeg, clearanceM));
  };
  push(element.diningStage);
  push(element.diningFoodPrepare);
  push(element.diningEntrance);
  push(element.diningExit);
  push(element.diningSharedAccessPoint);
  return boxes;
}

export function getDiningFeatureSubtractions(
  element: CenterpieceElement,
  clearanceM = 0.1,
): {
  topSubtract: number;
  bottomSubtract: number;
  leftSubtract: number;
  rightSubtract: number;
} {
  let topSubtract = 0;
  let bottomSubtract = 0;
  let leftSubtract = 0;
  let rightSubtract = 0;

  const clearance = clearanceM;

  const applyEdgeStrip = (
    spec:
      | {
          sideEdgeId?: number;
          depthM?: number;
          alignment?: string;
          rotationDeg?: number;
        }
      | undefined,
  ): void => {
    if (!spec || spec.sideEdgeId == null || spec.depthM == null) {
      return;
    }
    if (!diningFeatureEdgeStripApplies(element, spec)) {
      return;
    }
    const side = spec.sideEdgeId;
    const depth = spec.depthM;
    if (side === 0) topSubtract = Math.max(topSubtract, depth + clearance);
    else if (side === 2) bottomSubtract = Math.max(bottomSubtract, depth + clearance);
    else if (side === 3) leftSubtract = Math.max(leftSubtract, depth + clearance);
    else if (side === 1) rightSubtract = Math.max(rightSubtract, depth + clearance);
  };

  applyEdgeStrip(element.diningStage);
  applyEdgeStrip(element.diningFoodPrepare);
  applyEdgeStrip(element.diningExit);
  applyEdgeStrip(element.diningEntrance);
  applyEdgeStrip(element.diningSharedAccessPoint);

  return { topSubtract, bottomSubtract, leftSubtract, rightSubtract };
}
