import { CanvasPoint2 } from './block-viewpoint';

export interface BlockMeasureEdge {
  /** Stable logical side id (0 … n−1) for selection UI. */
  id: number;
  /** First raw polygon edge index (legacy / storage). */
  index: number;
  /** Raw polygon edge indices merged into this measurable side. */
  sourceIndices: number[];
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  midX: number;
  midY: number;
  lengthPx: number;
  /** Display label e.g. "Side 1", "Side 2". */
  label: string;
}

function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    return Math.hypot(px - x1, py - y1);
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function isCollinearAtVertex(
  prev: CanvasPoint2,
  vertex: CanvasPoint2,
  next: CanvasPoint2,
  toleranceDeg: number,
): boolean {
  const ax = prev.x - vertex.x;
  const ay = prev.y - vertex.y;
  const bx = next.x - vertex.x;
  const by = next.y - vertex.y;
  const lenA = Math.hypot(ax, ay);
  const lenB = Math.hypot(bx, by);
  if (lenA < 1e-6 || lenB < 1e-6) {
    return true;
  }
  const cos = (ax * bx + ay * by) / (lenA * lenB);
  return cos <= -Math.cos((toleranceDeg * Math.PI) / 180);
}

interface RawEdgeChain {
  sourceIndices: number[];
  start: CanvasPoint2;
  end: CanvasPoint2;
  lengthPx: number;
}

function tryMergePair(
  a: RawEdgeChain,
  b: RawEdgeChain,
  minEdgePx: number,
  collinearDeg: number,
): RawEdgeChain | null {
  const sharedVertex = a.end;
  const tiny = a.lengthPx < minEdgePx || b.lengthPx < minEdgePx;
  const collinear = isCollinearAtVertex(a.start, sharedVertex, b.end, collinearDeg);
  if (!tiny && !collinear) {
    return null;
  }
  return {
    sourceIndices: [...a.sourceIndices, ...b.sourceIndices],
    start: a.start,
    end: b.end,
    lengthPx: Math.hypot(b.end.x - a.start.x, b.end.y - a.start.y),
  };
}

function mergeChainsOnce(
  chains: RawEdgeChain[],
  minEdgePx: number,
  collinearDeg: number,
): { chains: RawEdgeChain[]; merged: boolean } {
  for (let i = 0; i < chains.length; i += 1) {
    const j = (i + 1) % chains.length;
    const combined = tryMergePair(chains[i], chains[j], minEdgePx, collinearDeg);
    if (combined) {
      return {
        chains: [...chains.slice(0, i), combined, ...chains.slice(j + 1)],
        merged: true,
      };
    }
  }
  return { chains, merged: false };
}

/**
 * Build logical measurable sides — merges tiny segments and collinear splits
 * (common on traced blocks where one visual side becomes 2+ polygon edges).
 */
export function buildBlockMeasureEdges(
  polygon: CanvasPoint2[],
  minEdgePx = 8,
  collinearDeg = 12,
): BlockMeasureEdge[] {
  if (polygon.length < 3) {
    return [];
  }

  const n = polygon.length;
  let chains: RawEdgeChain[] = [];
  for (let index = 0; index < n; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % n];
    chains.push({
      sourceIndices: [index],
      start: a,
      end: b,
      lengthPx: Math.hypot(b.x - a.x, b.y - a.y),
    });
  }

  let merged = true;
  while (merged && chains.length > 1) {
    const step = mergeChainsOnce(chains, minEdgePx, collinearDeg);
    chains = step.chains;
    merged = step.merged;
  }

  return chains.map((chain, id) => ({
    id,
    index: chain.sourceIndices[0],
    sourceIndices: chain.sourceIndices,
    x1: chain.start.x,
    y1: chain.start.y,
    x2: chain.end.x,
    y2: chain.end.y,
    midX: (chain.start.x + chain.end.x) / 2,
    midY: (chain.start.y + chain.end.y) / 2,
    lengthPx: chain.lengthPx,
    label: `Side ${id + 1}`,
  }));
}

export function isLogicalEdgeMeasured(edge: BlockMeasureEdge, measured: boolean[]): boolean {
  return edge.sourceIndices.every((src) => measured[src]);
}

