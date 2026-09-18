import { stadiumLogicalEdgeFromView } from './block-measure-edges';

export interface CanvasPoint2 {
  x: number;
  y: number;
}

export { stadiumLogicalEdgeFromView };

/** Default angle places the viewpoint above the block when no playing field is available. */
export const DEFAULT_VIEWPOINT_ANGLE_DEG = 0;

/** Viewpoint position on a ring around the block centre (0° = above / north). */
export function viewpointPositionFromAngle(
  cx: number,
  cy: number,
  angleDeg: number,
  distance: number,
): CanvasPoint2 {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + Math.sin(rad) * distance,
    y: cy - Math.cos(rad) * distance,
  };
}

/** Angle in degrees (0 = above block, clockwise) from block centre to a canvas point. */
export function viewpointAngleFromCanvasPoint(
  cx: number,
  cy: number,
  x: number,
  y: number,
): number {
  const rad = Math.atan2(x - cx, cy - y);
  return (rad * 180) / Math.PI;
}

/** Minimum distance so the viewpoint sits outside the block outline. */
export function minViewpointDistance(
  polygon: CanvasPoint2[],
  cx: number,
  cy: number,
): number {
  let maxR = 0;
  for (const p of polygon) {
    maxR = Math.max(maxR, Math.hypot(p.x - cx, p.y - cy));
  }
  return maxR + 36;
}

/** Default distance — just outside the block, always visible when the block is fitted. */
export function defaultViewpointDistance(
  polygon: CanvasPoint2[],
  cx: number,
  cy: number,
): number {
  return minViewpointDistance(polygon, cx, cy) + 32;
}

/** Clamp a dragged viewpoint distance to stay outside the block but within reach. */
export function clampViewpointDistance(
  polygon: CanvasPoint2[],
  cx: number,
  cy: number,
  rawDistance: number,
): number {
  const minD = minViewpointDistance(polygon, cx, cy);
  const maxD = minD + Math.max(120, minD * 0.85);
  return Math.max(minD, Math.min(maxD, rawDistance));
}

/**
 * Edge index that faces the viewpoint direction — first seating row runs along this edge,
 * rows grow inward away from the VIEW POINT (like seats facing a stage).
 */
export function stadiumSideIndexFromViewDirection(
  polygon: CanvasPoint2[],
  cx: number,
  cy: number,
  angleDeg: number,
): number {
  return stadiumLogicalEdgeFromView(polygon, cx, cy, angleDeg)?.index ?? 0;
}

export function polygonCanvasPointsFromBlock(
  customPoints: { xPct: number; yPct: number }[],
  rect: { x: number; y: number; width: number; height: number },
): CanvasPoint2[] {
  return customPoints.map((p) => ({
    x: rect.x + (p.xPct / 100) * rect.width,
    y: rect.y + (p.yPct / 100) * rect.height,
  }));
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

/** Closest polygon edge index within tolerance (px), or null. */
export function hitTestPolygonEdgeIndex(
  polygon: CanvasPoint2[],
  x: number,
  y: number,
  tolerancePx: number,
): number | null {
  if (polygon.length < 3) {
    return null;
  }
  let bestIndex: number | null = null;
  let bestDist = tolerancePx;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const dist = pointToSegmentDistance(x, y, a.x, a.y, b.x, b.y);
    if (dist <= bestDist) {
      bestDist = dist;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export function edgeSegment(
  polygon: CanvasPoint2[],
  sideIndex: number,
): { x1: number; y1: number; x2: number; y2: number; midX: number; midY: number } | null {
  if (polygon.length < 3 || sideIndex < 0 || sideIndex >= polygon.length) {
    return null;
  }
  const a = polygon[sideIndex];
  const b = polygon[(sideIndex + 1) % polygon.length];
  return {
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    midX: (a.x + b.x) / 2,
    midY: (a.y + b.y) / 2,
  };
}

function polygonSignedArea(polygon: CanvasPoint2[]): number {
  let sum = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Push an edge segment outward using polygon winding (works on trapezoids / concave blocks). */
export function offsetEdgeSegmentOutward(
  polygon: CanvasPoint2[],
  seg: { x1: number; y1: number; x2: number; y2: number },
  offsetPx: number,
): { x1: number; y1: number; x2: number; y2: number; midX: number; midY: number } {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const edgeLen = Math.hypot(dx, dy) || 1;
  const ccw = polygonSignedArea(polygon) >= 0;
  let nx = ccw ? dy / edgeLen : -dy / edgeLen;
  let ny = ccw ? -dx / edgeLen : dx / edgeLen;
  const midX = (seg.x1 + seg.x2) / 2;
  const midY = (seg.y1 + seg.y2) / 2;
  return {
    x1: seg.x1 + nx * offsetPx,
    y1: seg.y1 + ny * offsetPx,
    x2: seg.x2 + nx * offsetPx,
    y2: seg.y2 + ny * offsetPx,
    midX: midX + nx * offsetPx,
    midY: midY + ny * offsetPx,
  };
}
