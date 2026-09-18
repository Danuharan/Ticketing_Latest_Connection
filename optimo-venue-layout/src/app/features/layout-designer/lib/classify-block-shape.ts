import type { ElementPosition, ShapeId } from '../models/layout-element.model';

const CORNER_EPS_PCT = 2.5;
const COLINEAR_CROSS_EPS = 180;
const MIN_AREA_PCT2 = 80;
const RIGHT_ANGLE_COS_EPS = 0.22;
const SIDE_EQUAL_RATIO = 0.12;
const ASPECT_SQUARE_RATIO = 0.12;
const CIRCULARITY_MIN = 0.88;
const ELLIPSE_AREA_RATIO_MIN = 0.82;
const ELLIPSE_AREA_RATIO_MAX = 1.18;
const CIRCLE_ASPECT_MAX = 0.18;
const ELLIPSE_MIN_POINTS = 8;
const ELLIPSE_MIN_CORNERS = 8;

function dist(a: ElementPosition, b: ElementPosition): number {
  return Math.hypot(a.xPct - b.xPct, a.yPct - b.yPct);
}

function polygonArea(points: ElementPosition[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.xPct * b.yPct - b.xPct * a.yPct;
  }
  return Math.abs(sum) / 2;
}

function perimeter(points: ElementPosition[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    sum += dist(points[i]!, points[(i + 1) % points.length]!);
  }
  return sum;
}

/** Drop near-duplicate and nearly-colinear vertices. */
export function simplifyPolygonCorners(points: ElementPosition[]): ElementPosition[] {
  if (points.length < 3) {
    return points.slice();
  }

  const deduped: ElementPosition[] = [];
  for (const p of points) {
    const prev = deduped[deduped.length - 1];
    if (!prev || dist(prev, p) >= CORNER_EPS_PCT) {
      deduped.push({ xPct: p.xPct, yPct: p.yPct });
    }
  }
  if (deduped.length >= 2 && dist(deduped[0]!, deduped[deduped.length - 1]!) < CORNER_EPS_PCT) {
    deduped.pop();
  }
  if (deduped.length < 3) {
    return deduped;
  }

  const corners: ElementPosition[] = [];
  const n = deduped.length;
  for (let i = 0; i < n; i += 1) {
    const prev = deduped[(i - 1 + n) % n]!;
    const cur = deduped[i]!;
    const next = deduped[(i + 1) % n]!;
    const ax = cur.xPct - prev.xPct;
    const ay = cur.yPct - prev.yPct;
    const bx = next.xPct - cur.xPct;
    const by = next.yPct - cur.yPct;
    const cross = ax * by - ay * bx;
    if (Math.abs(cross) >= COLINEAR_CROSS_EPS) {
      corners.push(cur);
    }
  }
  return corners.length >= 3 ? corners : deduped;
}

function nearlyEqualSides(lengths: number[], toleranceRatio = SIDE_EQUAL_RATIO): boolean {
  const max = Math.max(...lengths);
  const min = Math.min(...lengths);
  if (max < 1e-6) {
    return false;
  }
  return (max - min) / max <= toleranceRatio;
}

function isRightAngleQuad(corners: ElementPosition[]): boolean {
  if (corners.length !== 4) {
    return false;
  }
  for (let i = 0; i < 4; i += 1) {
    const prev = corners[(i - 1 + 4) % 4]!;
    const cur = corners[i]!;
    const next = corners[(i + 1) % 4]!;
    const ax = prev.xPct - cur.xPct;
    const ay = prev.yPct - cur.yPct;
    const bx = next.xPct - cur.xPct;
    const by = next.yPct - cur.yPct;
    const magA = Math.hypot(ax, ay);
    const magB = Math.hypot(bx, by);
    if (magA < 1e-6 || magB < 1e-6) {
      return false;
    }
    const cos = (ax * bx + ay * by) / (magA * magB);
    if (Math.abs(cos) > RIGHT_ANGLE_COS_EPS) {
      return false;
    }
  }
  return true;
}

function classifyEllipseKind(points: ElementPosition[]): 'circle' | 'oval' | null {
  if (points.length < ELLIPSE_MIN_POINTS) {
    return null;
  }
  const xs = points.map((p) => p.xPct);
  const ys = points.map((p) => p.yPct);
  const w = Math.max(1e-6, Math.max(...xs) - Math.min(...xs));
  const h = Math.max(1e-6, Math.max(...ys) - Math.min(...ys));
  const aspectDelta = Math.abs(w - h) / Math.max(w, h);
  const area = polygonArea(points);
  const expectedEllipseArea = Math.PI * (w / 2) * (h / 2);
  if (expectedEllipseArea < 1e-6) {
    return null;
  }
  const areaRatio = area / expectedEllipseArea;
  if (areaRatio < ELLIPSE_AREA_RATIO_MIN || areaRatio > ELLIPSE_AREA_RATIO_MAX) {
    return null;
  }
  const peri = perimeter(points);
  if (peri < 1e-6) {
    return null;
  }
  const a = w / 2;
  const b = h / 2;
  const ellipsePeri =
    Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  const ellipseFit = (4 * Math.PI * area) / (peri * peri);
  const ellipsePeriFit = Math.abs(peri - ellipsePeri) / ellipsePeri;
  if (ellipseFit < CIRCULARITY_MIN * 0.85 && ellipsePeriFit > 0.2) {
    return null;
  }
  return aspectDelta <= CIRCLE_ASPECT_MAX ? 'circle' : 'oval';
}

/**
 * Named shape for JSON metadata only.
 * Canvas must still draw `customPoints` as a polygon — never swap to ellipse/rect primitives.
 */
export function classifyBlockShape(points: ElementPosition[] | undefined | null): ShapeId {
  if (!points || points.length < 3) {
    return 'custom';
  }
  if (polygonArea(points) < MIN_AREA_PCT2) {
    return 'custom';
  }

  const corners = simplifyPolygonCorners(points);
  if (polygonArea(corners) < MIN_AREA_PCT2) {
    return 'custom';
  }

  if (corners.length === 3) {
    return 'triangle';
  }

  if (corners.length === 4 && isRightAngleQuad(corners)) {
    const sides = corners.map((c, i) => dist(c, corners[(i + 1) % 4]!));
    const oppositeOk =
      Math.abs(sides[0]! - sides[2]!) / Math.max(sides[0]!, sides[2]!, 1e-6) <= SIDE_EQUAL_RATIO &&
      Math.abs(sides[1]! - sides[3]!) / Math.max(sides[1]!, sides[3]!, 1e-6) <= SIDE_EQUAL_RATIO;
    if (!oppositeOk) {
      return 'custom';
    }
    const pairA = (sides[0]! + sides[2]!) / 2;
    const pairB = (sides[1]! + sides[3]!) / 2;
    const aspectDelta = Math.abs(pairA - pairB) / Math.max(pairA, pairB);
    if (aspectDelta <= ASPECT_SQUARE_RATIO && nearlyEqualSides(sides, SIDE_EQUAL_RATIO * 1.5)) {
      return 'square';
    }
    return 'rectangle';
  }

  if (corners.length >= ELLIPSE_MIN_CORNERS) {
    const ellipseKind = classifyEllipseKind(points);
    if (ellipseKind) {
      return ellipseKind;
    }
  }

  return 'custom';
}
