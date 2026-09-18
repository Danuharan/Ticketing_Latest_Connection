import { PixelRect } from './geometry';
import {
  buildBlockMeasureEdges,
  cornerFrontSegmentFromView,
  findLogicalEdgeContainingSource,
  stadiumLogicalEdgeFromView,
  stadiumLogicalEdgesFromView,
  uniqueLogicalEdgesById,
  viewpointAisleStartPoint,
  resolveViewpointLogicalEdges,
} from './block-measure-edges';
import {
  capSeatLayoutToCapacity,
  createSeatLayoutSpec,
  getSeatLayoutRowSeatCounts,
  getSeatLayoutSpec,
  seatId,
} from './block-seat-layout';
import {
  canvasPointToElementPct,
  parseOverrideSeatId,
  pointInPolygon,
  pointInsidePolygonWithPadding,
  resolveSeatCenterBorderPaddingPx,
  type PhysicalDimsInput,
} from './custom-shape-seats';
import {
  drawnAisleSlotsToBands,
  pointHitsDrawnAisle,
  type DrawnAisleBand,
} from './drawn-aisle';
import {
  maxSeatsInRowCounts,
  pxPerMeter,
  resolveBlockLengthM,
  resolveBlockWidthM,
  resolveChairLengthM,
  resolveChairWidthM,
  resolveRowGapM,
  resolveSeatGapM,
  fitCountInSpan,
  type PhysicalCapacity,
} from './physical-dims';
import {
  CenterpieceElement,
  DEFAULT_SEAT_GAP_M,
  CustomShapeSeatPosition,
  hasTracedBlockOutline,
  SeatLabelStyle,
} from '../models/layout-element.model';
import {
  resolveRowSeatAlignFromAdjacent,
  type AdjacentBlockRef,
  type RowSeatAlign,
} from './row-seat-align';

interface CanvasPoint {
  x: number;
  y: number;
}

interface EdgeFrame {
  origin: CanvasPoint;
  ux: number;
  uy: number;
  perpX: number;
  perpY: number;
  edgeLength: number;
}

/** Stadium-view / VIEW POINT seating coordinate frame. */
export type ViewpointSeatFrame = EdgeFrame;

function resolveShapeSeatFirstRowDepthPx(rowGapPx: number, edgeSpanPx: number): number {
  const seatRadius = Math.max(2.8, rowGapPx * 0.42);
  return placementSeatBorderPaddingPx(rowGapPx, edgeSpanPx, seatRadius);
}

function estimateMaxArrangeByRowDepthPx(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  rowGapPx: number,
  referenceSpanPx: number,
): number {
  const seatRadius = Math.max(2.8, rowGapPx * 0.42);
  const depthPadding = placementSeatBorderPaddingPx(rowGapPx, referenceSpanPx, seatRadius);
  let maxVertexDepth = depthPadding;
  for (const vertex of polygon) {
    const depth = projectDepth(frame, vertex);
    if (depth > 0) {
      maxVertexDepth = Math.max(maxVertexDepth, depth);
    }
  }
  return Math.max(depthPadding, maxVertexDepth - depthPadding);
}

/** Chair rotation so seats face the pitch (opposite to the inward perpendicular). */
function seatFacingDegFromRowFrame(frame: EdgeFrame): number {
  return (Math.atan2(-frame.perpX, frame.perpY) * 180) / Math.PI;
}

function resolveRowGapMFromDims(dims: PhysicalDimsInput): number {
  return dims.rowGapM ?? dims.seatGapM ?? DEFAULT_SEAT_GAP_M;
}

function resolveSeatGapMFromDims(dims: PhysicalDimsInput): number {
  return dims.seatGapM ?? DEFAULT_SEAT_GAP_M;
}

/** Optional border-gap inset threaded through arrange-by-row placement helpers. */
let activePlacementBorderGapPx = 0;

/** Leftover packing side for exact-pitch rows (outer/side alignment). */
let activeRowSeatAlign: RowSeatAlign = 'center';

function withPlacementBorderGapPx<T>(borderGapPx: number, fn: () => T): T {
  const previous = activePlacementBorderGapPx;
  activePlacementBorderGapPx = Math.max(0, borderGapPx);
  try {
    return fn();
  } finally {
    activePlacementBorderGapPx = previous;
  }
}

function placementSeatBorderPaddingPx(
  pitchPx: number,
  spanPx: number,
  seatRadiusPx: number,
): number {
  return resolveSeatCenterBorderPaddingPx(
    pitchPx,
    spanPx,
    seatRadiusPx,
    activePlacementBorderGapPx,
  );
}

function getOutlineCanvasPoints(el: CenterpieceElement, rect: PixelRect): CanvasPoint[] {
  return (el.customPoints ?? []).map((p) => ({
    x: rect.x + (p.xPct / 100) * rect.width,
    y: rect.y + (p.yPct / 100) * rect.height,
  }));
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

export function isDragSeatsElement(el: CenterpieceElement): boolean {
  return (
    hasTracedBlockOutline(el) &&
    el.dragSeatsMode === true &&
    (el.customSideLengthsM?.length ?? 0) >= 3 &&
    (el.customSeatBlocks?.length ?? 0) === 0
  );
}

export function resolveStadiumSideIndex(el: CenterpieceElement, polygon: CanvasPoint[]): number {
  const index = el.dragSeatsStadiumSideIndex ?? 0;
  if (index >= 0 && index < polygon.length) {
    return index;
  }
  return estimateDefaultStadiumSideIndex(polygon);
}

/** Prefer the topmost, most horizontal edge as the default stadium-view side. */
export function estimateDefaultStadiumSideIndex(polygon: CanvasPoint[]): number {
  if (polygon.length < 3) {
    return 0;
  }
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const avgY = (a.y + b.y) / 2;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const horizontalBonus = dy <= dx ? -5000 : 0;
    const score = avgY + horizontalBonus;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return best;
}

export function stadiumSideLabel(index: number, totalSides: number): string {
  const next = (index + 1) % Math.max(1, totalSides);
  return `Side ${index + 1} → ${next + 1}`;
}

/** Default metre length per polygon edge from drawn pixel proportions. */
export function estimateDefaultSideLengthsM(
  el: CenterpieceElement,
  rect: PixelRect,
  defaultPerimeterM = 24,
): number[] {
  const polygon = getOutlineCanvasPoints(el, rect);
  if (polygon.length < 3) {
    return [];
  }
  const pxLengths = polygon.map((_, index) => {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    return Math.hypot(b.x - a.x, b.y - a.y);
  });
  const totalPx = pxLengths.reduce((sum, length) => sum + length, 0);
  if (totalPx <= 0) {
    return pxLengths.map(() => defaultPerimeterM / Math.max(1, pxLengths.length));
  }
  return pxLengths.map((length) => (length / totalPx) * defaultPerimeterM);
}

export function computePxPerMetre(
  polygon: CanvasPoint[],
  sideLengthsM: number[],
): number {
  let sum = 0;
  let count = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const pxLen = Math.hypot(b.x - a.x, b.y - a.y);
    const mLen = sideLengthsM[index] ?? 0;
    if (pxLen > 0 && mLen > 0) {
      sum += pxLen / mLen;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 1;
}

/**
 * Per-direction px/m for a seating frame.
 * `along` = parallel to the stadium edge (seat / column direction).
 * `depth` = perpendicular into the block (row direction).
 * Falls back to the isotropic average when the frame directions don't align
 * cleanly with any polygon edge.
 */
export function computeDirectionalPxPerMetre(
  polygon: CanvasPoint[],
  sideLengthsM: number[],
  frame: EdgeFrame,
): { ppmAlong: number; ppmDepth: number } {
  const isotropic = computePxPerMetre(polygon, sideLengthsM);
  let alongSum = 0;
  let alongCount = 0;
  let depthSum = 0;
  let depthCount = 0;

  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const pxLen = Math.hypot(dx, dy);
    const mLen = sideLengthsM[index] ?? 0;
    if (pxLen <= 0 || mLen <= 0) continue;

    // Project the edge vector onto along/depth directions.
    const alongProj = Math.abs(dx * frame.ux + dy * frame.uy);
    const depthProj = Math.abs(dx * frame.perpX + dy * frame.perpY);

    // Classify: whichever projection dominates gives that direction's scale.
    if (alongProj > depthProj * 1.5) {
      alongSum += pxLen / mLen;
      alongCount += 1;
    } else if (depthProj > alongProj * 1.5) {
      depthSum += pxLen / mLen;
      depthCount += 1;
    }
  }

  return {
    ppmAlong: alongCount > 0 ? alongSum / alongCount : isotropic,
    ppmDepth: depthCount > 0 ? depthSum / depthCount : isotropic,
  };
}

export function deriveBlockDimsFromSides(
  polygon: CanvasPoint[],
  sideLengthsM: number[],
): { physicalLengthM: number; physicalWidthM: number } {
  let maxWidthM = 1;
  let maxDepthM = 1;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const pxLen = Math.hypot(b.x - a.x, b.y - a.y);
    const mLen = sideLengthsM[index] ?? 0;
    if (pxLen <= 0 || mLen <= 0) {
      continue;
    }
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx >= dy) {
      maxWidthM = Math.max(maxWidthM, mLen);
    } else {
      maxDepthM = Math.max(maxDepthM, mLen);
    }
  }
  return { physicalLengthM: maxDepthM, physicalWidthM: maxWidthM };
}