/** Hit-test; prefers unmeasured sides when multiple edges are near the click. */
export function hitTestBlockMeasureEdges(
  edges: Array<
    Pick<BlockMeasureEdge, 'id' | 'x1' | 'y1' | 'x2' | 'y2'> & { isMeasured?: boolean }
  >,
  x: number,
  y: number,
  tolerancePx: number,
): number | null {
  let bestId: number | null = null;
  let bestDist = tolerancePx;
  let bestPending = false;

  for (const edge of edges) {
    const dist = pointToSegmentDistance(x, y, edge.x1, edge.y1, edge.x2, edge.y2);
    if (dist > tolerancePx) {
      continue;
    }
    const pending = !edge.isMeasured;
    const better =
      bestId == null ||
      (pending && !bestPending) ||
      (pending === bestPending && dist < bestDist);
    if (better) {
      bestId = edge.id;
      bestDist = dist;
      bestPending = pending;
    }
  }
  return bestId;
}

export function countMeasuredLogicalEdges(
  polygon: CanvasPoint2[],
  measured: boolean[],
): number {
  return buildBlockMeasureEdges(polygon).filter((edge) =>
    isLogicalEdgeMeasured(edge, measured),
  ).length;
}

export function logicalMeasureEdgeById(
  polygon: CanvasPoint2[],
  logicalId: number,
): BlockMeasureEdge | null {
  const edges = buildBlockMeasureEdges(polygon);
  return edges.find((edge) => edge.id === logicalId) ?? null;
}

/** @deprecated Use logicalMeasureEdgeById */
export function logicalMeasureEdgeForIndex(
  polygon: CanvasPoint2[],
  primaryIndex: number,
): BlockMeasureEdge | null {
  return buildBlockMeasureEdges(polygon).find((edge) => edge.index === primaryIndex) ?? null;
}

export function findLogicalEdgeContainingSource(
  polygon: CanvasPoint2[],
  sourceIndex: number,
): BlockMeasureEdge | null {
  return (
    buildBlockMeasureEdges(polygon).find((edge) => edge.sourceIndices.includes(sourceIndex)) ?? null
  );
}

/** One entry per measured side — two source indices on the same side collapse. */
export function uniqueLogicalEdgesById(edges: BlockMeasureEdge[]): BlockMeasureEdge[] {
  const seen = new Set<number>();
  const unique: BlockMeasureEdge[] = [];
  for (const edge of edges) {
    if (seen.has(edge.id)) {
      continue;
    }
    seen.add(edge.id);
    unique.push(edge);
  }
  return unique;
}

export function sumStoredLengthsForEdge(
  edge: BlockMeasureEdge,
  lengths: number[],
): number {
  return edge.sourceIndices.reduce((sum, src) => sum + (lengths[src] ?? 0), 0);
}

export function storedNameForEdge(edge: BlockMeasureEdge, names: string[]): string {
  for (const src of edge.sourceIndices) {
    const name = names[src]?.trim();
    if (name) {
      return name;
    }
  }
  return edge.label;
}

