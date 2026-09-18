import { PixelRect } from './geometry';
import {
  capSeatLayoutToCapacity,
  createSeatLayoutSpec,
  getAisleAfterSeatNumbers,
  getSeatCellsFromSpec,
  getSeatLayoutDisplayStats,
  getSeatLayoutRowOffsets,
  getSeatLayoutRowSeatCounts,
  getSeatLayoutSpec,
  resizeSeatLayoutRows,
  seatId,
} from './block-seat-layout';
import {
  chairPitchPx,
  computeCapacityFromDims,
  computePhysicalCapacity,
  buildRowSeatCountsFromTotal,
  fitCountInSpanPx,
  maxSeatsInRowCounts,
  totalSeatsInRowCounts,
  spreadCentroidsInSpan,
  pxPerMeter,
  resolveBlockLengthM,
  resolveBlockWidthM,
  resolveChairLengthM,
  resolveChairWidthM,
  resolveRowGapM,
  resolveSeatGapM,
  rowGapPx,
} from './physical-dims';
import { rowLabel, rowLabelToIndex, SeatNode, RowLabelNode } from './seat-layout';
import { placeDragSeatsGridInClipZone, resolvePpmForShapePlacement } from './drag-seats';
import {
  CenterpieceElement,
  CustomShapeSeatBlock,
  CustomShapeSeatPosition,
  DEFAULT_SEAT_GAP_M,
  ElementPosition,
  isCustomShapeSeatingEnabled,
  SeatLayoutSpec,
} from '../models/layout-element.model';

export interface CustomShapeSeatMap {
  seats: (SeatNode & {
    seatId: string;
    rowIndex: number;
    /** Owning sub-block (Create seats flow leaves this unset — the element stands in). */
    blockId?: string;
    rotationDeg?: number;
    pitchPx?: number;
  })[];
  rowLabels: RowLabelNode[];
}

/** Seat pitch used for chair rendering — prefers locked block placement pitch over stale element layout. */
export function resolveCustomShapeSeatPitchPx(
  element: CenterpieceElement,
  rect: PixelRect,
): number {
  for (const block of element.customSeatBlocks ?? []) {
    const blockPitch = block.seatLayout?.customShapeSeatPitchPx;
    if (blockPitch != null && blockPitch > 0) {
      return blockPitch;
    }
  }
  const layoutPitch = element.seatLayout?.customShapeSeatPitchPx;
  if (layoutPitch != null && layoutPitch > 0) {
    return layoutPitch;
  }
  return chairPitchPx(element, rect);
}

interface CanvasPoint {
  x: number;
  y: number;
}

function getPrimaryOutlineCanvasPoints(
  el: CenterpieceElement,
  rect: PixelRect,
): CanvasPoint[] {
  return (el.customPoints ?? []).map((p) => ({
    x: rect.x + (p.xPct / 100) * rect.width,
    y: rect.y + (p.yPct / 100) * rect.height,
  }));
}

export function pointInPolygon(point: CanvasPoint, polygon: CanvasPoint[]): boolean {
  if (polygon.length < 3) {
    return false;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonCentroid(polygon: CanvasPoint[]): CanvasPoint {
  if (polygon.length === 0) {
    return { x: 0, y: 0 };
  }
  const sum = polygon.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / polygon.length, y: sum.y / polygon.length };
}

export function clampPointInsidePolygon(point: CanvasPoint, polygon: CanvasPoint[]): CanvasPoint {
  if (polygon.length < 3 || pointInPolygon(point, polygon)) {
    return point;
  }
  const centroid = polygonCentroid(polygon);
  let low = 0;
  let high = 1;
  let best = { ...centroid };
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2;
    const candidate = {
      x: point.x + (centroid.x - point.x) * mid,
      y: point.y + (centroid.y - point.y) * mid,
    };
    if (pointInPolygon(candidate, polygon)) {
      best = candidate;
      low = mid;
    } else {
      high = mid;
    }
  }
  return best;
}

/**
 * Air gap between seat body edge and the shape outline (not centre-to-edge).
 * Kept modest so chairs are not flush against the stroke, but still tight enough
 * that concave notches / zig-zag borders can fit every seat the chair pitch allows.
 */
const SHAPE_SEAT_BORDER_EDGE_GAP_MIN_PX = 3;
/** ~30% of seat pitch — visible air between chair and outline (0.4 ate notch pockets). */
const SHAPE_SEAT_BORDER_PADDING_PITCH_RATIO = 0.3;
const SHAPE_SEAT_BORDER_PADDING_SPAN_RATIO = 0.035;
/**
 * Never go below this share of the pitch, even on narrow spans: the drawn
 * chair body reaches ~0.47× pitch from its centre while the placement radius
 * is 0.42×, so anything smaller lets the chair kiss the border stroke.
 */
const SHAPE_SEAT_BORDER_PADDING_PITCH_FLOOR_RATIO = 0.15;

export function resolveShapeSeatBorderPaddingPx(pitchPx: number, spanPx: number): number {
  if (spanPx <= 0 || pitchPx <= 0) {
    return SHAPE_SEAT_BORDER_EDGE_GAP_MIN_PX;
  }
  return Math.max(
    SHAPE_SEAT_BORDER_EDGE_GAP_MIN_PX,
    pitchPx * SHAPE_SEAT_BORDER_PADDING_PITCH_FLOOR_RATIO,
    Math.min(
      pitchPx * SHAPE_SEAT_BORDER_PADDING_PITCH_RATIO,
      spanPx * SHAPE_SEAT_BORDER_PADDING_SPAN_RATIO,
    ),
  );
}

export function resolveSeatBodyRadiusPx(pitchPx: number, rowHeightPx?: number): number {
  if (rowHeightPx != null && rowHeightPx > 0) {
    return Math.max(2.8, Math.min(rowHeightPx * 0.34, pitchPx * 0.42));
  }
  return Math.max(2.8, pitchPx * 0.42);
}

/** Minimum distance from seat centre to polygon edge (seat radius + border-to-seat gap). */
export function resolveSeatCenterBorderPaddingPx(
  pitchPx: number,
  spanPx: number,
  seatRadiusPx: number,
  minEdgeGapPx = 0,
): number {
  // Always keep the default air gap so chairs never flush the outline. User
  // Border gap (metres→px) raises the margin further; it must not replace the
  // default with a smaller value (e.g. 0.06m was making seats *closer*).
  const defaultGapPx = resolveShapeSeatBorderPaddingPx(pitchPx, spanPx);
  const borderToSeatGapPx = Math.max(defaultGapPx, Math.max(0, minEdgeGapPx));
  return seatRadiusPx + borderToSeatGapPx;
}

export function isRowLabelHidden(spec: SeatLayoutSpec | undefined, rowIndex: number): boolean {
  return spec?.hiddenRowLabelIndices?.includes(rowIndex) === true;
}

function minDistanceToPolygonBoundary(point: CanvasPoint, polygon: CanvasPoint[]): number {
  if (polygon.length < 2) {
    return Number.POSITIVE_INFINITY;
  }
  let minDist = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let dist: number;
    if (lenSq < 1e-9) {
      dist = Math.hypot(point.x - a.x, point.y - a.y);
    } else {
      let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      dist = Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
    }
    minDist = Math.min(minDist, dist);
  }
  return minDist;
}

export function pointInsidePolygonWithPadding(
  point: CanvasPoint,
  polygon: CanvasPoint[],
  paddingPx: number,
): boolean {
  if (!pointInPolygon(point, polygon)) {
    return false;
  }
  return minDistanceToPolygonBoundary(point, polygon) >= paddingPx - 0.5;
}

/** Evenly distribute seat centers across a padded horizontal span. */
export function spanFillAlongPositions(
  innerMin: number,
  innerMax: number,
  seatCount: number,
): number[] {
  if (seatCount <= 0) {
    return [];
  }
  if (seatCount === 1) {
    return [(innerMin + innerMax) / 2];
  }
  return Array.from(
    { length: seatCount },
    (_, index) => innerMin + (index / (seatCount - 1)) * (innerMax - innerMin),
  );
}

export function getPolygonVerticalRange(
  polygon: CanvasPoint[],
  pitchPx = 12,
  seatRadiusPx = resolveSeatBodyRadiusPx(pitchPx),
): { minY: number; maxY: number } {
  const ys = polygon.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const inset = resolveSeatCenterBorderPaddingPx(pitchPx, maxY - minY, seatRadiusPx);
  return { minY: minY + inset, maxY: maxY - inset };
}

export function getPolygonHorizontalSpanAtY(
  polygon: CanvasPoint[],
  y: number,
): { minX: number; maxX: number; width: number } | null {
  const intersections: number[] = [];
  const vertexCount = polygon.length;
  for (let index = 0; index < vertexCount; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % vertexCount];
    if (Math.abs(start.y - end.y) < 1e-6) {
      continue;
    }
    const edgeMinY = Math.min(start.y, end.y);
    const edgeMaxY = Math.max(start.y, end.y);
    if (y < edgeMinY || y >= edgeMaxY) {
      continue;
    }
    const t = (y - start.y) / (end.y - start.y);
    intersections.push(start.x + t * (end.x - start.x));
  }
  if (intersections.length < 2) {
    return null;
  }
  intersections.sort((a, b) => a - b);
  let best: { minX: number; maxX: number; width: number } | null = null;
  for (let index = 0; index + 1 < intersections.length; index += 2) {
    const minX = intersections[index];
    const maxX = intersections[index + 1];
    const width = maxX - minX;
    if (width <= 1) {
      continue;
    }
    const midX = (minX + maxX) / 2;
    if (!pointInPolygon({ x: midX, y }, polygon)) {
      continue;
    }
    if (!best || width > best.width) {
      best = { minX, maxX, width };
    }
  }
  if (best) {
    return best;
  }
  const minX = intersections[0];
  const maxX = intersections[intersections.length - 1];
  const width = maxX - minX;
  if (width <= 1) {
    return null;
  }
  const midX = (minX + maxX) / 2;
  if (!pointInPolygon({ x: midX, y }, polygon)) {
    return null;
  }
  return { minX, maxX, width };
}

function tryFixedPitchAllSeats(
  seatCount: number,
  innerMin: number,
  innerMax: number,
  pitch: number,
  aisleAfter: number[],
  aisleGapFraction: number,
): number[] | null {
  const rawPositions: number[] = [];
  let units = 0;
  for (let seatNumber = 1; seatNumber <= seatCount; seatNumber += 1) {
    const nextUnits = units + 1 + (aisleAfter.includes(seatNumber) ? aisleGapFraction : 0);
    const seatRight = innerMin + nextUnits * pitch;
    if (seatRight > innerMax + 0.01) {
      return null;
    }
    rawPositions.push(innerMin + (units + 0.5) * pitch);
    units = nextUnits;
  }
  return rawPositions;
}

function tryFixedPitchRightAligned(
  seatCount: number,
  innerMin: number,
  innerMax: number,
  pitch: number,
  aisleAfter: number[],
  aisleGapFraction: number,
): number[] | null {
  const positions: number[] = [];
  let x = innerMax - pitch * 0.5;
  for (let seatNumber = 1; seatNumber <= seatCount; seatNumber += 1) {
    if (x < innerMin - 0.01) {
      return null;
    }
    positions.unshift(x);
    const gap = aisleAfter.includes(seatNumber) ? pitch * aisleGapFraction : 0;
    x -= pitch + gap;
  }
  return positions;
}

function placeSeatsWithFixedPitch(
  seatCount: number,
  minX: number,
  maxX: number,
  pitch: number,
  aisleAfter: number[],
  aisleGapFraction: number,
  align: 'left' | 'center' | 'right' = 'center',
): number[] {
  if (seatCount <= 0 || pitch <= 0) {
    return [];
  }
  const span = maxX - minX;
  if (span <= 0) {
    return [];
  }
  const seatRadius = resolveSeatBodyRadiusPx(pitch);
  const sideInset = resolveSeatCenterBorderPaddingPx(pitch, span, seatRadius);
  const innerMin = minX + sideInset;
  const innerMax = maxX - sideInset;
  if (innerMax <= innerMin) {
    return [(minX + maxX) / 2];
  }

  if (align === 'right') {
    const fixed = tryFixedPitchRightAligned(
      seatCount,
      innerMin,
      innerMax,
      pitch,
      aisleAfter,
      aisleGapFraction,
    );
    if (fixed) {
      return fixed;
    }
    return spanFillAlongPositions(innerMin, innerMax, seatCount);
  }

  const fixed = tryFixedPitchAllSeats(
    seatCount,
    innerMin,
    innerMax,
    pitch,
    aisleAfter,
    aisleGapFraction,
  );
  if (fixed) {
    if (align === 'left') {
      return fixed;
    }
    const groupWidth = fixed.length > 1 ? fixed[fixed.length - 1] - fixed[0] : 0;
    const shift = innerMin + (innerMax - innerMin - groupWidth) / 2 - fixed[0];
    return fixed.map((x) => x + shift);
  }

  return spanFillAlongPositions(innerMin, innerMax, seatCount);
}

const ROW_LABEL_MAX_FONT_PX = 8;
const ROW_LABEL_MIN_FONT_PX = 3.6;
/** Gap between the block outline stroke and the near edge of a row letter. */
const ROW_LABEL_BORDER_CLEARANCE_PX = 3;

interface RowLabelPlacement {
  x: number;
  y: number;
  fontSize: number;
}

/**
 * Anchors every row label just outside the first chair of its own row, along the
 * row's actual direction — so on slanted or rotated blocks each letter sits level
 * with its row instead of drifting down a shared column beside the bounding box.
 * Letters shrink when rows are packed tighter than the default glyph height.
 */
