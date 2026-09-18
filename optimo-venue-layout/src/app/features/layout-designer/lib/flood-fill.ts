/**
 * Click-to-trace: flood-fill a coloured region on a blueprint and return its
 * outer contour as canvas-% polygon points (same idea as the prototype designer).
 */

import { extractBoundaryPolygon, type PointPct } from './contour-geometry';
import { closeMask, dilateMask, erodeMask } from './detect-blocks';

export interface FloodFillResult {
  polygon: PointPct[];
  fillColor: string;
  pixelArea: number;
}

export interface FloodFillOptions {
  /**
   * Expected block area (canvas px), from the audit Fix flow. When given,
   * same-coloured fragments mostly inside this rect are reunited — repairs
   * blocks whose white name label splits the coloured area into pieces.
   */
  targetRect?: { x: number; y: number; width: number; height: number };
}

function lum(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function isBorderPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 100) {
    return true;
  }
  const l = lum(r, g, b);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  if (l > 228 && chroma < 35) {
    return true;
  }
  if (l > 205 && chroma < 22) {
    return true;
  }
  if (l < 50 && chroma < 35) {
    return true;
  }
  if (l < 75 && chroma < 18) {
    return true;
  }
  return false;
}

function colorDistance(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function hexWithAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) {
    return `rgba(191,219,254,${alpha})`;
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export { hexWithAlpha };

/** Darken a `#rrggbb` colour so traced blocks stand out from the blueprint. */
export function darkenHex(hex: string, amount = 0.35): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) {
    return '#475569';
  }
  const scale = (n: number) => Math.max(0, Math.min(255, Math.round(n * (1 - amount))));
  const r = scale(parseInt(h.slice(0, 2), 16));
  const g = scale(parseInt(h.slice(2, 4), 16));
  const b = scale(parseInt(h.slice(4, 6), 16));
  return rgbToHex(r, g, b);
}

function parseHex(hex: string): [number, number, number] | null {
  const h = hex.replace('#', '');
  if (h.length !== 6) {
    return null;
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Blend sampled chart colour with a dark base so overlays read clearly on the blueprint. */
export function mixWithDarkBase(
  hex: string,
  base: [number, number, number] = [15, 23, 42],
  baseWeight = 0.78,
): string {
  const rgb = parseHex(hex);
  if (!rgb) {
    return rgbToHex(base[0], base[1], base[2]);
  }
  const tintWeight = 1 - baseWeight;
  const r = Math.round(base[0] * baseWeight + rgb[0] * tintWeight);
  const g = Math.round(base[1] * baseWeight + rgb[1] * tintWeight);
  const b = Math.round(base[2] * baseWeight + rgb[2] * tintWeight);
  return rgbToHex(r, g, b);
}

/** Fill + stroke tuned for click-traced blocks — clearly darker than the chart. */
export function tracedBlockStyle(sampledHex: string): {
  fillColor: string;
  strokeColor: string;
  labelColor: string;
} {
  const darkFill = mixWithDarkBase(sampledHex, [15, 23, 42], 0.8);
  return {
    fillColor: hexWithAlpha(darkFill, 0.94),
    strokeColor: '#020617',
    labelColor: '#ffffff',
  };
}

interface FragmentStats {
  label: number;
  count: number;
  /** Pixels inside the expanded target rect (0 when no rect given). */
  insideCount: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumR: number;
  sumG: number;
  sumB: number;
}

/** Nearest non-border pixel — rescues clicks landing on a white block label. */
function findNearestFillablePixel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  maxRadius: number,
): number | null {
  for (let r = 0; r <= maxRadius; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) {
          continue; // ring only
        }
        const x = startX + dx;
        const y = startY + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) {
          continue;
        }
        const pi = (y * width + x) * 4;
        if (!isBorderPixel(data[pi], data[pi + 1], data[pi + 2], data[pi + 3])) {
          return y * width + x;
        }
      }
    }
  }
  return null;
}