function edgeOutwardNormal(
  edge: { x1: number; y1: number; x2: number; y2: number },
  cx: number,
  cy: number,
): { nx: number; ny: number } {
  const dx = edge.x2 - edge.x1;
  const dy = edge.y2 - edge.y1;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  const mx = (edge.x1 + edge.x2) / 2;
  const my = (edge.y1 + edge.y2) / 2;
  if ((mx - cx) * nx + (my - cy) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { nx, ny };
}

/**
 * A side is a front only when its outward normal is closer to the ground /
 * VIEW POINT direction than to a lateral (strictly less than 45°).
 * Back and side walls are never viewpoints.
 */
const FRONT_HALF_ANGLE_DEG = 45;
const FRONT_COS = Math.cos((FRONT_HALF_ANGLE_DEG * Math.PI) / 180);
/** Straight wall that clearly is the single front. */
const DOMINANT_FRONT_DOT = 0.9;
const DOMINANT_NEIGHBOR_RATIO = 0.85;
/** Split front (two walls toward the ground): neighbor may be less aligned. */
const SPLIT_NEIGHBOR_RATIO = 0.72;
/** Outward normals more than this apart are different-facing walls, not one front. */
const SAME_FRONT_NORMAL_COS = Math.cos((80 * Math.PI) / 180);

function isGroundFacingFront(dot: number): boolean {
  return dot >= FRONT_COS - 1e-6;
}

/** True when two sides are one continuous front, not two unrelated faces. */
function edgesFormContinuousFront(
  a: BlockMeasureEdge,
  b: BlockMeasureEdge,
  cx: number,
  cy: number,
  dirX: number,
  dirY: number,
): boolean {
  const vertex = sharedLogicalEdgeVertex(a, b);
  if (!vertex) {
    return false;
  }
  const na = edgeOutwardNormal(a, cx, cy);
  const nb = edgeOutwardNormal(b, cx, cy);
  const aDot = na.nx * dirX + na.ny * dirY;
  const bDot = nb.nx * dirX + nb.ny * dirY;
  // Laterals and any wall that does not face the ground are not fronts.
  if (!isGroundFacingFront(aDot) || !isGroundFacingFront(bDot)) {
    return false;
  }
  const agreement = na.nx * nb.nx + na.ny * nb.ny;
  // A left/right wall at a different angle than the front.
  if (agreement <= SAME_FRONT_NORMAL_COS) {
    return false;
  }
  const vertexProj = (vertex.x - cx) * dirX + (vertex.y - cy) * dirY;
  return vertexProj >= -1e-9;
}

/**
 * Logical sides at the front of the block that face `angleDeg` (the ground /
 * VIEW POINT / pitch / centerpiece direction). One side when the front is a
 * single wall; both adjacent sides when each faces the ground (house / bent
 * front). Left, right, and back are never included.
 */
export function stadiumLogicalEdgesFacingDirection(
  polygon: CanvasPoint2[],
  cx: number,
  cy: number,
  angleDeg: number,
): BlockMeasureEdge[] {
  const edges = buildBlockMeasureEdges(polygon);
  if (!edges.length) {
    return [];
  }
  const rad = (angleDeg * Math.PI) / 180;
  const dirX = Math.sin(rad);
  const dirY = -Math.cos(rad);
  const dots = edges.map((edge) => {
    const normal = edgeOutwardNormal(edge, cx, cy);
    return normal.nx * dirX + normal.ny * dirY;
  });
  const projs = edges.map(
    (edge) => (edge.midX - cx) * dirX + (edge.midY - cy) * dirY,
  );
  let bestIndex = 0;
  for (let i = 1; i < dots.length; i += 1) {
    if (dots[i] > dots[bestIndex]) {
      bestIndex = i;
    }
  }
  const bestDot = dots[bestIndex];
  if (bestDot <= 0) {
    return [];
  }
  const bestProj = Math.max(0, projs[bestIndex]);
  const dominantFront = bestDot > DOMINANT_FRONT_DOT;
  const neighborRatio = dominantFront ? DOMINANT_NEIGHBOR_RATIO : SPLIT_NEIGHBOR_RATIO;
  const n = edges.length;

  const isDualFront = (index: number): boolean => {
    if (index === bestIndex) {
      return false;
    }
    if (!isGroundFacingFront(dots[index])) {
      return false;
    }
    if (dots[index] < bestDot * neighborRatio - 1e-9) {
      return false;
    }
    if (projs[index] < bestProj * 0.2 - 1e-9) {
      return false;
    }
    return edgesFormContinuousFront(
      edges[bestIndex],
      edges[index],
      cx,
      cy,
      dirX,
      dirY,
    );
  };

  const fronts = [edges[bestIndex]];
  const prev = (bestIndex - 1 + n) % n;
  const next = (bestIndex + 1) % n;
  const neighborFronts = [prev, next].filter((index) => isDualFront(index));
  if (neighborFronts.length === 1) {
    fronts.push(edges[neighborFronts[0]]);
  } else if (neighborFronts.length === 2) {
    fronts.push(edges[prev], edges[next]);
  }
  return uniqueLogicalEdgesById(
    [...fronts]
      .sort((a, b) => (dots[edges.indexOf(b)] ?? 0) - (dots[edges.indexOf(a)] ?? 0))
      .sort((a, b) => a.id - b.id),
  );
}

function smallestAngleDiffDeg(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

function angleFromCenterDeg(cx: number, cy: number, x: number, y: number): number {
  return (Math.atan2(x - cx, cy - y) * 180) / Math.PI;
}

function edgesIncidentToVertex(
  edges: BlockMeasureEdge[],
  vertex: CanvasPoint2,
  epsPx = 3,
): BlockMeasureEdge[] {
  return edges.filter(
    (edge) =>
      Math.hypot(edge.x1 - vertex.x, edge.y1 - vertex.y) <= epsPx ||
      Math.hypot(edge.x2 - vertex.x, edge.y2 - vertex.y) <= epsPx,
  );
}

/** The single logical side whose midpoint most faces `angleDeg`. */
export function stadiumFacingLogicalEdgeFromView(
  polygon: CanvasPoint2[],
  cx: number,
  cy: number,
  angleDeg: number,
): BlockMeasureEdge | null {
  const edges = buildBlockMeasureEdges(polygon);
  if (!edges.length) {
    return null;
  }
  let bestEdge = edges[0];
  let bestEdgeDiff = Number.POSITIVE_INFINITY;
  let bestDot = Number.NEGATIVE_INFINITY;
  const rad = (angleDeg * Math.PI) / 180;
  const dirX = Math.sin(rad);
  const dirY = -Math.cos(rad);
  for (const edge of edges) {
    const diff = smallestAngleDiffDeg(
      angleDeg,
      angleFromCenterDeg(cx, cy, edge.midX, edge.midY),
    );
    const vx = edge.midX - cx;
    const vy = edge.midY - cy;
    const len = Math.hypot(vx, vy) || 1;
    const dot = (vx / len) * dirX + (vy / len) * dirY;
    if (diff < bestEdgeDiff - 1e-6 || (Math.abs(diff - bestEdgeDiff) <= 1e-6 && dot > bestDot)) {
      bestEdgeDiff = diff;
      bestDot = dot;
      bestEdge = edge;
    }
  }
  return bestEdge;
}

/**
 * Logical side(s) that face the VIEW POINT.
 * When the marker sits on a corner (the intersection of two sides), both
 * adjacent sides are returned so the viewpoint applies to each of them.
 */
export function stadiumLogicalEdgesFromView(
  polygon: CanvasPoint2[],
  cx: number,
  cy: number,
  angleDeg: number,
): BlockMeasureEdge[] {
  const edges = buildBlockMeasureEdges(polygon);
  if (!edges.length) {
    return [];
  }

  const bestEdge = stadiumFacingLogicalEdgeFromView(polygon, cx, cy, angleDeg);
  if (!bestEdge) {
    return [];
  }

  let bestVertex: CanvasPoint2 | null = null;
  let bestVertexDiff = Number.POSITIVE_INFINITY;
  for (const vertex of polygon) {
    const diff = smallestAngleDiffDeg(angleDeg, angleFromCenterDeg(cx, cy, vertex.x, vertex.y));
    if (diff < bestVertexDiff) {
      bestVertexDiff = diff;
      bestVertex = vertex;
    }
  }

  const bestEdgeDiff = smallestAngleDiffDeg(
    angleDeg,
    angleFromCenterDeg(cx, cy, bestEdge.midX, bestEdge.midY),
  );

  const cornerSlackDeg = 10;
  if (bestVertex && bestVertexDiff + cornerSlackDeg < bestEdgeDiff) {
    const incident = edgesIncidentToVertex(edges, bestVertex);
    const facingIds = new Set(
      stadiumLogicalEdgesFacingDirection(polygon, cx, cy, angleDeg).map((edge) => edge.id),
    );
    const fronts = incident.filter((edge) => facingIds.has(edge.id));
    if (fronts.length >= 2) {
      return [...fronts].sort((a, b) => a.id - b.id);
    }
  }
  return [bestEdge];
}

/**
 * Viewpoint side(s) for a marker or ground direction: only sides whose
 * outward faces point at the ground / pitch / centerpiece. Laterals and the
 * back are omitted. Two fronts are returned when both face the ground.
 */
export function resolveViewpointLogicalEdges(
  polygon: CanvasPoint2[],
  cx: number,
  cy: number,
  angleDeg: number,
): BlockMeasureEdge[] {
  return stadiumLogicalEdgesFacingDirection(polygon, cx, cy, angleDeg);
}

function logicalEdgesFromSideIndices(
  polygon: CanvasPoint2[],
  indices: number[] | undefined | null,
): BlockMeasureEdge[] {
  if (!indices?.length) {
    return [];
  }
  const seen = new Set<number>();
  const edges: BlockMeasureEdge[] = [];
  for (const index of indices) {
    const edge = findLogicalEdgeContainingSource(polygon, index);
    if (edge && !seen.has(edge.id)) {
      seen.add(edge.id);
      edges.push(edge);
    }
  }
  return edges;
}

/** Logical side that faces the VIEW POINT direction (the strongest front side). */
export function stadiumLogicalEdgeFromView(
  polygon: CanvasPoint2[],
  cx: number,
  cy: number,
  angleDeg: number,
): BlockMeasureEdge | null {
  return stadiumFacingLogicalEdgeFromView(polygon, cx, cy, angleDeg);
}

/** Shared vertex of two logical edges, or null if they do not meet. */
export function sharedLogicalEdgeVertex(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
  epsPx = 3,
): CanvasPoint2 | null {
  const ptsA = [
    { x: a.x1, y: a.y1 },
    { x: a.x2, y: a.y2 },
  ];
  const ptsB = [
    { x: b.x1, y: b.y1 },
    { x: b.x2, y: b.y2 },
  ];
  for (const pa of ptsA) {
    for (const pb of ptsB) {
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) <= epsPx) {
        return pa;
      }
    }
  }
  return null;
}

