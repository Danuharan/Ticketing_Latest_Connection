/** 2D contour tracing + polygon simplification for block edge detection. */

export interface Point2D {
  x: number;
  y: number;
}

export interface PointPct {
  xPct: number;
  yPct: number;
}

function perpendicularDistance(point: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  }
  return (
    Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) /
    Math.hypot(dx, dy)
  );
}

/** Ramer–Douglas–Peucker on an open polyline. */
export function simplifyPolygon(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length <= 2) {
    return points;
  }
  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i += 1) {
    const dist = perpendicularDistance(points[i], points[0], points[end]);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = simplifyPolygon(points.slice(0, index + 1), epsilon);
    const right = simplifyPolygon(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[end]];
}

/**
 * RDP for closed contours: split at the diameter pair, simplify each chain, merge.
 * Open-chain RDP between first/last contour pixels produces jagged "wobbly" edges.
 */
export function simplifyClosedPolygon(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length <= 4) {
    return [...points];
  }

  let maxDist = 0;
  let iMax = 0;
  let jMax = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      if (d > maxDist) {
        maxDist = d;
        iMax = i;
        jMax = j;
      }
    }
  }

  const chain1 = iMax <= jMax ? points.slice(iMax, jMax + 1) : points.slice(iMax).concat(points.slice(0, jMax + 1));
  const chain2 = jMax <= iMax ? points.slice(jMax, iMax + 1) : points.slice(jMax).concat(points.slice(0, iMax + 1));

  if (chain1.length < 2 || chain2.length < 2) {
    return [...points];
  }

  const simp1 = simplifyPolygon(chain1, epsilon);
  const simp2 = simplifyPolygon(chain2, epsilon);
  const merged = simp1.slice(0, -1).concat(simp2.slice(0, -1));
  return merged.length >= 3 ? merged : [...points];
}

/** Drop vertices that sit almost on a straight line between neighbours. */
export function removeCollinearVertices(points: Point2D[], minTurnDeg = 8): Point2D[] {
  if (points.length < 4) {
    return [...points];
  }
  const cosThreshold = Math.cos(((180 - minTurnDeg) * Math.PI) / 180);
  const kept: Point2D[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[(i - 1 + points.length) % points.length];
    const cur = points[i];
    const next = points[(i + 1) % points.length];
    const v1x = prev.x - cur.x;
    const v1y = prev.y - cur.y;
    const v2x = next.x - cur.x;
    const v2y = next.y - cur.y;
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 0.5 || len2 < 0.5) {
      continue;
    }
    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    if (dot < -cosThreshold) {
      kept.push(cur);
    }
  }
  return kept.length >= 3 ? kept : [...points];
}

function simplifyToVertexBudget(points: Point2D[], epsilon: number, maxVerts: number): Point2D[] {
  const span = Math.max(1, Math.hypot(points[0]?.x ?? 0, points[0]?.y ?? 0));
  let eps = epsilon;
  let result = simplifyClosedPolygon(points, eps);
  result = removeCollinearVertices(result, 6);
  let guard = 0;
  while (result.length > maxVerts && eps < span * 0.35 && guard < 8) {
    eps *= 1.35;
    result = removeCollinearVertices(simplifyClosedPolygon(points, eps), 6);
    guard += 1;
  }
  return result;
}

