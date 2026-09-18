/**
 * Bulk seating import — turns one parsed file row into an element patch:
 * auto VIEW POINT facing the pitch, CSV chair/gap/border metres applied
 * identically, seats placed at those exact metres with the arrange-by-row engine.
 */

import { PixelRect } from './geometry';
import { buildBlockMeasureEdges, stadiumLogicalEdgeFromView, stadiumLogicalEdgesFacingDirection, uniqueLogicalEdgesById } from './block-measure-edges';
import { viewpointAngleFromCanvasPoint } from './block-viewpoint';
import { defaultLabelOffsetOutsideViewpoint, hasCustomLabelOffset } from './block-label';
import { getSeatLayoutRowSeatCounts, seatId } from './block-seat-layout';
import { rowLabel } from './seat-layout';
import {
  computePxPerMetre,
  createArrangeByRowGridSeating,
  type ArrangeByRowBlueprintScale,
} from './drag-seats';
import { collectAdjacentBlocks } from './row-seat-align';
import type { PhysicalDimsInput } from './custom-shape-seats';
import type { SeatingImportRow } from './parse-seating-import-file';
import {
  applyAutoFillBlockCurve,
  applyAutoFillCurveToSeatLayout,
  clampAutoFillCurveDeg,
  resolveAutoFillAislePlacement,
} from './auto-fill-seating';
import { DEFAULT_AUTO_FILL_SEATING_CONFIG } from '../models/auto-fill-seating.model';
import {
  CanvasConfig,
  CenterpieceElement,
  CustomShapeSeatPosition,
  ElementPosition,
  LayoutElement,
  SeatLayoutSpec,
} from '../models/layout-element.model';

export interface ImportSeatingPlan {
  patch: Partial<CenterpieceElement>;
  seatsPlaced: number;
  rowsPlaced: number;
  /** Seats removed from the tail rows to honour the requested capacity. */
  trimmedSeats: number;
  viewpointAngleDeg: number;
  warning?: string;
  /**
   * Set when the document explicitly asked for N seats per row (columns or
   * row_seats) but the block shape fits fewer in some rows. Seat sizes are
   * never shrunk to force the count — the caller decides: fill what fits or skip.
   */
  shortfall?: string;
  /** Total seats the document asked for (only when explicit per-row targets exist). */
  requestedSeats?: number;
  /** Rows that fit fewer seats than requested, for UI breakdown. */
  shortfallRows?: { row: string; placed: number; requested: number }[];
}

export interface ImportSeatingError {
  error: string;
}

interface CanvasPoint {
  x: number;
  y: number;
}

/** Fallback outline for plain (non-traced) blocks — the full element box. */
const RECT_OUTLINE: ElementPosition[] = [
  { xPct: 0, yPct: 0 },
  { xPct: 100, yPct: 0 },
  { xPct: 100, yPct: 100 },
  { xPct: 0, yPct: 100 },
];

/** How many times the metre scale is inflated when rows don't fit the traced shape. */
const MAX_SCALE_ATTEMPTS = 4;
/**
 * The seat engine keeps seats clear of the block border (~0.72 × pitch per
 * side: 0.42 seat radius + 0.3 air gap). Folded into the pixel scale so the
 * CSV grid fits — chair metres from the file are never rewritten.
 */
const PADDING_ALLOWANCE = 1.55;

function outlinePoints(el: CenterpieceElement): ElementPosition[] {
  return el.customPoints && el.customPoints.length >= 3 ? el.customPoints : RECT_OUTLINE;
}

function toCanvasPolygon(points: ElementPosition[], rect: PixelRect): CanvasPoint[] {
  return points.map((p) => ({
    x: rect.x + (p.xPct / 100) * rect.width,
    y: rect.y + (p.yPct / 100) * rect.height,
  }));
}

/** Deepest polygon vertex measured perpendicular from the stadium-edge line. */
function polygonDepthPx(
  polygon: CanvasPoint[],
  edge: { x1: number; y1: number; x2: number; y2: number },
): number {
  const dx = edge.x2 - edge.x1;
  const dy = edge.y2 - edge.y1;
  const len = Math.hypot(dx, dy) || 1;
  let depth = 0;
  for (const p of polygon) {
    const dist = Math.abs((p.x - edge.x1) * dy - (p.y - edge.y1) * dx) / len;
    depth = Math.max(depth, dist);
  }
  return Math.max(depth, 1);
}

/** n seats of `itemM` with `gapM` between, plus margins on both ends. */
function spanForCount(count: number, itemM: number, gapM: number, marginM: number): number {
  const n = Math.max(1, count);
  return n * itemM + (n - 1) * Math.max(0, gapM) + 2 * Math.max(0, marginM);
}

function roundDimM(value: number, min = 0): number {
  return Math.round(Math.max(min, value) * 1000) / 1000;
}

function explicitMetres(value: number | undefined, allowZero: boolean): number | undefined {
  if (value == null || !Number.isFinite(value)) {
    return undefined;
  }
  if (allowZero) {
    return value >= 0 ? value : undefined;
  }
  return value > 0 ? value : undefined;
}

/**
 * Split a pitch into item + gap using structure weights. Used only when the
 * CSV omitted that axis so we do not fall back to hardcoded chair sizes.
 */