function polygonSignedArea(polygon: CanvasPoint[]): number {
  let sum = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function buildEdgeFrameFromSegment(
  polygon: CanvasPoint[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): EdgeFrame {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const edgeLength = Math.hypot(dx, dy) || 1;
  const ux = dx / edgeLength;
  const uy = dy / edgeLength;
  const ccw = polygonSignedArea(polygon) >= 0;
  const perpX = ccw ? -uy : uy;
  const perpY = ccw ? ux : -ux;
  return ensureFrameDepthInward(polygon, {
    origin: { x: x1, y: y1 },
    ux,
    uy,
    perpX,
    perpY,
    edgeLength,
  });
}

/** Flip perpendicular so positive depth moves into the polygon (away from the stadium edge). */
function ensureFrameDepthInward(polygon: CanvasPoint[], frame: EdgeFrame): EdgeFrame {
  const midAlong = frame.edgeLength * 0.5;
  const testDepth = Math.max(4, frame.edgeLength * 0.02);
  const inward = pointOnFrame(frame, midAlong, testDepth);
  const outward = pointOnFrame(frame, midAlong, -testDepth);
  if (pointInPolygon(inward, polygon)) {
    return frame;
  }
  if (pointInPolygon(outward, polygon)) {
    return {
      ...frame,
      perpX: -frame.perpX,
      perpY: -frame.perpY,
    };
  }
  return frame;
}

/**
 * Row frame for drag-seats: uses the wizard / confirmed stadium side (green VIEW POINT edge),
 * not a second snap that can pick an adjacent diagonal edge.
 */
function buildDragSeatsRowFrame(
  polygon: CanvasPoint[],
  stadiumSideIndex: number,
): EdgeFrame {
  const logical = findLogicalEdgeContainingSource(polygon, stadiumSideIndex);
  if (logical) {
    return buildEdgeFrameFromSegment(polygon, logical.x1, logical.y1, logical.x2, logical.y2);
  }
  const safe = Math.max(0, Math.min(polygon.length - 1, stadiumSideIndex));
  const a = polygon[safe];
  const b = polygon[(safe + 1) % polygon.length];
  return buildEdgeFrameFromSegment(polygon, a.x, a.y, b.x, b.y);
}

export function buildStadiumEdgeFrame(
  polygon: CanvasPoint[],
  rect: PixelRect,
  stadiumSideIndex: number,
  viewpointAngleDeg?: number | null,
): EdgeFrame {
  if (viewpointAngleDeg != null && Number.isFinite(viewpointAngleDeg)) {
    const fromView = stadiumLogicalEdgesFromView(polygon, rect.cx, rect.cy, viewpointAngleDeg);
    if (fromView.length >= 2) {
      const corner = cornerFrontSegmentFromView(fromView[0], fromView[1], viewpointAngleDeg);
      if (corner) {
        return buildEdgeFrameFromSegment(polygon, corner.x1, corner.y1, corner.x2, corner.y2);
      }
    }
    if (fromView[0]) {
      return buildEdgeFrameFromSegment(
        polygon,
        fromView[0].x1,
        fromView[0].y1,
        fromView[0].x2,
        fromView[0].y2,
      );
    }
  }
  const logical = findLogicalEdgeContainingSource(polygon, stadiumSideIndex);
  if (logical) {
    return buildEdgeFrameFromSegment(polygon, logical.x1, logical.y1, logical.x2, logical.y2);
  }
  const safe = Math.max(0, Math.min(polygon.length - 1, stadiumSideIndex));
  const a = polygon[safe];
  const b = polygon[(safe + 1) % polygon.length];
  return buildEdgeFrameFromSegment(polygon, a.x, a.y, b.x, b.y);
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

/**
 * Remap a drawn-aisle endpoint from one block's local % into another's using
 * normalized seating-frame (along/depth) fractions so Auto Fill can place an
 * equivalent aisle on every selected block.
 */
export function remapDrawnAisleLocalPct(
  pct: { xPct: number; yPct: number },
  fromRect: PixelRect,
  fromPolygon: CanvasPoint[],
  fromStadiumSideIndex: number,
  fromViewpointAngleDeg: number | null | undefined,
  toRect: PixelRect,
  toPolygon: CanvasPoint[],
  toStadiumSideIndex: number,
  toViewpointAngleDeg: number | null | undefined,
): { xPct: number; yPct: number } {
  if (fromPolygon.length < 3 || toPolygon.length < 3) {
    return { xPct: pct.xPct, yPct: pct.yPct };
  }

  const fromFrame = buildStadiumEdgeFrame(
    fromPolygon,
    fromRect,
    fromStadiumSideIndex,
    fromViewpointAngleDeg,
  );
  const toFrame = buildStadiumEdgeFrame(
    toPolygon,
    toRect,
    toStadiumSideIndex,
    toViewpointAngleDeg,
  );
  const fromExtents = framePolygonExtents(fromPolygon, fromFrame);
  const toExtents = framePolygonExtents(toPolygon, toFrame);

  const sourceCanvas = {
    x: fromRect.x + (pct.xPct / 100) * fromRect.width,
    y: fromRect.y + (pct.yPct / 100) * fromRect.height,
  };
  const alongSpan = Math.max(1e-6, fromExtents.maxAlong - fromExtents.minAlong);
  const depthSpan = Math.max(1e-6, fromExtents.maxDepth - fromExtents.minDepth);
  const alongT = clampUnit((projectAlong(fromFrame, sourceCanvas) - fromExtents.minAlong) / alongSpan);
  const depthT = clampUnit((projectDepth(fromFrame, sourceCanvas) - fromExtents.minDepth) / depthSpan);

  const targetAlong =
    toExtents.minAlong + alongT * Math.max(1e-6, toExtents.maxAlong - toExtents.minAlong);
  const targetDepth =
    toExtents.minDepth + depthT * Math.max(1e-6, toExtents.maxDepth - toExtents.minDepth);
  const targetCanvas = pointOnFrame(toFrame, targetAlong, targetDepth);

  const width = Math.max(1e-6, toRect.width);
  const height = Math.max(1e-6, toRect.height);
  // Do not clamp to the AABB — clamping snaps exterior points onto the box
  // edge and warps remapped draw aisles on dissimilar block shapes.
  return {
    xPct: ((targetCanvas.x - toRect.x) / width) * 100,
    yPct: ((targetCanvas.y - toRect.y) / height) * 100,
  };
}

function buildEdgeFrame(polygon: CanvasPoint[], edgeIndex: number): EdgeFrame {
  const a = polygon[edgeIndex % polygon.length];
  const b = polygon[(edgeIndex + 1) % polygon.length];
  return buildEdgeFrameFromSegment(polygon, a.x, a.y, b.x, b.y);
}

function pointOnFrame(frame: EdgeFrame, alongPx: number, depthPx: number): CanvasPoint {
  return {
    x: frame.origin.x + frame.ux * alongPx + frame.perpX * depthPx,
    y: frame.origin.y + frame.uy * alongPx + frame.perpY * depthPx,
  };
}

function projectAlong(frame: EdgeFrame, point: CanvasPoint): number {
  const relX = point.x - frame.origin.x;
  const relY = point.y - frame.origin.y;
  return relX * frame.ux + relY * frame.uy;
}

function projectDepth(frame: EdgeFrame, point: CanvasPoint): number {
  const relX = point.x - frame.origin.x;
  const relY = point.y - frame.origin.y;
  return relX * frame.perpX + relY * frame.perpY;
}

function framePolygonExtents(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
): { minAlong: number; maxAlong: number; minDepth: number; maxDepth: number } {
  let minAlong = Number.POSITIVE_INFINITY;
  let maxAlong = Number.NEGATIVE_INFINITY;
  let minDepth = Number.POSITIVE_INFINITY;
  let maxDepth = Number.NEGATIVE_INFINITY;
  for (const point of polygon) {
    const along = projectAlong(frame, point);
    const depth = projectDepth(frame, point);
    minAlong = Math.min(minAlong, along);
    maxAlong = Math.max(maxAlong, along);
    minDepth = Math.min(minDepth, depth);
    maxDepth = Math.max(maxDepth, depth);
  }
  return { minAlong, maxAlong, minDepth, maxDepth };
}

function lerpPoint(a: CanvasPoint, b: CanvasPoint, t: number): CanvasPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function orderEdgeAlong(
  a: CanvasPoint,
  b: CanvasPoint,
  frame: EdgeFrame,
): [CanvasPoint, CanvasPoint] {
  return projectAlong(frame, a) <= projectAlong(frame, b) ? [a, b] : [b, a];
}

function edgeAlongSpan(
  edge: { x1: number; y1: number; x2: number; y2: number },
  frame: EdgeFrame,
): number {
  return Math.abs(
    projectAlong(frame, { x: edge.x1, y: edge.y1 }) - projectAlong(frame, { x: edge.x2, y: edge.y2 }),
  );
}

function edgeDepthSpan(
  edge: { x1: number; y1: number; x2: number; y2: number },
  frame: EdgeFrame,
): number {
  return Math.abs(
    projectDepth(frame, { x: edge.x1, y: edge.y1 }) - projectDepth(frame, { x: edge.x2, y: edge.y2 }),
  );
}

/** True when the side faces the viewpoint (a back wall), not a depth-aligned lateral. */
function isAcrossFacingSide(
  edge: { x1: number; y1: number; x2: number; y2: number },
  frame: EdgeFrame,
): boolean {
  return edgeAlongSpan(edge, frame) >= edgeDepthSpan(edge, frame) * 0.4;
}

function isNearPolygonVertex(
  point: CanvasPoint,
  polygon: CanvasPoint[],
  epsPx: number,
): boolean {
  return polygon.some((vertex) => pointsClose(point, vertex, epsPx));
}

/**
 * Depth-ray hit on a measured side: constant `along` from the VIEW POINT centre,
 * farthest intersection that lies on the side interior (not a corner).
 */
function depthRayInteriorHit(
  frame: EdgeFrame,
  startAlong: number,
  edges: ReturnType<typeof buildBlockMeasureEdges>,
  frontAlong: number,
): { edge: ReturnType<typeof buildBlockMeasureEdges>[number]; point: CanvasPoint } | null {
  const cornerT = 0.1;
  let best: { edge: ReturnType<typeof buildBlockMeasureEdges>[number]; point: CanvasPoint; depth: number } | null =
    null;
  for (const edge of edges) {
    if (isFrontMeasureEdge(edge, frame, frontAlong) || !isAcrossFacingSide(edge, frame)) {
      continue;
    }
    const a = { x: edge.x1, y: edge.y1 };
    const b = { x: edge.x2, y: edge.y2 };
    const alongA = projectAlong(frame, a);
    const alongB = projectAlong(frame, b);
    const span = alongB - alongA;
    if (Math.abs(span) < 1e-6) {
      continue;
    }
    const tSeg = (startAlong - alongA) / span;
    if (tSeg < cornerT || tSeg > 1 - cornerT) {
      continue;
    }
    const point = lerpPoint(a, b, tSeg);
    const depth = projectDepth(frame, point);
    if (depth < Math.max(4, frame.edgeLength * 0.08)) {
      continue;
    }
    if (!best || depth > best.depth) {
      best = { edge, point, depth };
    }
  }
  return best ? { edge: best.edge, point: best.point } : null;
}

function isFrontMeasureEdge(
  edge: { midX: number; midY: number },
  frame: EdgeFrame,
  frontAlong: number,
): boolean {
  const mid = { x: edge.midX, y: edge.midY };
  const depth = projectDepth(frame, mid);
  const alongDelta = Math.abs(projectAlong(frame, mid) - frontAlong);
  return depth < Math.max(4, frame.edgeLength * 0.08) && alongDelta < frame.edgeLength * 0.65;
}

function pointsClose(a: CanvasPoint, b: CanvasPoint, epsPx = 2.5): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= epsPx;
}

function longestFlaggedRun<T>(items: T[], flags: boolean[]): T[] {
  const n = items.length;
  if (n === 0 || !flags.some(Boolean)) {
    return [];
  }
  let start = 0;
  if (flags[0] && flags[n - 1]) {
    const gap = flags.findIndex((flag) => !flag);
    start = gap < 0 ? 0 : gap;
  }
  let best: T[] = [];
  let current: T[] = [];
  for (let step = 0; step < n; step += 1) {
    const index = (start + step) % n;
    if (flags[index]) {
      current.push(items[index]);
      continue;
    }
    if (current.length > best.length) {
      best = current;
    }
    current = [];
  }
  if (current.length > best.length) {
    best = current;
  }
  return best;
}

function sortMeasureEdgesAlong<T extends { midX: number; midY: number }>(
  edges: T[],
  frame: EdgeFrame,
): T[] {
  return [...edges].sort(
    (a, b) =>
      projectAlong(frame, { x: a.midX, y: a.midY }) -
      projectAlong(frame, { x: b.midX, y: b.midY }),
  );
}

/**
 * Measured sides that form the far/ending boundary (away from the VIEW POINT).
 * Viewpoint sides are never counted. Depth-aligned laterals and tiny corner cuts
 * are excluded so the aisle targets a real opposite side, not a vertex. A peaked
 * back (one far vertex) keeps only the across-facing sides that meet there.
 */
function collectOppositeEndSides(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  frontAlong: number,
  excludeSideIds: ReadonlySet<number> = new Set(),
): ReturnType<typeof buildBlockMeasureEdges> {
  const edges = buildBlockMeasureEdges(polygon);
  if (edges.length < 2) {
    return [];
  }
  let maxDepth = Number.NEGATIVE_INFINITY;
  let minDepth = Number.POSITIVE_INFINITY;
  for (const point of polygon) {
    const depth = projectDepth(frame, point);
    maxDepth = Math.max(maxDepth, depth);
    minDepth = Math.min(minDepth, depth);
  }
  const farTol = Math.max(8, (maxDepth - minDepth) * 0.22);
  const minSidePx = Math.max(8, frame.edgeLength * 0.08);
  const isFarPoint = (point: CanvasPoint): boolean =>
    projectDepth(frame, point) >= maxDepth - farTol;
  const usable = (edge: ReturnType<typeof buildBlockMeasureEdges>[number]): boolean =>
    !excludeSideIds.has(edge.id) &&
    !isFrontMeasureEdge(edge, frame, frontAlong) &&
    isAcrossFacingSide(edge, frame) &&
    edge.lengthPx >= minSidePx;

  const farFlags = edges.map((edge) => {
    if (!usable(edge)) {
      return false;
    }
    return isFarPoint({ x: edge.x1, y: edge.y1 }) && isFarPoint({ x: edge.x2, y: edge.y2 });
  });
  const chain = longestFlaggedRun(edges, farFlags).filter(usable);
  if (chain.length > 0) {
    return sortMeasureEdgesAlong(chain, frame);
  }

  const farVertices = polygon.filter((point) => isFarPoint(point));
  if (farVertices.length !== 1) {
    return [];
  }
  const peak = farVertices[0];
  const incident = edges.filter((edge) => {
    if (!usable(edge)) {
      return false;
    }
    const a = { x: edge.x1, y: edge.y1 };
    const b = { x: edge.x2, y: edge.y2 };
    return pointsClose(a, peak) || pointsClose(b, peak);
  });
  return sortMeasureEdgesAlong(incident, frame);
}

function measureEdgeMid(edge: { midX: number; midY: number }): CanvasPoint {
  return { x: edge.midX, y: edge.midY };
}

/**
 * Center-column aisle termination from opposite-end side count N:
 *   N % 2 === 1 → exact midpoint of the central side (index (N − 1) / 2)
 *   N % 2 === 0 → midpoint between the middle two sides (indices N/2 − 1, N/2)
 */
function oppositeAisleTerminationPoint(
  sides: ReturnType<typeof buildBlockMeasureEdges>,
  frame: EdgeFrame,
): CanvasPoint | null {
  const n = sides.length;
  if (n < 1) {
    return null;
  }
  const ordered = sortMeasureEdgesAlong(sides, frame);
  if (n % 2 === 1) {
    const central = ordered[(n - 1) / 2];
    return central ? measureEdgeMid(central) : null;
  }
  const left = ordered[n / 2 - 1];
  const right = ordered[n / 2];
  if (!left || !right) {
    return null;
  }
  return lerpPoint(measureEdgeMid(left), measureEdgeMid(right), 0.5);
}

/**
 * Opposite ending point from far-side count N (modulo-2):
 *   N === 1 or N odd  → midpoint of the central side
 *   N even            → midpoint between the middle two sides
 * Viewpoint sides are excluded from N. Ray fallback only when no far sides exist.
 */
function aisleViewpointSides(
  polygon: CanvasPoint[],
  cx: number,
  cy: number,
  viewpointAngleDeg?: number | null,
  viewpointSideIndices?: number[] | null,
) {
  const facing =
    viewpointAngleDeg != null && Number.isFinite(viewpointAngleDeg)
      ? resolveViewpointLogicalEdges(polygon, cx, cy, viewpointAngleDeg)
      : [];
  if ((viewpointSideIndices?.length ?? 0) >= 2) {
    const stored = uniqueLogicalEdgesById(
      viewpointSideIndices!
        .map((index) => findLogicalEdgeContainingSource(polygon, index))
        .filter((edge): edge is NonNullable<typeof edge> => edge != null),
    );
    const storedFronts = stored.filter((edge) => facing.some((front) => front.id === edge.id));
    if (storedFronts.length >= 2) {
      return storedFronts;
    }
  }
  return uniqueLogicalEdgesById(facing);
}

function findOppositeAisleTermination(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  cx: number,
  cy: number,
  start: CanvasPoint,
  viewpointAngleDeg?: number | null,
  viewpointSideIndices?: number[] | null,
): CanvasPoint | null {
  const frontAlong = projectAlong(frame, start);
  const viewpointSideIds = new Set(
    aisleViewpointSides(polygon, cx, cy, viewpointAngleDeg, viewpointSideIndices).map(
      (edge) => edge.id,
    ),
  );
  const farSides = collectOppositeEndSides(polygon, frame, frontAlong, viewpointSideIds);
  const mod2 = oppositeAisleTerminationPoint(farSides, frame);
  if (mod2) {
    return mod2;
  }

  const edges = buildBlockMeasureEdges(polygon);
  const rayHit = depthRayInteriorHit(frame, frontAlong, edges, frontAlong);
  if (rayHit) {
    return rayHit.point;
  }

  if (edges.length < 2) {
    return null;
  }
  const ext = framePolygonExtents(polygon, frame);
  const cornerEps = Math.max(
    12,
    (ext.maxAlong - ext.minAlong) * 0.1,
    (ext.maxDepth - ext.minDepth) * 0.06,
  );
  const angle =
    viewpointAngleDeg != null && Number.isFinite(viewpointAngleDeg)
      ? viewpointAngleDeg
      : (Math.atan2(start.x - cx, cy - start.y) * 180) / Math.PI;
  const fromView = stadiumLogicalEdgeFromView(polygon, cx, cy, angle + 180);
  if (
    fromView &&
    !viewpointSideIds.has(fromView.id) &&
    !isFrontMeasureEdge(fromView, frame, frontAlong) &&
    isAcrossFacingSide(fromView, frame)
  ) {
    const mid = measureEdgeMid(fromView);
    if (!isNearPolygonVertex(mid, polygon, cornerEps)) {
      return mid;
    }
  }
  let best: ReturnType<typeof buildBlockMeasureEdges>[number] | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const edge of edges) {
    if (
      viewpointSideIds.has(edge.id) ||
      isFrontMeasureEdge(edge, frame, frontAlong) ||
      !isAcrossFacingSide(edge, frame)
    ) {
      continue;
    }
    const mid = measureEdgeMid(edge);
    if (isNearPolygonVertex(mid, polygon, cornerEps)) {
      continue;
    }
    const depth = projectDepth(frame, mid);
    const score = depth + edgeAlongSpan(edge, frame) * 0.15;
    if (score > bestScore) {
      bestScore = score;
      best = edge;
    }
  }
  return best ? measureEdgeMid(best) : null;
}

/**
 * Straight center-column aisle: VIEW POINT → opposite end by far-side count N.
 * Start: one viewpoint side → its midpoint; two adjacent sides → shared vertex.
 * End: N odd → midpoint of the central side; N even → midpoint between the
 * middle two sides. Leftover seats pack into the remaining spans.
 */
function centerColumnAislesViewpointToOpposite(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  widthsPx: number[],
  cx: number,
  cy: number,
  viewpointAngleDeg?: number | null,
  viewpointSideIndices?: number[] | null,
): DrawnAisleBand[] {
  const widths = widthsPx.filter((width) => Number.isFinite(width) && width > 0);
  if (widths.length === 0) {
    return [];
  }
  const frontA = frame.origin;
  const frontB: CanvasPoint = {
    x: frame.origin.x + frame.ux * frame.edgeLength,
    y: frame.origin.y + frame.uy * frame.edgeLength,
  };
  const ext = framePolygonExtents(polygon, frame);
  const viewedStart =
    viewpointAngleDeg != null && Number.isFinite(viewpointAngleDeg)
      ? viewpointAisleStartPoint(polygon, cx, cy, viewpointAngleDeg, viewpointSideIndices)
      : viewpointSideIndices && viewpointSideIndices.length >= 2
        ? viewpointAisleStartPoint(polygon, cx, cy, 0, viewpointSideIndices)
        : null;
  const viewpointStart = viewedStart ?? {
    point: {
      x: frame.origin.x + frame.ux * (frame.edgeLength * 0.5),
      y: frame.origin.y + frame.uy * (frame.edgeLength * 0.5),
    },
    fromCorner: false,
  };
  const rawEnd =
    findOppositeAisleTermination(
      polygon,
      frame,
      cx,
      cy,
      viewpointStart.point,
      viewpointAngleDeg,
      viewpointSideIndices,
    ) ?? pointOnFrame(frame, (ext.minAlong + ext.maxAlong) * 0.5, ext.maxDepth);
  const [f0, f1] = orderEdgeAlong(frontA, frontB, frame);
  const n = widths.length;
  return widths.map((widthPx, index) => {
    const t = (index + 1) / (n + 1);
    const start = viewpointStart.fromCorner
      ? viewpointStart.point
      : lerpPoint(f0, f1, t);
    const end = rawEnd;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const padBack = Math.max(6, len * 0.04);
    const padFwd = Math.max(6, Math.min(14, len * 0.04));
    return {
      start: { x: start.x - nx * padBack, y: start.y - ny * padBack },
      end: { x: end.x + nx * padFwd, y: end.y + ny * padFwd },
      halfWidthPx: widthPx / 2,
    };
  });
}

/**
 * Center row aisles as straight walkways across the block (along direction).
 */
function centerRowAislesToStraightBands(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  widthsPx: number[],
): DrawnAisleBand[] {
  const widths = widthsPx.filter((width) => Number.isFinite(width) && width > 0);
  if (widths.length === 0) {
    return [];
  }
  const ext = framePolygonExtents(polygon, frame);
  const span = ext.maxDepth - ext.minDepth;
  if (span <= 0) {
    return [];
  }
  const pad = Math.max(4, (ext.maxAlong - ext.minAlong) * 0.02);
  const n = widths.length;
  return widths.map((widthPx, index) => {
    const depth = ext.minDepth + ((index + 1) * span) / (n + 1);
    return {
      start: pointOnFrame(frame, ext.minAlong - pad, depth),
      end: pointOnFrame(frame, ext.maxAlong + pad, depth),
      halfWidthPx: widthPx / 2,
    };
  });
}

export function resolvePitchPx(element: CenterpieceElement, ppm: number): number {
  const frozen = element.seatLayout?.customShapeSeatPitchPx;
  if (frozen && frozen > 0) {
    return frozen;
  }
  const chairWidthM = resolveChairWidthM(element);
  const gapM = resolveSeatGapM(element);
  return Math.max(6, (chairWidthM + gapM) * ppm);
}

export function resolveRowGapPx(element: CenterpieceElement, ppm: number): number {
  const chairLengthM = resolveChairLengthM(element);
  const rowGapM = resolveRowGapM(element);
  return Math.max(8, (chairLengthM + rowGapM) * ppm);
}

function intersectEdgeWithDepthLine(
  p1: CanvasPoint,
  p2: CanvasPoint,
  frame: EdgeFrame,
  depthPx: number,
): number | null {
  const ex = p2.x - p1.x;
  const ey = p2.y - p1.y;
  const ox = frame.origin.x + frame.perpX * depthPx;
  const oy = frame.origin.y + frame.perpY * depthPx;
  const { ux, uy } = frame;
  const rx = p1.x - ox;
  const ry = p1.y - oy;
  const det = ux * ey - uy * ex;
  if (Math.abs(det) < 1e-9) {
    return null;
  }
  const along = (rx * ey - ry * ex) / det;
  const s = (ux * ry - uy * rx) / det;
  if (s < -1e-6 || s > 1 + 1e-6) {
    return null;
  }
  return along;
}

function getChordAtDepth(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  pitchPx = 6,
): { minAlong: number; maxAlong: number } | null {
  const intersections: number[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const p1 = polygon[index];
    const p2 = polygon[(index + 1) % polygon.length];
    const along = intersectEdgeWithDepthLine(p1, p2, frame, depthPx);
    if (along !== null) {
      intersections.push(along);
    }
  }

  if (intersections.length >= 2) {
    const sorted = intersections
      .slice()
      .sort((a, b) => a - b)
      .filter((value, index, list) => index === 0 || Math.abs(value - list[index - 1]) > 0.5);
    let best: { minAlong: number; maxAlong: number } | null = null;
    let bestSpan = 0;
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const minAlong = sorted[index];
      const maxAlong = sorted[index + 1];
      const midAlong = (minAlong + maxAlong) / 2;
      const midPoint = pointOnFrame(frame, midAlong, depthPx);
      if (!pointInPolygon(midPoint, polygon)) {
        continue;
      }
      const span = maxAlong - minAlong;
      if (span > bestSpan) {
        bestSpan = span;
        best = { minAlong, maxAlong };
      }
    }
    if (best) {
      return best;
    }
  }

  let minAlong = Number.POSITIVE_INFINITY;
  let maxAlong = Number.NEGATIVE_INFINITY;
  const scanMax = Math.max(frame.edgeLength * 4, 400);
  const step = Math.max(1, pitchPx / 4);

  for (let along = -scanMax; along <= scanMax; along += step) {
    const point = pointOnFrame(frame, along, depthPx);
    if (pointInPolygon(point, polygon)) {
      minAlong = Math.min(minAlong, along);
      maxAlong = Math.max(maxAlong, along);
    }
  }

  if (minAlong > maxAlong) {
    return null;
  }
  return { minAlong, maxAlong };
}