/**
 * Center-column aisle start for a VIEW POINT: the shared vertex when both
 * adjacent sides are marked, otherwise the midpoint of the single facing side.
 */
export function viewpointAisleStartPoint(
  polygon: CanvasPoint2[],
  cx: number,
  cy: number,
  angleDeg: number,
  viewpointSideIndices?: number[] | null,
): { point: CanvasPoint2; fromCorner: boolean } | null {
  const stored = uniqueLogicalEdgesById(
    logicalEdgesFromSideIndices(polygon, viewpointSideIndices),
  );
  const facing = uniqueLogicalEdgesById(
    resolveViewpointLogicalEdges(polygon, cx, cy, angleDeg),
  );
  const storedFronts = stored.filter((edge) => facing.some((front) => front.id === edge.id));
  const fromView =
    storedFronts.length >= 2 ? storedFronts : facing.length > 0 ? facing : stored;
  if (fromView.length >= 2) {
    const vertex = sharedLogicalEdgeVertex(fromView[0], fromView[1]);
    if (vertex) {
      return { point: { x: vertex.x, y: vertex.y }, fromCorner: true };
    }
  }
  const edge = fromView[0];
  if (!edge) {
    return null;
  }
  return { point: { x: edge.midX, y: edge.midY }, fromCorner: false };
}