function placeRowLabelsAlongRows(
  seats: CustomShapeSeatMap['seats'],
  polygon: CanvasPoint[],
  radius: number,
): Map<number, RowLabelPlacement> {
  const rows = new Map<number, CustomShapeSeatMap['seats']>();
  for (const seat of seats) {
    const list = rows.get(seat.rowIndex);
    if (list) {
      list.push(seat);
    } else {
      rows.set(seat.rowIndex, [seat]);
    }
  }
  const placements = new Map<number, RowLabelPlacement>();
  if (rows.size === 0) {
    return placements;
  }

  // Principal axis of the seat scatter within rows = the shared row direction.
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const rowSeats of rows.values()) {
    if (rowSeats.length < 2) {
      continue;
    }
    const cx = rowSeats.reduce((sum, seat) => sum + seat.x, 0) / rowSeats.length;
    const cy = rowSeats.reduce((sum, seat) => sum + seat.y, 0) / rowSeats.length;
    for (const seat of rowSeats) {
      const dx = seat.x - cx;
      const dy = seat.y - cy;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }
  }
  let ux = 1;
  let uy = 0;
  if (sxx + syy > 1e-6) {
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    ux = Math.cos(angle);
    uy = Math.sin(angle);
  }
  // Read rows left-to-right (or top-to-bottom for vertical rows) so labels
  // gather on the same side the way a printed seating chart does.
  if (ux < -1e-6 || (Math.abs(ux) <= 1e-6 && uy < 0)) {
    ux = -ux;
    uy = -uy;
  }
  const vx = -uy;
  const vy = ux;

  // Row pitch from the spread of row centroids across the perpendicular.
  const centroidDepths = [...rows.values()]
    .map((rowSeats) => {
      const cx = rowSeats.reduce((sum, seat) => sum + seat.x, 0) / rowSeats.length;
      const cy = rowSeats.reduce((sum, seat) => sum + seat.y, 0) / rowSeats.length;
      return cx * vx + cy * vy;
    })
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let index = 1; index < centroidDepths.length; index += 1) {
    const gap = centroidDepths[index] - centroidDepths[index - 1];
    if (gap > 0.5) {
      gaps.push(gap);
    }
  }
  gaps.sort((a, b) => a - b);
  const rowPitch = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : radius * 2.4;
  const fontSize = Math.max(
    ROW_LABEL_MIN_FONT_PX,
    Math.min(ROW_LABEL_MAX_FONT_PX, rowPitch * 0.9),
  );
  const labelHalfWidth = fontSize * 0.45;
  const minOffsetFromSeat = radius + labelHalfWidth + 1.5;
  // Two letters closer than this (centre to centre) paint over each other.
  const minLabelSeparation = fontSize * 0.85;
  const collisionStep = fontSize * 0.55;
  const placed: { x: number; y: number }[] = [];

  const sortedRowIndices = [...rows.keys()].sort((a, b) => a - b);
  for (const rowIndex of sortedRowIndices) {
    const rowSeats = rows.get(rowIndex)!;
    let start = rowSeats[0];
    let startDepth = start.x * ux + start.y * uy;
    for (const seat of rowSeats) {
      const depth = seat.x * ux + seat.y * uy;
      if (depth < startDepth) {
        start = seat;
        startDepth = depth;
      }
    }
    // Walk backwards along the row until the block outline is crossed, then sit
    // the letter clear of the (selected, thick) border rather than on top of it.
    const exitDistance = rayExitDistanceFromPolygon(start, { x: -ux, y: -uy }, polygon);
    let offset = Math.max(
      minOffsetFromSeat,
      exitDistance + ROW_LABEL_BORDER_CLEARANCE_PX + labelHalfWidth,
    );
    let x = start.x - ux * offset;
    let y = start.y - uy * offset;
    // On notched / slanted outlines neighbouring rows can exit the border at
    // almost the same point (e.g. "I" landing under "J"). Keep stepping this
    // letter further out along its own row line until it no longer overlaps.
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const collides = placed.some(
        (p) => Math.hypot(p.x - x, p.y - y) < minLabelSeparation,
      );
      if (!collides) {
        break;
      }
      offset += collisionStep;
      x = start.x - ux * offset;
      y = start.y - uy * offset;
    }
    placed.push({ x, y });
    placements.set(rowIndex, {
      x,
      // Baseline shift so the glyph is optically centred on the row line.
      y: y + fontSize * 0.36,
      fontSize,
    });
  }
  return placements;
}

/** Distance from `origin` along `dir` (unit) to the first polygon edge crossed; 0 if none. */
function rayExitDistanceFromPolygon(
  origin: CanvasPoint,
  dir: CanvasPoint,
  polygon: CanvasPoint[],
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = dir.x * ey - dir.y * ex;
    if (Math.abs(denom) < 1e-9) {
      continue;
    }
    const wx = a.x - origin.x;
    const wy = a.y - origin.y;
    const t = (wx * ey - wy * ex) / denom;
    const s = (wx * dir.y - wy * dir.x) / denom;
    if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6 && t < best) {
      best = t;
    }
  }
  return Number.isFinite(best) ? best : 0;
}

function appendBlockRowLabels(
  rowLabels: RowLabelNode[],
  seats: CustomShapeSeatMap['seats'],
  spec: SeatLayoutSpec,
  polygon: CanvasPoint[],
  pitch: number,
  blockId: string,
): void {
  if (spec.showRowLabels === false) {
    return;
  }
  const radius = resolveSeatBodyRadiusPx(pitch);
  const placements = placeRowLabelsAlongRows(seats, polygon, radius);
  const style = spec.rowLabelStyle ?? 'letter';
  const rowIndices = [...placements.keys()].sort((a, b) => a - b);
  for (const rowIndex of rowIndices) {
    if (isRowLabelHidden(spec, rowIndex)) {
      continue;
    }
    const placement = placements.get(rowIndex)!;
    rowLabels.push({
      key: `row-${blockId}-${rowIndex}`,
      label: rowLabel(rowIndex, style),
      x: placement.x,
      y: placement.y,
      fontSize: placement.fontSize,
      blockId,
      rowIndex,
    });
  }
}

function blockOverridesFromDragSeatsPlacement(
  placement: ReturnType<typeof placeDragSeatsGridInClipZone>,
  blockCode: string,
  rect: PixelRect,
  style: 'letter' | 'number',
  hiddenSeatIds?: Set<string>,
): Record<string, { xPct: number; yPct: number }> {
  const overrides: Record<string, { xPct: number; yPct: number }> = {};
  const hidden = hiddenSeatIds ?? new Set<string>();
  for (let rowIndex = 0; rowIndex < placement.positionsByRow.length; rowIndex += 1) {
    const positions = placement.positionsByRow[rowIndex];
    for (let seatIndex = 0; seatIndex < positions.length; seatIndex += 1) {
      const id = blockSeatId(blockCode, rowIndex, seatIndex, style);
      if (hidden.has(id)) {
        continue;
      }
      overrides[id] = canvasPointToElementPct(positions[seatIndex], rect);
    }
  }
  return overrides;
}

function placeDragSeatsGridInDrawnZone(
  element: CenterpieceElement,
  mainPolygon: CanvasPoint[],
  zonePolygon: CanvasPoint[],
  rect: PixelRect,
  blockCode: string,
  dims: PhysicalDimsInput,
  options?: { hiddenSeatIds?: Set<string> },
): {
  overrides: Record<string, { xPct: number; yPct: number }>;
  rowSeatCounts: number[];
  pitchX: number;
  pitchY: number;
  seatFacingDeg: number;
} {
  const style = 'letter' as const;
  const placement = placeDragSeatsGridInClipZone(element, rect, mainPolygon, zonePolygon, dims);
  return {
    overrides: blockOverridesFromDragSeatsPlacement(
      placement,
      blockCode,
      rect,
      style,
      options?.hiddenSeatIds,
    ),
    rowSeatCounts: placement.rowSeatCounts,
    pitchX: placement.pitchPx,
    pitchY: placement.rowGapPx,
    seatFacingDeg: placement.seatFacingDeg,
  };
}

function appendCustomShapeRowLabels(
  rowLabels: RowLabelNode[],
  seats: CustomShapeSeatMap['seats'],
  spec: SeatLayoutSpec,
  polygon: CanvasPoint[],
  pitch: number,
  perSeatPlacementMode: boolean | undefined,
): void {
  if (perSeatPlacementMode || spec.showRowLabels === false) {
    return;
  }
  const radius = resolveSeatBodyRadiusPx(pitch);
  const placements = placeRowLabelsAlongRows(seats, polygon, radius);
  const style = spec.rowLabelStyle ?? 'letter';
  for (let rowIndex = 0; rowIndex < spec.rows; rowIndex += 1) {
    if (isRowLabelHidden(spec, rowIndex)) {
      continue;
    }
    const placement = placements.get(rowIndex);
    if (!placement) {
      continue;
    }
    rowLabels.push({
      key: `row-${rowIndex}`,
      label: rowLabel(rowIndex, style),
      x: placement.x,
      y: placement.y,
      fontSize: placement.fontSize,
      rowIndex,
    });
  }
}

function elementPctToCanvasPoint(
  xPct: number,
  yPct: number,
  rect: PixelRect,
): CanvasPoint {
  return {
    x: rect.x + (xPct / 100) * rect.width,
    y: rect.y + (yPct / 100) * rect.height,
  };
}

export function canvasPointToElementPct(
  point: CanvasPoint,
  rect: PixelRect,
): { xPct: number; yPct: number } {
  return {
    xPct: Math.max(0, Math.min(100, ((point.x - rect.x) / rect.width) * 100)),
    yPct: Math.max(0, Math.min(100, ((point.y - rect.y) / rect.height) * 100)),
  };
}

function canvasPctToCanvasPx(
  p: ElementPosition,
  canvas: { width: number; height: number },
): CanvasPoint {
  return { x: (p.xPct / 100) * canvas.width, y: (p.yPct / 100) * canvas.height };
}

function blockSeatId(
  blockCode: string,
  rowIndex: number,
  seatIndex: number,
  style: 'letter' | 'number',
): string {
  return `${blockCode}-${rowLabel(rowIndex, style)}${seatIndex + 1}`;
}

export function parseBlockSeatId(
  seatId: string,
  blockCode: string,
  style: 'letter' | 'number' = 'letter',
): { rowIndex: number; seatIndex: number } | null {
  const prefix = `${blockCode}-`;
  if (!seatId.startsWith(prefix)) {
    return null;
  }
  const rest = seatId.slice(prefix.length);
  const match = rest.match(/^([A-Z]+)(\d+)$/i);
  if (!match) {
    return null;
  }
  const rowLabelText = match[1].toUpperCase();
  const seatIndex = Math.max(0, parseInt(match[2], 10) - 1);
  for (let rowIndex = 0; rowIndex < 100; rowIndex += 1) {
    if (rowLabel(rowIndex, style).toUpperCase() === rowLabelText) {
      return { rowIndex, seatIndex };
    }
  }
  return null;
}

function longestEdgeDirection(polygon: CanvasPoint[]): { ux: number; uy: number; length: number } {
  let bestLen = 0;
  let ux = 1;
  let uy = 0;
  const count = polygon.length;
  for (let i = 0; i < count; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % count];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > bestLen) {
      bestLen = len;
      ux = dx / len;
      uy = dy / len;
    }
  }
  return { ux, uy, length: bestLen };
}

function expandLineZoneToBlockPolygon(
  linePoints: CanvasPoint[],
  depthPx: number,
  mainPolygon: CanvasPoint[],
): CanvasPoint[] {
  if (linePoints.length < 2) {
    return linePoints;
  }
  const a = linePoints[0];
  const b = linePoints[linePoints.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    return linePoints;
  }
  const ux = dx / len;
  const uy = dy / len;
  const perpA = { x: -uy, y: ux };
  const perpB = { x: uy, y: -ux };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const centroid = polygonCentroid(mainPolygon);
  const toCentroid = { x: centroid.x - mid.x, y: centroid.y - mid.y };
  const perp =
    perpA.x * toCentroid.x + perpA.y * toCentroid.y >= 0 ? perpA : perpB;
  const c = { x: b.x + perp.x * depthPx, y: b.y + perp.y * depthPx };
  const d = { x: a.x + perp.x * depthPx, y: a.y + perp.y * depthPx };
  return [a, b, c, d];
}

function mergePlacementDims(
  element: CenterpieceElement,
  dims: PhysicalDimsInput,
): PhysicalDimsInput {
  return {
    physicalLengthM: dims.physicalLengthM,
    physicalWidthM: dims.physicalWidthM,
    chairLengthM: dims.chairLengthM,
    chairWidthM: dims.chairWidthM,
    seatGapM: dims.seatGapM ?? resolveSeatGapM(element),
    rowGapM: dims.rowGapM ?? resolveRowGapM(element),
    borderGapM: dims.borderGapM ?? element.borderGapM,
  };
}

function buildZonePolygonFromDraw(
  canvasPctPoints: ElementPosition[],
  canvas: { width: number; height: number },
  mainPolygon: CanvasPoint[],
  dims: PhysicalDimsInput,
  element: CenterpieceElement,
  rect: PixelRect,
): CanvasPoint[] {
  const points = canvasPctPoints.map((p) => canvasPctToCanvasPx(p, canvas));
  if (points.length >= 3) {
    return points;
  }
  const ppm = resolvePpmForShapePlacement(
    mainPolygon,
    element.customSideLengthsM ?? [],
    rect,
    dims,
  );
  const depthPx = Math.max(8, dims.physicalLengthM * ppm);
  return expandLineZoneToBlockPolygon(points, depthPx, mainPolygon);
}

interface ZoneObb {
  origin: CanvasPoint;
  ux: number;
  uy: number;
  perpX: number;
  perpY: number;
  minAlong: number;
  maxAlong: number;
  minDepth: number;
  maxDepth: number;
}

function computeZoneObb(zonePolygon: CanvasPoint[]): ZoneObb {
  const { ux, uy } = longestEdgeDirection(zonePolygon);
  let perpX = -uy;
  let perpY = ux;
  const origin = zonePolygon[0];
  const centroid = polygonCentroid(zonePolygon);
  const toCentroid = { x: centroid.x - origin.x, y: centroid.y - origin.y };
  if (toCentroid.x * perpX + toCentroid.y * perpY < 0) {
    perpX = -perpX;
    perpY = -perpY;
  }

  let minAlong = Number.POSITIVE_INFINITY;
  let maxAlong = Number.NEGATIVE_INFINITY;
  let minDepth = Number.POSITIVE_INFINITY;
  let maxDepth = Number.NEGATIVE_INFINITY;
  for (const p of zonePolygon) {
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    const along = dx * ux + dy * uy;
    const depth = dx * perpX + dy * perpY;
    minAlong = Math.min(minAlong, along);
    maxAlong = Math.max(maxAlong, along);
    minDepth = Math.min(minDepth, depth);
    maxDepth = Math.max(maxDepth, depth);
  }
  return { origin, ux, uy, perpX, perpY, minAlong, maxAlong, minDepth, maxDepth };
}