/**
 * All contiguous "seat-able" segments at this row depth (each already inset by the
 * seat-centre border padding). A concave / angular shape can produce more than one
 * disjoint segment on a single row line — every one of them is returned so smaller
 * pockets (e.g. a notch or protrusion) still receive seats.
 */
function collectPaddedSegmentsAtDepth(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  pitchPx: number,
): { start: number; end: number }[] {
  const chord = getChordAtDepth(polygon, frame, depthPx, pitchPx);
  const step = Math.max(0.5, pitchPx / 12);
  const scanMax = Math.max(frame.edgeLength * 4, 400);
  const scanMin = chord ? Math.min(chord.minAlong, -scanMax) : -scanMax;
  const scanEnd = chord ? Math.max(chord.maxAlong, scanMax) : scanMax;
  // Size padding from pitch, not the full block chord — a wide chord used to
  // inflate the inset and erase short viable spans beside concave notches.
  const seatRadius = Math.max(2.8, pitchPx * 0.42);
  const paddingPx = placementSeatBorderPaddingPx(pitchPx, pitchPx * 4, seatRadius);

  const segments: { start: number; end: number }[] = [];
  let segStart: number | null = null;
  let segEnd: number | null = null;

  for (let along = scanMin; along <= scanEnd + step * 0.5; along += step) {
    const point = pointOnFrame(frame, along, depthPx);
    if (pointInsidePolygonWithPadding(point, polygon, paddingPx)) {
      if (segStart === null) {
        segStart = along;
      }
      segEnd = along;
    } else if (segStart !== null && segEnd !== null) {
      segments.push({ start: segStart, end: segEnd });
      segStart = null;
      segEnd = null;
    }
  }
  if (segStart !== null && segEnd !== null) {
    segments.push({ start: segStart, end: segEnd });
  }
  return segments;
}

function longestPaddedSegmentAtDepth(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  pitchPx: number,
): { start: number; end: number } | null {
  const segments = collectPaddedSegmentsAtDepth(polygon, frame, depthPx, pitchPx);
  if (segments.length === 0) {
    return null;
  }

  let best = segments[0];
  let bestSpan = best.end - best.start;
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    const span = segment.end - segment.start;
    if (span > bestSpan) {
      bestSpan = span;
      best = segment;
    }
  }
  return best;
}

function paddedSegmentInnerBounds(
  segment: { start: number; end: number },
  pitchPx: number,
): { innerMin: number; innerMax: number } | null {
  const span = segment.end - segment.start;
  if (span < pitchPx * 0.2) {
    const mid = (segment.start + segment.end) / 2;
    return { innerMin: mid, innerMax: mid };
  }
  const shrink = Math.min(pitchPx * 0.08, 1.5);
  const innerMin = segment.start + shrink;
  const innerMax = segment.end - shrink;
  if (innerMax < innerMin) {
    const mid = (segment.start + segment.end) / 2;
    return { innerMin: mid, innerMax: mid };
  }
  return { innerMin, innerMax };
}

function chordInnerBounds(
  chord: { minAlong: number; maxAlong: number },
  pitchPx: number,
): { innerMin: number; innerMax: number } | null {
  const span = chord.maxAlong - chord.minAlong;
  const seatRadius = Math.max(2.8, pitchPx * 0.42);
  const sideInset = placementSeatBorderPaddingPx(pitchPx, span, seatRadius);
  const innerMin = chord.minAlong + sideInset;
  const innerMax = chord.maxAlong - sideInset;
  if (innerMax < innerMin) {
    return null;
  }
  return { innerMin, innerMax };
}

function maxSeatsForSpanFill(innerMin: number, innerMax: number, pitchPx: number): number {
  const span = innerMax - innerMin;
  if (span < pitchPx * 0.2) {
    return 1;
  }
  return Math.max(1, Math.floor(span / pitchPx) + 1);
}

/** Pack seats from one side of the row span at a fixed pitch (no dual-edge / centered fill). */
function startAlignedAlongPositions(
  innerMin: number,
  innerMax: number,
  pitchPx: number,
  seatCount?: number,
): number[] {
  const maxCount =
    seatCount != null && seatCount > 0
      ? seatCount
      : maxSeatsForSpanFill(innerMin, innerMax, pitchPx);
  return alignedAlongPositions(innerMin, innerMax, pitchPx, maxCount, 'left');
}

/** Fixed-pitch centres packed left, right, or centred in the padded chord. */
function alignedAlongPositions(
  innerMin: number,
  innerMax: number,
  pitchPx: number,
  seatCount: number,
  align: RowSeatAlign,
): number[] {
  if (seatCount <= 0 || pitchPx <= 0 || innerMax < innerMin) {
    return [];
  }
  const groupWidth = (seatCount - 1) * pitchPx;
  const span = innerMax - innerMin;
  if (groupWidth > span + 0.01) {
    return [];
  }
  let startAlong: number;
  if (align === 'left') {
    startAlong = innerMin;
  } else if (align === 'right') {
    startAlong = innerMax - groupWidth;
  } else {
    startAlong = innerMin + (span - groupWidth) / 2;
  }
  return Array.from({ length: seatCount }, (_, index) => startAlong + index * pitchPx);
}

function seatAlignFallbackOrder(preferred: RowSeatAlign): RowSeatAlign[] {
  if (preferred === 'left') {
    return ['left', 'center', 'right'];
  }
  if (preferred === 'right') {
    return ['right', 'center', 'left'];
  }
  return ['center', 'left', 'right'];
}

function findContiguousInsideSegmentsAtDepth(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  scanMin: number,
  scanMax: number,
  step: number,
): { start: number; end: number }[] {
  const segments: { start: number; end: number }[] = [];
  let segStart: number | null = null;
  let segEnd: number | null = null;

  for (let along = scanMin; along <= scanMax + step * 0.5; along += step) {
    const point = pointOnFrame(frame, along, depthPx);
    if (pointInPolygon(point, polygon)) {
      if (segStart === null) {
        segStart = along;
      }
      segEnd = along;
    } else if (segStart !== null && segEnd !== null) {
      segments.push({ start: segStart, end: segEnd });
      segStart = null;
      segEnd = null;
    }
  }
  if (segStart !== null && segEnd !== null) {
    segments.push({ start: segStart, end: segEnd });
  }
  return segments;
}

function longestInsideSegmentAtDepth(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  pitchPx: number,
): { start: number; end: number } | null {
  const chord = getChordAtDepth(polygon, frame, depthPx, pitchPx);
  const step = Math.max(0.5, pitchPx / 10);
  const scanMax = Math.max(frame.edgeLength * 4, 400);
  const scanMin = chord ? Math.min(chord.minAlong, -scanMax) : -scanMax;
  const scanEnd = chord ? Math.max(chord.maxAlong, scanMax) : scanMax;

  const segments = findContiguousInsideSegmentsAtDepth(
    polygon,
    frame,
    depthPx,
    scanMin,
    scanEnd,
    step,
  );
  if (segments.length === 0) {
    return null;
  }

  let best = segments[0];
  let bestSpan = best.end - best.start;
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    const span = segment.end - segment.start;
    if (span > bestSpan) {
      bestSpan = span;
      best = segment;
    }
  }
  return best;
}

function insetSegmentBounds(
  start: number,
  end: number,
  pitchPx: number,
): { innerMin: number; innerMax: number } | null {
  const span = end - start;
  const seatRadius = Math.max(2.8, pitchPx * 0.42);
  const sideInset = placementSeatBorderPaddingPx(pitchPx, span, seatRadius);
  const innerMin = start + sideInset;
  const innerMax = end - sideInset;
  if (innerMax <= innerMin) {
    const mid = (start + end) / 2;
    return { innerMin: mid, innerMax: mid };
  }
  return { innerMin, innerMax };
}

