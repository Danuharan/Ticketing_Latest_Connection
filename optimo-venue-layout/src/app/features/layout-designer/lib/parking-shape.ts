/**
 * Parking area geometry: a closed freeform polygon whose edges can be bowed into a
 * smooth arc (same sine-bow technique as `curvedRectanglePath` in `geometry.ts`,
 * generalized to an arbitrary-orientation segment), plus a divider-line clipper
 * used to fit generated parking bay lines to the (possibly bowed) outline.
 */

import { PixelRect } from './geometry';
import { CanvasPoint } from './custom-shape';
import { ElementPosition } from '../models/layout-element.model';

/** Bow ratio is clamped to this range (fraction of the edge's own length). */
export const MAX_EDGE_BOW_RATIO = 0.6;

function toCanvasPx(p: ElementPosition, rect: PixelRect): CanvasPoint {
  return { x: rect.x + (p.xPct / 100) * rect.width, y: rect.y + (p.yPct / 100) * rect.height };
}

/** Sample a straight segment [a, b] bowed outward by `bowRatio` × segment length. */
export function sampleBowedEdge(
  a: CanvasPoint,
  b: CanvasPoint,
  bowRatio: number,
  steps = 16,
): CanvasPoint[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const perpX = -dy / len;
  const perpY = dx / len;
  const arcOffset = bowRatio * len;
  const points: CanvasPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const bow = Math.sin(t * Math.PI) * arcOffset;
    points.push({
      x: a.x + dx * t + perpX * bow,
      y: a.y + dy * t + perpY * bow,
    });
  }
  return points;
}

/** Full outline as a flat, closed point list (bowed edges pre-sampled). */
export function buildParkingOutlinePoints(
  rect: PixelRect,
  customPoints: ElementPosition[],
  edgeBowAmounts: number[] = [],
): CanvasPoint[] {
  const n = customPoints.length;
  if (n < 3) {
    return [];
  }
  const verts = customPoints.map((p) => toCanvasPx(p, rect));
  const outline: CanvasPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const bow = edgeBowAmounts[i] ?? 0;
    if (Math.abs(bow) < 0.005) {
      outline.push(a);
    } else {
      const sampled = sampleBowedEdge(a, b, bow);
      outline.push(...sampled.slice(0, -1));
    }
  }
  return outline;
}