/** Width axis follows the drawn line; depth goes inward into the zone. */
function computeZoneObbFromDraw(
  canvasPctPoints: ElementPosition[],
  canvas: { width: number; height: number },
  zonePolygon: CanvasPoint[],
): ZoneObb {
  const drawPts = canvasPctPoints.map((p) => canvasPctToCanvasPx(p, canvas));
  if (drawPts.length < 2) {
    return computeZoneObb(zonePolygon);
  }

  const a = drawPts[0];
  const b = drawPts[drawPts.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    return computeZoneObb(zonePolygon);
  }

  const ux = dx / len;
  const uy = dy / len;
  let perpX = -uy;
  let perpY = ux;
  const origin = a;

  let maxDepth = Number.NEGATIVE_INFINITY;
  for (const p of zonePolygon) {
    const depth = (p.x - origin.x) * perpX + (p.y - origin.y) * perpY;
    maxDepth = Math.max(maxDepth, depth);
  }
  if (maxDepth < 0) {
    perpX = -perpX;
    perpY = -perpY;
  }

  let minAlong = Number.POSITIVE_INFINITY;
  let maxAlong = Number.NEGATIVE_INFINITY;
  let minDepth = Number.POSITIVE_INFINITY;
  let maxDepthFinal = Number.NEGATIVE_INFINITY;
  for (const p of zonePolygon) {
    const pdx = p.x - origin.x;
    const pdy = p.y - origin.y;
    const along = pdx * ux + pdy * uy;
    const depth = pdx * perpX + pdy * perpY;
    minAlong = Math.min(minAlong, along);
    maxAlong = Math.max(maxAlong, along);
    minDepth = Math.min(minDepth, depth);
    maxDepthFinal = Math.max(maxDepthFinal, depth);
  }

  return {
    origin,
    ux,
    uy,
    perpX,
    perpY,
    minAlong,
    maxAlong,
    minDepth,
    maxDepth: maxDepthFinal,
  };
}

function pointInsideZone(point: CanvasPoint, zonePolygon: CanvasPoint[], mainPolygon: CanvasPoint[]): boolean {
  return pointInPolygon(point, zonePolygon) && pointInPolygon(point, mainPolygon);
}

function obbPointToCanvas(obb: ZoneObb, along: number, depth: number): CanvasPoint {
  return {
    x: obb.origin.x + obb.ux * along + obb.perpX * depth,
    y: obb.origin.y + obb.uy * along + obb.perpY * depth,
  };
}

function isZoneOutlineDraw(rowLines: ElementPosition[][]): boolean {
  return rowLines.length === 1 && (rowLines[0]?.length ?? 0) >= 3;
}

function envelopeFromParallelRowLines(linesPx: CanvasPoint[][]): CanvasPoint[] {
  const first = linesPx[0];
  const last = linesPx[linesPx.length - 1];
  return [first[0], first[first.length - 1], last[last.length - 1], last[0]];
}

function buildZonePolygonFromRowLines(
  rowLines: ElementPosition[][],
  canvas: { width: number; height: number },
  mainPolygon: CanvasPoint[],
  dims: PhysicalDimsInput,
  element: CenterpieceElement,
  rect: PixelRect,
): CanvasPoint[] {
  const linesPx = rowLines
    .filter((line) => line.length >= 2)
    .map((line) => canvasPctLineToPx(line, canvas));
  const primary = rowLines[0] ?? [];
  if (primary.length >= 3) {
    return canvasPctLineToPx(primary, canvas);
  }
  if (linesPx.length >= 2) {
    return envelopeFromParallelRowLines(linesPx);
  }
  return buildZonePolygonFromDraw(primary, canvas, mainPolygon, dims, element, rect);
}

function pointInsideSeatArea(
  point: CanvasPoint,
  zonePolygon: CanvasPoint[] | null,
  mainPolygon: CanvasPoint[],
): boolean {
  if (zonePolygon && zonePolygon.length >= 3) {
    return pointInPolygon(point, zonePolygon);
  }
  return pointInPolygon(point, mainPolygon);
}

function canvasPctLineToPx(
  points: ElementPosition[],
  canvas: { width: number; height: number },
): CanvasPoint[] {
  return points.map((p) => canvasPctToCanvasPx(p, canvas));
}

export function offsetPolylinePx(line: CanvasPoint[], offsetX: number, offsetY: number): CanvasPoint[] {
  return line.map((p) => ({ x: p.x + offsetX, y: p.y + offsetY }));
}

export function getLineInwardPerpendicular(
  linePx: CanvasPoint[],
  mainPolygon: CanvasPoint[],
): { perpX: number; perpY: number } {
  if (linePx.length < 2) {
    return { perpX: 0, perpY: 1 };
  }
  const a = linePx[0];
  const b = linePx[linePx.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const perpA = { perpX: -dy / len, perpY: dx / len };
  const perpB = { perpX: dy / len, perpY: -dx / len };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const centroid = polygonCentroid(mainPolygon);
  const toCentroid = { x: centroid.x - mid.x, y: centroid.y - mid.y };
  return perpA.perpX * toCentroid.x + perpA.perpY * toCentroid.y >= 0 ? perpA : perpB;
}

/** Build row polylines — multiple drawn rows, or parallel copies from one drawn row. */
function buildRowPolylinesPx(
  rowLinesCanvasPct: ElementPosition[][],
  canvas: { width: number; height: number },
  mainPolygon: CanvasPoint[],
  dims: PhysicalDimsInput,
  maxRows: number,
): { lines: CanvasPoint[][]; pitchY: number; pitchX: number } {
  const drawn = rowLinesCanvasPct
    .filter((line) => line.length >= 2)
    .map((line) => canvasPctLineToPx(line, canvas));
  if (drawn.length === 0) {
    return { lines: [], pitchY: 6, pitchX: 6 };
  }

  const reference = drawn[0];
  const lineLengthPx = Math.max(polylineLength(reference), 1);
  const ppm = lineLengthPx / Math.max(0.001, dims.physicalWidthM);
  const seatGapM = dims.seatGapM ?? DEFAULT_SEAT_GAP_M;
  const rowGapM = dims.rowGapM ?? seatGapM;
  const pitchX = Math.max(6, (dims.chairWidthM + seatGapM) * ppm);
  const pitchY = Math.max(8, (dims.chairLengthM + rowGapM) * ppm);

  if (drawn.length > 1) {
    return { lines: drawn.slice(0, maxRows), pitchY, pitchX };
  }

  const { perpX, perpY } = getLineInwardPerpendicular(reference, mainPolygon);
  const parallelRows = Array.from({ length: maxRows }, (_, rowIndex) =>
    offsetPolylinePx(reference, perpX * pitchY * rowIndex, perpY * pitchY * rowIndex),
  );
  return { lines: parallelRows, pitchY, pitchX };
}

/**
 * Place seats along each drawn row line — follows the row path the user traced.
 */
function placeSeatsAlongDrawnRows(
  rowLinesCanvasPct: ElementPosition[][],
  zonePolygon: CanvasPoint[],
  mainPolygon: CanvasPoint[],
  rect: PixelRect,
  canvas: { width: number; height: number },
  dims: PhysicalDimsInput,
  blockCode: string,
  options?: { rowSeatCounts?: number[] },
): {
  overrides: Record<string, { xPct: number; yPct: number }>;
  rowSeatCounts: number[];
  pitchX: number;
  pitchY: number;
  capacity: ReturnType<typeof computeCapacityFromDims>;
} {
  const capacity = computeCapacityFromDims(
    dims.physicalLengthM,
    dims.physicalWidthM,
    dims.chairLengthM,
    dims.chairWidthM,
  );
  const { lines, pitchX, pitchY } = buildRowPolylinesPx(
    rowLinesCanvasPct,
    canvas,
    mainPolygon,
    dims,
    capacity.maxRows,
  );
  const configuredCounts = options?.rowSeatCounts ?? [];
  const targetRowCount =
    configuredCounts.length > 0 ? configuredCounts.length : Math.min(lines.length, capacity.maxRows);
  const rowCount = Math.min(lines.length, capacity.maxRows, targetRowCount);
  const rowSeatCounts = Array.from({ length: rowCount }, () => 0);
  const overrides: Record<string, { xPct: number; yPct: number }> = {};
  const style = 'letter' as const;

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const rowLine = lines[rowIndex];
    const targetCount = configuredCounts[rowIndex];
    if (targetCount != null && targetCount <= 0) {
      rowSeatCounts[rowIndex] = 0;
      continue;
    }
    const placements = sampleSeatsFixedPitchOnPolyline(rowLine, pitchX)
      .filter((p) => pointInsideZone(p, zonePolygon, mainPolygon))
      .slice(0, targetCount ?? capacity.maxSeatsPerRow);
    if (placements.length < 2) {
      rowSeatCounts[rowIndex] = 0;
      continue;
    }
    rowSeatCounts[rowIndex] = placements.length;
    for (let seatIndex = 0; seatIndex < placements.length; seatIndex += 1) {
      const id = blockSeatId(blockCode, rowIndex, seatIndex, style);
      overrides[id] = canvasPointToElementPct(placements[seatIndex], rect);
    }
  }

  const adjustedCapacity = {
    ...capacity,
    maxRows: rowCount,
    maxCapacity: rowSeatCounts.reduce((sum, n) => sum + n, 0),
  };

  return { overrides, rowSeatCounts, pitchX, pitchY, capacity: adjustedCapacity };
}

function resolveZoneObbForPlacement(
  zonePolygon: CanvasPoint[],
  canvasPctPoints: ElementPosition[],
  canvas: { width: number; height: number },
): ZoneObb {
  if (canvasPctPoints.length >= 3) {
    return computeZoneObb(zonePolygon);
  }
  if (canvasPctPoints.length >= 2) {
    return computeZoneObbFromDraw(canvasPctPoints, canvas, zonePolygon);
  }
  return computeZoneObb(zonePolygon);
}

/** Canvas pitch for seat columns and row gaps inside a drawn zone OBB. */
function resolveZonePitchPx(
  dims: PhysicalDimsInput,
  widthPx: number,
  depthPx: number,
): { pitchX: number; rowGapPx: number } {
  const ppmAlong = widthPx / Math.max(0.001, dims.physicalWidthM);
  const ppmDepth = depthPx / Math.max(0.001, dims.physicalLengthM);
  const seatGapM = dims.seatGapM ?? DEFAULT_SEAT_GAP_M;
  const rowGapM = dims.rowGapM ?? seatGapM;
  const pitchX = Math.max(6, (dims.chairWidthM + seatGapM) * ppmAlong);
  const rowGapPx = Math.max(8, (dims.chairLengthM + rowGapM) * ppmDepth);
  return { pitchX, rowGapPx };
}

/** Left-aligned seat centres at a fixed pitch (matches drag-seats / arrange-by-row spacing). */
function leftAlignedCentersInSpan(innerMin: number, innerMax: number, pitchPx: number): number[] {
  if (pitchPx <= 0 || innerMax < innerMin) {
    return [];
  }
  const positions: number[] = [];
  let along = innerMin + pitchPx * 0.5;
  while (along <= innerMax + 0.01) {
    positions.push(along);
    along += pitchPx;
  }
  return positions;
}

/** Row depth centres inward from the zone edge at a fixed row gap. */
function rowDepthCentersInSpan(
  innerMin: number,
  innerMax: number,
  rowGapPx: number,
  spanPx: number,
  maxRows?: number,
): number[] {
  const seatRadius = resolveSeatBodyRadiusPx(rowGapPx);
  const firstDepth = resolveSeatCenterBorderPaddingPx(rowGapPx, spanPx, seatRadius);
  const depths: number[] = [];
  let depth = innerMin + firstDepth;
  while (depth <= innerMax + 0.5) {
    depths.push(depth);
    if (maxRows != null && depths.length >= maxRows) {
      break;
    }
    depth += rowGapPx;
  }
  return depths;
}

/** Sample seat centres along a polyline at fixed pitch from the row start. */
function sampleSeatsFixedPitchOnPolyline(points: CanvasPoint[], pitchPx: number): CanvasPoint[] {
  const total = polylineLength(points);
  if (total <= 0 || pitchPx <= 0 || points.length < 2) {
    return [];
  }
  const seatRadius = resolveSeatBodyRadiusPx(pitchPx);
  const startPad = resolveSeatCenterBorderPaddingPx(pitchPx, total, seatRadius);
  const positions: CanvasPoint[] = [];
  let dist = startPad;
  while (dist <= total - startPad + 0.01) {
    positions.push(pointAtArcLength(points, dist));
    dist += pitchPx;
  }
  return positions;
}

/** Capacity from the locked zone geometry on canvas (rows × seats fill the drawn area). */
function computeCapacityFromDrawnZone(
  dims: PhysicalDimsInput,
  zonePolygon: CanvasPoint[],
  canvasPctPoints: ElementPosition[],
  canvas: { width: number; height: number },
): ReturnType<typeof computeCapacityFromDims> {
  const obb = resolveZoneObbForPlacement(zonePolygon, canvasPctPoints, canvas);
  const widthPx = Math.max(obb.maxAlong - obb.minAlong, 1);
  const depthPx = Math.max(obb.maxDepth - obb.minDepth, 1);
  const ppmW = widthPx / Math.max(0.001, dims.physicalWidthM);
  const ppmL = depthPx / Math.max(0.001, dims.physicalLengthM);
  const seatGapM = dims.seatGapM ?? DEFAULT_SEAT_GAP_M;
  const rowGapM = dims.rowGapM ?? seatGapM;
  const chairWidthPx = Math.max(1, dims.chairWidthM * ppmW);
  const chairLengthPx = Math.max(1, dims.chairLengthM * ppmL);
  const gapPxW = seatGapM * ppmW;
  const gapPxL = rowGapM * ppmL;

  const maxSeatsPerRow = fitCountInSpanPx(widthPx, chairWidthPx, gapPxW);
  const maxRows = fitCountInSpanPx(depthPx, chairLengthPx, gapPxL);

  return { maxRows, maxSeatsPerRow, maxCapacity: maxRows * maxSeatsPerRow };
}

function curvedRowOffsetPx(
  seatIndex: number,
  seatCount: number,
  curveDeg: number,
  maxAmplitude: number,
): number {
  if (curveDeg === 0 || seatCount <= 1) {
    return 0;
  }
  const centered = seatIndex - (seatCount - 1) / 2;
  const halfSpan = Math.max(0.5, (seatCount - 1) / 2);
  const normalized = Math.max(-1, Math.min(1, centered / halfSpan));
  // One-sided: ends wrap toward VIEW POINT, middle stays. Not a two-ended U-bow.
  return -(normalized * normalized) * (curveDeg / 6) * maxAmplitude;
}

/**
 * One-sided circular bow for the whole block: chord is the block's along span,
 * sagitta is the wrap toward VIEW POINT. Middle of the chord stays; edges drop
 * onto the circle. Aisle leftovers and unshaped short rows use this same chord,
 * so they never get a private mini-circle.
 */
function sharedCircleArcOffsetPx(
  along: number,
  chordMid: number,
  halfSpan: number,
  sagitta: number,
): number {
  if (sagitta <= 1e-9 || halfSpan <= 1e-9) {
    return 0;
  }
  const x = Math.max(-halfSpan, Math.min(halfSpan, along - chordMid));
  const radius = (halfSpan * halfSpan) / (2 * sagitta) + sagitta / 2;
  if (radius > 1e8) {
    const normalized = x / halfSpan;
    return -normalized * normalized * sagitta;
  }
  const under = radius * radius - x * x;
  return -(radius - Math.sqrt(Math.max(0, under)));
}