/** Evenly space seat centres from one padded edge of the row chord to the other. */
function spanFillAlongPositions(
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

/**
 * Equal gaps between seats in an aisle leftover, but never a visually huge
 * stretch. Extra space is kept as equal side margins (centred group).
 * Only used when an aisle is applied.
 */
const AISLE_SHORT_ROW_MAX_STEP_FACTOR = 1.28;

function evenCappedAlongPositions(
  innerMin: number,
  innerMax: number,
  pitchPx: number,
  seatCount: number,
): number[] {
  if (seatCount <= 0 || pitchPx <= 0) {
    return [];
  }
  if (seatCount === 1) {
    return [(innerMin + innerMax) / 2];
  }
  const span = innerMax - innerMin;
  if (span <= 0) {
    return [(innerMin + innerMax) / 2];
  }
  const maxStep = pitchPx * AISLE_SHORT_ROW_MAX_STEP_FACTOR;
  const step = Math.min(span / (seatCount - 1), maxStep);
  const used = (seatCount - 1) * step;
  const start = innerMin + (span - used) / 2;
  return Array.from({ length: seatCount }, (_, index) => start + index * step);
}

function placeRowShapeFillAtBounds(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  innerMin: number,
  innerMax: number,
  pitchPx: number,
  maxSeatsCap?: number,
  fixedPitch = false,
  aisleEvenGaps = false,
): CanvasPoint[] {
  const seatRadius = Math.max(2.8, pitchPx * 0.42);
  const edgePadding = placementSeatBorderPaddingPx(
    pitchPx,
    Math.max(1, innerMax - innerMin),
    seatRadius,
  );
  let maxCount = maxSeatsForSpanFill(innerMin, innerMax, pitchPx);
  if (maxSeatsCap != null && maxSeatsCap > 0) {
    maxCount = Math.min(maxCount, maxSeatsCap);
  }
  if (maxCount <= 0) {
    return [];
  }

  // All-or-nothing: every seat must clear the border, otherwise try fewer seats.
  const tryAlongPositions = (
    alongPositions: number[],
    requirePadding: boolean,
  ): CanvasPoint[] | null => {
    const positions: CanvasPoint[] = [];
    for (const along of alongPositions) {
      const point = pointOnFrame(frame, along, depthPx);
      if (!pointInPolygon(point, polygon)) {
        return null;
      }
      // Bounds from padded segments are already inset from the border. Re-applying
      // full edge padding here rejects edge seats and falls back to centred pitch,
      // which zig-zags against slanted sides. Only enforce padding for fixed-pitch.
      if (requirePadding && !pointInsidePolygonWithPadding(point, polygon, edgePadding)) {
        return null;
      }
      positions.push(point);
    }
    return positions.length > 0 ? positions : null;
  };

  // Bulk/import mode: keep exact physical pitch. End / side blocks pack leftover
  // toward the outer edge (from the adjacent block); otherwise centre the chord.
  if (fixedPitch) {
    for (const align of seatAlignFallbackOrder(activeRowSeatAlign)) {
      for (let seatCount = maxCount; seatCount >= 1; seatCount -= 1) {
        const packed = tryAlongPositions(
          alignedAlongPositions(innerMin, innerMax, pitchPx, seatCount, align),
          true,
        );
        if (packed) {
          return packed;
        }
      }
    }
    return (
      tryAlongPositions(
        startAlignedAlongPositions(innerMin, innerMax, pitchPx, maxCount),
        true,
      ) ?? []
    );
  }

  // Aisle leftover: equal gaps between the seats that fit, but cap the step so
  // 3 seats in a wide leftover stay a compact group instead of a huge stretch.
  if (aisleEvenGaps) {
    for (let seatCount = maxCount; seatCount >= 1; seatCount -= 1) {
      const even = tryAlongPositions(
        evenCappedAlongPositions(innerMin, innerMax, pitchPx, seatCount),
        false,
      );
      if (even) {
        return even;
      }
    }
  } else {
    // Arrange-by-row / drag-seats: stretch edge-to-edge across THIS row's chord so
    // first/last seats hug the padded bounds — equal left/right margins, sides
    // stay parallel to the slant (no centred-pitch zigzag).
    for (let seatCount = maxCount; seatCount >= 1; seatCount -= 1) {
      const spanFill = tryAlongPositions(
        spanFillAlongPositions(innerMin, innerMax, seatCount),
        false,
      );
      if (spanFill) {
        return spanFill;
      }
    }
  }

  // Rare fallback when the chord is too narrow for a clean span.
  for (let seatCount = maxCount; seatCount >= 1; seatCount -= 1) {
    const centered = tryAlongPositions(
      centerAlongPositions(innerMin, innerMax, pitchPx, seatCount),
      false,
    );
    if (centered) {
      return centered;
    }
  }

  return [];
}

function findRowFillBoundsAtDepth(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  pitchPx: number,
): { innerMin: number; innerMax: number } | null {
  const segment = longestPaddedSegmentAtDepth(polygon, frame, depthPx, pitchPx);
  if (!segment) {
    return null;
  }
  return paddedSegmentInnerBounds(segment, pitchPx);
}

/** Place max seats that fit on this row's chord, edge-to-edge within the shape at this depth. */
function placeRowShapeFill(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  pitchPx: number,
  maxSeatsCap?: number,
  fixedPitch = false,
): CanvasPoint[] {
  if (pitchPx <= 0) {
    return [];
  }
  const bounds = findRowFillBoundsAtDepth(polygon, frame, depthPx, pitchPx);
  if (!bounds) {
    return [];
  }
  return placeRowShapeFillAtBounds(
    polygon,
    frame,
    depthPx,
    bounds.innerMin,
    bounds.innerMax,
    pitchPx,
    maxSeatsCap,
    fixedPitch,
  );
}

/**
 * Fill EVERY disjoint inside segment on this row at chair pitch (not just the
 * widest one). Each raw inside pocket uses padding sized to THAT pocket, then
 * packs at chair pitch — concave notches keep the 1–2 seats a large block-wide
 * border pad used to wipe out.
 */
function placeRowShapeFillAllSegments(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  pitchPx: number,
  maxSeatsCap?: number,
  fixedPitch = false,
  drawnBands: DrawnAisleBand[] = [],
): CanvasPoint[] {
  if (pitchPx <= 0) {
    return [];
  }

  const chord = getChordAtDepth(polygon, frame, depthPx, pitchPx);
  const step = Math.max(0.5, pitchPx / 12);
  const scanMax = Math.max(frame.edgeLength * 4, 400);
  const scanMin = chord ? Math.min(chord.minAlong, -scanMax) : -scanMax;
  const scanEnd = chord ? Math.max(chord.maxAlong, scanMax) : scanMax;
  const rawSegments = findContiguousInsideSegmentsAtDepth(
    polygon,
    frame,
    depthPx,
    scanMin,
    scanEnd,
    step,
  );
  if (rawSegments.length === 0) {
    return [];
  }
  rawSegments.sort((a, b) => a.start - b.start);

  const seatRadius = Math.max(2.8, pitchPx * 0.42);
  const positions: CanvasPoint[] = [];
  let remaining =
    maxSeatsCap != null && maxSeatsCap > 0 ? maxSeatsCap : Number.POSITIVE_INFINITY;

  for (const raw of rawSegments) {
    if (remaining <= 0) {
      break;
    }
    const span = raw.end - raw.start;
    const paddingPx = placementSeatBorderPaddingPx(pitchPx, Math.max(span, pitchPx), seatRadius);

    // Split viable centres inside this pocket (handles sharp V walls).
    let viableStart: number | null = null;
    let viableEnd: number | null = null;
    const flushViable = (): void => {
      if (viableStart === null || viableEnd === null || remaining <= 0) {
        viableStart = null;
        viableEnd = null;
        return;
      }
      const placed = placeSeatsInViableSpan(
        polygon,
        frame,
        depthPx,
        viableStart,
        viableEnd,
        pitchPx,
        paddingPx,
        Number.isFinite(remaining) ? remaining : undefined,
        fixedPitch,
        drawnBands.length > 0,
      );
      positions.push(...placed);
      remaining -= placed.length;
      viableStart = null;
      viableEnd = null;
    };

    for (let along = raw.start; along <= raw.end + step * 0.5; along += step) {
      const point = pointOnFrame(frame, along, depthPx);
      const freeOfAisle =
        drawnBands.length === 0 || !pointHitsDrawnAisle(point, drawnBands, seatRadius);
      if (pointInsidePolygonWithPadding(point, polygon, paddingPx) && freeOfAisle) {
        if (viableStart === null) {
          viableStart = along;
        }
        viableEnd = along;
      } else if (viableStart !== null) {
        flushViable();
      }
    }
    flushViable();
  }

  return positions;
}

/** Place as many seats as chair pitch allows inside a viable (already padded) span. */
function placeSeatsInViableSpan(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  viableStart: number,
  viableEnd: number,
  pitchPx: number,
  paddingPx: number,
  maxSeatsCap: number | undefined,
  fixedPitch: boolean,
  aisleEvenGaps = false,
): CanvasPoint[] {
  const span = viableEnd - viableStart;
  if (span < 0) {
    return [];
  }

  if (span < pitchPx * 0.2) {
    const mid = (viableStart + viableEnd) / 2;
    const midPoint = pointOnFrame(frame, mid, depthPx);
    return pointInsidePolygonWithPadding(midPoint, polygon, paddingPx) ? [midPoint] : [];
  }

  const shrink = Math.min(pitchPx * 0.08, 1.5);
  let innerMin = viableStart + shrink;
  let innerMax = viableEnd - shrink;
  if (innerMax < innerMin) {
    innerMin = (viableStart + viableEnd) / 2;
    innerMax = innerMin;
  }

  if (fixedPitch) {
    return placeRowShapeFillAtBounds(
      polygon,
      frame,
      depthPx,
      innerMin,
      innerMax,
      pitchPx,
      maxSeatsCap,
      true,
    );
  }

  if (aisleEvenGaps) {
    return placeRowShapeFillAtBounds(
      polygon,
      frame,
      depthPx,
      innerMin,
      innerMax,
      pitchPx,
      maxSeatsCap,
      false,
      true,
    );
  }

  const spanFilled = placeRowShapeFillAtBounds(
    polygon,
    frame,
    depthPx,
    innerMin,
    innerMax,
    pitchPx,
    maxSeatsCap,
    false,
  );

  // Greedy pitch pack recovers an extra seat when stretch-fill under-counts a notch.
  const greedy: CanvasPoint[] = [];
  const limit =
    maxSeatsCap != null && maxSeatsCap > 0 ? maxSeatsCap : Number.POSITIVE_INFINITY;
  let along = innerMin;
  const probe = Math.max(0.5, pitchPx / 16);
  while (along <= innerMax + 0.01 && greedy.length < limit) {
    const point = pointOnFrame(frame, along, depthPx);
    if (pointInsidePolygonWithPadding(point, polygon, paddingPx)) {
      greedy.push(point);
      along += pitchPx;
    } else {
      along += probe;
    }
  }

  return greedy.length > spanFilled.length ? greedy : spanFilled;
}

function seatsAtRowDepth(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  pitchPx: number,
  maxSeatsCap?: number,
  drawnBands: DrawnAisleBand[] = [],
): number {
  return placeRowShapeFillAllSegments(
    polygon,
    frame,
    depthPx,
    pitchPx,
    maxSeatsCap,
    false,
    drawnBands,
  ).length;
}

/** Never keep a row that would contain only one chair. */
const MIN_SEATS_PER_ROW = 2;

/** Allow an explicit 1-column request; otherwise skip singleton leftover rows. */
function resolveMinSeatsPerRow(seatsCap?: number | null): number {
  if (seatsCap != null && seatsCap > 0 && seatsCap < MIN_SEATS_PER_ROW) {
    return seatsCap;
  }
  return MIN_SEATS_PER_ROW;
}

/** Row depths where a real row (at least two seats) fits at that depth. */
function collectViableRowDepths(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  firstDepth: number,
  rowGapPx: number,
  depthLimit: number,
  pitchPx: number,
  maxRows?: number,
  minSeatsPerRow = MIN_SEATS_PER_ROW,
  drawnBands: DrawnAisleBand[] = [],
): number[] {
  const depths: number[] = [];
  let depth = firstDepth;
  while (depth <= depthLimit + 0.5) {
    // Accept any depth where measurement fit places seats — including short
    // notch pockets that are narrower than 0.35 * pitch on the longest segment.
    const count = seatsAtRowDepth(polygon, frame, depth, pitchPx, undefined, drawnBands);
    if (count >= minSeatsPerRow) {
      depths.push(depth);
      if (maxRows != null && depths.length >= maxRows) {
        break;
      }
    }
    depth += rowGapPx;
  }
  return depths;
}

function nextViableRowDepthAfter(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  afterDepth: number,
  rowGapPx: number,
  maxDepth: number,
  pitchPx: number,
): number | null {
  let depth = afterDepth + rowGapPx;
  while (depth <= maxDepth + 0.5) {
    if (seatsAtRowDepth(polygon, frame, depth, pitchPx) > 0) {
      return depth;
    }
    depth += rowGapPx;
  }
  return null;
}

function collectExistingDragSeatsRows(
  element: CenterpieceElement,
  rect: PixelRect,
  frame: EdgeFrame,
  style: SeatLabelStyle,
): {
  depths: number[];
  overrides: Record<string, CustomShapeSeatPosition>;
} {
  const source = element.seatPositionOverrides ?? {};
  if (!element.seatLayout) {
    return { depths: [], overrides: {} };
  }
  const spec = getSeatLayoutSpec({
    rows: element.rows,
    seatsPerRow: element.seatsPerRow,
    rowLabelStyle: element.rowLabelStyle,
    seatLayout: element.seatLayout,
  });
  const rowSeatCounts = getSeatLayoutRowSeatCounts(spec);
  const depths: number[] = [];
  const overrides: Record<string, CustomShapeSeatPosition> = {};

  for (let rowIndex = 0; rowIndex < rowSeatCounts.length; rowIndex += 1) {
    const count = rowSeatCounts[rowIndex] ?? 0;
    if (count <= 0) {
      continue;
    }
    const anchor = source[seatId(rowIndex, 0, style)];
    if (!anchor) {
      continue;
    }
    depths.push(
      projectDepth(frame, elementPctToCanvasPoint(anchor.xPct, anchor.yPct, rect)),
    );
    for (let seatIndex = 0; seatIndex < count; seatIndex += 1) {
      const id = seatId(rowIndex, seatIndex, style);
      if (source[id]) {
        overrides[id] = source[id];
      }
    }
  }

  return { depths, overrides };
}

function resolveInteractiveDragRowDepths(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  firstDepth: number,
  rowGapPx: number,
  maxDepth: number,
  pitchPx: number,
  targetDepth: number,
  existingDepths: number[],
): number[] {
  const hysteresis = rowGapPx * 0.5;
  let rowDepths = existingDepths.length > 0 ? [...existingDepths] : [firstDepth];
  const clampedTarget = Math.max(firstDepth, Math.min(maxDepth, targetDepth));

  while (true) {
    const tail = rowDepths[rowDepths.length - 1];
    const next = nextViableRowDepthAfter(polygon, frame, tail, rowGapPx, maxDepth, pitchPx);
    if (next == null || clampedTarget < next - hysteresis) {
      break;
    }
    rowDepths.push(next);
  }

  while (rowDepths.length > 1) {
    const tail = rowDepths[rowDepths.length - 1];
    if (clampedTarget < tail - hysteresis) {
      rowDepths.pop();
    } else {
      break;
    }
  }

  return rowDepths;
}

function rowDepthsForDragSeats(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  firstDepth: number,
  rowGapPx: number,
  targetDepth: number,
  maxDepth: number,
  pitchPx: number,
  options?: { snapLastToMax?: boolean; fillEntireShape?: boolean },
): number[] {
  const clampedTarget = options?.fillEntireShape
    ? maxDepth
    : Math.max(firstDepth, Math.min(maxDepth, targetDepth));
  const depths = collectViableRowDepths(
    polygon,
    frame,
    firstDepth,
    rowGapPx,
    clampedTarget,
    pitchPx,
  );
  if (depths.length === 0) {
    return [firstDepth];
  }
  if (options?.snapLastToMax && depths.length > 0) {
    const last = depths[depths.length - 1];
    if (last >= maxDepth - 0.5) {
      depths[depths.length - 1] = maxDepth;
    } else {
      const tailCount = seatsAtRowDepth(polygon, frame, maxDepth, pitchPx);
      if (tailCount > 0) {
        if (maxDepth - last < rowGapPx * 0.85) {
          depths[depths.length - 1] = maxDepth;
        } else {
          depths.push(maxDepth);
        }
      }
    }
  }
  return depths;
}

function maxSeatsForInnerBounds(innerMin: number, innerMax: number, pitchPx: number): number {
  if (pitchPx <= 0 || innerMax < innerMin) {
    return 0;
  }
  let count = 0;
  let along = innerMin + pitchPx * 0.5;
  while (along <= innerMax + 0.01) {
    count += 1;
    along += pitchPx;
  }
  return count;
}

function maxSeatsAtDepth(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  pitchPx: number,
): number {
  return seatsAtRowDepth(polygon, frame, depthPx, pitchPx);
}

function centerAlongPositions(
  innerMin: number,
  innerMax: number,
  pitchPx: number,
  seatCount: number,
): number[] {
  if (seatCount <= 0 || pitchPx <= 0) {
    return [];
  }
  const groupWidth = (seatCount - 1) * pitchPx;
  const startAlong = innerMin + (innerMax - innerMin - groupWidth) / 2;
  return Array.from({ length: seatCount }, (_, index) => startAlong + index * pitchPx);
}

function placeRowWithSeatCount(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  pitchPx: number,
  seatCount: number,
): CanvasPoint[] {
  if (pitchPx <= 0 || seatCount <= 0) {
    return [];
  }
  const bounds = findRowFillBoundsAtDepth(polygon, frame, depthPx, pitchPx);
  if (!bounds) {
    return [];
  }
  return placeRowShapeFillAtBounds(
    polygon,
    frame,
    depthPx,
    bounds.innerMin,
    bounds.innerMax,
    pitchPx,
    seatCount,
  );
}

function placeFirstRowAlongEdge(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  pitchPx: number,
  seatCount?: number,
): CanvasPoint[] {
  const depthInset = Math.max(2, pitchPx * 0.5);
  if (seatCount != null && seatCount > 0) {
    return placeRowWithSeatCount(polygon, frame, depthInset, pitchPx, seatCount);
  }
  const maxSeats = maxSeatsAtDepth(polygon, frame, depthInset, pitchPx);
  return placeRowWithSeatCount(polygon, frame, depthInset, pitchPx, maxSeats);
}

function derivePitchFromLockedFirstRow(
  firstRowOverrides: Record<string, CustomShapeSeatPosition>,
  rect: PixelRect,
  style: 'letter' | 'number',
  frame: EdgeFrame,
  polygon: CanvasPoint[],
  fallbackPitch: number,
): number {
  const seats: CanvasPoint[] = [];
  for (let seatIndex = 0; seatIndex < 500; seatIndex += 1) {
    const position = firstRowOverrides[seatId(0, seatIndex, style)];
    if (!position) {
      break;
    }
    seats.push(elementPctToCanvasPoint(position.xPct, position.yPct, rect));
  }
  if (seats.length >= 2) {
    const pitches: number[] = [];
    for (let index = 1; index < seats.length; index += 1) {
      const deltaAlong =
        projectAlong(frame, seats[index]) - projectAlong(frame, seats[index - 1]);
      if (deltaAlong > 0.5) {
        pitches.push(deltaAlong);
      }
    }
    if (pitches.length > 0) {
      return pitches.reduce((sum, pitch) => sum + pitch, 0) / pitches.length;
    }
  }
  if (seats.length > 0) {
    const depth = projectDepth(frame, seats[0]);
    const chord = getChordAtDepth(polygon, frame, depth, fallbackPitch);
    if (chord) {
      return (chord.maxAlong - chord.minAlong) / seats.length;
    }
  }
  return fallbackPitch;
}

function placeRowFillChord(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  pitchPx: number,
): CanvasPoint[] {
  return placeRowShapeFill(polygon, frame, depthPx, pitchPx);
}

function columnAlongPositions(
  innerMin: number,
  innerMax: number,
  pitchPx: number,
  seatCount: number,
): number[] {
  return centerAlongPositions(innerMin, innerMax, pitchPx, seatCount);
}

function columnAlongFromFirstRow(
  firstRowOverrides: Record<string, CustomShapeSeatPosition>,
  rect: PixelRect,
  style: 'letter' | 'number',
  frame: EdgeFrame,
  seatCount: number,
): number[] {
  const along: number[] = [];
  for (let seatIndex = 0; seatIndex < seatCount; seatIndex += 1) {
    const position = firstRowOverrides[seatId(0, seatIndex, style)];
    if (!position) {
      break;
    }
    along.push(
      projectAlong(frame, elementPctToCanvasPoint(position.xPct, position.yPct, rect)),
    );
  }
  return along;
}

function placeRowAtAlignedColumns(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  columnAlong: number[],
): CanvasPoint[] {
  const positions: CanvasPoint[] = [];
  for (const along of columnAlong) {
    const point = pointOnFrame(frame, along, depthPx);
    if (pointInPolygon(point, polygon)) {
      positions.push(point);
    }
  }
  return positions;
}

function rowFitsAlignedColumns(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  columnAlong: number[],
  seatCount: number,
): boolean {
  if (columnAlong.length < seatCount) {
    return false;
  }
  let inside = 0;
  for (let index = 0; index < seatCount; index += 1) {
    const point = pointOnFrame(frame, columnAlong[index], depthPx);
    if (pointInPolygon(point, polygon)) {
      inside += 1;
    }
  }
  return inside >= seatCount;
}

function placeRowAtDepth(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  columnAlong: number[],
  seatCount: number,
): CanvasPoint[] {
  return placeRowAtAlignedColumns(polygon, frame, depthPx, columnAlong.slice(0, seatCount));
}

function firstSeatAlongAnchor(
  firstRowOverrides: Record<string, CustomShapeSeatPosition>,
  rect: PixelRect,
  style: 'letter' | 'number',
  frame: EdgeFrame,
  pitchPx: number,
): number {
  const first = firstRowOverrides[seatId(0, 0, style)];
  if (first) {
    return projectAlong(frame, elementPctToCanvasPoint(first.xPct, first.yPct, rect));
  }
  return pitchPx * 0.5;
}

function maxFillDepth(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  firstDepth: number,
  rowGapPx: number,
  columnAlong: number[],
  seatCount: number,
  limitDepth: number,
): number {
  let last = firstDepth;
  for (let depth = firstDepth; depth <= limitDepth + 0.5; depth += rowGapPx) {
    if (rowFitsAlignedColumns(polygon, frame, depth, columnAlong, seatCount)) {
      last = depth;
    }
  }
  return last;
}

function estimateMaxInwardDepth(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  firstDepth: number,
  rowGapPx: number,
  columnAlong: number[],
  seatCount: number,
): number {
  let maxDepth = frame.edgeLength * 2;
  for (const vertex of polygon) {
    const depth = projectDepth(frame, vertex);
    if (depth > 0) {
      maxDepth = Math.max(maxDepth, depth);
    }
  }
  return maxFillDepth(
    polygon,
    frame,
    firstDepth,
    rowGapPx,
    columnAlong,
    seatCount,
    maxDepth,
  );
}

function collectRowDepthsFromOverrides(
  element: CenterpieceElement,
  rect: PixelRect,
  frame: EdgeFrame,
  fallbackDepth: number,
): number[] {
  const overrides = element.seatPositionOverrides ?? {};
  const depths = new Set<number>();
  for (const position of Object.values(overrides)) {
    const point = elementPctToCanvasPoint(position.xPct, position.yPct, rect);
    depths.add(projectDepth(frame, point));
  }
  if (depths.size === 0) {
    depths.add(fallbackDepth);
  }
  return [...depths].sort((a, b) => a - b);
}

function maxUniformSeatsForAlignedColumns(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depths: number[],
  pitchPx: number,
): number {
  if (depths.length === 0) {
    return 1;
  }
  let minMax = Number.POSITIVE_INFINITY;
  for (const depth of depths) {
    minMax = Math.min(minMax, maxSeatsAtDepth(polygon, frame, depth, pitchPx));
  }
  return Math.max(1, minMax);
}

function rowDepthsFromAnchor(
  firstDepth: number,
  rowGapPx: number,
  targetDepth: number,
  maxDepth: number,
  options?: { snapLastToMax?: boolean },
): number[] {
  const clamped = Math.max(firstDepth, Math.min(maxDepth, targetDepth));
  const depths = [firstDepth];
  let depth = firstDepth + rowGapPx;
  while (depth <= clamped + 0.5) {
    depths.push(depth);
    depth += rowGapPx;
  }
  if (options?.snapLastToMax && depths[depths.length - 1] < maxDepth - rowGapPx * 0.35) {
    const last = depths[depths.length - 1];
    if (maxDepth - last < rowGapPx * 0.85) {
      depths[depths.length - 1] = maxDepth;
    } else {
      depths.push(maxDepth);
    }
  }
  return depths;
}

function dragSeatsViewpointFrame(
  element: CenterpieceElement,
  polygon: CanvasPoint[],
  rect: PixelRect,
): { frame: EdgeFrame; sideIndex: number } {
  const sideIndex = resolveStadiumSideIndex(element, polygon);
  const angle = element.blockViewpointAngleDeg ?? null;
  // Prefer the VIEW POINT angle so the row axis matches the green block-side marker,
  // not a stale raw edge index that can leave seats screen-axis while the side is slanted.
  const frame = buildStadiumEdgeFrame(polygon, rect, sideIndex, angle);
  const fromView =
    angle != null && Number.isFinite(angle)
      ? stadiumLogicalEdgeFromView(polygon, rect.cx, rect.cy, angle)
      : null;
  return {
    sideIndex: fromView?.index ?? sideIndex,
    frame,
  };
}

function buildDragSeatsLayout(
  element: CenterpieceElement,
  rect: PixelRect,
  targetDepth: number,
  options?: {
    initialFirstRowOnly?: boolean;
    fillEntireShape?: boolean;
    interactiveExpand?: boolean;
  },
): Partial<CenterpieceElement> {
  const polygon = getOutlineCanvasPoints(element, rect);
  const sideLengthsM = element.customSideLengthsM ?? [];
  if (polygon.length < 3 || sideLengthsM.length < 3) {
    return {};
  }

  const borderGapPx = Math.max(0, (element.borderGapM ?? 0) * computePxPerMetre(polygon, sideLengthsM));

  return withPlacementBorderGapPx(borderGapPx, () => {
    const { frame, sideIndex } = dragSeatsViewpointFrame(element, polygon, rect);
    const ppm = computePxPerMetre(polygon, sideLengthsM);
    const seatGapM = resolveSeatGapM(element);
    const rowGapM = resolveRowGapM(element);
    // Same pitch formula as arrange-by-row — do not keep a stale frozen pitch that
    // forces centred packing and zig-zag edges.
    const pitchPx = Math.max(
      6,
      element.seatLayout?.customShapeSeatPitchPx && element.seatLayout.customShapeSeatPitchPx > 0
        ? element.seatLayout.customShapeSeatPitchPx
        : (resolveChairWidthM(element) + seatGapM) * ppm,
    );
    const rowGapPx = Math.max(8, (resolveChairLengthM(element) + rowGapM) * ppm);
    const style = element.rowLabelStyle ?? element.seatLayout?.rowLabelStyle ?? 'letter';

    const firstDepth = resolveShapeSeatFirstRowDepthPx(rowGapPx, frame.edgeLength);
    const maxDepth = estimateMaxArrangeByRowDepthPx(
      polygon,
      frame,
      rowGapPx,
      frame.edgeLength,
    );

    let effectiveTarget = options?.initialFirstRowOnly
      ? firstDepth
      : Math.max(firstDepth, Math.min(maxDepth, targetDepth));

    if (options?.fillEntireShape) {
      effectiveTarget = maxDepth;
    } else if (
      !options?.initialFirstRowOnly &&
      !options?.interactiveExpand &&
      effectiveTarget >= maxDepth - rowGapPx * 0.5
    ) {
      effectiveTarget = maxDepth;
    }

    const existingDepths =
      options?.interactiveExpand && !options?.initialFirstRowOnly
        ? collectExistingDragSeatsRows(element, rect, frame, style).depths
        : ([] as number[]);

    const rowDepths =
      options?.interactiveExpand && !options?.initialFirstRowOnly
        ? resolveInteractiveDragRowDepths(
            polygon,
            frame,
            firstDepth,
            rowGapPx,
            maxDepth,
            pitchPx,
            effectiveTarget,
            existingDepths,
          )
        : rowDepthsForDragSeats(
            polygon,
            frame,
            firstDepth,
            rowGapPx,
            effectiveTarget,
            maxDepth,
            pitchPx,
            {
              snapLastToMax:
                options?.fillEntireShape ||
                (!options?.initialFirstRowOnly &&
                  !options?.interactiveExpand &&
                  effectiveTarget >= maxDepth - rowGapPx * 0.5),
              fillEntireShape: options?.fillEntireShape,
            },
          );

    const rowSeatCounts: number[] = [];
    const overrides: Record<string, CustomShapeSeatPosition> = {};

    // Same placement as arrange-by-row: every row span-fills its own chord so
    // left/right margins stay equal and edges stay parallel to the slant.
    // Always re-place (never preserve old centred/zigzag overrides).
    for (let depthIndex = 0; depthIndex < rowDepths.length; depthIndex += 1) {
      const depth = rowDepths[depthIndex];
      if (depth > maxDepth + 0.5) {
        break;
      }

      const positions = placeRowShapeFillAllSegments(polygon, frame, depth, pitchPx);
      if (positions.length === 0) {
        if (depthIndex === 0) {
          return {};
        }
        continue;
      }

      rowSeatCounts.push(positions.length);
      const rowIndex = rowSeatCounts.length - 1;
      for (let seatIndex = 0; seatIndex < positions.length; seatIndex += 1) {
        overrides[seatId(rowIndex, seatIndex, style)] = canvasPointToElementPct(
          positions[seatIndex],
          rect,
        );
      }
    }

    if (rowSeatCounts.length === 0) {
      return {};
    }

    const maxSeatsPerRow = Math.max(1, maxSeatsInRowCounts(rowSeatCounts));
    const baseSpec = element.seatLayout
      ? getSeatLayoutSpec({
          rows: element.rows,
          seatsPerRow: element.seatsPerRow,
          rowLabelStyle: element.rowLabelStyle,
          seatLayout: element.seatLayout,
        })
      : createSeatLayoutSpec(rowSeatCounts.length, maxSeatsPerRow, style);

    const spec = capSeatLayoutToCapacity(
      {
        ...baseSpec,
        rows: rowSeatCounts.length,
        seatsPerRow: maxSeatsPerRow,
        rowSeatCounts,
        customShapeSeatPitchPx: pitchPx,
        seatAlign: 'center',
      },
      rowSeatCounts.length,
      maxSeatsPerRow,
    );

    return {
      rows: spec.rows,
      seatsPerRow: spec.seatsPerRow,
      rowLabelStyle: spec.rowLabelStyle,
      seatLayout: spec,
      seatPositionOverrides: overrides,
      dragSeatsStadiumSideIndex: sideIndex,
      dragSeatsFirstRowSeatCount: rowSeatCounts[0],
      seatFacingDeg: seatFacingDegFromRowFrame(frame),
    };
  });
}

/** Enable drag-seats — first row along the chosen stadium-view side only. */
export function createDragSeatsSeating(
  element: CenterpieceElement,
  rect: PixelRect,
  sideLengthsM: number[],
  dims: PhysicalDimsInput,
  stadiumSideIndex: number,
  firstRowSeatCount?: number,
): Partial<CenterpieceElement> {
  const polygon = getOutlineCanvasPoints(element, rect);
  if (polygon.length < 3 || sideLengthsM.length < 3) {
    return {};
  }

  const blockDims = deriveBlockDimsFromSides(polygon, sideLengthsM);
  const ppm = computePxPerMetre(polygon, sideLengthsM);
  const gapM = dims.seatGapM ?? DEFAULT_SEAT_GAP_M;
  const pitchPx = Math.max(6, (dims.chairWidthM + gapM) * ppm);
  const safeSideIndex = Math.max(0, Math.min(polygon.length - 1, stadiumSideIndex));

  const el: CenterpieceElement = {
    ...element,
    ...dims,
    ...blockDims,
    customSideLengthsM: sideLengthsM,
    dragSeatsMode: true,
    dragSeatsStadiumSideIndex: safeSideIndex,
    dragSeatsFirstRowSeatCount: firstRowSeatCount,
    code: element.code?.trim() || element.name?.trim() || 'CUSTOM',
    customSeatBlocks: undefined,
    rowLabelStyle: 'letter',
    seatLayout: {
      rows: 1,
      seatsPerRow: 1,
      customShapeSeatPitchPx: pitchPx,
      seatAlign: 'center',
      rowSeatCounts: [0],
    },
    seatPositionOverrides: {},
  };

  const { frame, sideIndex: resolvedSide } = dragSeatsViewpointFrame(el, polygon, rect);
  const rowGapPx = Math.max(8, (dims.chairLengthM + (dims.rowGapM ?? gapM)) * ppm);
  const firstDepth = resolveShapeSeatFirstRowDepthPx(rowGapPx, frame.edgeLength);
  const layoutPatch = buildDragSeatsLayout(
    { ...el, dragSeatsStadiumSideIndex: resolvedSide },
    rect,
    firstDepth,
    { initialFirstRowOnly: true },
  );

  return {
    ...layoutPatch,
    customSideLengthsM: sideLengthsM,
    dragSeatsMode: true,
    dragSeatsStadiumSideIndex: resolvedSide,
    dragSeatsFirstRowSeatCount: layoutPatch.dragSeatsFirstRowSeatCount,
    seatFacingDeg: seatFacingDegFromRowFrame(frame),
    physicalLengthM: dims.physicalLengthM || blockDims.physicalLengthM,
    physicalWidthM: dims.physicalWidthM || blockDims.physicalWidthM,
    chairLengthM: dims.chairLengthM,
    chairWidthM: dims.chairWidthM,
    seatGapM: gapM,
    rowGapM: dims.rowGapM ?? gapM,
    code: el.code,
    customSeatBlocks: undefined,
  };
}

/** Expand rows inward from the stadium side as the user drags into the shape. */
export function expandDragSeatsToCanvasPoint(
  element: CenterpieceElement,
  rect: PixelRect,
  canvasPoint: CanvasPoint,
): Partial<CenterpieceElement> {
  if (!isDragSeatsElement(element)) {
    return {};
  }
  const polygon = getOutlineCanvasPoints(element, rect);
  const { frame } = dragSeatsViewpointFrame(element, polygon, rect);
  const targetDepth = Math.max(0, projectDepth(frame, canvasPoint));
  return buildDragSeatsLayout(element, rect, targetDepth, { interactiveExpand: true });
}

/** Fill every row that fits inside the custom piece (row A stays locked). */
export function fillDragSeatsFullShape(
  element: CenterpieceElement,
  rect: PixelRect,
): Partial<CenterpieceElement> {
  if (!isDragSeatsElement(element)) {
    return {};
  }
  return buildDragSeatsLayout(element, rect, Number.MAX_SAFE_INTEGER, { fillEntireShape: true });
}

/** @deprecated Use expandDragSeatsToCanvasPoint */
export function expandDragSeatsToCanvasY(
  element: CenterpieceElement,
  rect: PixelRect,
  canvasY: number,
): Partial<CenterpieceElement> {
  return expandDragSeatsToCanvasPoint(element, rect, { x: rect.x + rect.width / 2, y: canvasY });
}

function getCurrentDragSeatsTargetDepth(
  element: CenterpieceElement,
  rect: PixelRect,
): number {
  const polygon = getOutlineCanvasPoints(element, rect);
  if (polygon.length < 3) {
    return 0;
  }
  const { frame } = dragSeatsViewpointFrame(element, polygon, rect);
  const style = element.rowLabelStyle ?? element.seatLayout?.rowLabelStyle ?? 'letter';
  const overrides = element.seatPositionOverrides ?? {};
  let maxDepth = 0;
  for (const position of Object.values(overrides)) {
    const point = elementPctToCanvasPoint(position.xPct, position.yPct, rect);
    maxDepth = Math.max(maxDepth, projectDepth(frame, point));
  }
  const first = overrides[seatId(0, 0, style)];
  const rowGapPx = resolveRowGapPx(element, computePxPerMetre(polygon, element.customSideLengthsM ?? []));
  const firstDepth = first
    ? projectDepth(frame, elementPctToCanvasPoint(first.xPct, first.yPct, rect))
    : resolveShapeSeatFirstRowDepthPx(rowGapPx, frame.edgeLength);
  return Math.max(firstDepth, maxDepth);
}

/** Seats placed on the first row at the current spacing (shape auto-fill). */
export function getDragSeatsMaxFirstRowSeatCount(
  element: CenterpieceElement,
  rect: PixelRect,
): number {
  const polygon = getOutlineCanvasPoints(element, rect);
  const sideLengthsM = element.customSideLengthsM ?? [];
  if (polygon.length < 3 || sideLengthsM.length < 3) {
    return 1;
  }
  const { frame } = dragSeatsViewpointFrame(element, polygon, rect);
  const ppm = computePxPerMetre(polygon, sideLengthsM);
  const pitchPx = resolvePitchPx(element, ppm);
  const rowGapPx = resolveRowGapPx(element, ppm);
  const style = element.rowLabelStyle ?? element.seatLayout?.rowLabelStyle ?? 'letter';
  const overrides = element.seatPositionOverrides ?? {};
  const first = overrides[seatId(0, 0, style)];
  const firstDepth = first
    ? projectDepth(frame, elementPctToCanvasPoint(first.xPct, first.yPct, rect))
    : resolveShapeSeatFirstRowDepthPx(rowGapPx, frame.edgeLength);
  return Math.max(1, seatsAtRowDepth(polygon, frame, firstDepth, pitchPx));
}

/** Estimate max first-row seats before drag-seats is applied (wizard preview). */
export function estimateDragSeatsFirstRowCapacity(
  element: CenterpieceElement,
  rect: PixelRect,
  sideLengthsM: number[],
  chairWidthM: number,
  chairLengthM: number,
  seatGapM: number | undefined,
  stadiumSideIndex: number,
): number {
  const polygon = getOutlineCanvasPoints(element, rect);
  if (polygon.length < 3 || sideLengthsM.length < 3) {
    return 1;
  }
  const safeSideIndex = Math.max(0, Math.min(polygon.length - 1, stadiumSideIndex));
  const frame = buildStadiumEdgeFrame(
    polygon,
    rect,
    safeSideIndex,
    element.blockViewpointAngleDeg ?? null,
  );
  const ppm = computePxPerMetre(polygon, sideLengthsM);
  const gapM = seatGapM ?? DEFAULT_SEAT_GAP_M;
  const rowGapM = gapM;
  const pitchPx = Math.max(6, (chairWidthM + gapM) * ppm);
  const rowGapPx = Math.max(8, (chairLengthM + rowGapM) * ppm);
  const firstDepth = resolveShapeSeatFirstRowDepthPx(rowGapPx, frame.edgeLength);
  return Math.max(1, seatsAtRowDepth(polygon, frame, firstDepth, pitchPx));
}

/** Rebuild drag-seats layout at the current drag depth (shape-fill per row). */
export function updateDragSeatsFirstRowSeatCount(
  element: CenterpieceElement,
  rect: PixelRect,
  _seatCount: number,
): Partial<CenterpieceElement> {
  if (!isDragSeatsElement(element)) {
    return {};
  }
  const targetDepth = getCurrentDragSeatsTargetDepth(element, rect);
  return buildDragSeatsLayout(element, rect, targetDepth);
}

/** Rebuild drag-seats layout when chair size or gaps change. */
export function updateDragSeatsSpacing(
  element: CenterpieceElement,
  rect: PixelRect,
  dims: PhysicalDimsInput,
): Partial<CenterpieceElement> {
  if (!isDragSeatsElement(element)) {
    return {};
  }
  const polygon = getOutlineCanvasPoints(element, rect);
  const sideLengthsM = element.customSideLengthsM ?? [];
  if (polygon.length < 3 || sideLengthsM.length < 3) {
    return {};
  }

  const targetDepth = getCurrentDragSeatsTargetDepth(element, rect);
  const { frame } = dragSeatsViewpointFrame(element, polygon, rect);
  const ppm = computePxPerMetre(polygon, sideLengthsM);
  const seatGapM = resolveSeatGapMFromDims(dims);
  const rowGapM = resolveRowGapMFromDims(dims);
  const pitchPx = Math.max(6, (dims.chairWidthM + seatGapM) * ppm);
  const rowGapPx = Math.max(8, (dims.chairLengthM + rowGapM) * ppm);
  const maxDepth = estimateMaxArrangeByRowDepthPx(polygon, frame, rowGapPx, frame.edgeLength);
  const fillEntireShape = targetDepth >= maxDepth - rowGapPx * 0.5;

  const merged: CenterpieceElement = {
    ...element,
    chairLengthM: dims.chairLengthM,
    chairWidthM: dims.chairWidthM,
    seatGapM: dims.seatGapM,
    rowGapM: dims.rowGapM,
    seatPositionOverrides: {},
    seatLayout: {
      ...(element.seatLayout ?? { rows: 1, seatsPerRow: 1, rowSeatCounts: [1] }),
      customShapeSeatPitchPx: pitchPx,
    },
  };

  return buildDragSeatsLayout(merged, rect, targetDepth, { fillEntireShape });
}

/** Rebuild drag-seats layout when only seat gap changes (legacy entry point). */
export function updateDragSeatsSeatGap(
  element: CenterpieceElement,
  rect: PixelRect,
  seatGapM: number,
): Partial<CenterpieceElement> {
  return updateDragSeatsSpacing(element, rect, {
    physicalLengthM: resolveBlockLengthM(element),
    physicalWidthM: resolveBlockWidthM(element),
    chairLengthM: resolveChairLengthM(element),
    chairWidthM: resolveChairWidthM(element),
    seatGapM,
    rowGapM: resolveRowGapM(element),
  });
}

export interface ArrangeByRowLayoutPreview {
  rowSeatCounts: number[];
  totalSeats: number;
  minSeatsPerRow: number;
  maxSeatsPerRow: number;
}

function arrangeByRowSeatFrame(
  element: CenterpieceElement,
  rect: PixelRect,
  sideLengthsM: number[],
  dims: PhysicalDimsInput,
  stadiumSideIndex: number,
  viewpointAngleDeg?: number | null,
): {
  polygon: CanvasPoint[];
  frame: EdgeFrame;
  pitchPx: number;
  rowGapPx: number;
  firstDepth: number;
} | null {
  const polygon = getOutlineCanvasPoints(element, rect);
  if (polygon.length < 3 || sideLengthsM.length < 3) {
    return null;
  }
  const safeSideIndex = Math.max(0, Math.min(polygon.length - 1, stadiumSideIndex));
  const angle = viewpointAngleDeg ?? element.blockViewpointAngleDeg ?? null;
  // Same edge as the green VIEW POINT marker — rows stay parallel to that block side.
  const frame = buildStadiumEdgeFrame(polygon, rect, safeSideIndex, angle);
  const ppm = computePxPerMetre(polygon, sideLengthsM);
  const seatGapM = resolveSeatGapMFromDims(dims);
  const rowGapM = resolveRowGapMFromDims(dims);
  const pitchPx = Math.max(6, (dims.chairWidthM + seatGapM) * ppm);
  const rowGapPx = Math.max(8, (dims.chairLengthM + rowGapM) * ppm);
  const firstDepth = resolveShapeSeatFirstRowDepthPx(rowGapPx, frame.edgeLength);
  return { polygon, frame, pitchPx, rowGapPx, firstDepth };
}

/** Per-row seat counts when each row auto-fills its shape width at that depth. */
export function previewArrangeByRowLayout(
  element: CenterpieceElement,
  rect: PixelRect,
  sideLengthsM: number[],
  dims: PhysicalDimsInput,
  stadiumSideIndex: number,
  rowCount: number,
  viewpointAngleDeg?: number | null,
  maxSeatsPerRowCap?: number,
): ArrangeByRowLayoutPreview | null {
  const ctx = arrangeByRowSeatFrame(
    element,
    rect,
    sideLengthsM,
    dims,
    stadiumSideIndex,
    viewpointAngleDeg,
  );
  if (!ctx) {
    return null;
  }
  const rows = Math.max(1, Math.round(rowCount));
  const cap =
    maxSeatsPerRowCap != null && maxSeatsPerRowCap > 0 ? maxSeatsPerRowCap : undefined;
  const maxDepth = estimateMaxArrangeByRowDepthPx(
    ctx.polygon,
    ctx.frame,
    ctx.rowGapPx,
    ctx.frame.edgeLength,
  );
  const minSeatsPerRow = resolveMinSeatsPerRow(cap);
  const rowDepths = collectViableRowDepths(
    ctx.polygon,
    ctx.frame,
    ctx.firstDepth,
    ctx.rowGapPx,
    maxDepth,
    ctx.pitchPx,
    rows,
    minSeatsPerRow,
  );
  const rowSeatCounts: number[] = [];
  for (const depth of rowDepths) {
    const count = seatsAtRowDepth(ctx.polygon, ctx.frame, depth, ctx.pitchPx, cap);
    if (count < minSeatsPerRow) {
      continue;
    }
    rowSeatCounts.push(count);
  }
  if (rowSeatCounts.length === 0) {
    return null;
  }
  return {
    rowSeatCounts,
    totalSeats: rowSeatCounts.reduce((sum, count) => sum + count, 0),
    minSeatsPerRow: Math.min(...rowSeatCounts),
    maxSeatsPerRow: Math.max(...rowSeatCounts),
  };
}

/** Maximum rows and per-row fill capacity using measured side lengths and chair spacing. */
export function estimateArrangeByRowCapacity(
  element: CenterpieceElement,
  rect: PixelRect,
  sideLengthsM: number[],
  dims: PhysicalDimsInput,
  stadiumSideIndex: number,
  viewpointAngleDeg?: number | null,
): PhysicalCapacity {
  const polygon = getOutlineCanvasPoints(element, rect);
  const ppm =
    polygon.length >= 3 && sideLengthsM.length >= 3
      ? computePxPerMetre(polygon, sideLengthsM)
      : 1;
  const borderGapPx = Math.max(0, (dims.borderGapM ?? 0) * ppm);

  return withPlacementBorderGapPx(borderGapPx, () => {
    const ctx = arrangeByRowSeatFrame(
      element,
      rect,
      sideLengthsM,
      dims,
      stadiumSideIndex,
      viewpointAngleDeg,
    );
    if (!ctx) {
      return { maxRows: 1, maxSeatsPerRow: 1, maxCapacity: 1 };
    }

    const rowSeatCounts: number[] = [];
    const maxDepth = estimateMaxArrangeByRowDepthPx(
      ctx.polygon,
      ctx.frame,
      ctx.rowGapPx,
      ctx.frame.edgeLength,
    );
    const viableDepths = collectViableRowDepths(
      ctx.polygon,
      ctx.frame,
      ctx.firstDepth,
      ctx.rowGapPx,
      maxDepth,
      ctx.pitchPx,
    );
    for (const depth of viableDepths) {
      const count = seatsAtRowDepth(ctx.polygon, ctx.frame, depth, ctx.pitchPx);
      if (count < MIN_SEATS_PER_ROW) {
        continue;
      }
      rowSeatCounts.push(count);
    }

    if (rowSeatCounts.length === 0) {
      return { maxRows: 1, maxSeatsPerRow: 1, maxCapacity: 1 };
    }

    return {
      maxRows: rowSeatCounts.length,
      maxSeatsPerRow: Math.max(...rowSeatCounts),
      maxCapacity: rowSeatCounts.reduce((sum, count) => sum + count, 0),
    };
  });
}

/** Blueprint sheet scale — stadium edge metres mapped to canvas pixels. */
export interface ArrangeByRowBlueprintScale {
  stadiumEdgeLengthM: number;
  stadiumEdgeLengthPx: number;
  depthLengthM: number;
  /**
   * Optional lower bounds for on-canvas seat spacing (defaults 6px / 8px).
   * Bulk import lowers them so small traced blocks honour the documented
   * grid exactly — the canvas zoom makes tiny seats workable.
   */
  minSeatPitchPx?: number;
  minRowSpacingPx?: number;
  /**
   * Place seats at exactly the physical pitch. Leftover in a row packs to the
   * outer / side edge when a neighbour is present, otherwise the group is centred.
   */
  exactPitchPlacement?: boolean;
}

export interface ArrangeByRowPlacementOptions {
  /** Explicit leftover packing. When omitted, inferred from adjacent blocks. */
  seatAlign?: RowSeatAlign;
  /** Nearby blocks used to pick the outer / side edge for leftover seats. */
  adjacentBlocks?: AdjacentBlockRef[];
  /**
   * Which end of every row gets seat 1, as seen by someone sitting in the
   * block and facing the VIEW POINT. Omitted → legacy edge order.
   */
  seatStartSide?: SeatStartSide;
}

/** Seat 1 position within a row, from the spectator's point of view (facing the VIEW POINT). */
export type SeatStartSide = 'left' | 'right';

/**
 * Which side seat 1 lands on when seats are numbered in the frame's `along`
 * order. Spectators face the VIEW POINT edge (−perp); their left-hand
 * direction on a y-down canvas is (−perpY, perpX).
 */
export function seatStartSideFromFrameOrder(frame: ViewpointSeatFrame): SeatStartSide {
  const leftX = -frame.perpY;
  const leftY = frame.perpX;
  const alongPointsLeft = frame.ux * leftX + frame.uy * leftY > 0;
  // Along = direction of increasing seat number, so seat 1 sits at the far end.
  return alongPointsLeft ? 'right' : 'left';
}

/**
 * Effective seat-1 side for a block: the stored choice, else read off the
 * placed seats themselves (legacy blocks keep their numbering), else the
 * spectator's left — the usual convention for a fresh block.
 */
export function resolveSeatStartSide(element: CenterpieceElement, rect: PixelRect): SeatStartSide {
  if (element.seatStartSide === 'left' || element.seatStartSide === 'right') {
    return element.seatStartSide;
  }
  const built = buildViewpointSeatFrame(element, rect);
  if (!built) {
    return 'left';
  }
  const positions = element.autoFillStraightSeatPositions ?? element.seatPositionOverrides ?? {};
  const byRow = new Map<number, { seatIndex: number; point: CanvasPoint }[]>();
  for (const [id, pos] of Object.entries(positions)) {
    const parsed = parseOverrideSeatId(id);
    if (!parsed) {
      continue;
    }
    const list = byRow.get(parsed.rowIndex) ?? [];
    list.push({ seatIndex: parsed.seatIndex, point: elementPctToCanvasPoint(pos.xPct, pos.yPct, rect) });
    byRow.set(parsed.rowIndex, list);
  }
  const leftX = -built.frame.perpY;
  const leftY = built.frame.perpX;
  let vote = 0;
  for (const seats of byRow.values()) {
    if (seats.length < 2) {
      continue;
    }
    seats.sort((a, b) => a.seatIndex - b.seatIndex);
    const first = seats[0].point;
    const last = seats[seats.length - 1].point;
    // Positive → seat numbers grow toward the spectator's left → seat 1 is on the right.
    vote += (last.x - first.x) * leftX + (last.y - first.y) * leftY;
  }
  if (Math.abs(vote) > 1e-6) {
    return vote > 0 ? 'right' : 'left';
  }
  return 'left';
}

/** Capacity from blueprint metre labels (not geometric chord sampling). */
export function estimateCapacityFromBlueprintMeters(
  scale: ArrangeByRowBlueprintScale,
  dims: PhysicalDimsInput,
): PhysicalCapacity {
  const seatGapM = resolveSeatGapMFromDims(dims);
  const rowGapM = resolveRowGapMFromDims(dims);
  const maxSeatsPerRow = fitCountInSpan(
    scale.stadiumEdgeLengthM,
    dims.chairWidthM,
    seatGapM,
  );
  const maxRows = fitCountInSpan(scale.depthLengthM, dims.chairLengthM, rowGapM);
  const safeRows = Math.max(1, maxRows);
  const safeSeats = Math.max(1, maxSeatsPerRow);
  return {
    maxRows: safeRows,
    maxSeatsPerRow: safeSeats,
    maxCapacity: safeRows * safeSeats,
  };
}

/**
 * Walkway slots for arrange-by-row / Auto Fill.
 * Empty physical slots keep spacing; seat IDs renumber continuously (skip C → next row still labeled C).
 * `aisleWidthM` reserves real metres for each walkway so seats pack into the remaining space.
 */
export interface ArrangeByRowAislePlacement {
  /** 0-based physical row slots left empty. */
  aisleRowIndices?: number[];
  /** 0-based seat columns left empty in every row. */
  aisleColumnIndices?: number[];
  /** Fallback walkway width in metres. */
  aisleWidthM?: number;
  /** Width for manual row aisles (metres). */
  rowAisleWidthM?: number;
  /** Width for manual column aisles (metres). */
  columnAisleWidthM?: number;
  /**
   * Geometric center aisle(s). Axis comes from each slot's `centerAxis` (row/column tick).
   * Multiple aisles on the same axis evenly divide that side's measurement.
   */
  centerAisle?: boolean;
  /** @deprecated Prefer centerColumn / centerRow width lists. */
  centerAisleCount?: number;
  /** @deprecated Prefer centerColumnAisleWidthsM / centerRowAisleWidthsM. */
  centerAisleWidthM?: number;
  /** @deprecated Prefer split row/column width lists. */
  centerAisleWidthsM?: number[];
  /** Center aisles along columns (across / seat direction). */
  centerColumnAisleWidthsM?: number[];
  /** Center aisles along rows (depth direction). */
  centerRowAisleWidthsM?: number[];
  /** Drawn two-point walkways (element-local %). Seats pack into remaining space. */
  drawnAisles?: {
    start: { xPct: number; yPct: number };
    end: { xPct: number; yPct: number };
    widthM: number;
  }[];
}

/**
 * Pack seat centers into a row span at chair pitch, inserting aisleWidthPx gaps at
 * aisle column indices. Aisle metres are reserved first; seats pack into what remains
 * (e.g. 5m span − 2m aisle → seats use 3m). Labels renumber continuously.
 * Optional geometric center aisles stay at mid-span and combine with indexed columns.
 */
function alongPositionsWithColumnAisles(
  innerMin: number,
  innerMax: number,
  pitchPx: number,
  aisleColSet: Set<number>,
  aisleWidthPx: number,
  seatsCap?: number,
  centerWidthsPx?: number[],
): number[] {
  const centers = (centerWidthsPx ?? []).filter((w) => Number.isFinite(w) && w > 0);
  if (centers.length > 0 && aisleColSet.size > 0) {
    return alongPositionsWithColumnAislesAndCenter(
      innerMin,
      innerMax,
      pitchPx,
      aisleColSet,
      aisleWidthPx,
      centers,
      seatsCap,
    );
  }
  if (centers.length > 0) {
    return alongPositionsWithGeometricCenterAisles(
      innerMin,
      innerMax,
      pitchPx,
      centers,
      seatsCap,
    );
  }

  const span = innerMax - innerMin;
  if (span <= 0 || pitchPx <= 0 || aisleWidthPx < 0) {
    return [];
  }

  const tryPack = (nSeats: number): number[] | null => {
    if (nSeats <= 0) {
      return null;
    }
    const seatAlongs: number[] = [];
    let along = 0;
    let seats = 0;
    let phys = 0;
    const guardLimit = nSeats + aisleColSet.size + 64;
    while (seats < nSeats && phys < guardLimit) {
      if (aisleColSet.has(phys)) {
        along += aisleWidthPx;
      } else {
        seatAlongs.push(along);
        along += pitchPx;
        seats += 1;
      }
      phys += 1;
    }
    if (seatAlongs.length !== nSeats) {
      return null;
    }
    const lastSeat = seatAlongs[seatAlongs.length - 1]!;
    // Occupied from 0 through last seat center (leading aisles included in offsets).
    if (lastSeat > span + 0.01) {
      return null;
    }
    const extra = span - lastSeat;
    const startAlong =
      activeRowSeatAlign === 'left'
        ? innerMin
        : activeRowSeatAlign === 'right'
          ? innerMin + extra
          : innerMin + extra / 2;
    return seatAlongs.map((a) => startAlong + a);
  };

  let maxGuess = maxSeatsForSpanFill(innerMin, innerMax, pitchPx);
  if (seatsCap != null && seatsCap > 0) {
    maxGuess = Math.min(maxGuess, seatsCap);
  }
  for (let n = maxGuess; n >= 1; n -= 1) {
    const packed = tryPack(n);
    if (!packed) {
      continue;
    }
    if (packed.every((a) => a >= innerMin - 0.01 && a <= innerMax + 0.01)) {
      return packed;
    }
  }
  return [];
}

/** Map a position packed in concatenated usable span back through geometric center bands. */
function mapAlongThroughSeatBands(
  relAlong: number,
  bands: { min: number; max: number }[],
): number | null {
  let remaining = relAlong;
  for (const band of bands) {
    const width = band.max - band.min;
    if (remaining <= width + 0.01) {
      return band.min + remaining;
    }
    remaining -= width;
  }
  return null;
}

/**
 * Indexed column aisles + geometric center column aisles together.
 * Center walkways stay on the block midpoints; column N is still a physical slot.
 */
function alongPositionsWithColumnAislesAndCenter(
  innerMin: number,
  innerMax: number,
  pitchPx: number,
  aisleColSet: Set<number>,
  aisleWidthPx: number,
  centerWidthsPx: number[],
  seatsCap?: number,
): number[] {
  const bands = buildEvenCenterAisleBands(innerMin, innerMax, centerWidthsPx);
  if (!bands || bands.length < 2) {
    return alongPositionsWithColumnAisles(
      innerMin,
      innerMax,
      pitchPx,
      aisleColSet,
      aisleWidthPx,
      seatsCap,
    );
  }
  const usableSpan = bands.reduce((sum, band) => sum + (band.max - band.min), 0);
  if (usableSpan <= 0) {
    return [];
  }
  const packed = alongPositionsWithColumnAisles(
    0,
    usableSpan,
    pitchPx,
    aisleColSet,
    aisleWidthPx,
    seatsCap,
  );
  const mapped: number[] = [];
  for (const rel of packed) {
    const abs = mapAlongThroughSeatBands(rel, bands);
    if (abs == null) {
      return [];
    }
    mapped.push(abs);
  }
  return mapped;
}

function placeRowWithColumnAisles(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  pitchPx: number,
  aisleColSet: Set<number>,
  aisleWidthPx: number,
  seatsCap?: number,
  centerWidthsPx?: number[],
): CanvasPoint[] {
  const bounds = findRowFillBoundsAtDepth(polygon, frame, depthPx, pitchPx);
  if (!bounds) {
    return [];
  }
  const alongs = alongPositionsWithColumnAisles(
    bounds.innerMin,
    bounds.innerMax,
    pitchPx,
    aisleColSet,
    aisleWidthPx,
    seatsCap,
    centerWidthsPx,
  );
  const positions: CanvasPoint[] = [];
  for (const along of alongs) {
    const point = pointOnFrame(frame, along, depthPx);
    if (pointInPolygon(point, polygon)) {
      positions.push(point);
    }
  }
  return positions;
}

/**
 * Walk depth with metre-based aisle gaps. Seat rows use rowGapPx; aisle slots use aisleWidthPx
 * so remaining depth is what seats pack into (5m − 2m aisle → 3m of seat rows).
 * Optional geometric center row aisles combine with indexed row letters.
 */
function collectSeatRowDepthsWithAisleGaps(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  firstDepth: number,
  rowGapPx: number,
  depthLimit: number,
  pitchPx: number,
  aisleRowSet: Set<number>,
  aisleWidthPx: number,
  maxSeatRows: number,
  minSeatsPerRow: number,
  centerWidthsPx?: number[],
): number[] {
  const centers = (centerWidthsPx ?? []).filter((w) => Number.isFinite(w) && w > 0);
  if (centers.length > 0 && aisleRowSet.size > 0) {
    return collectSeatRowDepthsWithIndexedAndCenterAisles(
      polygon,
      frame,
      firstDepth,
      rowGapPx,
      depthLimit,
      pitchPx,
      aisleRowSet,
      aisleWidthPx,
      centers,
      maxSeatRows,
      minSeatsPerRow,
    );
  }
  if (centers.length > 0) {
    return collectSeatRowDepthsWithGeometricCenterAisle(
      polygon,
      frame,
      firstDepth,
      rowGapPx,
      depthLimit,
      pitchPx,
      centers,
      maxSeatRows,
      minSeatsPerRow,
    );
  }

  const depths: number[] = [];
  let depth = firstDepth;
  let physicalIndex = 0;
  const guardLimit = maxSeatRows + aisleRowSet.size + 64;
  while (
    depth <= depthLimit + 0.5 &&
    depths.length < maxSeatRows &&
    physicalIndex < guardLimit
  ) {
    if (aisleRowSet.has(physicalIndex)) {
      depth += aisleWidthPx;
      physicalIndex += 1;
      continue;
    }
    const count = seatsAtRowDepth(polygon, frame, depth, pitchPx);
    if (count >= minSeatsPerRow) {
      depths.push(depth);
      depth += rowGapPx;
      physicalIndex += 1;
    } else if (depths.length === 0) {
      // Hunt for the first viable depth without consuming an aisle letter slot.
      depth += Math.max(1, rowGapPx * 0.25);
    } else {
      // Skip a singleton leftover pocket; keep looking for the next real row.
      depth += rowGapPx;
    }
  }
  return depths;
}

/** Indexed row letters + geometric center row aisles in one depth walk. */
function collectSeatRowDepthsWithIndexedAndCenterAisles(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  firstDepth: number,
  rowGapPx: number,
  depthLimit: number,
  pitchPx: number,
  aisleRowSet: Set<number>,
  aisleWidthPx: number,
  centerWidthsPx: number[],
  maxSeatRows: number,
  minSeatsPerRow: number,
): number[] {
  const bands = buildEvenCenterAisleBands(firstDepth, depthLimit, centerWidthsPx);
  if (!bands || bands.length < 2) {
    return collectSeatRowDepthsWithAisleGaps(
      polygon,
      frame,
      firstDepth,
      rowGapPx,
      depthLimit,
      pitchPx,
      aisleRowSet,
      aisleWidthPx,
      maxSeatRows,
      minSeatsPerRow,
    );
  }

  const depths: number[] = [];
  let bandIdx = 0;
  let depth = Math.max(bands[0].min, firstDepth);
  let physicalIndex = 0;
  const guardLimit = maxSeatRows + aisleRowSet.size + 64;
  let guard = 0;
  while (depths.length < maxSeatRows && bandIdx < bands.length && guard < guardLimit) {
    guard += 1;
    const band = bands[bandIdx];
    if (depth > band.max + 0.5) {
      bandIdx += 1;
      if (bandIdx >= bands.length) {
        break;
      }
      depth = bands[bandIdx].min;
      continue;
    }
    if (aisleRowSet.has(physicalIndex)) {
      depth += aisleWidthPx;
      physicalIndex += 1;
      continue;
    }
    if (
      depth >= band.min - 0.01 &&
      depth <= band.max + 0.01 &&
      seatsAtRowDepth(polygon, frame, depth, pitchPx) >= minSeatsPerRow
    ) {
      depths.push(depth);
      depth += rowGapPx;
      physicalIndex += 1;
    } else if (depths.length === 0 && bandIdx === 0) {
      depth += Math.max(1, rowGapPx * 0.25);
    } else {
      bandIdx += 1;
      if (bandIdx >= bands.length) {
        break;
      }
      depth = bands[bandIdx].min;
    }
  }
  return depths;
}

/**
 * Evenly place N center aisles along [start, end]: aisle i at (i+1)/(N+1) of the span.
 * Returns N+1 seat bands between those walkways.
 */
function buildEvenCenterAisleBands(
  start: number,
  end: number,
  aisleWidthsPx: number[],
): { min: number; max: number }[] | null {
  const n = aisleWidthsPx.length;
  const span = end - start;
  if (n < 1 || span <= 0) {
    return null;
  }
  const totalAisle = aisleWidthsPx.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (totalAisle >= span) {
    return null;
  }

  const bands: { min: number; max: number }[] = [];
  let cursor = start;
  for (let i = 0; i < n; i += 1) {
    const mid = start + ((i + 1) * span) / (n + 1);
    const half = Math.max(0, aisleWidthsPx[i]) / 2;
    const aisleStart = mid - half;
    const aisleEnd = mid + half;
    if (aisleStart <= cursor + 0.01 || aisleEnd >= end - 0.01) {
      return null;
    }
    bands.push({ min: cursor, max: aisleStart });
    cursor = aisleEnd;
  }
  bands.push({ min: cursor, max: end });
  return bands.every((b) => b.max > b.min + 0.01) ? bands : null;
}

/**
 * Pack seats into bands split by N center aisles. Each leftover span is filled
 * independently so an irregular / unshaped block uses its real width at this
 * row instead of being limited to the narrower side (which looks triangular).
 */
function alongPositionsWithGeometricCenterAisles(
  innerMin: number,
  innerMax: number,
  pitchPx: number,
  aisleWidthsPx: number[],
  seatsCap?: number,
): number[] {
  if (pitchPx <= 0 || aisleWidthsPx.length < 1) {
    return [];
  }
  const bands = buildEvenCenterAisleBands(innerMin, innerMax, aisleWidthsPx);
  if (!bands || bands.length < 2) {
    return [];
  }

  const packed: number[] = [];
  let remaining =
    seatsCap != null && seatsCap > 0 ? seatsCap : Number.POSITIVE_INFINITY;
  for (const band of bands) {
    if (remaining <= 0) {
      break;
    }
    let n = maxSeatsForSpanFill(band.min, band.max, pitchPx);
    if (Number.isFinite(remaining)) {
      n = Math.min(n, remaining);
    }
    if (n < 1) {
      continue;
    }
    packed.push(...evenCappedAlongPositions(band.min, band.max, pitchPx, n));
    remaining -= n;
  }
  return packed;
}

function placeRowWithGeometricCenterAisle(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  depthPx: number,
  pitchPx: number,
  aisleWidthsPx: number[],
  seatsCap?: number,
): CanvasPoint[] {
  const bounds = findRowFillBoundsAtDepth(polygon, frame, depthPx, pitchPx);
  if (!bounds) {
    return [];
  }
  const alongs = alongPositionsWithGeometricCenterAisles(
    bounds.innerMin,
    bounds.innerMax,
    pitchPx,
    aisleWidthsPx,
    seatsCap,
  );
  const positions: CanvasPoint[] = [];
  for (const along of alongs) {
    const point = pointOnFrame(frame, along, depthPx);
    if (pointInPolygon(point, polygon)) {
      positions.push(point);
    }
  }
  return positions;
}

/**
 * Seat-row depths with N walkway bands evenly dividing [firstDepth, maxDepth].
 * Equal row counts in each seat zone between center aisles.
 */
function collectSeatRowDepthsWithGeometricCenterAisle(
  polygon: CanvasPoint[],
  frame: EdgeFrame,
  firstDepth: number,
  rowGapPx: number,
  maxDepth: number,
  pitchPx: number,
  aisleWidthsPx: number[],
  maxSeatRows: number,
  minSeatsPerRow: number,
): number[] {
  if (aisleWidthsPx.length < 1 || maxDepth <= firstDepth || rowGapPx <= 0) {
    return [];
  }
  const bands = buildEvenCenterAisleBands(firstDepth, maxDepth, aisleWidthsPx);
  if (!bands || bands.length < 2) {
    return [];
  }

  const bandDepths: number[][] = bands.map(() => []);
  for (let b = 0; b < bands.length; b += 1) {
    const { min, max } = bands[b];
    let depth = min;
    // Snap first depth into the band if needed.
    if (b === 0) {
      depth = Math.max(min, firstDepth);
    }
    while (depth <= max + 0.5 && bandDepths[b].length < maxSeatRows) {
      if (
        depth >= min - 0.01 &&
        depth <= max + 0.01 &&
        seatsAtRowDepth(polygon, frame, depth, pitchPx) >= minSeatsPerRow
      ) {
        bandDepths[b].push(depth);
      }
      depth += rowGapPx;
    }
  }

  const each = Math.min(...bandDepths.map((d) => d.length));
  if (each < 1) {
    return [];
  }
  return bandDepths.flatMap((depths) => depths.slice(0, each));
}

/** Place rows facing the stadium / viewpoint side; each row auto-fills its shape width. */
export function createArrangeByRowGridSeating(
  element: CenterpieceElement,
  rect: PixelRect,
  sideLengthsM: number[],
  sideNames: string[],
  dims: PhysicalDimsInput,
  stadiumSideIndex: number,
  rowCount: number,
  seatsPerRowCap?: number,
  viewpointAngleDeg?: number | null,
  blueprintScale?: ArrangeByRowBlueprintScale,
  aislePlacement?: ArrangeByRowAislePlacement,
  placementOptions?: ArrangeByRowPlacementOptions,
): { patch: Partial<CenterpieceElement> } | { error: string } {
  const rows = Math.max(1, Math.round(rowCount));
  const seatsCap =
    seatsPerRowCap != null && seatsPerRowCap > 0 ? Math.round(seatsPerRowCap) : undefined;
  const polygon = getOutlineCanvasPoints(element, rect);
  if (polygon.length < 3 || sideLengthsM.length < 3) {
    return { error: 'Configure all block sides before placing seats.' };
  }

  const ppm =
    blueprintScale && blueprintScale.stadiumEdgeLengthM > 0
      ? blueprintScale.stadiumEdgeLengthPx / blueprintScale.stadiumEdgeLengthM
      : computePxPerMetre(polygon, sideLengthsM);
  const borderGapPx = Math.max(0, (dims.borderGapM ?? 0) * ppm);

  return withPlacementBorderGapPx(borderGapPx, () => {
    const cap = blueprintScale
      ? estimateCapacityFromBlueprintMeters(blueprintScale, dims)
      : estimateArrangeByRowCapacity(
          element,
          rect,
          sideLengthsM,
          dims,
          stadiumSideIndex,
          viewpointAngleDeg,
        );
    if (rows > cap.maxRows) {
      const seatGapM = resolveSeatGapMFromDims(dims);
      const rowGapM = resolveRowGapMFromDims(dims);
      return {
        error: `Too many rows. Maximum ${cap.maxRows} rows (${cap.maxCapacity} seats total when each row fills the shape). Reduce rows or decrease chair size (${dims.chairWidthM}m × ${dims.chairLengthM}m), seat gap (${seatGapM}m), or row gap (${rowGapM}m).`,
      };
    }

    const blockDims = deriveBlockDimsFromSides(polygon, sideLengthsM);
    const safeSideIndex = Math.max(0, Math.min(polygon.length - 1, stadiumSideIndex));
    const angle = viewpointAngleDeg ?? element.blockViewpointAngleDeg ?? null;
    const stadiumEdge =
      (angle != null && Number.isFinite(angle)
        ? stadiumLogicalEdgeFromView(polygon, rect.cx, rect.cy, angle)
        : null) ?? findLogicalEdgeContainingSource(polygon, safeSideIndex);
    const storedSideIndex = stadiumEdge?.index ?? safeSideIndex;
    // Match the green VIEW POINT edge on the block — rows parallel to that side.
    const facingSides =
      angle != null && Number.isFinite(angle)
        ? resolveViewpointLogicalEdges(polygon, rect.cx, rect.cy, angle)
        : [];
    const storedFronts = uniqueLogicalEdgesById(
      (element.dragSeatsStadiumSideIndices ?? [])
        .map((index) => findLogicalEdgeContainingSource(polygon, index))
        .filter((edge): edge is NonNullable<typeof edge> => edge != null)
        .filter((edge) => facingSides.some((front) => front.id === edge.id)),
    );
    const storedDualIndices =
      storedFronts.length > 1
        ? storedFronts.map((edge) => edge.index)
        : facingSides.length > 1
          ? uniqueLogicalEdgesById(facingSides).map((edge) => edge.index)
          : undefined;
    const frame = buildStadiumEdgeFrame(polygon, rect, storedSideIndex, angle);
    const requestedStartSide = placementOptions?.seatStartSide;
    const frameOrderSide = seatStartSideFromFrameOrder(frame);
    const shouldReverseRow = (rowPositions: CanvasPoint[]): boolean => {
      if (requestedStartSide == null || rowPositions.length < 2) {
        return false;
      }
      const increasing =
        projectAlong(frame, rowPositions[rowPositions.length - 1]) >=
        projectAlong(frame, rowPositions[0]);
      const currentSide: SeatStartSide = increasing
        ? frameOrderSide
        : frameOrderSide === 'left'
          ? 'right'
          : 'left';
      return currentSide !== requestedStartSide;
    };
    const resolvedAlign =
      placementOptions?.seatAlign ??
      resolveRowSeatAlignFromAdjacent(
        polygon,
        frame,
        placementOptions?.adjacentBlocks ?? [],
      );
    const previousAlign = activeRowSeatAlign;
    activeRowSeatAlign = resolvedAlign;
    try {
    const seatGapM = resolveSeatGapMFromDims(dims);
    const rowGapM = resolveRowGapMFromDims(dims);
    const pitchPx = Math.max(
      blueprintScale?.minSeatPitchPx ?? 6,
      (dims.chairWidthM + seatGapM) * ppm,
    );
    const rowGapPx = Math.max(
      blueprintScale?.minRowSpacingPx ?? 8,
      (dims.chairLengthM + rowGapM) * ppm,
    );
    const exactPitch = blueprintScale?.exactPitchPlacement === true;
    const firstDepth = resolveShapeSeatFirstRowDepthPx(rowGapPx, frame.edgeLength);
    const maxDepth = estimateMaxArrangeByRowDepthPx(polygon, frame, rowGapPx, frame.edgeLength);
    const style: SeatLabelStyle = 'letter';

    const rowSeatCounts: number[] = [];
    const overrides: Record<string, CustomShapeSeatPosition> = {};

    // Import mode: a "row" hugging a slanted corner that only holds a couple of
    // seats is not a real row — skip such depths so the first row starts where
    // most of the requested seats genuinely fit. The bar is half the request,
    // but never more than half of what the block's edge can hold at all —
    // otherwise an over-asked column count would reject every row outright.
    const maxAcrossEdge = Math.max(1, Math.floor(frame.edgeLength / Math.max(1, pitchPx)));
    const minSeatsPerRow =
      exactPitch && seatsCap != null && seatsCap > 0
        ? Math.max(
            resolveMinSeatsPerRow(seatsCap),
            Math.min(Math.ceil(seatsCap * 0.5), Math.ceil(maxAcrossEdge * 0.5)),
          )
        : resolveMinSeatsPerRow(seatsCap);

    const aisleRowSet = new Set(
      (aislePlacement?.aisleRowIndices ?? []).filter((i) => Number.isInteger(i) && i >= 0),
    );
    const aisleColSet = new Set(
      (aislePlacement?.aisleColumnIndices ?? []).filter((i) => Number.isInteger(i) && i >= 0),
    );
    const fallbackWidthM =
      aislePlacement?.aisleWidthM != null && Number.isFinite(aislePlacement.aisleWidthM)
        ? Math.max(0, aislePlacement.aisleWidthM)
        : 0;
    const wantsCenterAisle = aislePlacement?.centerAisle === true;
    // Per-direction px/m so row and column aisles scale correctly on
    // non-square blocks where ppmX ≠ ppmY.
    const { ppmAlong, ppmDepth } = computeDirectionalPxPerMetre(polygon, sideLengthsM, frame);
    const resolveDepthWidthPx = (specific?: number): number => {
      const metres =
        specific != null && Number.isFinite(specific) && specific > 0
          ? specific
          : fallbackWidthM > 0
            ? fallbackWidthM
            : 0;
      if (metres > 0) {
        return metres * ppmDepth;
      }
      return aisleRowSet.size > 0 || wantsCenterAisle ? rowGapPx : pitchPx;
    };
    const resolveAlongWidthPx = (specific?: number): number => {
      const metres =
        specific != null && Number.isFinite(specific) && specific > 0
          ? specific
          : fallbackWidthM > 0
            ? fallbackWidthM
            : 0;
      if (metres > 0) {
        return metres * ppmAlong;
      }
      return aisleRowSet.size > 0 || wantsCenterAisle ? rowGapPx : pitchPx;
    };
    const rowAisleWidthPx = resolveDepthWidthPx(aislePlacement?.rowAisleWidthM);
    const columnAisleWidthPx = resolveAlongWidthPx(aislePlacement?.columnAisleWidthM);
    const toDepthWidthsPx = (metresList: number[] | undefined): number[] =>
      (metresList ?? []).map((w) => resolveDepthWidthPx(w));
    const toAlongWidthsPx = (metresList: number[] | undefined): number[] =>
      (metresList ?? []).map((w) => resolveAlongWidthPx(w));

    // User-ticked center axis (row / column). Multiple on same axis evenly divide that side.
    // Center column aisles divide the along (seat) direction → use ppmAlong.
    // Center row aisles divide the depth (row) direction → use ppmDepth.
    let centerColumnWidthsPx = toAlongWidthsPx(aislePlacement?.centerColumnAisleWidthsM);
    let centerRowWidthsPx = toDepthWidthsPx(aislePlacement?.centerRowAisleWidthsM);
    // Legacy single center list → treat as column (across) when axis was not stored.
    if (
      centerColumnWidthsPx.length === 0 &&
      centerRowWidthsPx.length === 0 &&
      wantsCenterAisle
    ) {
      const legacy = aislePlacement?.centerAisleWidthsM ?? [];
      if (legacy.length > 0) {
        centerColumnWidthsPx = toAlongWidthsPx(legacy);
      } else if (aislePlacement?.centerAisleWidthM != null) {
        const count = Math.max(1, Math.round(aislePlacement.centerAisleCount ?? 1));
        centerColumnWidthsPx = Array.from({ length: count }, () =>
          resolveAlongWidthPx(aislePlacement.centerAisleWidthM),
        );
      }
    }

    const useCenterColumn = centerColumnWidthsPx.length > 0;
    const useCenterRow = centerRowWidthsPx.length > 0;
    const drawnBands = [
      ...drawnAisleSlotsToBands(aislePlacement?.drawnAisles ?? [], rect, ppm),
      ...centerColumnAislesViewpointToOpposite(
        polygon,
        frame,
        centerColumnWidthsPx,
        rect.cx,
        rect.cy,
        angle,
        storedDualIndices,
      ),
      ...centerRowAislesToStraightBands(polygon, frame, centerRowWidthsPx),
    ];
    const hasDrawnAisle = drawnBands.length > 0;
    const drawnSeatRadius = Math.max(2.8, pitchPx * 0.42);

    if (useCenterColumn) {
      const acrossPx =
        blockDims.physicalWidthM > 0 ? blockDims.physicalWidthM * ppmAlong : frame.edgeLength;
      const total = centerColumnWidthsPx.reduce((sum, w) => sum + w, 0);
      if (total >= acrossPx) {
        return {
          error:
            'Center column aisle width is too wide for this block. Reduce aisle width or aisle count.',
        };
      }
    }
    if (useCenterRow) {
      const depthBudgetPx = Math.max(
        0,
        blockDims.physicalLengthM > 0
          ? blockDims.physicalLengthM * ppmDepth
          : maxDepth - firstDepth,
      );
      const total = centerRowWidthsPx.reduce((sum, w) => sum + w, 0);
      if (total >= depthBudgetPx) {
        return {
          error:
            'Center row aisle width is too wide for this block. Reduce aisle width or aisle count.',
        };
      }
    }

    const collectedRowDepths =
      aisleRowSet.size > 0
        ? collectSeatRowDepthsWithAisleGaps(
            polygon,
            frame,
            firstDepth,
            rowGapPx,
            maxDepth,
            pitchPx,
            aisleRowSet,
            rowAisleWidthPx,
            rows,
            minSeatsPerRow,
            centerRowWidthsPx,
          )
        : collectViableRowDepths(
            polygon,
            frame,
            firstDepth,
            rowGapPx,
            maxDepth,
            pitchPx,
            rows,
            minSeatsPerRow,
            drawnBands,
          );
    const rowDepths = hasDrawnAisle
      ? collectedRowDepths.filter(
          (depth) =>
            seatsAtRowDepth(polygon, frame, depth, pitchPx, seatsCap, drawnBands) >= minSeatsPerRow,
        )
      : collectedRowDepths;

    if (aisleRowSet.size === 0 && !useCenterRow && !useCenterColumn && !hasDrawnAisle && rowDepths.length < rows) {
      return {
        error: `Only ${rowDepths.length} row${rowDepths.length === 1 ? '' : 's'} fit inside this shape. Reduce rows or decrease chair size (${dims.chairWidthM}m × ${dims.chairLengthM}m), seat gap (${seatGapM}m), or row gap (${rowGapM}m).`,
      };
    }
    if (rowDepths.length === 0) {
      return {
        error:
          aisleRowSet.size > 0 || useCenterRow || useCenterColumn || hasDrawnAisle
            ? 'Aisle width left no room for seats. Reduce aisle width or chair/row spacing.'
            : `Only 0 rows fit inside this shape. Reduce chair size (${dims.chairWidthM}m × ${dims.chairLengthM}m), seat gap (${seatGapM}m), or row gap (${rowGapM}m).`,
      };
    }

    let placedRowIndex = 0;
    for (let seatRowIndex = 0; seatRowIndex < rowDepths.length; seatRowIndex += 1) {
      const depth = rowDepths[seatRowIndex];
      const rawPositions =
        aisleColSet.size > 0
          ? placeRowWithColumnAisles(
              polygon,
              frame,
              depth,
              pitchPx,
              aisleColSet,
              columnAisleWidthPx,
              seatsCap,
            )
          : hasDrawnAisle || !exactPitch
            ? placeRowShapeFillAllSegments(
                polygon,
                frame,
                depth,
                pitchPx,
                seatsCap,
                exactPitch,
                drawnBands,
              )
            : placeRowShapeFill(polygon, frame, depth, pitchPx, seatsCap, exactPitch);
      const positions =
        hasDrawnAisle && aisleColSet.size > 0
          ? rawPositions.filter((point) => !pointHitsDrawnAisle(point, drawnBands, drawnSeatRadius))
          : rawPositions;
      if (positions.length < minSeatsPerRow) {
        continue;
      }

      // Seat 1 goes on the side the user asked for (spectator's view); the
      // placement itself is unchanged, only the numbering direction flips.
      const numbered = shouldReverseRow(positions) ? [...positions].reverse() : positions;
      for (let seatIndex = 0; seatIndex < numbered.length; seatIndex += 1) {
        overrides[seatId(placedRowIndex, seatIndex, style)] = canvasPointToElementPct(
          numbered[seatIndex],
          rect,
        );
      }
      rowSeatCounts.push(positions.length);
      placedRowIndex += 1;
    }

    if (rowSeatCounts.length === 0) {
      return {
        error: hasDrawnAisle
          ? 'Aisle width left no room for seats. Reduce aisle width or redraw the aisle.'
          : `Only 0 rows fit inside this shape. Reduce chair size (${dims.chairWidthM}m × ${dims.chairLengthM}m), seat gap (${seatGapM}m), or row gap (${rowGapM}m).`,
      };
    }

    const maxPlacedSeats = Math.max(...rowSeatCounts);
    const seatLayout = capSeatLayoutToCapacity(
      {
        rows: rowSeatCounts.length,
        seatsPerRow: maxPlacedSeats,
        rowSeatCounts,
        customShapeSeatPitchPx: pitchPx,
        seatAlign: resolvedAlign,
        rowLabelStyle: style,
      },
      rowSeatCounts.length,
      maxPlacedSeats,
    );

    const storedViewpointAngle =
      viewpointAngleDeg ?? element.blockViewpointAngleDeg ?? null;

    return {
      patch: {
        ...dims,
        ...blockDims,
        customSideLengthsM: sideLengthsM,
        customSideNames: sideNames,
        dragSeatsStadiumSideIndex: storedSideIndex,
        dragSeatsStadiumSideIndices: storedDualIndices,
        arrangeByRowMode: true,
        arrangeByRowRows: [],
        dragSeatsMode: undefined,
        dragSeatsFirstRowSeatCount: undefined,
        perSeatPlacementMode: undefined,
        defineByRowColumnMode: undefined,
        defineByRowColumnRows: undefined,
        defineByRowColumnColumns: undefined,
        code: element.code?.trim() || element.name?.trim() || 'CUSTOM',
        rows: seatLayout.rows,
        seatsPerRow: seatLayout.seatsPerRow,
        rowLabelStyle: style,
        seatLayout,
        seatPositionOverrides: overrides,
        seatFacingDeg: seatFacingDegFromRowFrame(frame),
        blockViewpointAngleDeg: storedViewpointAngle ?? undefined,
        customSeatBlocks: undefined,
        seatGapM: resolveSeatGapMFromDims(dims),
        rowGapM: resolveRowGapMFromDims(dims),
        borderGapM: dims.borderGapM,
      },
    };
    } finally {
      activeRowSeatAlign = previousAlign;
    }
  });
}

export interface DragSeatsClipPlacement {
  rowSeatCounts: number[];
  positionsByRow: CanvasPoint[][];
  pitchPx: number;
  rowGapPx: number;
  seatFacingDeg: number;
}

export function resolvePpmForShapePlacement(
  polygon: CanvasPoint[],
  sideLengthsM: number[],
  rect: PixelRect,
  dims: PhysicalDimsInput,
): number {
  if (polygon.length >= 3 && sideLengthsM.length >= 3) {
    return computePxPerMetre(polygon, sideLengthsM);
  }
  return pxPerMeter(rect, dims.physicalLengthM, dims.physicalWidthM);
}

/** Drag-seats row grid clipped to a drawn zone (manual seat area). */
export function placeDragSeatsGridInClipZone(
  element: CenterpieceElement,
  rect: PixelRect,
  mainPolygon: CanvasPoint[],
  clipPolygon: CanvasPoint[],
  dims: PhysicalDimsInput,
): DragSeatsClipPlacement {
  const sideLengthsM = element.customSideLengthsM ?? [];
  const sideIndex = resolveStadiumSideIndex(element, mainPolygon);
  const frame = buildStadiumEdgeFrame(
    mainPolygon,
    rect,
    sideIndex,
    element.blockViewpointAngleDeg ?? null,
  );
  const ppm = resolvePpmForShapePlacement(mainPolygon, sideLengthsM, rect, dims);
  const seatGapM = resolveSeatGapMFromDims(dims);
  const rowGapM = resolveRowGapMFromDims(dims);
  const pitchPx = Math.max(6, (dims.chairWidthM + seatGapM) * ppm);
  const rowGapPx = Math.max(8, (dims.chairLengthM + rowGapM) * ppm);
  const firstDepth = resolveShapeSeatFirstRowDepthPx(rowGapPx, frame.edgeLength);
  const maxDepth = estimateMaxArrangeByRowDepthPx(
    mainPolygon,
    frame,
    rowGapPx,
    frame.edgeLength,
  );
  const rowDepths = collectViableRowDepths(
    mainPolygon,
    frame,
    firstDepth,
    rowGapPx,
    maxDepth,
    pitchPx,
  );

  const rowSeatCounts: number[] = [];
  const positionsByRow: CanvasPoint[][] = [];

  for (const depth of rowDepths) {
    const rowPositions = placeRowShapeFillAllSegments(mainPolygon, frame, depth, pitchPx).filter(
      (point) => pointInPolygon(point, clipPolygon) && pointInPolygon(point, mainPolygon),
    );
    if (rowPositions.length === 0) {
      if (rowSeatCounts.length === 0) {
        continue;
      }
      break;
    }
    rowSeatCounts.push(rowPositions.length);
    positionsByRow.push(rowPositions);
  }

  return {
    rowSeatCounts,
    positionsByRow,
    pitchPx,
    rowGapPx,
    seatFacingDeg: seatFacingDegFromRowFrame(frame),
  };
}

/** Chair rotation for shape seating using the confirmed stadium-view side. */
export function resolveSeatFacingDegForShapeSeats(
  element: CenterpieceElement,
  mainPolygon: CanvasPoint[],
  rect?: PixelRect,
): number {
  const sideIndex = resolveStadiumSideIndex(element, mainPolygon);
  if (rect) {
    const frame = buildStadiumEdgeFrame(
      mainPolygon,
      rect,
      sideIndex,
      element.blockViewpointAngleDeg ?? null,
    );
    return seatFacingDegFromRowFrame(frame);
  }
  const frame = buildDragSeatsRowFrame(mainPolygon, sideIndex);
  return seatFacingDegFromRowFrame(frame);
}

/** Polygon + edge frame for rows facing the block VIEW POINT. */
export function buildViewpointSeatFrame(
  element: CenterpieceElement,
  rect: PixelRect,
): { polygon: CanvasPoint[]; frame: ViewpointSeatFrame } | null {
  const polygon = getOutlineCanvasPoints(element, rect);
  if (polygon.length < 3) {
    return null;
  }
  const sideIndex = resolveStadiumSideIndex(element, polygon);
  const frame = buildStadiumEdgeFrame(
    polygon,
    rect,
    sideIndex,
    element.blockViewpointAngleDeg ?? null,
  );
  return { polygon, frame };
}

export function viewpointFirstRowDepthPx(pitchPx: number, rowGapPx = pitchPx): number {
  return resolveShapeSeatFirstRowDepthPx(rowGapPx, rowGapPx);
}

export function projectOnViewpointFrame(
  frame: ViewpointSeatFrame,
  point: CanvasPoint,
): { along: number; depth: number } {
  return { along: projectAlong(frame, point), depth: projectDepth(frame, point) };
}

export function viewpointPointOnFrame(
  frame: ViewpointSeatFrame,
  along: number,
  depth: number,
): CanvasPoint {
  return pointOnFrame(frame, along, depth);
}

export function clampAlongOnViewpointRow(
  polygon: CanvasPoint[],
  frame: ViewpointSeatFrame,
  depthPx: number,
  pitchPx: number,
  along: number,
): number {
  const chord = getChordAtDepth(polygon, frame, depthPx, pitchPx);
  if (!chord) {
    return along;
  }
  const bounds = chordInnerBounds(chord, pitchPx);
  if (!bounds) {
    return along;
  }
  return Math.max(bounds.innerMin, Math.min(bounds.innerMax, along));
}

/** Fill a row along the VIEW POINT edge — whole seats packed from startAlong toward the drag. */
export function placeSeatsOnViewpointSpan(
  polygon: CanvasPoint[],
  frame: ViewpointSeatFrame,
  depthPx: number,
  pitchPx: number,
  startAlong: number,
  endAlong: number,
): CanvasPoint[] {
  if (pitchPx <= 0) {
    return [];
  }
  const chord = getChordAtDepth(polygon, frame, depthPx, pitchPx);
  if (!chord) {
    return [];
  }
  const bounds = chordInnerBounds(chord, pitchPx);
  if (!bounds) {
    return [];
  }
  const sign: 1 | -1 = endAlong >= startAlong ? 1 : -1;
  const dragSpan = Math.abs(endAlong - startAlong);
  const maxByDrag = 1 + Math.floor((dragSpan + 1e-6) / pitchPx);
  const padding = Math.max(2.8, pitchPx * 0.42);
  const placements: CanvasPoint[] = [];
  for (let index = 0; index < maxByDrag && index < 512; index += 1) {
    const along = startAlong + sign * index * pitchPx;
    if (along < bounds.innerMin - 0.01 || along > bounds.innerMax + 0.01) {
      break;
    }
    const point = pointOnFrame(frame, along, depthPx);
    if (!pointInPolygon(point, polygon)) {
      break;
    }
    if (!pointInsidePolygonWithPadding(point, polygon, padding)) {
      break;
    }
    placements.push(point);
  }
  return placements;
}

/** One full row at an inward depth — whole seats at chair pitch (no stretched/half seats). */
export function placeMaxSeatsAtViewpointDepth(
  polygon: CanvasPoint[],
  frame: ViewpointSeatFrame,
  depthPx: number,
  pitchPx: number,
  fixedPitch = false,
): CanvasPoint[] {
  return placeRowShapeFill(polygon, frame, depthPx, pitchPx, undefined, fixedPitch);
}

export function maxViewpointInwardDepth(
  polygon: CanvasPoint[],
  frame: ViewpointSeatFrame,
  pitchPx: number,
  firstDepth: number,
  rowGapPx: number,
): number {
  let maxVertexDepth = firstDepth;
  for (const vertex of polygon) {
    maxVertexDepth = Math.max(maxVertexDepth, projectDepth(frame, vertex));
  }
  let last = firstDepth;
  for (let depth = firstDepth; depth <= maxVertexDepth + 0.5; depth += rowGapPx) {
    if (maxSeatsAtDepth(polygon, frame, depth, pitchPx) > 0) {
      last = depth;
    }
  }
  return last;
}