function closestContourIndex(contour: Point2D[], pt: Point2D): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < contour.length; i += 1) {
    const d = Math.hypot(contour[i].x - pt.x, contour[i].y - pt.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Shorter arc between two indices on a closed contour. */
function contourChain(contour: Point2D[], from: number, to: number): Point2D[] {
  const n = contour.length;
  if (n === 0) {
    return [];
  }
  if (from === to) {
    return [contour[from]];
  }
  const forward: Point2D[] = [];
  let i = from;
  while (i !== to) {
    forward.push(contour[i]);
    i = (i + 1) % n;
    if (forward.length > n) {
      break;
    }
  }
  forward.push(contour[to]);

  const backward: Point2D[] = [];
  i = from;
  while (i !== to) {
    backward.push(contour[i]);
    i = (i - 1 + n) % n;
    if (backward.length > n) {
      break;
    }
  }
  backward.push(contour[to]);

  return forward.length <= backward.length ? forward : backward;
}

/**
 * Re-insert contour points along bowed edges that RDP flattened to straight lines.
 * Stadium sector blocks need 3–4 points per curved arc, not just corner-to-corner.
 */
function restoreCurveVertices(
  contour: Point2D[],
  simplified: Point2D[],
  minBow: number,
  maxVerts: number,
): Point2D[] {
  let pts = [...simplified];
  let guard = 0;
  while (pts.length < maxVerts && guard < 32) {
    guard += 1;
    const enriched: Point2D[] = [];
    let inserted = false;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      enriched.push(a);
      if (enriched.length >= maxVerts) {
        break;
      }
      const chain = contourChain(
        contour,
        closestContourIndex(contour, a),
        closestContourIndex(contour, b),
      );
      if (chain.length < 3) {
        continue;
      }
      let maxDist = 0;
      let best: Point2D | null = null;
      for (const p of chain) {
        const d = perpendicularDistance(p, a, b);
        if (d > maxDist) {
          maxDist = d;
          best = p;
        }
      }
      if (maxDist >= minBow && best) {
        enriched.push(best);
        inserted = true;
      }
    }
    if (!inserted) {
      break;
    }
    pts = enriched;
  }
  return pts;
}

const MOORE_DIRS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
];

function traceContour(
  labels: Int32Array,
  label: number,
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Point2D[] {
  const isFg = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] === label;

  let start: Point2D | null = null;
  for (let y = minY; y <= maxY && !start; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (isFg(x, y)) {
        start = { x, y };
        break;
      }
    }
  }
  if (!start) {
    return [];
  }

  const contour: Point2D[] = [];
  let current = start;
  let backtrack = 0;
  const maxSteps = ((maxX - minX + 1) * 2 + (maxY - minY + 1) * 2) * 4 + 32;
  let steps = 0;

  do {
    contour.push(current);
    let found = false;
    for (let i = 0; i < 8; i += 1) {
      const dirIdx = (backtrack + 1 + i) % 8;
      const nx = current.x + MOORE_DIRS[dirIdx].dx;
      const ny = current.y + MOORE_DIRS[dirIdx].dy;
      if (isFg(nx, ny)) {
        backtrack = (dirIdx + 4) % 8;
        current = { x: nx, y: ny };
        found = true;
        break;
      }
    }
    if (!found) {
      break;
    }
    steps += 1;
  } while ((current.x !== start.x || current.y !== start.y) && steps < maxSteps);

  return contour;
}

export function extractBoundaryPolygon(
  labels: Int32Array,
  label: number,
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): PointPct[] {
  const contour = traceContour(labels, label, width, height, minX, minY, maxX, maxY);
  if (contour.length < 3) {
    return [];
  }
  const step = Math.max(1, Math.floor(contour.length / 120));
  const downsampled = step > 1 ? contour.filter((_, i) => i % step === 0) : contour;
  const span = Math.max(4, Math.min(maxX - minX, maxY - minY));
  const epsilon = Math.max(1.2, span * 0.032);
  const maxVerts = 22;
  const minBow = Math.max(1.1, span * 0.018);
  let simplified =
    downsampled.length > 6
      ? simplifyToVertexBudget(downsampled, epsilon, maxVerts)
      : removeCollinearVertices(downsampled, 6);
  if (downsampled.length > 6 && simplified.length >= 3) {
    simplified = restoreCurveVertices(downsampled, simplified, minBow, maxVerts);
    simplified = removeCollinearVertices(simplified, 5);
  }
  const finalPts = simplified.length >= 3 ? simplified : downsampled;
  return finalPts.map((p) => ({
    xPct: (p.x / width) * 100,
    yPct: (p.y / height) * 100,
  }));
}

export function pointInPolygon(x: number, y: number, polygon: PointPct[]): boolean {
  if (polygon.length < 3) {
    return false;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].xPct;
    const yi = polygon[i].yPct;
    const xj = polygon[j].xPct;
    const yj = polygon[j].yPct;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}