function splitPitch(pitchM: number, itemWeight: number, gapWeight: number, hasGaps: boolean): {
  itemM: number;
  gapM: number;
} {
  const itemW = Math.max(0.001, itemWeight);
  const gapW = hasGaps ? Math.max(0, gapWeight) : 0;
  const denom = itemW + gapW;
  return {
    itemM: roundDimM((pitchM * itemW) / denom, 0.05),
    gapM: hasGaps ? roundDimM((pitchM * gapW) / denom, 0) : 0,
  };
}

export interface DerivedImportSpacing {
  chairWidthM: number;
  chairLengthM: number;
  seatGapM: number;
  rowGapM: number;
  edgeMarginM: number;
}

/** Fit omitted dimensions to the remaining block space (CSV values stay exact). */
function fitOmittedSpacing(
  availableWidthM: number,
  availableDepthM: number,
  rows: number,
  cols: number | undefined,
  aisleAlongM: number,
  aisleDepthM: number,
  edgePx?: number,
  depthPx?: number,
): DerivedImportSpacing {
  const rowCount = Math.max(1, rows);
  const colCount = Math.max(1, cols ?? 1);
  const usableW = Math.max(0.1, availableWidthM - Math.max(0, aisleAlongM));
  const usableD = Math.max(0.1, availableDepthM - Math.max(0, aisleDepthM));
  const cwW = colCount;
  const sgW = cwW / colCount;
  const cdW = rowCount;
  const rgW = cdW / rowCount;
  const bdW = Math.min(sgW, rgW) || 1;
  const colDenom = colCount * cwW + Math.max(0, colCount - 1) * sgW + 2 * bdW;
  const rowDenom = rowCount * cdW + Math.max(0, rowCount - 1) * rgW + 2 * bdW;
  const ppmX =
    edgePx != null && edgePx > 0 && availableWidthM > 0 ? edgePx / availableWidthM : 0;
  const ppmY =
    depthPx != null && depthPx > 0 && availableDepthM > 0 ? depthPx / availableDepthM : 0;

  let borderM: number;
  let along: { itemM: number; gapM: number };
  let depth: { itemM: number; gapM: number };
  if (ppmX > 0 && ppmY > 0 && edgePx != null && depthPx != null) {
    const usablePxW = Math.max(1, edgePx - Math.max(0, aisleAlongM) * ppmX);
    const usablePxD = Math.max(1, depthPx - Math.max(0, aisleDepthM) * ppmY);
    const borderPx = Math.min(
      usablePxW * (bdW / Math.max(0.001, colDenom)),
      usablePxD * (bdW / Math.max(0.001, rowDenom)),
    );
    borderM = roundDimM(borderPx / Math.max(ppmX, ppmY), 0);
    const innerPxW = Math.max(1, usablePxW - 2 * borderPx);
    const innerPxD = Math.max(1, usablePxD - 2 * borderPx);
    along = splitPitch(innerPxW / (colCount + PADDING_ALLOWANCE) / ppmX, cwW, sgW, colCount > 1);
    depth = splitPitch(innerPxD / (rowCount + PADDING_ALLOWANCE) / ppmY, cdW, rgW, rowCount > 1);
  } else {
    borderM = roundDimM(
      Math.min(usableW * (bdW / Math.max(0.001, colDenom)), usableD * (bdW / Math.max(0.001, rowDenom))),
      0,
    );
    along = splitPitch(
      Math.max(0.05, usableW - 2 * borderM) / (colCount + PADDING_ALLOWANCE),
      cwW,
      sgW,
      colCount > 1,
    );
    depth = splitPitch(
      Math.max(0.05, usableD - 2 * borderM) / (rowCount + PADDING_ALLOWANCE),
      cdW,
      rgW,
      rowCount > 1,
    );
  }

  if (cols == null) {
    return {
      chairWidthM: depth.itemM,
      chairLengthM: depth.itemM,
      seatGapM: depth.gapM,
      rowGapM: depth.gapM,
      edgeMarginM: borderM,
    };
  }
  return {
    chairWidthM: along.itemM,
    chairLengthM: depth.itemM,
    seatGapM: along.gapM,
    rowGapM: depth.gapM,
    edgeMarginM: borderM,
  };
}

/**
 * CSV metres are applied identically when present. Only omitted fields are
 * calculated from the row/column structure and remaining block space.
 */
export function deriveImportSpacingFromStructure(
  availableWidthM: number,
  availableDepthM: number,
  rows: number,
  cols: number | undefined,
  aisleAlongM: number,
  aisleDepthM: number,
  seeds: {
    chairWidthM?: number;
    chairLengthM?: number;
    seatGapM?: number;
    rowGapM?: number;
    edgeMarginM?: number;
  } = {},
  edgePx?: number,
  depthPx?: number,
): DerivedImportSpacing {
  const exact = {
    chairWidthM: explicitMetres(seeds.chairWidthM, false),
    chairLengthM: explicitMetres(seeds.chairLengthM, false),
    seatGapM: explicitMetres(seeds.seatGapM, true),
    rowGapM: explicitMetres(seeds.rowGapM, true),
    edgeMarginM: explicitMetres(seeds.edgeMarginM, true),
  };
  if (
    exact.chairWidthM != null &&
    exact.chairLengthM != null &&
    exact.seatGapM != null &&
    exact.rowGapM != null &&
    exact.edgeMarginM != null
  ) {
    return {
      chairWidthM: exact.chairWidthM,
      chairLengthM: exact.chairLengthM,
      seatGapM: exact.seatGapM,
      rowGapM: exact.rowGapM,
      edgeMarginM: exact.edgeMarginM,
    };
  }

  const fitted = fitOmittedSpacing(
    availableWidthM,
    availableDepthM,
    rows,
    cols,
    aisleAlongM,
    aisleDepthM,
    edgePx,
    depthPx,
  );
  return {
    chairWidthM: exact.chairWidthM ?? fitted.chairWidthM,
    chairLengthM: exact.chairLengthM ?? fitted.chairLengthM,
    seatGapM: exact.seatGapM ?? fitted.seatGapM,
    rowGapM: exact.rowGapM ?? fitted.rowGapM,
    edgeMarginM: exact.edgeMarginM ?? fitted.edgeMarginM,
  };
}

