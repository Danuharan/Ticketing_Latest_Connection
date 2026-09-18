import { PixelRect } from './geometry';
import {
  CenterpieceElement,
  DEFAULT_BLOCK_LENGTH_M,
  DEFAULT_BLOCK_WIDTH_M,
  DEFAULT_CHAIR_LENGTH_M,
  DEFAULT_CHAIR_WIDTH_M,
  DEFAULT_SEAT_GAP_M,
  ElementPosition,
} from '../models/layout-element.model';

export interface PhysicalCapacity {
  maxRows: number;
  maxSeatsPerRow: number;
  maxCapacity: number;
}

/**
 * Block extents in metres taken from the per-side measurements: the longest horizontal side
 * gives the width, the longest vertical side gives the depth. Returns null while any side is
 * still unmeasured, so callers keep their previous value instead of a half-measured guess.
 */
function classifyBlockMetresFromSides(
  customPoints: ElementPosition[] | undefined,
  sideLengthsM: number[],
  wScale: number,
  hScale: number,
): { physicalLengthM: number; physicalWidthM: number } | null {
  const points = customPoints ?? [];
  if (points.length < 3 || sideLengthsM.length < points.length) {
    return null;
  }
  let widthM = 0;
  let lengthM = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const sideM = sideLengthsM[index] ?? 0;
    if (!(sideM > 0)) {
      return null;
    }
    const dx = Math.abs(b.xPct - a.xPct) * wScale;
    const dy = Math.abs(b.yPct - a.yPct) * hScale;
    if (dx >= dy) {
      widthM = Math.max(widthM, sideM);
    } else {
      lengthM = Math.max(lengthM, sideM);
    }
  }
  if (!(widthM > 0) || !(lengthM > 0)) {
    return null;
  }
  return { physicalLengthM: lengthM, physicalWidthM: widthM };
}

export function blockMetresFromSideLengths(
  customPoints: ElementPosition[] | undefined,
  sideLengthsM: number[],
  rect: PixelRect,
): { physicalLengthM: number; physicalWidthM: number } | null {
  return classifyBlockMetresFromSides(customPoints, sideLengthsM, rect.width, rect.height);
}

/** Same as blockMetresFromSideLengths, using the element's own box aspect instead of a canvas rect. */
export function blockMetresFromElement(
  el: Pick<CenterpieceElement, 'customPoints' | 'customSideLengthsM' | 'size'>,
): { physicalLengthM: number; physicalWidthM: number } | null {
  return classifyBlockMetresFromSides(
    el.customPoints,
    el.customSideLengthsM ?? [],
    Math.max(0.001, el.size?.wPct ?? 1),
    Math.max(0.001, el.size?.hPct ?? 1),
  );
}

export function resolveBlockLengthM(el: CenterpieceElement): number {
  const fromSides = blockMetresFromElement(el);
  if (fromSides) {
    return fromSides.physicalLengthM;
  }
  const v = el.physicalLengthM;
  return v != null && v > 0 ? v : DEFAULT_BLOCK_LENGTH_M;
}

export function resolveBlockWidthM(el: CenterpieceElement): number {
  const fromSides = blockMetresFromElement(el);
  if (fromSides) {
    return fromSides.physicalWidthM;
  }
  const v = el.physicalWidthM;
  return v != null && v > 0 ? v : DEFAULT_BLOCK_WIDTH_M;
}

export function resolveChairLengthM(el: CenterpieceElement): number {
  const v = el.chairLengthM;
  return v != null && v > 0 ? v : DEFAULT_CHAIR_LENGTH_M;
}

export function resolveChairWidthM(el: CenterpieceElement): number {
  const v = el.chairWidthM;
  return v != null && v > 0 ? v : DEFAULT_CHAIR_WIDTH_M;
}

export function resolveSeatGapM(el?: CenterpieceElement): number {
  const v = el?.seatGapM;
  return v != null && v >= 0 ? v : DEFAULT_SEAT_GAP_M;
}

export function resolveRowGapM(el?: CenterpieceElement): number {
  const row = el?.rowGapM;
  if (row != null && row >= 0) {
    return row;
  }
  return resolveSeatGapM(el);
}

/** How many items fit in a span with fixed gap between each (n·item + (n−1)·gap ≤ span). */
export function fitCountInSpan(spanM: number, itemM: number, gapM: number): number {
  if (itemM <= 0) {
    return 1;
  }
  const safeGap = Math.max(0, gapM);
  return Math.max(1, Math.floor((spanM + safeGap) / (itemM + safeGap)));
}

/** Pixel version — how many items fit in a drawn span on canvas. */
export function fitCountInSpanPx(spanPx: number, itemPx: number, gapPx: number): number {
  if (itemPx <= 0) {
    return 1;
  }
  const safeGap = Math.max(0, gapPx);
  return Math.max(1, Math.floor((spanPx + safeGap) / (itemPx + safeGap)));
}

/** Evenly spread centres across the full span (edge-to-edge, no side margins). */
export function spreadCentroidsInSpan(count: number, spanPx: number): number[] {
  if (count <= 0) {
    return [];
  }
  const pitch = spanPx / count;
  return Array.from({ length: count }, (_, i) => (i + 0.5) * pitch);
}

/**
 * Spread centres using fixed centre-to-centre gap, centred inside the span.
 * Returns null when the requested count does not fit at the given gap.
 */