/**
 * Chair facing (deg) toward a VIEW POINT focus (pitch).
 * The glyph at 0° faces up (negative-Y), so a chair looking toward direction
 * D = (dx, dy) uses atan2(dx, -dy).
 */
export function curvedSeatFacingDegTowardFocus(
  seat: CanvasPoint,
  focus: CanvasPoint,
): number {
  const dx = focus.x - seat.x;
  const dy = focus.y - seat.y;
  if (Math.hypot(dx, dy) < 1e-6) {
    return 0;
  }
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/** Legacy helper for older per-row curve ramps. */
export const ROW_CURVE_FRONT_SCALE = 0.28;

/** Scale 0 at the VIEW POINT row → 1 at the back row (small step per row). */
export function rowCurveDepthScale(rowFromFront: number, rowCount: number): number {
  if (rowCount <= 1) {
    return 1;
  }
  const t = Math.max(0, Math.min(1, rowFromFront / (rowCount - 1)));
  return ROW_CURVE_FRONT_SCALE + (1 - ROW_CURVE_FRONT_SCALE) * t;
}

function lerpAngleDeg(fromDeg: number, toDeg: number, t: number): number {
  const delta = ((toDeg - fromDeg + 540) % 360) - 180;
  return fromDeg + delta * Math.max(0, Math.min(1, t));
}

/** Bend one row's seats along the inward perpendicular — other rows are untouched. */
export function applyCurveToRowPoints(
  points: CanvasPoint[],
  curveDeg: number,
  mainPolygon: CanvasPoint[],
): CanvasPoint[] {
  if (curveDeg === 0 || points.length <= 1) {
    return points;
  }
  const first = points[0];
  const last = points[points.length - 1];
  const rowSpan = Math.hypot(last.x - first.x, last.y - first.y);
  const maxAmp = Math.min(rowSpan * 0.35, Math.max(8, rowSpan * 0.18));
  const { perpX, perpY } = getLineInwardPerpendicular([first, last], mainPolygon);

  return points.map((point, seatIndex) => {
    const offset = curvedRowOffsetPx(seatIndex, points.length, curveDeg, maxAmp);
    return { x: point.x + perpX * offset, y: point.y + perpY * offset };
  });
}

/** Parse an override seat id ("B4" or "BLOCK-B4") into 0-based row / seat indices. */
export function parseOverrideSeatId(id: string): { rowIndex: number; seatIndex: number } | null {
  const match = id.trim().match(/^(?:.*-)?([A-Z]+)(\d+)$/i);
  if (!match) {
    return null;
  }
  const rowIndex = rowLabelToIndex(match[1]);
  if (rowIndex == null || rowIndex < 0) {
    return null;
  }
  return { rowIndex, seatIndex: Math.max(0, Number.parseInt(match[2], 10) - 1) };
}

export interface SeatCurveFrame {
  origin: { x: number; y: number };
  ux: number;
  uy: number;
  perpX: number;
  perpY: number;
  /**
   * Dual VIEW POINT foci (first, second). When set, the first half of each
   * curved row orients toward the first focus and the remaining half toward
   * the second.
   */
  dualFoci?: { x: number; y: number }[];
}

/**
 * Pull a point toward the polygon centroid until it clears border padding
 * (same no-touch rule as straight seat placement).
 */
function clampPointInsidePolygonWithPadding(
  point: CanvasPoint,
  polygon: CanvasPoint[],
  paddingPx: number,
): CanvasPoint {
  if (polygon.length < 3) {
    return point;
  }
  if (pointInsidePolygonWithPadding(point, polygon, paddingPx)) {
    return point;
  }
  const centroid = polygonCentroid(polygon);
  let low = 0;
  let high = 1;
  let best = { ...centroid };
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2;
    const candidate = {
      x: point.x + (centroid.x - point.x) * mid,
      y: point.y + (centroid.y - point.y) * mid,
    };
    if (pointInsidePolygonWithPadding(candidate, polygon, paddingPx)) {
      best = candidate;
      high = mid;
    } else {
      low = mid;
    }
  }
  return best;
}

/**
 * Keep a curved seat centre inside the block with the same border padding used
 * for straight placement — binary-search back toward the straight position.
 */