/**
 * Resolve the rows × columns target. Capacity-only rows get a grid whose aspect
 * follows the traced shape so the fill looks natural.
 */
function resolveGridTarget(
  row: SeatingImportRow,
  edgePx: number,
  depthPx: number,
): { rows: number; cols?: number } | null {
  if (row.rowSeatCounts && row.rowSeatCounts.length > 0) {
    // Per-row counts (row_seats column) — widest row drives the seat pitch.
    return { rows: row.rowSeatCounts.length, cols: Math.max(...row.rowSeatCounts) };
  }
  if (row.rows != null && row.seatsPerRow != null) {
    return { rows: row.rows, cols: row.seatsPerRow };
  }
  if (row.capacity != null && row.rows != null) {
    return { rows: row.rows, cols: Math.ceil(row.capacity / row.rows) };
  }
  if (row.capacity != null && row.seatsPerRow != null) {
    return { rows: Math.ceil(row.capacity / row.seatsPerRow), cols: row.seatsPerRow };
  }
  if (row.capacity != null) {
    const aspect = edgePx / Math.max(1, depthPx);
    const cols = Math.max(1, Math.min(row.capacity, Math.round(Math.sqrt(row.capacity * aspect))));
    return { rows: Math.max(1, Math.ceil(row.capacity / cols)), cols };
  }
  if (row.rows != null) {
    // Rows only — each row auto-fills the shape width.
    return { rows: row.rows };
  }
  return null;
}

/** Trim seats from the tail rows so the total matches the requested capacity. */
function trimToCapacity(
  patch: Partial<CenterpieceElement>,
  capacity: number,
): { trimmed: number; seats: number } {
  const layout = patch.seatLayout as SeatLayoutSpec | undefined;
  if (!layout) {
    return { trimmed: 0, seats: 0 };
  }
  const counts = [...getSeatLayoutRowSeatCounts(layout)];
  let total = counts.reduce((sum, c) => sum + c, 0);
  if (total <= capacity) {
    return { trimmed: 0, seats: total };
  }

  const style = layout.rowLabelStyle ?? 'letter';
  const overrides: Record<string, CustomShapeSeatPosition> = {
    ...(patch.seatPositionOverrides ?? {}),
  };
  let trimmed = 0;
  for (let rowIndex = counts.length - 1; rowIndex >= 0 && total > capacity; rowIndex -= 1) {
    while (counts[rowIndex] > 0 && total > capacity) {
      counts[rowIndex] -= 1;
      delete overrides[seatId(rowIndex, counts[rowIndex], style)];
      total -= 1;
      trimmed += 1;
    }
  }
  while (counts.length > 1 && counts[counts.length - 1] === 0) {
    counts.pop();
  }

  const seatsPerRow = Math.max(1, ...counts);
  patch.seatLayout = {
    ...layout,
    rows: counts.length,
    seatsPerRow,
    rowSeatCounts: counts,
  };
  patch.rows = counts.length;
  patch.seatsPerRow = seatsPerRow;
  patch.seatPositionOverrides = overrides;
  return { trimmed, seats: total };
}

/**
 * Trim rows that placed more seats than their per-row target, keeping the
 * centred seats so the row stays symmetric inside the shape.
 */
function trimRowsToTargets(patch: Partial<CenterpieceElement>, targets: number[]): void {
  const layout = patch.seatLayout as SeatLayoutSpec | undefined;
  if (!layout) {
    return;
  }
  const counts = [...getSeatLayoutRowSeatCounts(layout)];
  const style = layout.rowLabelStyle ?? 'letter';
  const overrides: Record<string, CustomShapeSeatPosition> = {
    ...(patch.seatPositionOverrides ?? {}),
  };
  let changed = false;

  for (let rowIndex = 0; rowIndex < counts.length; rowIndex += 1) {
    const targetCount = targets[rowIndex];
    if (targetCount == null || counts[rowIndex] <= targetCount) {
      continue;
    }
    const placed = counts[rowIndex];
    const rowPositions: (CustomShapeSeatPosition | undefined)[] = [];
    for (let k = 0; k < placed; k += 1) {
      const id = seatId(rowIndex, k, style);
      rowPositions.push(overrides[id]);
      delete overrides[id];
    }
    const start = Math.floor((placed - targetCount) / 2);
    for (let k = 0; k < targetCount; k += 1) {
      const pos = rowPositions[start + k];
      if (pos) {
        overrides[seatId(rowIndex, k, style)] = pos;
      }
    }
    counts[rowIndex] = targetCount;
    changed = true;
  }

  if (!changed) {
    return;
  }
  const seatsPerRow = Math.max(1, ...counts);
  patch.seatLayout = { ...layout, seatsPerRow, rowSeatCounts: counts };
  patch.seatsPerRow = seatsPerRow;
  patch.seatPositionOverrides = overrides;
}

