import type { AabbM, PointM } from './types.ts';

export function polygonAabb(polygon: PointM[]): AabbM {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export function aabbOverlap(a: AabbM, b: AabbM, eps = 1e-6): boolean {
  return a.minX < b.maxX - eps && a.maxX > b.minX + eps && a.minY < b.maxY - eps && a.maxY > b.minY + eps;
}

export function expandAabb(box: AabbM, pad: number): AabbM {
  return {
    minX: box.minX - pad,
    minY: box.minY - pad,
    maxX: box.maxX + pad,
    maxY: box.maxY + pad,
  };
}

export function pointInPolygon(point: PointM, polygon: PointM[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

export function distToSegment(p: PointM, a: PointM, b: PointM): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return Math.hypot(ex, ey);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function minDistToPolygonEdges(point: PointM, polygon: PointM[]): number {
  let min = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    min = Math.min(min, distToSegment(point, a, b));
  }
  return min;
}

export function rotatedRectCorners(
  cx: number,
  cy: number,
  halfW: number,
  halfD: number,
  rotationDeg: number,
): PointM[] {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const local = [
    { x: -halfW, y: -halfD },
    { x: halfW, y: -halfD },
    { x: halfW, y: halfD },
    { x: -halfW, y: halfD },
  ];
  return local.map((p) => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  }));
}

export function rotatedRectAabb(
  cx: number,
  cy: number,
  halfW: number,
  halfD: number,
  rotationDeg: number,
): AabbM {
  const corners = rotatedRectCorners(cx, cy, halfW, halfD, rotationDeg);
  return polygonAabb(corners);
}

export function rectInsidePolygon(
  cx: number,
  cy: number,
  halfW: number,
  halfD: number,
  rotationDeg: number,
  polygon: PointM[],
  wallClearanceM: number,
): boolean {
  if (!pointInPolygon({ x: cx, y: cy }, polygon)) {
    return false;
  }
  if (minDistToPolygonEdges({ x: cx, y: cy }, polygon) < Math.max(halfW, halfD) + wallClearanceM - 1e-6) {
    const corners = rotatedRectCorners(cx, cy, halfW, halfD, rotationDeg);
    for (const c of corners) {
      if (!pointInPolygon(c, polygon)) {
        return false;
      }
      if (minDistToPolygonEdges(c, polygon) < wallClearanceM - 1e-6) {
        return false;
      }
    }
    return true;
  }
  const corners = rotatedRectCorners(cx, cy, halfW, halfD, rotationDeg);
  for (const c of corners) {
    if (!pointInPolygon(c, polygon)) {
      return false;
    }
  }
  return true;
}

export function polygonsIntersect(a: PointM[], b: PointM[]): boolean {
  const aa = polygonAabb(a);
  const bb = polygonAabb(b);
  if (!aabbOverlap(aa, bb)) {
    return false;
  }
  for (const p of a) {
    if (pointInPolygon(p, b)) {
      return true;
    }
  }
  for (const p of b) {
    if (pointInPolygon(p, a)) {
      return true;
    }
  }
  return false;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function circleInsidePolygon(
  cx: number,
  cy: number,
  radius: number,
  polygon: PointM[],
  wallClearanceM: number,
): boolean {
  if (!pointInPolygon({ x: cx, y: cy }, polygon)) {
    return false;
  }
  return minDistToPolygonEdges({ x: cx, y: cy }, polygon) >= radius + wallClearanceM - 1e-6;
}

/** Minimum distance from a point to an axis-aligned box (0 if inside). */
export function pointToAabbDistance(px: number, py: number, box: AabbM): number {
  const nx = clamp(px, box.minX, box.maxX);
  const ny = clamp(py, box.minY, box.maxY);
  return Math.hypot(px - nx, py - ny);
}

export function circleHitsAabb(cx: number, cy: number, r: number, box: AabbM): boolean {
  return pointToAabbDistance(cx, cy, box) < r - 1e-9;
}

export function circleHitsRotatedRect(
  cx: number,
  cy: number,
  radius: number,
  rx: number,
  ry: number,
  halfW: number,
  halfD: number,
  rotationDeg: number,
): boolean {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = cx - rx;
  const dy = cy - ry;
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  const nx = clamp(lx, -halfW, halfW);
  const ny = clamp(ly, -halfD, halfD);
  const ex = lx - nx;
  const ey = ly - ny;
  return ex * ex + ey * ey < radius * radius - 1e-9;
}

function projectObb(
  cx: number,
  cy: number,
  halfW: number,
  halfD: number,
  rotationDeg: number,
  axisX: number,
  axisY: number,
): { min: number; max: number } {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const worldX = [cos * halfW, -sin * halfD];
  const worldY = [sin * halfW, cos * halfD];
  const extent = Math.abs(worldX[0] * axisX + worldY[0] * axisY) + Math.abs(worldX[1] * axisX + worldY[1] * axisY);
  const center = cx * axisX + cy * axisY;
  return { min: center - extent, max: center + extent };
}

/** Precise oriented-rectangle overlap. AABB may be used first as a cheap reject. */
export function orientedRectsOverlap(
  ax: number,
  ay: number,
  aHalfW: number,
  aHalfD: number,
  aRot: number,
  bx: number,
  by: number,
  bHalfW: number,
  bHalfD: number,
  bRot: number,
): boolean {
  const cheapA = rotatedRectAabb(ax, ay, aHalfW, aHalfD, aRot);
  const cheapB = rotatedRectAabb(bx, by, bHalfW, bHalfD, bRot);
  if (!aabbOverlap(cheapA, cheapB)) {
    return false;
  }
  const aRad = (aRot * Math.PI) / 180;
  const bRad = (bRot * Math.PI) / 180;
  const axes: [number, number][] = [
    [Math.cos(aRad), Math.sin(aRad)],
    [-Math.sin(aRad), Math.cos(aRad)],
    [Math.cos(bRad), Math.sin(bRad)],
    [-Math.sin(bRad), Math.cos(bRad)],
  ];
  for (const [axisX, axisY] of axes) {
    const pa = projectObb(ax, ay, aHalfW, aHalfD, aRot, axisX, axisY);
    const pb = projectObb(bx, by, bHalfW, bHalfD, bRot, axisX, axisY);
    if (pa.max <= pb.min + 1e-9 || pb.max <= pa.min + 1e-9) {
      return false;
    }
  }
  return true;
}

export function circlesSeparated(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
  extraGap = 0,
): boolean {
  const min = ar + br + extraGap;
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy >= min * min - 1e-9;
}