function clampCurvedSeatInsideBorder(
  straight: CanvasPoint,
  curved: CanvasPoint,
  polygon: CanvasPoint[],
  paddingPx: number,
): CanvasPoint {
  if (pointInsidePolygonWithPadding(curved, polygon, paddingPx)) {
    return curved;
  }
  if (!pointInsidePolygonWithPadding(straight, polygon, paddingPx)) {
    return clampPointInsidePolygonWithPadding(straight, polygon, paddingPx);
  }
  let lo = 0;
  let hi = 1;
  let best = straight;
  for (let step = 0; step < 20; step += 1) {
    const mid = (lo + hi) / 2;
    const candidate = {
      x: straight.x + (curved.x - straight.x) * mid,
      y: straight.y + (curved.y - straight.y) * mid,
    };
    if (pointInsidePolygonWithPadding(candidate, polygon, paddingPx)) {
      best = candidate;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

function estimateCurveBorderPaddingPx(
  byRow: Map<number, { id: string; seatIndex: number; point: CanvasPoint }[]>,
  polygon: CanvasPoint[],
  originX: number,
  originY: number,
  perpX: number,
  perpY: number,
  minEdgeGapPx = 0,
): { borderPaddingPx: number; minPitchPx: number; rowPitchPx: number; seatRadiusPx: number } {
  let minAlongPitch = Number.POSITIVE_INFINITY;
  const rowDepths: number[] = [];
  for (const seats of byRow.values()) {
    const sorted = [...seats].sort((a, b) => a.seatIndex - b.seatIndex);
    for (let i = 1; i < sorted.length; i += 1) {
      const d = Math.hypot(
        sorted[i].point.x - sorted[i - 1].point.x,
        sorted[i].point.y - sorted[i - 1].point.y,
      );
      if (d > 1) {
        minAlongPitch = Math.min(minAlongPitch, d);
      }
    }
    if (sorted.length > 0) {
      const depths = sorted.map((seat) =>
        depthOf(seat.point, originX, originY, perpX, perpY),
      );
      rowDepths.push(depths.reduce((sum, d) => sum + d, 0) / depths.length);
    }
  }
  rowDepths.sort((a, b) => a - b);
  let minRowPitch = Number.POSITIVE_INFINITY;
  for (let i = 1; i < rowDepths.length; i += 1) {
    const gap = rowDepths[i] - rowDepths[i - 1];
    if (gap > 1) {
      minRowPitch = Math.min(minRowPitch, gap);
    }
  }

  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const spanW = Math.max(1, Math.max(...xs) - Math.min(...xs));
  const spanH = Math.max(1, Math.max(...ys) - Math.min(...ys));
  const span = Math.max(spanW, spanH);
  if (!Number.isFinite(minAlongPitch)) {
    minAlongPitch = Math.max(8, Math.min(spanW, spanH) * 0.08);
  }
  if (!Number.isFinite(minRowPitch)) {
    minRowPitch = minAlongPitch;
  }
  const seatRadius = resolveSeatBodyRadiusPx(minAlongPitch, minRowPitch);
  return {
    borderPaddingPx: resolveSeatCenterBorderPaddingPx(
      minAlongPitch,
      span,
      seatRadius,
      minEdgeGapPx,
    ),
    minPitchPx: minAlongPitch,
    rowPitchPx: minRowPitch,
    seatRadiusPx: seatRadius,
  };
}

/** Minimum centre-to-centre distance so drawn seat bodies never touch after curve. */
function resolveCurveSeatClearancePx(seatRadiusPx: number): number {
  return seatRadiusPx * 2 + 1;
}

function depthOf(
  point: CanvasPoint,
  originX: number,
  originY: number,
  perpX: number,
  perpY: number,
): number {
  return (point.x - originX) * perpX + (point.y - originY) * perpY;
}

/**
 * Cap relative bow drift between rows. Shared curve on every row keeps most of
 * the row gap; only a fraction is reserved so one wider row cannot overrun the next.
 */
function resolveSafeCurveAmplitudePx(
  byRow: Map<number, { id: string; seatIndex: number; point: CanvasPoint }[]>,
  originX: number,
  originY: number,
  perpX: number,
  perpY: number,
  clearancePx: number,
): number {
  const rowDepths = [...byRow.values()]
    .map((seats) => {
      if (seats.length === 0) {
        return null;
      }
      const depths = seats.map((seat) =>
        depthOf(seat.point, originX, originY, perpX, perpY),
      );
      return depths.reduce((sum, d) => sum + d, 0) / depths.length;
    })
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b);

  if (rowDepths.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  let minGap = Number.POSITIVE_INFINITY;
  for (let i = 1; i < rowDepths.length; i += 1) {
    minGap = Math.min(minGap, rowDepths[i] - rowDepths[i - 1]);
  }
  if (!Number.isFinite(minGap) || minGap <= 0) {
    return 0;
  }
  // Allow a strong default bow; pairwise overlap pass still scales down if needed.
  return Math.max(minGap * 0.75, Math.max(0, minGap - clearancePx * 0.35));
}

function curvedSeatsClearOfEachOther(
  points: CanvasPoint[],
  clearancePx: number,
): boolean {
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      if (d < clearancePx - 0.5) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Curve every created seat on the block toward the VIEW POINT on **one shared
 * circle**. The chord is the full block along-span (not each row, aisle leftover,
 * or unshaped short row). Edge seats wrap toward the viewpoint; the middle stays.
 * Every row uses the same sagitta on that shared circle so curvature stays
 * visually identical and rows keep their straight-layout spacing.
 * Dual viewpoints: first half of the block faces the first VIEW POINT, the
 * remaining half faces the second.
 */
export function applySharedBlockCurveToOverrides(
  overrides: Record<string, CustomShapeSeatPosition>,
  rect: PixelRect,
  polygon: CanvasPoint[],
  curveDeg: number,
  viewpointFrame?: SeatCurveFrame | null,
  minEdgeGapPx = 0,
): Record<string, CustomShapeSeatPosition> {
  const ids = Object.keys(overrides);
  if (ids.length === 0 || polygon.length < 3) {
    return { ...overrides };
  }
  if (curveDeg === 0) {
    const straight: Record<string, CustomShapeSeatPosition> = {};
    for (const id of ids) {
      const pos = overrides[id];
      straight[id] = { xPct: pos.xPct, yPct: pos.yPct };
    }
    return straight;
  }

  const byRow = new Map<number, { id: string; seatIndex: number; point: CanvasPoint }[]>();
  let fallbackRow = 10_000;
  for (const id of ids) {
    const parsed = parseOverrideSeatId(id);
    const rowIndex = parsed?.rowIndex ?? fallbackRow++;
    const seatIndex = parsed?.seatIndex ?? 0;
    const pos = overrides[id];
    const list = byRow.get(rowIndex) ?? [];
    list.push({
      id,
      seatIndex,
      point: elementPctToCanvasPoint(pos.xPct, pos.yPct, rect),
    });
    byRow.set(rowIndex, list);
  }

  let ux = viewpointFrame?.ux ?? 0;
  let uy = viewpointFrame?.uy ?? 0;
  // Positive perp is inward from the VIEW POINT edge (same depth axis as row placement).
  let perpX = viewpointFrame?.perpX ?? 0;
  let perpY = viewpointFrame?.perpY ?? 0;
  let originX = viewpointFrame?.origin.x ?? 0;
  let originY = viewpointFrame?.origin.y ?? 0;
  const frameLen = Math.hypot(ux, uy);
  if (frameLen < 1e-6) {
    const refRow = [...byRow.values()]
      .map((seats) => [...seats].sort((a, b) => a.seatIndex - b.seatIndex))
      .find((seats) => seats.length >= 2);
    if (!refRow) {
      return { ...overrides };
    }
    const first = refRow[0].point;
    const last = refRow[refRow.length - 1].point;
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) {
      return { ...overrides };
    }
    ux = dx / len;
    uy = dy / len;
    originX = first.x;
    originY = first.y;
    const inward = getLineInwardPerpendicular([first, last], polygon);
    perpX = inward.perpX;
    perpY = inward.perpY;
  }

  const alongOf = (point: CanvasPoint): number =>
    (point.x - originX) * ux + (point.y - originY) * uy;
  const allAlongs = [...byRow.values()].flat().map((seat) => alongOf(seat.point));
  const globalMin = Math.min(...allAlongs);
  const globalMax = Math.max(...allAlongs);
  const globalMid = (globalMin + globalMax) / 2;
  const focus = {
    x: originX + ux * globalMid,
    y: originY + uy * globalMid,
  };
  const dualRaw = (viewpointFrame?.dualFoci ?? []).filter(
    (pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y),
  );
  const dualFoci = dualRaw.length >= 2 ? [dualRaw[0], dualRaw[1]] : null;
  const { borderPaddingPx, seatRadiusPx } = estimateCurveBorderPaddingPx(
    byRow,
    polygon,
    originX,
    originY,
    perpX,
    perpY,
    Math.max(0, minEdgeGapPx),
  );
  const clearancePx = resolveCurveSeatClearancePx(seatRadiusPx);
  const safeAmpCap = resolveSafeCurveAmplitudePx(
    byRow,
    originX,
    originY,
    perpX,
    perpY,
    clearancePx,
  );

  const globalSpan = Math.max(1, globalMax - globalMin);
  const globalHalfSpan = globalSpan / 2;
  const sharedMaxAmp = Math.min(
    globalSpan * 0.35,
    Math.max(8, globalSpan * 0.18),
    safeAmpCap,
  );

  const rowPlans = [...byRow.values()].map((rowSeats) => {
    const sorted = [...rowSeats].sort((a, b) => a.seatIndex - b.seatIndex);
    const alongs = sorted.map((seat) => alongOf(seat.point));
    const depth =
      sorted.reduce(
        (sum, seat) => sum + depthOf(seat.point, originX, originY, perpX, perpY),
        0,
      ) / Math.max(1, sorted.length);
    return { sorted, alongs, depth };
  });

  const straightFacingDeg = curvedSeatFacingDegTowardFocus(
    { x: 0, y: 0 },
    { x: -perpX, y: -perpY },
  );

  // Curve each row on the shared block circle; trim seats that leave the border.
  const result: Record<string, CustomShapeSeatPosition> = {};

  for (const plan of rowPlans) {
    const amplitude = (curveDeg / 6) * sharedMaxAmp * ROW_CURVE_FRONT_SCALE;

    // One shared circle for the whole block. Dual: split at the block mid, not
    // each leftover / unshaped row's own mid.
    const rowCurved: { id: string; point: CanvasPoint; rotationDeg: number }[] = [];
    const splitAlong = globalMid;
    const focusA = dualFoci?.[0] ?? focus;
    const focusB = dualFoci?.[1] ?? focus;
    const firstOwnsLowAlong = dualFoci ? alongOf(focusA) <= alongOf(focusB) : true;
    for (let i = 0; i < plan.sorted.length; i += 1) {
      const along = plan.alongs[i];
      const offset = sharedCircleArcOffsetPx(along, globalMid, globalHalfSpan, amplitude);
      const point = plan.sorted[i].point;
      const onLowAlong = along < splitAlong;
      const seatFocus = dualFoci
        ? onLowAlong === firstOwnsLowAlong
          ? focusA
          : focusB
        : focus;
      let curved = { x: point.x + perpX * offset, y: point.y + perpY * offset };
      if (dualFoci) {
        const dx = seatFocus.x - point.x;
        const dy = seatFocus.y - point.y;
        const len = Math.hypot(dx, dy) || 1;
        const pull = Math.abs(offset);
        curved = {
          x: point.x + (dx / len) * pull,
          y: point.y + (dy / len) * pull,
        };
      }
      const focusFacing = curvedSeatFacingDegTowardFocus(curved, seatFocus);
      rowCurved.push({
        id: plan.sorted[i].id,
        point: curved,
        rotationDeg: lerpAngleDeg(straightFacingDeg, focusFacing, 1),
      });
    }

    // Trim from both edges inward: remove seats that touch the border.
    // Find the valid continuous range [left..right].
    let left = 0;
    let right = rowCurved.length - 1;
    while (
      left <= right &&
      !pointInsidePolygonWithPadding(rowCurved[left].point, polygon, borderPaddingPx)
    ) {
      left += 1;
    }
    while (
      right >= left &&
      !pointInsidePolygonWithPadding(rowCurved[right].point, polygon, borderPaddingPx)
    ) {
      right -= 1;
    }

    // Keep only the continuous range of seats that fit inside the border.
    for (let i = left; i <= right; i += 1) {
      // Double-check each remaining seat is inside (for concave shapes).
      if (pointInsidePolygonWithPadding(rowCurved[i].point, polygon, borderPaddingPx)) {
        result[rowCurved[i].id] = {
          ...canvasPointToElementPct(rowCurved[i].point, rect),
        };
      }
    }
  }

  // Second pass: drop seats that overlap a shallower kept seat. Aisle leftovers
  // and unshaped short rows stay on the shared circle — only the colliding
  // chairs go, not the whole row.
  const rowResults = rowPlans
    .map((plan) => ({
      depth: plan.depth,
      entries: plan.sorted
        .map((seat) => ({ id: seat.id, point: result[seat.id] }))
        .filter((entry) => entry.point != null),
    }))
    .sort((a, b) => a.depth - b.depth);
  const keptPts: CanvasPoint[] = [];
  for (const row of rowResults) {
    const surviving: { id: string; point: CustomShapeSeatPosition }[] = [];
    for (const entry of row.entries) {
      const pt = elementPctToCanvasPoint(entry.point!.xPct, entry.point!.yPct, rect);
      const overlaps = keptPts.some(
        (q) => Math.hypot(pt.x - q.x, pt.y - q.y) < clearancePx - 0.5,
      );
      if (overlaps) {
        delete result[entry.id];
      } else {
        surviving.push({ id: entry.id, point: entry.point! });
      }
    }
    if (surviving.length < 2) {
      for (const entry of surviving) {
        delete result[entry.id];
      }
      continue;
    }
    for (const entry of surviving) {
      keptPts.push(elementPctToCanvasPoint(entry.point.xPct, entry.point.yPct, rect));
    }
  }

  return result;
}

function placeFullSeatGridInZone(
  zonePolygon: CanvasPoint[],
  mainPolygon: CanvasPoint[],
  rect: PixelRect,
  blockCode: string,
  canvasPctPoints: ElementPosition[],
  canvas: { width: number; height: number },
  rowCount: number,
  seatsPerRow: number,
  dims: PhysicalDimsInput,
  options?: {
    rowSeatCounts?: number[];
    rowCurveDegs?: number[];
    hiddenSeatIds?: Set<string>;
  },
): {
  overrides: Record<string, { xPct: number; yPct: number }>;
  rowSeatCounts: number[];
  pitchX: number;
  pitchY: number;
} {
  const obb = resolveZoneObbForPlacement(zonePolygon, canvasPctPoints, canvas);
  const widthPx = Math.max(obb.maxAlong - obb.minAlong, 1);
  const depthPx = Math.max(obb.maxDepth - obb.minDepth, 1);
  const { pitchX, rowGapPx } = resolveZonePitchPx(dims, widthPx, depthPx);
  const configuredCounts = options?.rowSeatCounts;
  const maxRows =
    configuredCounts && configuredCounts.length > 0
      ? configuredCounts.length
      : Math.max(1, rowCount);

  const seatRadius = resolveSeatBodyRadiusPx(pitchX, rowGapPx);
  const alongPadding = resolveSeatCenterBorderPaddingPx(pitchX, widthPx, seatRadius);
  const depthPadding = resolveSeatCenterBorderPaddingPx(rowGapPx, depthPx, seatRadius);
  const innerAlongMin = obb.minAlong + alongPadding;
  const innerAlongMax = obb.maxAlong - alongPadding;
  const innerDepthMin = obb.minDepth + depthPadding;
  const innerDepthMax = obb.maxDepth - depthPadding;
  const edgePadding = resolveSeatCenterBorderPaddingPx(pitchX, widthPx, seatRadius);

  const depthCenters = rowDepthCentersInSpan(
    innerDepthMin,
    innerDepthMax,
    rowGapPx,
    depthPx,
    maxRows,
  );

  const overrides: Record<string, { xPct: number; yPct: number }> = {};
  const rowSeatCounts: number[] = [];
  const style = 'letter' as const;
  const hidden = options?.hiddenSeatIds ?? new Set<string>();
  const alongPositions = leftAlignedCentersInSpan(innerAlongMin, innerAlongMax, pitchX);

  for (let rowIndex = 0; rowIndex < depthCenters.length; rowIndex += 1) {
    const depthCenter = depthCenters[rowIndex];
    const seatCap = configuredCounts?.[rowIndex] ?? seatsPerRow;
    let placedInRow = 0;

    for (let seatIndex = 0; seatIndex < alongPositions.length; seatIndex += 1) {
      if (seatCap > 0 && placedInRow >= seatCap) {
        break;
      }
      const id = blockSeatId(blockCode, rowIndex, seatIndex, style);
      if (hidden.has(id)) {
        continue;
      }
      const candidate = obbPointToCanvas(obb, alongPositions[seatIndex], depthCenter);
      if (
        !pointInsideZone(candidate, zonePolygon, mainPolygon) ||
        !pointInsidePolygonWithPadding(candidate, zonePolygon, edgePadding)
      ) {
        continue;
      }
      overrides[id] = canvasPointToElementPct(candidate, rect);
      placedInRow += 1;
    }
    if (placedInRow >= 2) {
      rowSeatCounts[rowIndex] = placedInRow;
    } else {
      for (let seatIndex = 0; seatIndex < alongPositions.length; seatIndex += 1) {
        delete overrides[blockSeatId(blockCode, rowIndex, seatIndex, style)];
      }
      if (rowIndex === 0) {
        rowSeatCounts[rowIndex] = 0;
      } else if (placedInRow === 0) {
        break;
      } else {
        rowSeatCounts[rowIndex] = 0;
      }
    }
  }

  return { overrides, rowSeatCounts, pitchX, pitchY: rowGapPx };
}

function canvasPointsToElementBoundary(
  zone: CanvasPoint[],
  rect: PixelRect,
): ElementPosition[] {
  return zone.map((p) => canvasPointToElementPct(p, rect));
}

function buildSeatsFromBlock(
  block: CustomShapeSeatBlock,
  element: CenterpieceElement,
  rect: PixelRect,
): CustomShapeSeatMap {
  if (!block.seatLayout) {
    return { seats: [], rowLabels: [] };
  }
  const polygon = getPrimaryOutlineCanvasPoints(element, rect);
  const spec = getSeatLayoutSpec({
    rows: block.rows,
    seatsPerRow: block.seatsPerRow,
    rowLabelStyle: block.rowLabelStyle,
    seatLayout: block.seatLayout,
  });
  const rowSeatCounts = getSeatLayoutRowSeatCounts(spec);
  const overrides = block.seatPositionOverrides ?? {};
  const hidden = new Set(spec.hiddenSeatIds ?? []);
  const style = spec.rowLabelStyle ?? 'letter';
  const pitch =
    spec.customShapeSeatPitchPx && spec.customShapeSeatPitchPx > 0
      ? spec.customShapeSeatPitchPx
      : chairPitchPx(
          {
            ...element,
            physicalLengthM: block.physicalLengthM,
            physicalWidthM: block.physicalWidthM,
            chairLengthM: block.chairLengthM,
            chairWidthM: block.chairWidthM,
          },
          rect,
        );
  const radius = resolveSeatBodyRadiusPx(pitch);
  const rowCurveDegs = spec.rowCurveDegs ?? [];
  const seats: CustomShapeSeatMap['seats'] = [];

  for (let rowIndex = 0; rowIndex < spec.rows; rowIndex += 1) {
    const rowSeats: { id: string; seatIndex: number; x: number; y: number }[] = [];
    for (let seatIndex = 0; seatIndex < spec.seatsPerRow; seatIndex += 1) {
      const id = blockSeatId(block.code, rowIndex, seatIndex, style);
      if (hidden.has(id)) {
        continue;
      }
      const override = overrides[id];
      if (!override) {
        continue;
      }
      const basePoint = elementPctToCanvasPoint(override.xPct, override.yPct, rect);
      rowSeats.push({ id, seatIndex, x: basePoint.x, y: basePoint.y });
    }
    if (rowSeats.length === 0) {
      continue;
    }

    const curveDeg = rowCurveDegs[rowIndex] ?? 0;
    const curvedPoints = applyCurveToRowPoints(
      rowSeats.map((s) => ({ x: s.x, y: s.y })),
      curveDeg,
      polygon,
    );
    const first = rowSeats[0];
    const last = rowSeats[rowSeats.length - 1];
    const mid = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
    const { perpX, perpY } = getLineInwardPerpendicular(
      [
        { x: first.x, y: first.y },
        { x: last.x, y: last.y },
      ],
      polygon,
    );
    const rowLen = Math.hypot(last.x - first.x, last.y - first.y);
    const focus = {
      x: mid.x - perpX * Math.max(24, rowLen),
      y: mid.y - perpY * Math.max(24, rowLen),
    };

    for (let i = 0; i < rowSeats.length; i += 1) {
      const pt = curvedPoints[i];
      seats.push({
        key: rowSeats[i].id,
        seatId: rowSeats[i].id,
        rowIndex,
        blockId: block.id,
        label: rowSeats[i].id,
        x: pt.x,
        y: pt.y,
        radius,
        pitchPx: pitch,
        rotationDeg: undefined,
      });
    }
  }

  const rowLabels: RowLabelNode[] = [];
  if (!element.perSeatPlacementMode) {
    appendBlockRowLabels(rowLabels, seats, spec, polygon, pitch, block.id);
  }

  return { seats, rowLabels };
}

/**
 * Fill every seat that fits inside a drawn zone using block + chair dimensions.
 */
export function createSeatBlockFromDrawnZone(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  rowLines: ElementPosition[][],
  dims: PhysicalDimsInput,
  blockIndex: number,
): CustomShapeSeatBlock {
  const mainPolygon = getPrimaryOutlineCanvasPoints(element, rect);
  const mergedDims = mergePlacementDims(element, dims);
  const zonePolygon = buildZonePolygonFromRowLines(
    rowLines,
    canvas,
    mainPolygon,
    mergedDims,
    element,
    rect,
  );
  const code = `B${blockIndex + 1}`;
  const style = 'letter' as const;
  const grid = placeDragSeatsGridInDrawnZone(
    element,
    mainPolygon,
    zonePolygon,
    rect,
    code,
    mergedDims,
  );
  const { overrides, rowSeatCounts, pitchX, pitchY } = grid;
  const dimsCapacity = {
    maxRows: Math.max(1, rowSeatCounts.length),
    maxSeatsPerRow: Math.max(1, maxSeatsInRowCounts(rowSeatCounts)),
    maxCapacity: rowSeatCounts.reduce((sum, count) => sum + count, 0),
  };
  const actualRows = Math.max(1, rowSeatCounts.length);
  const layoutSeatsPerRow = Math.max(
    dimsCapacity.maxSeatsPerRow,
    maxSeatsInRowCounts(rowSeatCounts),
  );
  const spec = capSeatLayoutToCapacity(
    createSeatLayoutSpec(actualRows, layoutSeatsPerRow, style),
    actualRows,
    layoutSeatsPerRow,
  );
  const pitch = Math.max(pitchX, 6);
  const capped = capSeatLayoutToCapacity(
    { ...spec, rowSeatCounts, customShapeSeatPitchPx: pitch },
    actualRows,
    layoutSeatsPerRow,
  );

  return {
    id: `cblock-${Date.now().toString(36)}-${blockIndex}`,
    code,
    boundaryPoints: canvasPointsToElementBoundary(zonePolygon, rect),
    physicalLengthM: mergedDims.physicalLengthM,
    physicalWidthM: mergedDims.physicalWidthM,
    chairLengthM: mergedDims.chairLengthM,
    chairWidthM: mergedDims.chairWidthM,
    rows: capped.rows,
    seatsPerRow: capped.seatsPerRow,
    rowLabelStyle: style,
    seatLayout: capped,
    seatPositionOverrides: overrides,
    rowLines,
  };
}

export function getLockedBlockPolygonsCanvasPx(
  element: CenterpieceElement,
  rect: PixelRect,
): CanvasPoint[][] {
  return (element.customSeatBlocks ?? []).map((block) =>
    (block.boundaryPoints ?? []).map((p) => elementPctToCanvasPoint(p.xPct, p.yPct, rect)),
  );
}

export function getPendingBlockPreviewPolygon(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  rowLines: ElementPosition[][],
  previewWidthM: number,
  previewLengthM: number,
): CanvasPoint[] {
  const mainPolygon = getPrimaryOutlineCanvasPoints(element, rect);
  return buildZonePolygonFromRowLines(
    rowLines,
    canvas,
    mainPolygon,
    {
      physicalLengthM: previewLengthM,
      physicalWidthM: previewWidthM,
      chairLengthM: resolveChairLengthM(element),
      chairWidthM: resolveChairWidthM(element),
      seatGapM: resolveSeatGapM(element),
      rowGapM: resolveRowGapM(element),
    },
    element,
    rect,
  );
}

export function getRowLinesCanvasPx(
  rowLines: ElementPosition[][],
  canvas: { width: number; height: number },
): CanvasPoint[][] {
  return rowLines
    .filter((line) => line.length >= 2)
    .map((line) => canvasPctLineToPx(line, canvas));
}

function getReferenceSeatPitch(
  el: CenterpieceElement,
  rect: PixelRect,
  spec: SeatLayoutSpec,
  polygon: CanvasPoint[],
  rowCenterYs: number[],
  rowSeatCounts: number[],
): number {
  const fromPhysical = chairPitchPx(el, rect);
  let widestSpanWidth = 0;
  for (const rowCenterY of rowCenterYs) {
    const span = getPolygonHorizontalSpanAtY(polygon, rowCenterY);
    if (span) {
      widestSpanWidth = Math.max(widestSpanWidth, span.width);
    }
  }
  const maxConfigured = Math.max(spec.seatsPerRow, ...rowSeatCounts, 1);
  const fromWidestRow =
    widestSpanWidth > 0 ? widestSpanWidth / Math.max(1, maxConfigured * 1.35) : fromPhysical;
  return Math.max(fromPhysical, fromWidestRow);
}

export function buildCustomShapeSeatMap(
  element: CenterpieceElement,
  rect: PixelRect,
): CustomShapeSeatMap {
  if (!isCustomShapeSeatingEnabled(element)) {
    return { seats: [], rowLabels: [] };
  }
  const polygon = getPrimaryOutlineCanvasPoints(element, rect);
  if (polygon.length < 3) {
    return { seats: [], rowLabels: [] };
  }

  const blocks = element.customSeatBlocks ?? [];
  if (blocks.length > 0) {
    const seats: CustomShapeSeatMap['seats'] = [];
    const rowLabels: RowLabelNode[] = [];
    for (const block of blocks) {
      const map = buildSeatsFromBlock(block, element, rect);
      seats.push(...map.seats);
      rowLabels.push(...map.rowLabels);
    }
    return { seats, rowLabels };
  }

  const spec = getSeatLayoutSpec({
    rows: element.rows,
    seatsPerRow: element.seatsPerRow,
    rowLabelStyle: element.rowLabelStyle,
    seatLayout: element.seatLayout,
  });
  const aisleAfter = getAisleAfterSeatNumbers(spec);
  const rowSeatCounts = getSeatLayoutRowSeatCounts(spec);
  const { rowOffsetXPcts, rowOffsetYPcts } = getSeatLayoutRowOffsets(spec);
  const cells = getSeatCellsFromSpec(spec).filter((c) => !c.isHidden);
  const overrides = element.seatPositionOverrides ?? {};

  const usePlacedOverrides = Object.keys(overrides).length > 0;

  if (usePlacedOverrides && Object.keys(overrides).length > 0) {
    const pitch =
      spec.customShapeSeatPitchPx && spec.customShapeSeatPitchPx > 0
        ? spec.customShapeSeatPitchPx
        : chairPitchPx(element, rect);
    const radius = resolveSeatBodyRadiusPx(pitch);
    const seats: CustomShapeSeatMap['seats'] = [];
    for (const cell of cells) {
      const override = overrides[cell.seatId];
      if (!override) {
        continue;
      }
      const point = elementPctToCanvasPoint(override.xPct, override.yPct, rect);
      if (!pointInPolygon(point, polygon)) {
        continue;
      }
      seats.push({
        key: cell.seatId,
        seatId: cell.seatId,
        rowIndex: cell.rowIndex,
        label: cell.seatId,
        x: point.x,
        y: point.y,
        radius,
        pitchPx: pitch,
        rotationDeg: undefined,
      });
    }
    const rowLabels: RowLabelNode[] = [];
    appendCustomShapeRowLabels(rowLabels, seats, spec, polygon, pitch, element.perSeatPlacementMode);
    return { seats, rowLabels };
  }

  const pitchForRange = chairPitchPx(element, rect);
  const seatRadiusForRange = resolveSeatBodyRadiusPx(pitchForRange);
  const { minY, maxY } = getPolygonVerticalRange(polygon, pitchForRange, seatRadiusForRange);
  const gapPx = rowGapPx(element, rect);
  const rowHeight = Math.max(gapPx, (maxY - minY) / Math.max(1, spec.rows));

  const rowCenterYs = Array.from({ length: spec.rows }, (_, rowIndex) =>
    minY +
    rowHeight / 2 +
    rowIndex * rowHeight +
    ((rowOffsetYPcts[rowIndex] ?? 0) / 100) * (maxY - minY),
  );
  const referenceSeatPitch =
    spec.customShapeSeatPitchPx && spec.customShapeSeatPitchPx > 0
      ? spec.customShapeSeatPitchPx
      : getReferenceSeatPitch(element, rect, spec, polygon, rowCenterYs, rowSeatCounts);

  const seats: CustomShapeSeatMap['seats'] = [];
  const rowLabels: RowLabelNode[] = [];
  const aisleGapFraction = 0.65;
  const radius = Math.max(
    2.8,
    Math.min(rowHeight * 0.34, referenceSeatPitch * 0.42),
  );

  for (let rowIndex = 0; rowIndex < spec.rows; rowIndex += 1) {
    const configuredSeatCount = rowSeatCounts[rowIndex] ?? 0;
    if (configuredSeatCount <= 0) {
      continue;
    }
    const rowCenterY = rowCenterYs[rowIndex];
    const span = getPolygonHorizontalSpanAtY(polygon, rowCenterY);
    if (!span) {
      continue;
    }
    const borderPadding = resolveSeatCenterBorderPaddingPx(
      referenceSeatPitch,
      span.width,
      radius,
    );
    const offsetXPct = rowOffsetXPcts[rowIndex] ?? 0;
    const rowShift = offsetXPct !== 0 ? (offsetXPct / 100) * span.width : 0;
    const rowAisleAfter = aisleAfter.filter((v) => v < configuredSeatCount);
    const seatAlign = spec.seatAlign ?? 'center';
    const xPositions = placeSeatsWithFixedPitch(
      configuredSeatCount,
      span.minX + rowShift,
      span.maxX + rowShift,
      referenceSeatPitch,
      rowAisleAfter,
      aisleGapFraction,
      seatAlign,
    );
    const rowCells = cells.filter((c) => c.rowIndex === rowIndex);

    for (const cell of rowCells) {
      const override = overrides[cell.seatId];
      if (!override && cell.seatIndex >= xPositions.length) {
        continue;
      }
      const basePoint = override
        ? elementPctToCanvasPoint(override.xPct, override.yPct, rect)
        : { x: xPositions[cell.seatIndex], y: rowCenterY };
      if (!pointInPolygon(basePoint, polygon)) {
        continue;
      }
      const seatPoint = pointInsidePolygonWithPadding(basePoint, polygon, borderPadding)
        ? basePoint
        : clampPointInsidePolygon(basePoint, polygon);
      if (!pointInsidePolygonWithPadding(seatPoint, polygon, borderPadding)) {
        continue;
      }
      seats.push({
        key: cell.seatId,
        seatId: cell.seatId,
        rowIndex: rowIndex,
        label: cell.seatId,
        x: seatPoint.x,
        y: seatPoint.y,
        radius,
      });
    }
  }

  appendCustomShapeRowLabels(
    rowLabels,
    seats,
    spec,
    polygon,
    referenceSeatPitch,
    element.perSeatPlacementMode,
  );

  return { seats, rowLabels };
}

const DEFINE_GRID_MIN_SPACING_PX = 12;

/** Suggest row/column counts from the custom outline size on canvas. */
export function estimateGridDefaultsForCustomShape(
  element: CenterpieceElement,
  rect: PixelRect,
): { rows: number; columns: number } {
  const polygon = getPrimaryOutlineCanvasPoints(element, rect);
  if (polygon.length < 3) {
    return { rows: 4, columns: 8 };
  }
  const obb = computeZoneObb(polygon);
  const widthPx = Math.max(obb.maxAlong - obb.minAlong, 1);
  const depthPx = Math.max(obb.maxDepth - obb.minDepth, 1);
  return {
    rows: Math.max(1, Math.min(100, Math.floor(depthPx / DEFINE_GRID_MIN_SPACING_PX))),
    columns: Math.max(1, Math.min(100, Math.floor(widthPx / DEFINE_GRID_MIN_SPACING_PX))),
  };
}

/** Evenly spread rows × columns inside the custom outline (no physical dims). */
export function placeDefineByRowColumnGridInShape(
  element: CenterpieceElement,
  rect: PixelRect,
  rows: number,
  columns: number,
): {
  overrides: Record<string, { xPct: number; yPct: number }>;
  pitch: number;
  rows: number;
  seatsPerRow: number;
  seatLayout: SeatLayoutSpec;
} {
  const polygon = getPrimaryOutlineCanvasPoints(element, rect);
  const safeRows = Math.max(1, Math.round(rows));
  const safeCols = Math.max(1, Math.round(columns));
  const style = 'letter' as const;

  if (polygon.length < 3) {
    const emptySpec = createSeatLayoutSpec(0, 0, style);
    return {
      overrides: {},
      pitch: 12,
      rows: 0,
      seatsPerRow: 0,
      seatLayout: emptySpec,
    };
  }

  const obb = computeZoneObb(polygon);
  const widthPx = Math.max(obb.maxAlong - obb.minAlong, 1);
  const depthPx = Math.max(obb.maxDepth - obb.minDepth, 1);
  const insetAlong = widthPx * 0.04;
  const insetDepth = depthPx * 0.04;
  const alongCenters = spreadCentroidsInSpan(safeCols, Math.max(1, widthPx - insetAlong * 2));
  const depthCenters = spreadCentroidsInSpan(safeRows, Math.max(1, depthPx - insetDepth * 2));
  const pitch = Math.min(
    (widthPx - insetAlong * 2) / safeCols,
    (depthPx - insetDepth * 2) / safeRows,
    48,
  );

  const spec = createSeatLayoutSpec(safeRows, safeCols, style);
  const rowSeatCounts = Array.from({ length: safeRows }, () => safeCols);
  const cells = getSeatCellsFromSpec({ ...spec, rowSeatCounts }).filter((c) => !c.isHidden);
  const overrides: Record<string, { xPct: number; yPct: number }> = {};

  for (const cell of cells) {
    const along = obb.minAlong + insetAlong + alongCenters[cell.seatIndex];
    const depth = obb.minDepth + insetDepth + depthCenters[cell.rowIndex];
    const raw = obbPointToCanvas(obb, along, depth);
    const point = clampPointInsidePolygon(raw, polygon);
    overrides[cell.seatId] = canvasPointToElementPct(point, rect);
  }

  return {
    overrides,
    pitch: Math.max(6, pitch),
    rows: safeRows,
    seatsPerRow: safeCols,
    seatLayout: {
      ...spec,
      rowSeatCounts,
      customShapeSeatPitchPx: Math.max(6, pitch),
      seatAlign: 'center',
    },
  };
}

export function getCustomShapeVisibleSeatCount(
  element: CenterpieceElement,
  _rect?: PixelRect,
): number {
  return getSeatingBlockStoredStats(element).totalSeats;
}

/**
 * Rows / columns / total from the saved seat layout (CSV / Auto Fill / editor),
 * the same numbers stored in `layout_config`. Hover and badges must match this.
 */
export function getSeatingBlockDisplayStats(
  element: CenterpieceElement,
  _rect?: PixelRect,
): { rows: number; columns: number; totalSeats: number } {
  return getSeatingBlockStoredStats(element);
}

export function getSeatingBlockStoredStats(
  element: CenterpieceElement,
): { rows: number; columns: number; totalSeats: number } {
  const blocks = element.customSeatBlocks ?? [];
  if (blocks.length > 0) {
    let rows = 0;
    let columns = 0;
    let totalSeats = 0;
    for (const block of blocks) {
      const stats = storedStatsFromLayoutSource(block);
      rows += stats.rows;
      if (stats.columns > columns) {
        columns = stats.columns;
      }
      totalSeats += stats.totalSeats;
    }
    return { rows, columns, totalSeats };
  }
  return storedStatsFromLayoutSource(element);
}

function storedStatsFromLayoutSource(source: {
  rows?: number;
  seatsPerRow?: number;
  rowLabelStyle?: CenterpieceElement['rowLabelStyle'];
  seatLayout?: SeatLayoutSpec;
}): { rows: number; columns: number; totalSeats: number } {
  if (source.seatLayout == null && !(source.rows && source.seatsPerRow)) {
    return { rows: 0, columns: 0, totalSeats: 0 };
  }
  return getSeatLayoutDisplayStats(
    getSeatLayoutSpec({
      rows: source.rows,
      seatsPerRow: source.seatsPerRow,
      rowLabelStyle: source.rowLabelStyle,
      seatLayout: source.seatLayout,
    }),
  );
}

export function getCustomShapeRowInsideSeatCounts(
  element: CenterpieceElement,
  _rect?: PixelRect,
): number[] {
  if (!isCustomShapeSeatingEnabled(element)) {
    return [];
  }
  const blocks = element.customSeatBlocks ?? [];
  if (blocks.length === 1) {
    return getSeatLayoutRowSeatCounts(
      getSeatLayoutSpec({
        rows: blocks[0].rows,
        seatsPerRow: blocks[0].seatsPerRow,
        rowLabelStyle: blocks[0].rowLabelStyle,
        seatLayout: blocks[0].seatLayout,
      }),
    );
  }
  if ((element.rows ?? 0) <= 0 && element.seatLayout == null) {
    return [];
  }
  return getSeatLayoutRowSeatCounts(
    getSeatLayoutSpec({
      rows: element.rows,
      seatsPerRow: element.seatsPerRow,
      rowLabelStyle: element.rowLabelStyle,
      seatLayout: element.seatLayout,
    }),
  );
}

function isTooCloseToExisting(candidate: CanvasPoint, existing: CanvasPoint[], minDist = 14): boolean {
  return existing.some(
    (p) => (p.x - candidate.x) ** 2 + (p.y - candidate.y) ** 2 < minDist ** 2,
  );
}

function findPlacementForNewSeat(polygon: CanvasPoint[], existing: CanvasPoint[]): CanvasPoint {
  const minDist = 14;
  const tooClose = (c: CanvasPoint) => isTooCloseToExisting(c, existing, minDist);
  if (existing.length > 0) {
    const anchor = existing.reduce((best, p) => (p.x > best.x ? p : best), existing[0]);
    const offsets = [
      { dx: 18, dy: 0 },
      { dx: 0, dy: 18 },
      { dx: -18, dy: 0 },
      { dx: 0, dy: -18 },
    ];
    for (const { dx, dy } of offsets) {
      const candidate = clampPointInsidePolygon({ x: anchor.x + dx, y: anchor.y + dy }, polygon);
      if (!tooClose(candidate)) {
        return candidate;
      }
    }
  }
  const { minY, maxY } = getPolygonVerticalRange(polygon);
  const seedY = minY + (maxY - minY) * 0.18;
  const span = getPolygonHorizontalSpanAtY(polygon, seedY);
  const seed = span
    ? { x: span.minX + span.width * 0.12, y: seedY }
    : polygon[0] ?? { x: 0, y: 0 };
  for (let ring = 0; ring < 8; ring += 1) {
    for (let index = 0; index < 10; index += 1) {
      const angle = (index / 10) * Math.PI * 2 + ring * 0.3;
      const r = 6 + ring * 8;
      const candidate = clampPointInsidePolygon(
        { x: seed.x + Math.cos(angle) * r, y: seed.y + Math.sin(angle) * r },
        polygon,
      );
      if (!tooClose(candidate)) {
        return candidate;
      }
    }
  }
  return clampPointInsidePolygon(seed, polygon);
}

export function createDefaultCustomShapeSeating(
  element: CenterpieceElement,
  rect: PixelRect,
  dims?: PhysicalDimsInput,
): Partial<CenterpieceElement> {
  if (dims) {
    return createEmptyCustomShapeSeating(element, rect, dims);
  }
  return createMaxCapacityCustomShapeSeating(element, rect);
}

/** Save dimensions and enable seat tools — no seats placed until custom draw is used. */
export function createEmptyCustomShapeSeating(
  element: CenterpieceElement,
  rect: PixelRect,
  dims: PhysicalDimsInput,
): Partial<CenterpieceElement> {
  const el: CenterpieceElement = { ...element, ...dims };
  const capacity = computePhysicalCapacity(el);
  const pitch = chairPitchPx(el, rect);
  const spec = capSeatLayoutToCapacity(
    createSeatLayoutSpec(capacity.maxRows, capacity.maxSeatsPerRow, 'letter'),
    capacity.maxRows,
    capacity.maxSeatsPerRow,
  );
  return {
    physicalLengthM: dims.physicalLengthM,
    physicalWidthM: dims.physicalWidthM,
    chairLengthM: dims.chairLengthM,
    chairWidthM: dims.chairWidthM,
    code: el.code?.trim() || el.name?.trim() || 'CUSTOM',
    rows: spec.rows,
    seatsPerRow: spec.seatsPerRow,
    rowLabelStyle: 'letter',
    seatLayout: {
      ...spec,
      rowSeatCounts: Array.from({ length: spec.rows }, () => 0),
      customShapeSeatPitchPx: pitch,
    },
    seatPositionOverrides: {},
  };
}

export interface PhysicalDimsInput {
  physicalLengthM: number;
  physicalWidthM: number;
  chairLengthM: number;
  chairWidthM: number;
  /** Gap between seats in a row (metres). */
  seatGapM?: number;
  /** Gap between rows (metres); defaults to seat gap when unset. */
  rowGapM?: number;
  /** Usable-area inset from block boundary (metres). */
  borderGapM?: number;
}

/** Full grid at max capacity with every seat position frozen from auto-layout. */
export function createMaxCapacityCustomShapeSeating(
  element: CenterpieceElement,
  rect: PixelRect,
  dims?: PhysicalDimsInput,
): Partial<CenterpieceElement> {
  const el: CenterpieceElement = dims ? { ...element, ...dims } : element;
  const capacity = computePhysicalCapacity(el);
  const rows = capacity.maxRows;
  const seatsPerRow = capacity.maxSeatsPerRow;
  const pitch = chairPitchPx(el, rect);
  const spec = capSeatLayoutToCapacity(
    createSeatLayoutSpec(rows, seatsPerRow, 'letter'),
    capacity.maxRows,
    capacity.maxSeatsPerRow,
  );
  const base: CenterpieceElement = {
    ...el,
    code: el.code?.trim() || el.name?.trim() || 'CUSTOM',
    rows: spec.rows,
    seatsPerRow: spec.seatsPerRow,
    rowLabelStyle: 'letter',
    seatLayout: { ...spec, customShapeSeatPitchPx: pitch },
    seatPositionOverrides: {},
  };
  const map = buildCustomShapeSeatMap(base, rect);
  const overrides: Record<string, { xPct: number; yPct: number }> = {};
  for (const seat of map.seats) {
    overrides[seat.seatId] = canvasPointToElementPct({ x: seat.x, y: seat.y }, rect);
  }
  return {
    physicalLengthM: el.physicalLengthM,
    physicalWidthM: el.physicalWidthM,
    chairLengthM: el.chairLengthM,
    chairWidthM: el.chairWidthM,
    code: base.code,
    rows: base.rows,
    seatsPerRow: base.seatsPerRow,
    rowLabelStyle: base.rowLabelStyle,
    seatLayout: base.seatLayout,
    seatPositionOverrides: overrides,
  };
}

function polylineLength(points: CanvasPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.hypot(dx, dy);
  }
  return total;
}

/** Point at distance `arc` along a polyline (0 = start). */
function pointAtArcLength(points: CanvasPoint[], arc: number): CanvasPoint {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  if (points.length === 1) {
    return { ...points[0] };
  }
  const total = polylineLength(points);
  if (total <= 0) {
    return { ...points[0] };
  }
  const target = Math.max(0, Math.min(total, arc));
  let travelled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen < 1e-6) {
      continue;
    }
    if (travelled + segLen >= target) {
      const t = (target - travelled) / segLen;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    travelled += segLen;
  }
  return { ...points[points.length - 1] };
}

/** Sample seat centres evenly along a polyline for a fixed seat count. */
export function sampleSeatsAlongPolyline(points: CanvasPoint[], seatCount: number): CanvasPoint[] {
  if (points.length < 2 || seatCount <= 0) {
    return [];
  }
  const total = polylineLength(points);
  if (total <= 0) {
    return [];
  }
  return Array.from({ length: seatCount }, (_, index) =>
    pointAtArcLength(points, ((index + 0.5) / seatCount) * total),
  );
}

/** Max seats along a line from geometry only (chair pitch + row cap), ignoring block total. */
function maxSeatsAlongLineGeometry(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  canvasPctPoints: ElementPosition[],
): number {
  if (canvasPctPoints.length < 2) {
    return 0;
  }
  const dimsEl: CenterpieceElement = {
    ...element,
    physicalLengthM: resolveBlockLengthM(element),
    physicalWidthM: resolveBlockWidthM(element),
    chairLengthM: resolveChairLengthM(element),
    chairWidthM: resolveChairWidthM(element),
  };
  const capacity = computePhysicalCapacity(dimsEl);
  const pitch = chairPitchPx(dimsEl, rect);
  const linePx = canvasPctPoints.map((p) => ({
    x: (p.xPct / 100) * canvas.width,
    y: (p.yPct / 100) * canvas.height,
  }));
  const ppm = pxPerMeter(rect, resolveBlockLengthM(dimsEl), resolveBlockWidthM(dimsEl));
  const lineLengthM = polylineLength(linePx) / Math.max(0.001, ppm);
  const seatsFromDims = Math.max(1, Math.floor(lineLengthM / resolveChairWidthM(dimsEl)));
  const seatsFromPitch = Math.max(1, Math.floor(polylineLength(linePx) / pitch));
  return Math.min(seatsFromDims, seatsFromPitch, capacity.maxSeatsPerRow);
}

/** Max seats that fit along a drawn line given chair pitch and block capacity. */
export function estimateMaxSeatsOnLine(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  canvasPctPoints: ElementPosition[],
): number {
  if (canvasPctPoints.length < 2) {
    return 0;
  }
  const polygon = getPrimaryOutlineCanvasPoints(element, rect);
  if (polygon.length < 3) {
    return 0;
  }
  const geometryMax = maxSeatsAlongLineGeometry(element, rect, canvas, canvasPctPoints);
  const capacity = computePhysicalCapacity(element);
  const currentTotal = isCustomShapeSeatingEnabled(element)
    ? getCustomShapeVisibleSeatCount(element, rect)
    : 0;
  return Math.min(geometryMax, Math.max(0, capacity.maxCapacity - currentTotal));
}

/** Max seats allowed on a saved custom line seat row (line geometry only). */
export function maxSeatsForLineSeatRow(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  rowIndex: number,
): number {
  const line = element.customLineSeatRows?.[rowIndex];
  if (!line || line.length < 2) {
    return 1;
  }
  return Math.max(1, maxSeatsAlongLineGeometry(element, rect, canvas, line));
}

/** Re-place seats along a saved line row at a new count. */
export function updateLineSeatRowCount(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  rowIndex: number,
  seatCount: number,
): Partial<CenterpieceElement> {
  const line = element.customLineSeatRows?.[rowIndex];
  if (!line || line.length < 2 || !element.seatLayout) {
    return {};
  }
  const polygon = getPrimaryOutlineCanvasPoints(element, rect);
  if (polygon.length < 3) {
    return {};
  }

  const maxAllowed = maxSeatsForLineSeatRow(element, rect, canvas, rowIndex);
  const safeCount = Math.max(0, Math.min(maxAllowed, Math.round(seatCount)));

  const spec = getSeatLayoutSpec({
    rows: element.rows,
    seatsPerRow: element.seatsPerRow,
    rowLabelStyle: element.rowLabelStyle,
    seatLayout: element.seatLayout,
  });
  const rowSeatCounts = [...getSeatLayoutRowSeatCounts(spec)];
  const style = spec.rowLabelStyle ?? 'letter';
  const previousCount = rowSeatCounts[rowIndex] ?? 0;
  if (safeCount === previousCount) {
    return {};
  }

  const overrides: Record<string, { xPct: number; yPct: number }> = {
    ...(element.seatPositionOverrides ?? {}),
  };

  for (let i = 0; i < Math.max(previousCount, spec.seatsPerRow); i += 1) {
    delete overrides[seatId(rowIndex, i, style)];
  }

  rowSeatCounts[rowIndex] = safeCount;

  if (safeCount > 0) {
    const linePx = line.map((p) => ({
      x: (p.xPct / 100) * canvas.width,
      y: (p.yPct / 100) * canvas.height,
    }));
    const placements = sampleSeatsAlongPolyline(linePx, safeCount).map((p) =>
      clampPointInsidePolygon(p, polygon),
    );
    for (let i = 0; i < safeCount; i += 1) {
      overrides[seatId(rowIndex, i, style)] = canvasPointToElementPct(placements[i], rect);
    }
  }

  const pitch = chairPitchPx(element, rect);
  const capacity = computePhysicalCapacity(element);
  const geometryMax = maxSeatsAlongLineGeometry(element, rect, canvas, line);
  const nextSpec = capSeatLayoutToCapacity(
    {
      ...spec,
      rowSeatCounts,
      seatsPerRow: Math.max(spec.seatsPerRow, ...rowSeatCounts, safeCount),
      customShapeSeatPitchPx: pitch,
    },
    Math.max(capacity.maxRows, rowSeatCounts.length),
    Math.max(capacity.maxSeatsPerRow, geometryMax, ...rowSeatCounts),
  );

  return {
    rows: nextSpec.rows,
    seatsPerRow: nextSpec.seatsPerRow,
    rowLabelStyle: nextSpec.rowLabelStyle,
    seatLayout: nextSpec,
    seatPositionOverrides: overrides,
  };
}

/** Preview seat centres (canvas px) for a line before it is committed. */
export function previewSeatsOnLineCanvasPx(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  canvasPctPoints: ElementPosition[],
): CanvasPoint[] {
  const seatCount = estimateMaxSeatsOnLine(element, rect, canvas, canvasPctPoints);
  if (seatCount <= 0) {
    return [];
  }
  const polygon = getPrimaryOutlineCanvasPoints(element, rect);
  const linePx = canvasPctPoints.map((p) => ({
    x: (p.xPct / 100) * canvas.width,
    y: (p.yPct / 100) * canvas.height,
  }));
  return sampleSeatsAlongPolyline(linePx, seatCount)
    .map((p) => clampPointInsidePolygon(p, polygon))
    .filter((p) => pointInPolygon(p, polygon));
}

/**
 * Draw a custom seat row along a line on the canvas (2+ points).
 * Seats snap at chair pitch and are fixed inside the shape.
 */
export function addSeatRowFromLine(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  canvasPctPoints: ElementPosition[],
): Partial<CenterpieceElement> {
  if (!isCustomShapeSeatingEnabled(element) || !element.seatLayout || canvasPctPoints.length < 2) {
    return {};
  }
  const polygon = getPrimaryOutlineCanvasPoints(element, rect);
  if (polygon.length < 3) {
    return {};
  }
  const geometryMax = maxSeatsAlongLineGeometry(element, rect, canvas, canvasPctPoints);
  const seatCount = geometryMax;
  if (seatCount <= 0) {
    return {};
  }

  const capacity = computePhysicalCapacity(element);
  const pitch = chairPitchPx(element, rect);
  const linePx = canvasPctPoints.map((p) => ({
    x: (p.xPct / 100) * canvas.width,
    y: (p.yPct / 100) * canvas.height,
  }));
  const sampled = sampleSeatsAlongPolyline(linePx, seatCount);

  let spec = getSeatLayoutSpec({
    rows: element.rows,
    seatsPerRow: element.seatsPerRow,
    rowLabelStyle: element.rowLabelStyle,
    seatLayout: element.seatLayout,
  });
  const rowSeatCounts = [...getSeatLayoutRowSeatCounts(spec)];
  const style = spec.rowLabelStyle ?? 'letter';

  let targetRow = rowSeatCounts.findIndex((c) => c === 0);
  if (targetRow < 0 && spec.rows < capacity.maxRows) {
    spec = resizeSeatLayoutRows(spec, spec.rows + 1);
    rowSeatCounts.push(0);
    targetRow = spec.rows - 1;
  } else if (targetRow < 0) {
    targetRow = rowSeatCounts.length - 1;
  }

  const overrides: Record<string, { xPct: number; yPct: number }> = {
    ...(element.seatPositionOverrides ?? {}),
  };

  const existingIds = new Set(getSeatCellsFromSpec(spec).map((c) => c.seatId));
  for (const id of existingIds) {
    if ((spec.hiddenSeatIds ?? []).includes(id)) {
      delete overrides[id];
    }
  }

  rowSeatCounts[targetRow] = seatCount;
  for (let i = 0; i < seatCount; i += 1) {
    const id = seatId(targetRow, i, style);
    overrides[id] = canvasPointToElementPct(
      clampPointInsidePolygon(sampled[i], polygon),
      rect,
    );
  }

  spec = capSeatLayoutToCapacity(
    {
      ...spec,
      rowSeatCounts,
      seatsPerRow: Math.max(spec.seatsPerRow, ...rowSeatCounts, seatCount),
      customShapeSeatPitchPx: pitch,
    },
    Math.max(capacity.maxRows, rowSeatCounts.length),
    Math.max(capacity.maxSeatsPerRow, geometryMax, ...rowSeatCounts),
  );

  const customLineSeatRows = [...(element.customLineSeatRows ?? [])];
  while (customLineSeatRows.length <= targetRow) {
    customLineSeatRows.push([]);
  }
  customLineSeatRows[targetRow] = canvasPctPoints;

  return {
    rows: spec.rows,
    seatsPerRow: spec.seatsPerRow,
    rowLabelStyle: spec.rowLabelStyle,
    seatLayout: spec,
    seatPositionOverrides: overrides,
    customLineSeatRows,
  };
}

/** True when a canvas-% point lies inside the custom piece outline. */
export function isCanvasPctInsideCustomShape(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  canvasPct: ElementPosition,
): boolean {
  const polygon = getPrimaryOutlineCanvasPoints(element, rect);
  if (polygon.length < 3) {
    return false;
  }
  const point = {
    x: (canvasPct.xPct / 100) * canvas.width,
    y: (canvasPct.yPct / 100) * canvas.height,
  };
  return pointInPolygon(point, polygon);
}

/** Place one seat at an exact canvas click position inside the custom shape. */
export function addCustomShapeSeatAtPoint(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  canvasPct: ElementPosition,
): Partial<CenterpieceElement> {
  if (!element.seatLayout) {
    return {};
  }
  const polygon = getPrimaryOutlineCanvasPoints(element, rect);
  if (polygon.length < 3) {
    return {};
  }
  const canvasPoint = {
    x: (canvasPct.xPct / 100) * canvas.width,
    y: (canvasPct.yPct / 100) * canvas.height,
  };
  let placement = canvasPoint;
  if (!pointInPolygon(placement, polygon)) {
    placement = clampPointInsidePolygon(placement, polygon);
    if (!pointInPolygon(placement, polygon)) {
      return {};
    }
  }

  const capacity = computePhysicalCapacity(element);
  const currentTotal = getCustomShapeVisibleSeatCount(element, rect);
  if (currentTotal >= capacity.maxCapacity) {
    return {};
  }

  let spec = getSeatLayoutSpec({
    rows: element.rows,
    seatsPerRow: element.seatsPerRow,
    rowLabelStyle: element.rowLabelStyle,
    seatLayout: element.seatLayout,
  });
  const rowSeatCounts = [...getSeatLayoutRowSeatCounts(spec)];
  const style = spec.rowLabelStyle ?? 'letter';
  const frozenPitch =
    spec.customShapeSeatPitchPx && spec.customShapeSeatPitchPx > 0
      ? spec.customShapeSeatPitchPx
      : chairPitchPx(element, rect);

  let targetRow = rowSeatCounts.indexOf(Math.min(...rowSeatCounts));
  let seatIndex = rowSeatCounts[targetRow] ?? 0;
  if (seatIndex >= capacity.maxSeatsPerRow) {
    if (spec.rows >= capacity.maxRows) {
      return {};
    }
    spec = resizeSeatLayoutRows(spec, spec.rows + 1);
    rowSeatCounts.push(0);
    targetRow = spec.rows - 1;
    seatIndex = 0;
  }

  const overrides: Record<string, { xPct: number; yPct: number }> = {
    ...(element.seatPositionOverrides ?? {}),
  };
  const newSeatId = seatId(targetRow, seatIndex, style);
  rowSeatCounts[targetRow] = seatIndex + 1;
  overrides[newSeatId] = canvasPointToElementPct(placement, rect);

  spec = capSeatLayoutToCapacity(
    {
      ...spec,
      rowSeatCounts,
      seatsPerRow: Math.max(spec.seatsPerRow, ...rowSeatCounts),
      customShapeSeatPitchPx: frozenPitch,
    },
    capacity.maxRows,
    capacity.maxSeatsPerRow,
  );

  return {
    rows: spec.rows,
    seatsPerRow: spec.seatsPerRow,
    rowLabelStyle: spec.rowLabelStyle,
    seatLayout: spec,
    seatPositionOverrides: overrides,
    perSeatPlacementMode: true,
  };
}

export function addIndependentCustomShapeSeats(
  element: CenterpieceElement,
  rect: PixelRect,
  count: number,
): Partial<CenterpieceElement> {
  if (!isCustomShapeSeatingEnabled(element) || !element.seatLayout) {
    return {};
  }
  const capacity = computePhysicalCapacity(element);
  const currentTotal = getCustomShapeVisibleSeatCount(element, rect);
  if (currentTotal >= capacity.maxCapacity) {
    return {};
  }
  const safeCount = Math.max(1, Math.min(Math.round(count), capacity.maxCapacity - currentTotal, 50));
  const polygon = getPrimaryOutlineCanvasPoints(element, rect);
  if (polygon.length < 3) {
    return {};
  }

  const currentMap = buildCustomShapeSeatMap(element, rect);
  const overrides: Record<string, { xPct: number; yPct: number }> = {
    ...(element.seatPositionOverrides ?? {}),
  };
  for (const seat of currentMap.seats) {
    overrides[seat.seatId] = canvasPointToElementPct({ x: seat.x, y: seat.y }, rect);
  }

  let spec = getSeatLayoutSpec({
    rows: element.rows,
    seatsPerRow: element.seatsPerRow,
    rowLabelStyle: element.rowLabelStyle,
    seatLayout: element.seatLayout,
  });
  const rowSeatCounts = [...getSeatLayoutRowSeatCounts(spec)];
  const style = spec.rowLabelStyle ?? 'letter';
  const frozenPitch =
    spec.customShapeSeatPitchPx && spec.customShapeSeatPitchPx > 0
      ? spec.customShapeSeatPitchPx
      : chairPitchPx(element, rect);

  const existingCanvasPoints = () =>
    Object.values(overrides).map((o) => elementPctToCanvasPoint(o.xPct, o.yPct, rect));

  for (let added = 0; added < safeCount; added += 1) {
    const targetRow = rowSeatCounts.indexOf(Math.min(...rowSeatCounts));
    const seatIndex = rowSeatCounts[targetRow];
    if (seatIndex >= capacity.maxSeatsPerRow) {
      break;
    }
    const newSeatId = seatId(targetRow, seatIndex, style);
    rowSeatCounts[targetRow] += 1;
    const placement = findPlacementForNewSeat(polygon, existingCanvasPoints());
    overrides[newSeatId] = canvasPointToElementPct(placement, rect);
  }

  spec = capSeatLayoutToCapacity(
    {
      ...spec,
      rowSeatCounts,
      seatsPerRow: Math.max(spec.seatsPerRow, ...rowSeatCounts),
      customShapeSeatPitchPx: frozenPitch,
    },
    capacity.maxRows,
    capacity.maxSeatsPerRow,
  );

  return {
    rows: spec.rows,
    seatsPerRow: spec.seatsPerRow,
    rowLabelStyle: spec.rowLabelStyle,
    seatLayout: spec,
    seatPositionOverrides: overrides,
  };
}

function patchSeatInBlocks(
  element: CenterpieceElement,
  targetSeatId: string,
  patchBlock: (block: CustomShapeSeatBlock) => CustomShapeSeatBlock | null,
): Partial<CenterpieceElement> | null {
  const blocks = element.customSeatBlocks;
  if (!blocks?.length) {
    return null;
  }
  let changed = false;
  const next = blocks.map((block) => {
    const hasSeat = block.seatPositionOverrides?.[targetSeatId] != null;
    if (!hasSeat) {
      return block;
    }
    const patched = patchBlock(block);
    if (patched) {
      changed = true;
      return patched;
    }
    return block;
  });
  return changed ? { customSeatBlocks: next } : null;
}

export function removeCustomShapeSeat(
  element: CenterpieceElement,
  targetSeatId: string,
): Partial<CenterpieceElement> {
  const blockPatch = patchSeatInBlocks(element, targetSeatId, (block) => {
    if (!block.seatLayout) {
      return null;
    }
    const style = block.rowLabelStyle ?? 'letter';
    const spec = getSeatLayoutSpec({
      rows: block.rows,
      seatsPerRow: block.seatsPerRow,
      rowLabelStyle: block.rowLabelStyle,
      seatLayout: block.seatLayout,
    });
    const hiddenSeatIds = Array.from(new Set([...(spec.hiddenSeatIds ?? []), targetSeatId]));
    const overrides = { ...(block.seatPositionOverrides ?? {}) };
    delete overrides[targetSeatId];
    const rowSeatCounts = [...getSeatLayoutRowSeatCounts(spec)];
    const parsed = parseBlockSeatId(targetSeatId, block.code, style);
    if (parsed && rowSeatCounts[parsed.rowIndex] != null) {
      rowSeatCounts[parsed.rowIndex] = Math.max(0, rowSeatCounts[parsed.rowIndex] - 1);
    }
    return {
      ...block,
      seatLayout: { ...spec, hiddenSeatIds, rowSeatCounts },
      seatPositionOverrides: overrides,
    };
  });
  if (blockPatch) {
    return blockPatch;
  }

  if (!isCustomShapeSeatingEnabled(element) || !element.seatLayout) {
    return {};
  }
  const spec = getSeatLayoutSpec({
    rows: element.rows,
    seatsPerRow: element.seatsPerRow,
    rowLabelStyle: element.rowLabelStyle,
    seatLayout: element.seatLayout,
  });
  const hiddenSeatIds = Array.from(new Set([...(spec.hiddenSeatIds ?? []), targetSeatId]));
  const overrides = { ...(element.seatPositionOverrides ?? {}) };
  delete overrides[targetSeatId];
  return {
    seatLayout: { ...spec, hiddenSeatIds },
    seatPositionOverrides: Object.keys(overrides).length > 0 ? overrides : {},
  };
}

export function applySeatLayoutWithCapacity(
  element: CenterpieceElement,
  rect: PixelRect,
  next: SeatLayoutSpec,
): Partial<CenterpieceElement> {
  const capacity = computePhysicalCapacity(element);
  const capped = capSeatLayoutToCapacity(next, capacity.maxRows, capacity.maxSeatsPerRow);
  const pitch = chairPitchPx(element, rect);
  return {
    rows: capped.rows,
    seatsPerRow: capped.seatsPerRow,
    rowLabelStyle: capped.rowLabelStyle,
    seatLayout: {
      ...capped,
      customShapeSeatPitchPx: capped.customShapeSeatPitchPx ?? pitch,
    },
  };
}

export function updateSeatOverride(
  element: CenterpieceElement,
  rect: PixelRect,
  targetSeatId: string,
  canvasPoint: CanvasPoint,
): Partial<CenterpieceElement> {
  const polygon = getPrimaryOutlineCanvasPoints(element, rect);
  const clamped = clampPointInsidePolygon(canvasPoint, polygon);
  const position = canvasPointToElementPct(clamped, rect);
  const blockPatch = patchSeatInBlocks(element, targetSeatId, (block) => ({
    ...block,
    seatPositionOverrides: {
      ...(block.seatPositionOverrides ?? {}),
      [targetSeatId]: position,
    },
  }));
  if (blockPatch) {
    return blockPatch;
  }
  return {
    seatPositionOverrides: {
      ...(element.seatPositionOverrides ?? {}),
      [targetSeatId]: position,
    },
  };
}

export function recalcSeatPitchOnDimChange(
  element: CenterpieceElement,
  rect: PixelRect,
): Partial<CenterpieceElement> {
  if (!isCustomShapeSeatingEnabled(element) || !element.seatLayout) {
    return {};
  }
  const capacity = computePhysicalCapacity(element);
  const spec = capSeatLayoutToCapacity(
    getSeatLayoutSpec({
      rows: element.rows,
      seatsPerRow: element.seatsPerRow,
      rowLabelStyle: element.rowLabelStyle,
      seatLayout: element.seatLayout,
    }),
    capacity.maxRows,
    capacity.maxSeatsPerRow,
  );
  const pitch = chairPitchPx(element, rect);
  return {
    rows: spec.rows,
    seatsPerRow: spec.seatsPerRow,
    seatLayout: { ...spec, customShapeSeatPitchPx: pitch },
  };
}

export function regenerateBlockSeats(
  element: CenterpieceElement,
  blockIndex: number,
  rect: PixelRect,
  canvas: { width: number; height: number },
): CustomShapeSeatBlock {
  const block = element.customSeatBlocks?.[blockIndex];
  if (!block) {
    throw new Error('Block not found');
  }

  const mainPolygon = getPrimaryOutlineCanvasPoints(element, rect);
  const zonePolygon = block.boundaryPoints.map((p) =>
    elementPctToCanvasPoint(p.xPct, p.yPct, rect),
  );

  const rows = block.rows;
  const seatsPerRow = block.seatsPerRow;
  const spec = block.seatLayout ?? {
    rows,
    seatsPerRow,
    rowSeatCounts: Array.from({ length: rows }, () => seatsPerRow),
    rowCurveDegs: Array.from({ length: rows }, () => 0),
  };

  const rowSeatCounts = spec.rowSeatCounts ?? Array.from({ length: rows }, () => seatsPerRow);
  const rowCurveDegs = spec.rowCurveDegs ?? Array.from({ length: rows }, () => 0);
  const hiddenSeatIds = new Set(spec.hiddenSeatIds ?? []);
  const totalSeats = totalSeatsInRowCounts(rowSeatCounts);
  const spreadCounts = buildRowSeatCountsFromTotal(totalSeats, seatsPerRow);
  const spreadRows = Math.max(1, spreadCounts.length);
  const spreadCurves = Array.from({ length: spreadRows }, (_, i) => rowCurveDegs[i] ?? 0);
  const blockDims = mergePlacementDims(element, {
    physicalLengthM: block.physicalLengthM,
    physicalWidthM: block.physicalWidthM,
    chairLengthM: block.chairLengthM,
    chairWidthM: block.chairWidthM,
  });

  const rowLines = block.rowLines ?? [];
  const grid = placeDragSeatsGridInDrawnZone(
    element,
    mainPolygon,
    zonePolygon,
    rect,
    block.code,
    blockDims,
    { hiddenSeatIds },
  );
  const { overrides, rowSeatCounts: nextRowCounts, pitchX, pitchY } = grid;

  const pitch = Math.max(pitchX, 6);
  const actualRows = Math.max(1, nextRowCounts.length);

  const updatedSpec = {
    ...spec,
    rows: actualRows,
    seatsPerRow: Math.max(seatsPerRow, maxSeatsInRowCounts(nextRowCounts)),
    rowSeatCounts: nextRowCounts,
    rowCurveDegs: spreadCurves.slice(0, actualRows),
    customShapeSeatPitchPx: pitch,
  };

  return {
    ...block,
    rows: actualRows,
    seatsPerRow: updatedSpec.seatsPerRow,
    seatLayout: updatedSpec,
    seatPositionOverrides: overrides,
  };
}