/** Rows that fit fewer seats than the document asked for. */
function collectShortfallRows(
  placed: number[],
  targets: number[],
): { row: string; placed: number; requested: number }[] {
  const misses: { row: string; placed: number; requested: number }[] = [];
  for (let rowIndex = 0; rowIndex < targets.length; rowIndex += 1) {
    const got = placed[rowIndex] ?? 0;
    if (got < targets[rowIndex]) {
      misses.push({ row: rowLabel(rowIndex, 'letter'), placed: got, requested: targets[rowIndex] });
    }
  }
  return misses;
}

/** Human summary of shortfall rows, for report entries. */
function describeShortfall(
  misses: { row: string; placed: number; requested: number }[],
): string | undefined {
  if (misses.length === 0) {
    return undefined;
  }
  const sample = misses
    .slice(0, 3)
    .map((m) => `${m.row}: ${m.placed}/${m.requested}`)
    .join(', ');
  const more = misses.length > 3 ? ` +${misses.length - 3} more` : '';
  return `${misses.length} row${misses.length === 1 ? '' : 's'} fit fewer seats than the document asks (${sample}${more}).`;
}

/** Everything derived from one import row + its block, shared by scale + plan. */
interface ImportContext {
  points: ElementPosition[];
  polygon: CanvasPoint[];
  viewpointAngleDeg: number;
  seatingAngleDeg: number;
  stadiumEdge: { index: number; lengthPx: number; x1: number; y1: number; x2: number; y2: number };
  viewpointSideIndices: number[];
  edgePx: number;
  depthPx: number;
  chairWidthM: number;
  chairLengthM: number;
  seatGapM: number;
  rowGapM: number;
  edgeMarginM: number;
  /** CSV center/column aisle metres reserved across the seating width. */
  aisleAlongM: number;
  /** CSV center/row aisle metres reserved along block depth. */
  aisleDepthM: number;
  target: { rows: number; cols?: number };
  /** Per-row seat targets used for width sizing (explicit or uniform columns). */
  widthTargets: number[] | null;
  /** Explicit per-row expectations from the document — columns or row_seats. */
  strictTargets: number[] | null;
  availableWidthM: number;
  availableDepthM: number;
  sideLengthsM: number[];
}

function sumWidthsM(values: number[] | undefined): number {
  return (values ?? []).reduce((sum, width) => sum + Math.max(0, width), 0);
}

/** Walkway metres from the CSV aisle columns, split by axis. */
function csvAisleSpansM(row: SeatingImportRow): { alongM: number; depthM: number } {
  if (!row.aisles?.length) {
    return { alongM: 0, depthM: 0 };
  }
  const placement = resolveAutoFillAislePlacement({
    ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
    aisles: row.aisles,
  });
  if (!placement) {
    return { alongM: 0, depthM: 0 };
  }
  const alongM =
    sumWidthsM(placement.centerColumnAisleWidthsM) +
    (placement.columnAisleWidthM ?? 0) * (placement.aisleColumnIndices?.length ?? 0);
  const depthM =
    sumWidthsM(placement.centerRowAisleWidthsM) +
    (placement.rowAisleWidthM ?? 0) * (placement.aisleRowIndices?.length ?? 0);
  return { alongM, depthM };
}

function roundMetres(value: number): number {
  return Math.round(Math.max(0.1, value) * 100) / 100;
}

function sideLengthsFromPolygon(polygon: CanvasPoint[], perimeterM = 24): number[] {
  const pxLengths = polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
  const totalPx = pxLengths.reduce((sum, length) => sum + length, 0);
  if (totalPx <= 0) {
    return pxLengths.map(() => perimeterM / Math.max(1, pxLengths.length));
  }
  return pxLengths.map((length) => Math.max(0.1, (length / totalPx) * perimeterM));
}

/**
 * Side lengths for this block: saved measurements first, then venue scale,
 * then the traced/synthesised outline scaled to a default perimeter.
 */
function resolveImportSideLengthsM(
  el: CenterpieceElement,
  polygon: CanvasPoint[],
  venueMetresPerPx?: number,
): number[] {
  const stored = el.customSideLengthsM ?? [];
  if (stored.length >= polygon.length && stored.slice(0, polygon.length).every((len) => len > 0.05)) {
    return stored.slice(0, polygon.length);
  }
  if (venueMetresPerPx != null && venueMetresPerPx > 0) {
    return polygon.map((point, index) => {
      const next = polygon[(index + 1) % polygon.length];
      return Math.max(0.1, Math.hypot(next.x - point.x, next.y - point.y) * venueMetresPerPx);
    });
  }
  return sideLengthsFromPolygon(polygon);
}