/**
 * Flood-fills the region under `(startX, startY)` and traces its boundary.
 * `tolerance` is summed RGB distance (typical range 24–80).
 *
 * The traced mask is repaired before contouring: name-label glyphs enclosed by
 * the region are absorbed (hole fill + morphological close), and — when
 * `options.targetRect` is given — same-coloured fragments that the label's
 * white border split off are reunited into one block.
 */
export function floodFillAtPoint(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  tolerance: number,
  options: FloodFillOptions = {},
): FloodFillResult | null {
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) {
    return null;
  }

  const seedIdx = findNearestFillablePixel(data, width, height, startX, startY, 18);
  if (seedIdx === null) {
    return null;
  }
  const si = seedIdx * 4;
  const seedR = data[si];
  const seedG = data[si + 1];
  const seedB = data[si + 2];

  const target = options.targetRect ?? null;
  const expanded = target
    ? {
        x: Math.max(0, target.x - target.width * 0.175),
        y: Math.max(0, target.y - target.height * 0.175),
        width: Math.min(width, target.width * 1.35),
        height: Math.min(height, target.height * 1.35),
      }
    : null;

  // Pixels in the block core (the unexpanded target rect) cannot belong to a
  // neighbour, so tolerate the label's shading there; stay strict outside.
  const toleranceAt = (x: number, y: number): number =>
    target &&
    x >= target.x &&
    x <= target.x + target.width &&
    y >= target.y &&
    y <= target.y + target.height
      ? tolerance * 1.6
      : tolerance;

  const labels = new Int32Array(width * height);

  const fillFragment = (fromIdx: number, label: number): FragmentStats => {
    const frag: FragmentStats = {
      label,
      count: 0,
      insideCount: 0,
      minX: fromIdx % width,
      minY: Math.floor(fromIdx / width),
      maxX: fromIdx % width,
      maxY: Math.floor(fromIdx / width),
      sumR: 0,
      sumG: 0,
      sumB: 0,
    };
    labels[fromIdx] = label;
    const stack: number[] = [fromIdx];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const cy = Math.floor(cur / width);
      const cx = cur % width;
      const pi = cur * 4;
      frag.sumR += data[pi];
      frag.sumG += data[pi + 1];
      frag.sumB += data[pi + 2];
      frag.count += 1;
      frag.minX = Math.min(frag.minX, cx);
      frag.minY = Math.min(frag.minY, cy);
      frag.maxX = Math.max(frag.maxX, cx);
      frag.maxY = Math.max(frag.maxY, cy);
      if (
        expanded &&
        cx >= expanded.x &&
        cx <= expanded.x + expanded.width &&
        cy >= expanded.y &&
        cy <= expanded.y + expanded.height
      ) {
        frag.insideCount += 1;
      }

      const neighbors: number[] = [];
      if (cx > 0) neighbors.push(cur - 1);
      if (cx < width - 1) neighbors.push(cur + 1);
      if (cy > 0) neighbors.push(cur - width);
      if (cy < height - 1) neighbors.push(cur + width);
      for (const n of neighbors) {
        if (labels[n] !== 0) {
          continue;
        }
        const ni = n * 4;
        if (isBorderPixel(data[ni], data[ni + 1], data[ni + 2], data[ni + 3])) {
          continue;
        }
        const nx = n % width;
        const ny = (n - nx) / width;
        if (
          colorDistance(seedR, seedG, seedB, data[ni], data[ni + 1], data[ni + 2]) >
          toleranceAt(nx, ny)
        ) {
          continue;
        }
        labels[n] = label;
        stack.push(n);
      }
    }
    return frag;
  };

  const accepted: FragmentStats[] = [fillFragment(seedIdx, 1)];

  // Reunite label-split fragments: same-coloured regions mostly inside the
  // expected block area belong to this block; neighbouring blocks (same
  // colour, body mostly outside the rect) fail the containment test.
  if (target && expanded) {
    const rectArea = Math.max(1, target.width * target.height);
    let nextLabel = 2;
    const step = 3;
    const yEnd = Math.min(height - 1, Math.round(expanded.y + expanded.height));
    const xEnd = Math.min(width - 1, Math.round(expanded.x + expanded.width));
    for (let y = Math.max(0, Math.round(expanded.y)); y <= yEnd; y += step) {
      for (let x = Math.max(0, Math.round(expanded.x)); x <= xEnd; x += step) {
        const idx = y * width + x;
        if (labels[idx] !== 0) {
          continue;
        }
        const pi = idx * 4;
        if (isBorderPixel(data[pi], data[pi + 1], data[pi + 2], data[pi + 3])) {
          continue;
        }
        if (
          colorDistance(seedR, seedG, seedB, data[pi], data[pi + 1], data[pi + 2]) >
          toleranceAt(x, y)
        ) {
          continue;
        }
        const frag = fillFragment(idx, nextLabel);
        nextLabel += 1;
        if (
          frag.count > 0 &&
          frag.insideCount / frag.count >= 0.6 &&
          frag.count <= rectArea * 2.5
        ) {
          accepted.push(frag);
        }
        // Rejected fragments stay labelled so they are never re-filled.
      }
    }
  }

  // Union stats of the accepted fragments (colour comes from real pixels only).
  let minX = accepted[0].minX;
  let minY = accepted[0].minY;
  let maxX = accepted[0].maxX;
  let maxY = accepted[0].maxY;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let colorCount = 0;
  for (const frag of accepted) {
    minX = Math.min(minX, frag.minX);
    minY = Math.min(minY, frag.minY);
    maxX = Math.max(maxX, frag.maxX);
    maxY = Math.max(maxY, frag.maxY);
    sumR += frag.sumR;
    sumG += frag.sumG;
    sumB += frag.sumB;
    colorCount += frag.count;
  }

  // Repair the mask in a small window around the union: close across thin
  // label strokes, then absorb fully-enclosed holes (glyphs, label boxes).
  // With a target rect the radius scales to the block — closing only fuses
  // pixels already in OUR mask, so it can never leak into neighbour blocks.
  const baseCloseRadius = Math.max(2, Math.min(6, Math.round(Math.min(width, height) * 0.004)));
  const closeRadius = target
    ? Math.max(
        baseCloseRadius,
        Math.max(4, Math.min(14, Math.round(Math.min(target.width, target.height) * 0.1))),
      )
    : baseCloseRadius;
  const margin = closeRadius + 2;
  const winX = Math.max(0, minX - margin);
  const winY = Math.max(0, minY - margin);
  const winMaxX = Math.min(width - 1, maxX + margin);
  const winMaxY = Math.min(height - 1, maxY + margin);
  const winW = winMaxX - winX + 1;
  const winH = winMaxY - winY + 1;

  const acceptedLabels = new Set(accepted.map((frag) => frag.label));
  const mask = new Uint8Array(winW * winH);
  for (let y = winY; y <= winMaxY; y += 1) {
    for (let x = winX; x <= winMaxX; x += 1) {
      if (acceptedLabels.has(labels[y * width + x])) {
        mask[(y - winY) * winW + (x - winX)] = 1;
      }
    }
  }

  const repaired = closeMask(mask, winW, winH, closeRadius);
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) {
      repaired[i] = 1; // Closing must never lose original pixels.
    }
  }

  // Hole fill: zeros unreachable from the window edge are enclosed → absorb.
  const outside = new Uint8Array(winW * winH);
  const edgeStack: number[] = [];
  for (let x = 0; x < winW; x += 1) {
    if (!repaired[x] && !outside[x]) {
      outside[x] = 1;
      edgeStack.push(x);
    }
    const bottom = (winH - 1) * winW + x;
    if (!repaired[bottom] && !outside[bottom]) {
      outside[bottom] = 1;
      edgeStack.push(bottom);
    }
  }
  for (let y = 0; y < winH; y += 1) {
    const left = y * winW;
    if (!repaired[left] && !outside[left]) {
      outside[left] = 1;
      edgeStack.push(left);
    }
    const right = y * winW + winW - 1;
    if (!repaired[right] && !outside[right]) {
      outside[right] = 1;
      edgeStack.push(right);
    }
  }
  while (edgeStack.length > 0) {
    const cur = edgeStack.pop()!;
    const cy = Math.floor(cur / winW);
    const cx = cur % winW;
    const neighbors: number[] = [];
    if (cx > 0) neighbors.push(cur - 1);
    if (cx < winW - 1) neighbors.push(cur + 1);
    if (cy > 0) neighbors.push(cur - winW);
    if (cy < winH - 1) neighbors.push(cur + winW);
    for (const n of neighbors) {
      if (!repaired[n] && !outside[n]) {
        outside[n] = 1;
        edgeStack.push(n);
      }
    }
  }
  for (let i = 0; i < repaired.length; i += 1) {
    if (!repaired[i] && !outside[i]) {
      repaired[i] = 1;
    }
  }

  // Smooth the outline: open (erode→dilate) shaves pixel spurs from the fuzzy
  // rescaled-bitmap borders, close refills the small dents — straight, clean
  // edges instead of a staircase contour. Skip if it would destroy a tiny mask.
  const smoothRadius = 2;
  const opened = dilateMask(
    erodeMask(repaired, winW, winH, smoothRadius),
    winW,
    winH,
    smoothRadius,
  );
  const smoothed = closeMask(opened, winW, winH, smoothRadius);
  let repairedCount = 0;
  let smoothedCount = 0;
  for (let i = 0; i < repaired.length; i += 1) {
    repairedCount += repaired[i];
    smoothedCount += smoothed[i];
  }
  const finalMask = smoothedCount >= 25 && smoothedCount >= repairedCount * 0.6 ? smoothed : repaired;

  // Final mask stats + write back into the label grid for contour tracing.
  const finalLabel = 1_000_000;
  let finalCount = 0;
  let fMinX = winMaxX;
  let fMinY = winMaxY;
  let fMaxX = winX;
  let fMaxY = winY;
  for (let y = 0; y < winH; y += 1) {
    for (let x = 0; x < winW; x += 1) {
      if (!finalMask[y * winW + x]) {
        continue;
      }
      const fx = winX + x;
      const fy = winY + y;
      labels[fy * width + fx] = finalLabel;
      finalCount += 1;
      fMinX = Math.min(fMinX, fx);
      fMinY = Math.min(fMinY, fy);
      fMaxX = Math.max(fMaxX, fx);
      fMaxY = Math.max(fMaxY, fy);
    }
  }

  if (finalCount < 25 || fMaxX - fMinX < 5 || fMaxY - fMinY < 5) {
    return null;
  }

  let polygon = extractBoundaryPolygon(labels, finalLabel, width, height, fMinX, fMinY, fMaxX, fMaxY);
  if (polygon.length < 3) {
    return null;
  }

  // Shape safety net (Fix flow only): if label notches still scar the outline,
  // the convex hull of the traced points is the clean block the chart shows.
  if (target) {
    const hull = convexHull(polygon);
    const hullArea = shoelaceArea(hull);
    if (hull.length >= 3 && hullArea > 0 && shoelaceArea(polygon) / hullArea < 0.82) {
      polygon = hull;
    }
  }

  const fillColor = rgbToHex(sumR / colorCount, sumG / colorCount, sumB / colorCount);
  return { polygon, fillColor, pixelArea: finalCount };
}

function shoelaceArea(points: PointPct[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    area += points[j].xPct * points[i].yPct - points[i].xPct * points[j].yPct;
  }
  return Math.abs(area) / 2;
}

/** Andrew's monotone-chain convex hull (counter-clockwise, no duplicates). */
function convexHull(points: PointPct[]): PointPct[] {
  if (points.length <= 3) {
    return [...points];
  }
  const pts = [...points].sort((a, b) => a.xPct - b.xPct || a.yPct - b.yPct);
  const cross = (o: PointPct, a: PointPct, b: PointPct): number =>
    (a.xPct - o.xPct) * (b.yPct - o.yPct) - (a.yPct - o.yPct) * (b.xPct - o.xPct);
  const lower: PointPct[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: PointPct[] = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