/**
 * Straight front along a corner viewpoint: through the shared vertex, perpendicular
 * to the VIEW POINT direction, spanning both adjacent sides.
 */
export function cornerFrontSegmentFromView(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
  angleDeg: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const vertex = sharedLogicalEdgeVertex(a, b);
  if (!vertex) {
    return null;
  }
  const rad = (angleDeg * Math.PI) / 180;
  const dirX = Math.sin(rad);
  const dirY = -Math.cos(rad);
  const ux = dirY;
  const uy = -dirX;
  const ends = [
    { x: a.x1, y: a.y1 },
    { x: a.x2, y: a.y2 },
    { x: b.x1, y: b.y1 },
    { x: b.x2, y: b.y2 },
  ];
  let minS = 0;
  let maxS = 0;
  for (const point of ends) {
    if (Math.hypot(point.x - vertex.x, point.y - vertex.y) < 1) {
      continue;
    }
    const s = (point.x - vertex.x) * ux + (point.y - vertex.y) * uy;
    minS = Math.min(minS, s);
    maxS = Math.max(maxS, s);
  }
  if (maxS - minS < 4) {
    minS = -24;
    maxS = 24;
  }
  return {
    x1: vertex.x + ux * minS,
    y1: vertex.y + uy * minS,
    x2: vertex.x + ux * maxS,
    y2: vertex.y + uy * maxS,
  };
}