/** Available seating width (along the VIEW POINT) and depth (into the block). */
function resolveAvailableImportSizeM(
  el: CenterpieceElement,
  rect: PixelRect,
  polygon: CanvasPoint[],
  edgePx: number,
  depthPx: number,
  venueMetresPerPx?: number,
): { widthM: number; depthM: number; sideLengthsM: number[] } {
  if (venueMetresPerPx != null && venueMetresPerPx > 0) {
    const sideLengthsM = polygon.map((point, index) => {
      const next = polygon[(index + 1) % polygon.length];
      return Math.max(0.1, Math.hypot(next.x - point.x, next.y - point.y) * venueMetresPerPx);
    });
    return {
      widthM: Math.max(0.1, edgePx * venueMetresPerPx),
      depthM: Math.max(0.1, depthPx * venueMetresPerPx),
      sideLengthsM,
    };
  }
  const sideLengthsM = resolveImportSideLengthsM(el, polygon);
  const ppm = Math.max(1e-6, computePxPerMetre(polygon, sideLengthsM));
  const storedWidth = el.physicalWidthM;
  const storedDepth = el.physicalLengthM;
  return {
    widthM:
      storedWidth != null && storedWidth > 0.05
        ? storedWidth
        : Math.max(0.1, edgePx / ppm),
    depthM:
      storedDepth != null && storedDepth > 0.05
        ? storedDepth
        : Math.max(0.1, depthPx / ppm),
    sideLengthsM,
  };
}

/**
 * Physical block size implied by the applied spacing: chairs + gaps + border + aisles.
 * Same CSV metres → same stored measurements; visual pitch follows those metres.
 */
function csvRecipeSizeM(
  ctx: ImportContext,
): { widthM: number; depthM: number } {
  const cols =
    ctx.target.cols ??
    (ctx.widthTargets && ctx.widthTargets.length > 0 ? Math.max(...ctx.widthTargets) : undefined);
  const widthM =
    (cols != null
      ? spanForCount(cols, ctx.chairWidthM, ctx.seatGapM, ctx.edgeMarginM)
      : spanForCount(1, ctx.chairWidthM, ctx.seatGapM, ctx.edgeMarginM)) + ctx.aisleAlongM;
  const depthM =
    spanForCount(ctx.target.rows, ctx.chairLengthM, ctx.rowGapM, ctx.edgeMarginM) +
    ctx.aisleDepthM;
  return { widthM, depthM };
}

/** Front/back (along the VIEW POINT edge) get recipe width; the other sides get recipe depth. */
function assignRecipeSideLengthsM(
  polygon: CanvasPoint[],
  stadiumEdge: { x1: number; y1: number; x2: number; y2: number },
  widthM: number,
  depthM: number,
): number[] {
  const ex = stadiumEdge.x2 - stadiumEdge.x1;
  const ey = stadiumEdge.y2 - stadiumEdge.y1;
  const edgeLen = Math.hypot(ex, ey) || 1;
  const ux = ex / edgeLen;
  const uy = ey / edgeLen;
  return polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const dx = next.x - point.x;
    const dy = next.y - point.y;
    const along = Math.abs(dx * ux + dy * uy);
    const depth = Math.abs(dx * -uy + dy * ux);
    return along >= depth ? widthM : depthM;
  });
}

function prepareImportContext(
  el: CenterpieceElement,
  rect: PixelRect,
  row: SeatingImportRow,
  pitch: CanvasPoint,
  venueMetresPerPx?: number,
): ImportContext | ImportSeatingError {
  const points = outlinePoints(el);
  const polygon = toCanvasPolygon(points, rect);
  if (polygon.length < 3) {
    return { error: 'Block outline has fewer than 3 points.' };
  }

  const towardGroundDeg = viewpointAngleFromCanvasPoint(rect.cx, rect.cy, pitch.x, pitch.y);
  const facingSides = uniqueLogicalEdgesById(
    stadiumLogicalEdgesFacingDirection(
      polygon,
      rect.cx,
      rect.cy,
      towardGroundDeg,
    ),
  );
  const stadiumEdge =
    stadiumLogicalEdgeFromView(polygon, rect.cx, rect.cy, towardGroundDeg) ?? facingSides[0] ?? null;
  if (!stadiumEdge || facingSides.length === 0) {
    return { error: 'Could not resolve the pitch-facing side of this block.' };
  }
  const seatingAngleDeg = viewpointAngleFromCanvasPoint(
    rect.cx,
    rect.cy,
    stadiumEdge.midX,
    stadiumEdge.midY,
  );
  const viewpointAngleDeg = facingSides.length >= 2 ? towardGroundDeg : seatingAngleDeg;
  const viewpointSideIndices = facingSides.map((edge) => edge.index);

  const edgePx = Math.max(1, stadiumEdge.lengthPx);
  const depthPx = polygonDepthPx(polygon, stadiumEdge);
  const target = resolveGridTarget(row, edgePx, depthPx);
  if (!target) {
    return { error: 'Row needs rows + columns, or a capacity.' };
  }

  const widthTargets =
    row.rowSeatCounts ??
    (target.cols != null
      ? Array.from({ length: target.rows }, () => target.cols as number)
      : null);
  const strictTargets =
    row.rowSeatCounts ??
    (row.seatsPerRow != null
      ? Array.from({ length: target.rows }, () => row.seatsPerRow as number)
      : null);
  const aisleSpans = csvAisleSpansM(row);
  const available = resolveAvailableImportSizeM(
    el,
    rect,
    polygon,
    edgePx,
    depthPx,
    venueMetresPerPx,
  );
  const colCount =
    target.cols ??
    (widthTargets && widthTargets.length > 0 ? Math.max(...widthTargets) : undefined);
  const spacing = deriveImportSpacingFromStructure(
    available.widthM,
    available.depthM,
    target.rows,
    colCount,
    aisleSpans.alongM,
    aisleSpans.depthM,
    {
      chairWidthM: row.chairWidthM,
      chairLengthM: row.chairLengthM,
      seatGapM: row.seatGapM,
      rowGapM: row.rowGapM,
      edgeMarginM: row.edgeMarginM,
    },
    edgePx,
    depthPx,
  );

  return {
    points,
    polygon,
    viewpointAngleDeg,
    seatingAngleDeg,
    stadiumEdge,
    viewpointSideIndices,
    edgePx,
    depthPx,
    chairWidthM: spacing.chairWidthM,
    chairLengthM: spacing.chairLengthM,
    seatGapM: spacing.seatGapM,
    rowGapM: spacing.rowGapM,
    edgeMarginM: spacing.edgeMarginM,
    aisleAlongM: aisleSpans.alongM,
    aisleDepthM: aisleSpans.depthM,
    target,
    widthTargets,
    strictTargets,
    availableWidthM: available.widthM,
    availableDepthM: available.depthM,
    sideLengthsM: available.sideLengthsM,
  };
}