export function spreadCentroidsWithFixedGap(
  count: number,
  spanPx: number,
  gapPx: number,
  itemPx: number,
): number[] | null {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [spanPx / 2];
  }
  const gap = Math.max(0, gapPx);
  const halfItem = Math.max(0, itemPx) / 2;
  const centreSpan = (count - 1) * gap;
  const available = spanPx - 2 * halfItem;
  if (centreSpan > available + 0.001) {
    return null;
  }
  const start = halfItem + (available - centreSpan) / 2;
  return Array.from({ length: count }, (_, index) => start + index * gap);
}

/**
 * Spread centres with a fixed clear gap between adjacent item edges, centred in the span.
 * itemPx is the full visual width/depth of each item.
 */
export function spreadCentroidsWithEdgeGap(
  count: number,
  spanPx: number,
  edgeGapPx: number,
  itemPx: number,
): number[] | null {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [spanPx / 2];
  }
  const gap = Math.max(0, edgeGapPx);
  const item = Math.max(0, itemPx);
  const total = count * item + (count - 1) * gap;
  if (total > spanPx + 0.001) {
    return null;
  }
  const start = (spanPx - total) / 2 + item / 2;
  const pitch = item + gap;
  return Array.from({ length: count }, (_, index) => start + index * pitch);
}

/** Maximum rows/seats that fit inside the block given chair footprint and seat gap. */
export function computeCapacityFromDims(
  lengthM: number,
  widthM: number,
  chairLengthM: number,
  chairWidthM: number,
  seatGapM: number = DEFAULT_SEAT_GAP_M,
): PhysicalCapacity {
  const maxRows = fitCountInSpan(lengthM, chairLengthM, seatGapM);
  const maxSeatsPerRow = fitCountInSpan(widthM, chairWidthM, seatGapM);
  return { maxRows, maxSeatsPerRow, maxCapacity: maxRows * maxSeatsPerRow };
}

/** Every row gets the same seat count (e.g. 17 seats in each of 4 rows). */
export function buildEqualRowSeatCounts(rowCount: number, seatsPerRow: number): number[] {
  const rows = Math.max(1, rowCount);
  const perRow = Math.max(0, seatsPerRow);
  return Array.from({ length: rows }, () => perRow);
}

/**
 * Split total seats across rows as evenly as possible.
 * Any remainder is placed on the last row (e.g. 17 total / 4 rows → 4+4+4+5).
 */
export function distributeSeatsToRows(totalSeats: number, rowCount: number): number[] {
  const rows = Math.max(1, rowCount);
  const total = Math.max(0, Math.round(totalSeats));
  if (total === 0) {
    return Array.from({ length: rows }, () => 0);
  }
  const base = Math.floor(total / rows);
  const remainder = total % rows;
  return Array.from({ length: rows }, (_, i) =>
    i === rows - 1 ? base + remainder : base,
  );
}

/**
 * Spread a total seat count across as many rows as needed (seats-per-row cap).
 * 13 @ 4/row → [4, 4, 5]; 19 @ 4/row → [4, 4, 4, 4, 3]
 */
export function buildRowSeatCountsFromTotal(totalSeats: number, seatsPerRow: number): number[] {
  const total = Math.max(0, Math.round(totalSeats));
  const cap = Math.max(1, Math.round(seatsPerRow));
  if (total === 0) {
    return [];
  }

  const fullRows = Math.floor(total / cap);
  const remainder = total % cap;

  if (remainder === 0) {
    return Array.from({ length: fullRows }, () => cap);
  }

  // One leftover seat merges into the last full row (13 → [4,4,5]).
  if (remainder === 1 && fullRows > 0) {
    return distributeSeatsToRows(total, fullRows);
  }

  // Larger remainder gets its own row (19 → [4,4,4,4,3]).
  return [...Array.from({ length: fullRows }, () => cap), remainder];
}

export function totalSeatsInRowCounts(rowSeatCounts: number[]): number {
  return rowSeatCounts.reduce((sum, count) => sum + Math.max(0, count), 0);
}

/** Row seat counts — equal seats in every row across the block depth. */
export function buildRowSeatCountsForCapacity(capacity: PhysicalCapacity): number[] {
  return buildEqualRowSeatCounts(capacity.maxRows, capacity.maxSeatsPerRow);
}

export function maxSeatsInRowCounts(rowSeatCounts: number[]): number {
  return rowSeatCounts.length > 0 ? Math.max(...rowSeatCounts) : 0;
}

export function computePhysicalCapacity(el: CenterpieceElement): PhysicalCapacity {
  return computeCapacityFromDims(
    resolveBlockLengthM(el),
    resolveBlockWidthM(el),
    resolveChairLengthM(el),
    resolveChairWidthM(el),
  );
}

/** Canvas pixels per metre from element box and physical dimensions. */
export function pxPerMeter(rect: PixelRect, lengthM: number, widthM: number): number {
  if (lengthM <= 0 || widthM <= 0) {
    return 1;
  }
  return Math.min(rect.width / widthM, rect.height / lengthM);
}

export function chairPitchPx(el: CenterpieceElement, rect: PixelRect): number {
  const widthM = resolveBlockWidthM(el);
  const lengthM = resolveBlockLengthM(el);
  const ppm = pxPerMeter(rect, lengthM, widthM);
  const gapM = resolveSeatGapM(el);
  return Math.max(6, (resolveChairWidthM(el) + gapM) * ppm);
}

export function rowGapPx(el: CenterpieceElement, rect: PixelRect): number {
  const widthM = resolveBlockWidthM(el);
  const lengthM = resolveBlockLengthM(el);
  const ppm = pxPerMeter(rect, lengthM, widthM);
  return Math.max(8, resolveChairLengthM(el) * ppm);
}