/** SVG `path d=` for the closed, possibly-bowed outline. Empty string when < 3 points. */
export function buildParkingOutlinePathPx(
  rect: PixelRect,
  customPoints: ElementPosition[],
  edgeBowAmounts: number[] = [],
): string {
  const points = buildParkingOutlinePoints(rect, customPoints, edgeBowAmounts);
  if (points.length < 3) {
    return '';
  }
  const parts = points.map(
    (p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`,
  );
  parts.push('Z');
  return parts.join(' ');
}

/**
 * Midpoint of one (possibly bowed) edge — used to position its drag handle.
 * Offset inward by `insetPx` so a straight (unbowed) edge's handle doesn't sit exactly on
 * top of the bounding-box resize handle at the same edge (n/s/e/w share that pixel otherwise).
 */
export function getEdgeBowHandleCanvasPx(
  rect: PixelRect,
  customPoints: ElementPosition[],
  edgeBowAmounts: number[] = [],
  edgeIndex: number,
  insetPx = 0,
): CanvasPoint | null {
  const n = customPoints.length;
  if (n < 3 || edgeIndex < 0 || edgeIndex >= n) {
    return null;
  }
  const a = toCanvasPx(customPoints[edgeIndex], rect);
  const b = toCanvasPx(customPoints[(edgeIndex + 1) % n], rect);
  const bow = edgeBowAmounts[edgeIndex] ?? 0;
  const sampled = sampleBowedEdge(a, b, bow);
  const mid = sampled[Math.floor(sampled.length / 2)];
  if (!insetPx) {
    return mid;
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular pointing toward the polygon's centroid-ish direction (rect centre is a
  // good enough approximation for the small nudge this is used for).
  const perpX = -dy / len;
  const perpY = dx / len;
  const towardCentre = (rect.cx - mid.x) * perpX + (rect.cy - mid.y) * perpY >= 0 ? 1 : -1;
  return { x: mid.x + perpX * insetPx * towardCentre, y: mid.y + perpY * insetPx * towardCentre };
}

/** Intersection of the infinite line through (p3,p4)'s carrier direction is NOT used here —
 *  this finds where finite segment [p3,p4] crosses the infinite line through (p1,p2). */
function lineIntersection(
  p1: CanvasPoint,
  p2: CanvasPoint,
  p3: CanvasPoint,
  p4: CanvasPoint,
): CanvasPoint | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) {
    return null;
  }
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (u < 0 || u > 1) {
    return null;
  }
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/**
 * Bowed points for an OPEN polyline still being drafted (not yet closed into a polygon) —
 * used for the live preview while drawing, and for the mid-drag handle of the most
 * recently placed segment. Works directly in canvas px (no element/rect yet).
 */
export function buildBowedOpenPolylinePoints(
  points: CanvasPoint[],
  edgeBowAmounts: number[] = [],
): CanvasPoint[] {
  const n = points.length;
  if (n < 2) {
    return points;
  }
  const out: CanvasPoint[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const bow = edgeBowAmounts[i] ?? 0;
    if (Math.abs(bow) < 0.005) {
      out.push(a);
    } else {
      const sampled = sampleBowedEdge(a, b, bow);
      out.push(...sampled.slice(0, -1));
    }
  }
  out.push(points[n - 1]);
  return out;
}

/** Midpoint handle for one segment of an open (not-yet-closed) draft polyline. */
export function getOpenEdgeBowHandleCanvasPx(
  points: CanvasPoint[],
  edgeBowAmounts: number[] = [],
  edgeIndex: number,
): CanvasPoint | null {
  if (edgeIndex < 0 || edgeIndex >= points.length - 1) {
    return null;
  }
  const a = points[edgeIndex];
  const b = points[edgeIndex + 1];
  const bow = edgeBowAmounts[edgeIndex] ?? 0;
  const sampled = sampleBowedEdge(a, b, bow);
  return sampled[Math.floor(sampled.length / 2)];
}

/**
 * Clips the infinite line through (p1, p2) to the outer bounds of `polygon`, keeping
 * only the two most extreme intersection points. Correct for convex outlines; on a
 * non-convex outline this may pass through a concave notch — acceptable v1 tradeoff.
 */
export function clipLineToPolygon(
  p1: CanvasPoint,
  p2: CanvasPoint,
  polygon: CanvasPoint[],
): [CanvasPoint, CanvasPoint] | null {
  const n = polygon.length;
  if (n < 3) {
    return null;
  }
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  let tMin = Infinity;
  let tMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const hit = lineIntersection(p1, p2, polygon[i], polygon[(i + 1) % n]);
    if (!hit) {
      continue;
    }
    const t = (hit.x - p1.x) * ux + (hit.y - p1.y) * uy;
    tMin = Math.min(tMin, t);
    tMax = Math.max(tMax, t);
  }
  if (tMax <= tMin) {
    return null;
  }
  return [
    { x: p1.x + ux * tMin, y: p1.y + uy * tMin },
    { x: p1.x + ux * tMax, y: p1.y + uy * tMax },
  ];
}

/** Max projection extent of `points` onto the unit direction (ux, uy). */
export function projectionSpan(
  points: CanvasPoint[],
  origin: CanvasPoint,
  ux: number,
  uy: number,
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const t = (p.x - origin.x) * ux + (p.y - origin.y) * uy;
    min = Math.min(min, t);
    max = Math.max(max, t);
  }
  return { min, max };
}

/**
 * Real-world scale (canvas px per metre) derived from the edges the user has actually
 * measured, rather than a generic L×W box — a proper fit for an irregular outline. Each
 * measured edge's *current* rect-relative straight-line pixel length (corner to corner,
 * even for a bowed edge — that's what a tape measure gives you) is weighted into the
 * average, so longer edges anchor the scale more. Recomputed fresh from `rect` every call
 * (never cached), so it stays correct if the shape is later resized. Returns `null` when
 * nothing has been measured yet — caller should fall back to the generic L×W scale.
 */
export function computeParkingPxPerMeter(
  rect: PixelRect,
  customPoints: ElementPosition[],
  customSideLengthsM: number[] = [],
): number | null {
  const n = customPoints.length;
  if (n < 3) {
    return null;
  }
  let totalPx = 0;
  let totalM = 0;
  for (let i = 0; i < n; i++) {
    const lengthM = customSideLengthsM[i];
    if (!lengthM || lengthM <= 0) {
      continue;
    }
    const a = toCanvasPx(customPoints[i], rect);
    const b = toCanvasPx(customPoints[(i + 1) % n], rect);
    totalPx += Math.hypot(b.x - a.x, b.y - a.y);
    totalM += lengthM;
  }
  return totalM > 0 ? totalPx / totalM : null;
}

/**
 * Reshapes the outline so each measured edge's on-screen (pixel) length is proportional
 * to the real-world length the user entered for it — e.g. a 10 m edge ends up twice as
 * long on screen as a 5 m edge, instead of both keeping whatever length they happened to
 * have when freehand-drawn. Edges without a saved length are left free-ish (soft
 * constraint pulling them back toward their current length) so the shape can still close
 * up; they visibly settle into place as more edges get measured.
 *
 * Implemented as a Gauss-Seidel distance-constraint relaxation (the standard
 * position-based-dynamics rope/cloth technique): each edge is a spring toward its target
 * pixel length, iterated until the polygon converges. Started from the current vertex
 * positions, so the result stays as close as possible to the hand-drawn shape/angles —
 * for a triangle (fully determined by 3 side lengths) it converges to the exact SSS
 * triangle; for polygons with more sides (under-determined by side lengths alone) it
 * picks the closest-to-drawn solution rather than an arbitrary one.
 *
 * Returns new vertex positions in canvas px (same space as `toCanvasPx`), or `null` if
 * there's nothing measured yet to anchor a scale.
 */
export function relaxParkingPolygonToLengths(
  rect: PixelRect,
  customPoints: ElementPosition[],
  customSideLengthsM: number[] = [],
  iterations = 60,
): CanvasPoint[] | null {
  const n = customPoints.length;
  if (n < 3) {
    return null;
  }
  const pxPerMeter = computeParkingPxPerMeter(rect, customPoints, customSideLengthsM);
  if (!pxPerMeter) {
    return null;
  }

  const verts = customPoints.map((p) => toCanvasPx(p, rect));
  const targets: { lengthPx: number; hard: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const lengthM = customSideLengthsM[i];
    if (lengthM && lengthM > 0) {
      targets.push({ lengthPx: lengthM * pxPerMeter, hard: true });
    } else {
      const a = verts[i];
      const b = verts[(i + 1) % n];
      targets.push({ lengthPx: Math.hypot(b.x - a.x, b.y - a.y) || 1, hard: false });
    }
  }

  const SOFT_STIFFNESS = 0.12;
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = verts[i];
      const b = verts[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1e-6;
      const target = targets[i];
      const stiffness = target.hard ? 1 : SOFT_STIFFNESS;
      const correction = ((len - target.lengthPx) / len) * stiffness * 0.5;
      a.x += dx * correction;
      a.y += dy * correction;
      b.x -= dx * correction;
      b.y -= dy * correction;
    }
  }

  return verts;
}

export interface ParkingEdgeSummary {
  index: number;
  label: string;
  isCurved: boolean;
  lengthM: number | null;
}

/** One summary row per raw edge — shared by the sidebar list and the canvas overlay so they stay in sync. */
export function buildParkingEdgeSummaries(
  customPoints: ElementPosition[],
  edgeBowAmounts: number[] = [],
  customSideLengthsM: number[] = [],
): ParkingEdgeSummary[] {
  return customPoints.map((_, index) => ({
    index,
    label: `Side ${index + 1}`,
    isCurved: Math.abs(edgeBowAmounts[index] ?? 0) >= 0.005,
    lengthM: customSideLengthsM[index] && customSideLengthsM[index] > 0 ? customSideLengthsM[index] : null,
  }));
}