/**
 * Longest inside span of the block at a given depth from the pitch-facing
 * edge, measured parallel to that edge. Concave / curved traced outlines can
 * cross the row line more than twice — seats can only use one contiguous run.
 */
function chordSpanAtDepth(
  polygon: CanvasPoint[],
  edge: { x1: number; y1: number; x2: number; y2: number },
  depthPx: number,
): number {
  const ex = edge.x2 - edge.x1;
  const ey = edge.y2 - edge.y1;
  const len = Math.hypot(ex, ey) || 1;
  const ux = ex / len;
  const uy = ey / len;
  let nx = -uy;
  let ny = ux;
  // Point the normal toward the polygon interior (its centroid).
  let cx = 0;
  let cy = 0;
  for (const p of polygon) {
    cx += p.x;
    cy += p.y;
  }
  cx /= polygon.length;
  cy /= polygon.length;
  if ((cx - edge.x1) * nx + (cy - edge.y1) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const px = edge.x1 + nx * depthPx;
  const py = edge.y1 + ny * depthPx;

  const ts: number[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const rx = b.x - a.x;
    const ry = b.y - a.y;
    const denom = ux * ry - uy * rx;
    if (Math.abs(denom) < 1e-9) {
      continue;
    }
    const qx = a.x - px;
    const qy = a.y - py;
    const s = (qx * uy - qy * ux) / -denom;
    if (s < -1e-9 || s > 1 + 1e-9) {
      continue;
    }
    ts.push((qx * ry - qy * rx) / -denom);
  }
  if (ts.length < 2) {
    return 0;
  }
  ts.sort((a, b) => a - b);
  let longest = ts[ts.length - 1] - ts[0];
  if (ts.length >= 4 && ts.length % 2 === 0) {
    longest = 0;
    for (let i = 0; i + 1 < ts.length; i += 2) {
      longest = Math.max(longest, ts[i + 1] - ts[i]);
    }
  }
  return longest;
}

/**
 * Smallest metres-per-pixel scale at which the requested grid fits this block —
 * including the engine's border padding and, for per-row targets, the actual
 * block width at each row's depth (handles tapered stadium blocks).
 * Seat dimensions are taken as given and never altered.
 */
function requiredMetresPerPx(ctx: ImportContext): number {
  const colPitchM = ctx.chairWidthM + ctx.seatGapM;
  const rowPitchM = ctx.chairLengthM + ctx.rowGapM;
  const depthM =
    spanForCount(ctx.target.rows, ctx.chairLengthM, ctx.rowGapM, ctx.edgeMarginM) +
    ctx.aisleDepthM +
    PADDING_ALLOWANCE * rowPitchM;
  let scale = depthM / ctx.depthPx;
  if (ctx.target.cols != null) {
    const widthM =
      spanForCount(ctx.target.cols, ctx.chairWidthM, ctx.seatGapM, ctx.edgeMarginM) +
      ctx.aisleAlongM +
      PADDING_ALLOWANCE * colPitchM;
    scale = Math.max(scale, widthM / ctx.edgePx);
  }
  if (!ctx.widthTargets) {
    return scale;
  }

  // Refine against the block's real width at each row depth (tapered sides).
  // Growing the scale moves rows closer to the front, so iterate to converge.
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const rowPitchPx = rowPitchM / scale;
    let next = scale;
    for (let rowIndex = 0; rowIndex < ctx.widthTargets.length; rowIndex += 1) {
      const depth = (0.65 + rowIndex) * rowPitchPx;
      if (depth > ctx.depthPx) {
        break;
      }
      const chord = chordSpanAtDepth(ctx.polygon, ctx.stadiumEdge, depth);
      if (chord <= 1) {
        continue;
      }
      const needM =
        spanForCount(ctx.widthTargets[rowIndex], ctx.chairWidthM, ctx.seatGapM, ctx.edgeMarginM) +
        ctx.aisleAlongM +
        PADDING_ALLOWANCE * colPitchM;
      next = Math.max(next, (needM / chord) * 1.04);
    }
    if (next <= scale * 1.0001) {
      break;
    }
    scale = next;
  }
  return scale;
}

/**
 * Smallest scale this row needs in its block — used by the importer to pick
 * one consistent venue-wide scale (the max across blocks), so equal chair
 * sizes render equal on screen and bigger chairs actually look bigger.
 */
export function computeRequiredImportScale(
  el: CenterpieceElement,
  rect: PixelRect,
  row: SeatingImportRow,
  pitch: CanvasPoint,
): number | null {
  const ctx = prepareImportContext(el, rect, row, pitch);
  return 'error' in ctx ? null : requiredMetresPerPx(ctx);
}

/**
 * Build the seat-fill patch for one imported block. The VIEW POINT is aimed
 * from the block centre toward the pitch, so row A always faces the pitch.
 *
 * Chair width, chair depth, seat spacing, row gap, and border gap are taken
 * from the CSV when present (applied identically) and only calculated when
 * the file omitted them. Seats are placed at those exact metres so the
 * visual pitch matches the file. Aisle positions/widths and curve stay as
 * specified.
 *
 * `minMetresPerPx` is only the user-calibrated venue scale. When it is
 * provided the scale is NEVER inflated per block.
 */
export function computeImportSeatingPlan(
  el: CenterpieceElement,
  rect: PixelRect,
  row: SeatingImportRow,
  pitch: CanvasPoint,
  minMetresPerPx?: number,
  layout?: { elements: LayoutElement[]; canvas: CanvasConfig },
): ImportSeatingPlan | ImportSeatingError {
  const ctx = prepareImportContext(el, rect, row, pitch, minMetresPerPx);
  if ('error' in ctx) {
    return ctx;
  }
  const {
    points,
    polygon,
    viewpointAngleDeg,
    seatingAngleDeg,
    stadiumEdge,
    viewpointSideIndices,
    edgePx,
    depthPx,
    chairWidthM,
    chairLengthM,
    seatGapM,
    rowGapM,
    edgeMarginM,
    target,
  } = ctx;

  const venueMode = minMetresPerPx != null;
  const recipe = csvRecipeSizeM(ctx);
  const colPitchM = chairWidthM + seatGapM;
  const rowPitchM = chairLengthM + rowGapM;
  const recipePpm = Math.min(
    edgePx / Math.max(0.1, recipe.widthM + PADDING_ALLOWANCE * colPitchM),
    depthPx / Math.max(0.1, recipe.depthM + PADDING_ALLOWANCE * rowPitchM),
  );
  let metresPerPx = minMetresPerPx ?? 1 / Math.max(recipePpm, 1e-6);
  let attemptRows = target.rows;
  const csvExplicitGrid = target.cols != null;

  const logicalEdges = buildBlockMeasureEdges(polygon);
  const sideNames = points.map((_, index) => {
    const logical = logicalEdges.find((edge) => edge.sourceIndices[0] === index);
    return logical ? logical.label : '';
  });

  const baseElement: CenterpieceElement = {
    ...el,
    customPoints: points,
    shape: 'custom',
    blockViewpointAngleDeg: seatingAngleDeg,
    dragSeatsStadiumSideIndex: stadiumEdge.index,
    dragSeatsStadiumSideIndices:
      viewpointSideIndices.length > 1 ? viewpointSideIndices : undefined,
    // Re-import must regenerate from CSV — never reuse a prior seat layout.
    seatLayout: undefined,
    seatPositionOverrides: undefined,
    autoFillStraightSeatPositions: undefined,
    rows: undefined,
    seatsPerRow: undefined,
  };

  const aislePlacement = row.aisles?.length
    ? resolveAutoFillAislePlacement({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        aisles: row.aisles,
      })
    : undefined;
  let lastError = 'Seats could not be placed inside this block.';
  for (let attempt = 0; attempt < MAX_SCALE_ATTEMPTS; attempt += 1) {
    const ppm = venueMode ? 1 / metresPerPx : recipePpm;
    const widthM = venueMode ? edgePx * metresPerPx : recipe.widthM;
    const depthM = venueMode ? depthPx * metresPerPx : recipe.depthM;
    const sideLengthsM = venueMode
      ? polygon.map((point, index) => {
          const next = polygon[(index + 1) % polygon.length];
          return Math.max(0.1, Math.hypot(next.x - point.x, next.y - point.y) / Math.max(ppm, 1e-6));
        })
      : assignRecipeSideLengthsM(polygon, stadiumEdge, widthM, depthM);
    const dims: PhysicalDimsInput = {
      physicalLengthM: depthM,
      physicalWidthM: widthM,
      chairWidthM,
      chairLengthM,
      seatGapM,
      rowGapM,
      borderGapM: edgeMarginM,
    };
    const blueprintScale: ArrangeByRowBlueprintScale = {
      stadiumEdgeLengthM: widthM,
      stadiumEdgeLengthPx: venueMode ? edgePx : widthM * recipePpm,
      depthLengthM: depthM,
      minSeatPitchPx: 3.5,
      minRowSpacingPx: 4.5,
      exactPitchPlacement: csvExplicitGrid,
    };

    const result = createArrangeByRowGridSeating(
      baseElement,
      rect,
      sideLengthsM,
      sideNames,
      dims,
      stadiumEdge.index,
      attemptRows,
      target.cols,
      seatingAngleDeg,
      blueprintScale,
      aislePlacement,
      layout
        ? { adjacentBlocks: collectAdjacentBlocks(el, layout.elements, layout.canvas) }
        : undefined,
    );

    if ('error' in result) {
      lastError = result.error;
      const fitMatch = result.error.match(/(?:Only|Maximum) (\d+) rows?/i);
      const nextRows = fitMatch
        ? Math.min(attemptRows - 1, Number(fitMatch[1]))
        : attemptRows - 1;
      if (nextRows < 1) {
        return { error: lastError };
      }
      attemptRows = nextRows;
      continue;
    }

    const patch: Partial<CenterpieceElement> = {
      ...result.patch,
      customPoints: points,
      shape: 'custom',
      blockType: 'seating',
      code: row.blockCode,
      label: el.label?.trim() || row.blockCode,
      name: el.name?.trim() || row.blockCode,
      chairWidthM,
      chairLengthM,
      seatGapM,
      rowGapM,
      borderGapM: edgeMarginM,
      dragSeatsStadiumSideIndex: stadiumEdge.index,
      dragSeatsStadiumSideIndices:
        viewpointSideIndices.length > 1 ? viewpointSideIndices : undefined,
      blockViewpointAngleDeg: viewpointAngleDeg,
      ...(hasCustomLabelOffset(el) ? {} : defaultLabelOffsetOutsideViewpoint(viewpointAngleDeg)),
      autoFillAisles: row.aisles?.length ? row.aisles : undefined,
      ...(!venueMode
        ? {
            customSideLengthsM: assignRecipeSideLengthsM(
              polygon,
              stadiumEdge,
              roundMetres(recipe.widthM),
              roundMetres(recipe.depthM),
            ),
            physicalWidthM: roundMetres(recipe.widthM),
            physicalLengthM: roundMetres(recipe.depthM),
          }
        : {}),
    };

    const strictTargets = ctx.strictTargets;

    let shortfall: string | undefined;
    let shortfallRows: { row: string; placed: number; requested: number }[] | undefined;
    let requestedSeats: number | undefined;
    if (strictTargets) {
      trimRowsToTargets(patch, strictTargets);
      requestedSeats = strictTargets.reduce((sum, t) => sum + t, 0);
      const misses = collectShortfallRows(
        getSeatLayoutRowSeatCounts(patch.seatLayout as SeatLayoutSpec),
        strictTargets,
      );
      shortfall = describeShortfall(misses);
      shortfallRows = misses.length > 0 ? misses : undefined;
    }

    let trimmedSeats = 0;
    let seatsPlaced = getSeatLayoutRowSeatCounts(
      patch.seatLayout as SeatLayoutSpec,
    ).reduce((sum, c) => sum + c, 0);
    let warning: string | undefined;

    // Rows are part of the document's ask too — dropped rows must go through
    // the same continue/skip popup, never a silent reduction. (When explicit
    // per-row targets exist, the missing rows already show up above as 0/n.)
    if (attemptRows < target.rows && !strictTargets) {
      const missing = target.rows - attemptRows;
      const rowsMessage = `Asked ${target.rows} rows but only ${attemptRows} fit — ${missing} row${missing === 1 ? '' : 's'} do not fit this block.`;
      shortfall = shortfall ? `${shortfall} ${rowsMessage}` : rowsMessage;
      if (attemptRows > 0) {
        requestedSeats = Math.round((seatsPlaced * target.rows) / attemptRows);
      }
    }

    if (row.capacity != null) {
      const trimResult = trimToCapacity(patch, row.capacity);
      trimmedSeats = trimResult.trimmed;
      seatsPlaced = trimResult.seats;
      if (seatsPlaced < row.capacity) {
        warning = `Requested ${row.capacity} seats but only ${seatsPlaced} fit in the shape.`;
      }
    }

    const curveDeg = clampAutoFillCurveDeg(row.curveDeg);
    if (curveDeg > 0 && patch.seatPositionOverrides) {
      const curvedEl = { ...baseElement, ...patch };
      const straight = { ...patch.seatPositionOverrides };
      patch.autoFillStraightSeatPositions = straight;
      patch.seatPositionOverrides = applyAutoFillBlockCurve(curvedEl, rect, straight, curveDeg);
      if (patch.seatLayout) {
        patch.seatLayout = applyAutoFillCurveToSeatLayout(patch.seatLayout, curveDeg);
      }
      seatsPlaced = Object.keys(patch.seatPositionOverrides ?? {}).length;
    } else {
      patch.autoFillStraightSeatPositions = undefined;
      if (patch.seatLayout) {
        patch.seatLayout = applyAutoFillCurveToSeatLayout(patch.seatLayout, 0);
      }
    }

    return {
      patch,
      seatsPlaced,
      rowsPlaced: (patch.seatLayout as SeatLayoutSpec).rows,
      trimmedSeats,
      viewpointAngleDeg,
      warning,
      shortfall,
      requestedSeats,
      shortfallRows,
    };
  }

  return { error: lastError };
}
