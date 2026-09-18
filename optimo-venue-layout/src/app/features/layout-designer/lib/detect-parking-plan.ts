/**
 * Client-side parking-plan detection: given a plan image (grey lot on a light
 * background, bays drawn as white-outlined rectangles, optional "160.0 m" dimension
 * labels), detect the lot outline, the individual bays, and a real-world scale — so the
 * parking designer can auto-create the area, its edge measurements, and its slots.
 *
 * The stadium block detector (`detect-blocks.ts`) is unsuitable here — it rejects
 * regions larger than 8% of the image, and a parking lot IS the image. This detector
 * reuses the same primitives (`isBorderPixel`, `extractBoundaryPolygon`) with
 * parking-tuned thresholds. All core functions take a plain raster object so they are
 * unit-testable without DOM/ImageData; only `rasterizeParkingPlanFile` touches canvas.
 */

import { isBorderPixel } from './flood-fill';
import { closeMask } from './detect-blocks';
import { extractBoundaryPolygon, pointInPolygon, type PointPct } from './contour-geometry';
import type { OcrToken } from './assign-ocr-labels';
import type { ParkingSlotDefaults } from '../services/parking-slot-defaults.service';

export interface ParkingPlanRaster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface DetectedParkingBay {
  /** Centre in image-% (0–100). */
  cxPct: number;
  cyPct: number;
  /** Depth-axis angle in degrees (raster px space; long axis of the bay). */
  rotationDeg: number;
  /** Oriented extents in raster px — length along the depth axis, width across it. */
  lengthPx: number;
  widthPx: number;
  /** Traced cell boundary in image-% — lets non-rectangular bays keep their true shape. */
  polygonPct?: PointPct[];
}

export interface ParkingPlanDetection {
  widthPx: number;
  heightPx: number;
  /** Lot boundary in image-%, simplified to at most `MAX_OUTLINE_VERTICES` vertices. */
  outlinePct: PointPct[];
  bays: DetectedParkingBay[];
}

export interface ParkingDimensionLabel {
  valueM: number;
  xPct: number;
  yPct: number;
}

export interface ParkingPlanScale {
  /** Raster pixels per metre. */
  ppm: number;
  source: 'ocr' | 'bay-default';
}

export interface DetectedParkingSlotPlacement {
  /** Canvas-% (== image-%) centre. */
  xPct: number;
  yPct: number;
  rotationDeg: number;
  lengthM: number;
  widthM: number;
  /** Row cluster the bay belongs to — one lane letter per index. */
  laneIndex: number;
  /** Slot-local % polygon for non-rectangular cells (absent = rectangle). */
  shapePoints?: { xPct: number; yPct: number }[];
  /**
   * Real printed bookable code (e.g. "S27") when the placement came from an OCR code
   * token — used verbatim as the slot label instead of the auto-generated A1/B1 scheme.
   */
  label?: string;
  /** Lane-grouping key when known (the code's letter prefix); falls back to laneIndex. */
  laneKey?: string;
  /**
   * Printed code glyph height on the plan (metres). Used so canvas labels match the
   * uploaded image's naming size.
   */
  labelHeightM?: number;
}

/**
 * Vertex budget for the traced lot outline. Must be generous: a real lot is a rounded
 * rectangle with notched corners, bevels, and side-column bulges — 12 vertices (the old
 * budget) forces Visvalingam to eat genuine corners, which renders as diagonal cuts
 * slicing across the plan instead of following its boundary.
 */
const MAX_OUTLINE_VERTICES = 24;
/**
 * Smallest corner triangle (in %² of the image) the simplifier may keep once under the
 * vertex budget. The old value of 5 shaved legitimate rounded corners and notch steps
 * into diagonals; 1.2 keeps those while still dropping pixel-stair noise.
 */
const OUTLINE_MIN_TRIANGLE_PCT = 1.2;
/** Lot must cover a meaningful share of the plan, but not be the page background. */
const LOT_MIN_AREA_FRACTION = 0.08;
const LOT_MAX_AREA_FRACTION = 0.92;
const BAY_MIN_AREA_PX = 120;
const BAY_MAX_AREA_FRACTION = 0.015;
const BAY_MIN_ASPECT = 1.4;
const BAY_MAX_ASPECT = 3.5;
/**
 * Bounds for slot sizes measured off the plan's own geometry — wide enough to accept a
 * schematic plan drawn well off its printed scale, tight enough to reject a broken one.
 * Kept in sync with the constants of the same name in `detect-parking-ocr.ts`.
 */
const MEASURED_MIN_M = 0.5;
const MEASURED_MAX_M = 40;
/** Flood-fill colour tolerance (summed RGB distance from the region seed). */
const REGION_TOLERANCE = 60;

interface RegionStats {
  label: number;
  count: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumX: number;
  sumY: number;
  sumXX: number;
  sumYY: number;
  sumXY: number;
}

/**
 * Same border mask the stadium block detector (`detect-blocks.ts` `segmentFromImageData`)
 * builds: the base boundary rule PLUS a local colour-gradient pass — any pixel with a
 * sharp jump (summed RGB) to its right or bottom neighbour also counts as an edge. That
 * second pass is what gives the stadium detector crisp block outlines even where two
 * cells meet without a hard white/black line between them (soft shading, anti-aliasing,
 * a printed bay code sitting right at a cell's edge) — reused as-is here so parking bay
 * cells trace just as cleanly as stadium blocks do.
 */
export function computeBorderMask(
  raster: ParkingPlanRaster,
  isBoundary: (r: number, g: number, b: number, a: number) => boolean,
  useGradientPass = true,
): Uint8Array {
  const { data, width, height } = raster;
  const border = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const i = idx * 4;
      if (isBoundary(data[i], data[i + 1], data[i + 2], data[i + 3])) {
        border[idx] = 1;
      }
    }
  }
  if (!useGradientPass) {
    return border;
  }
  const EDGE_SUM = 60;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const idx = y * width + x;
      if (border[idx]) {
        continue;
      }
      const i = idx * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const rightI = (idx + 1) * 4;
      const downI = (idx + width) * 4;
      const dRight =
        Math.abs(r - data[rightI]) + Math.abs(g - data[rightI + 1]) + Math.abs(b - data[rightI + 2]);
      const dDown =
        Math.abs(r - data[downI]) + Math.abs(g - data[downI + 1]) + Math.abs(b - data[downI + 2]);
      if (dRight > EDGE_SUM || dDown > EDGE_SUM) {
        border[idx] = 1;
      }
    }
  }
  return border;
}

/**
 * Labels every non-border pixel into flood-filled regions (4-connected, colour
 * tolerance from each region's seed). Returns the label grid plus per-region stats
 * including second moments for orientation analysis.
 */
function segmentRegions(
  raster: ParkingPlanRaster,
  isBoundary: (r: number, g: number, b: number, a: number) => boolean = isBorderPixel,
  useGradientPass = true,
): { labels: Int32Array; regions: RegionStats[] } {
  const { data, width, height } = raster;
  const border = computeBorderMask(raster, isBoundary, useGradientPass);
  const labels = new Int32Array(width * height);
  const regions: RegionStats[] = [];
  let nextLabel = 1;
  const stack: number[] = [];

  for (let start = 0; start < width * height; start++) {
    if (labels[start] !== 0) {
      continue;
    }
    if (border[start]) {
      labels[start] = -1;
      continue;
    }
    const si = start * 4;
    const seedR = data[si];
    const seedG = data[si + 1];
    const seedB = data[si + 2];
    const label = nextLabel++;
    const region: RegionStats = {
      label,
      count: 0,
      minX: start % width,
      minY: Math.floor(start / width),
      maxX: start % width,
      maxY: Math.floor(start / width),
      sumX: 0,
      sumY: 0,
      sumXX: 0,
      sumYY: 0,
      sumXY: 0,
    };
    labels[start] = label;
    stack.length = 0;
    stack.push(start);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const cx = cur % width;
      const cy = (cur - cx) / width;
      region.count += 1;
      region.minX = Math.min(region.minX, cx);
      region.minY = Math.min(region.minY, cy);
      region.maxX = Math.max(region.maxX, cx);
      region.maxY = Math.max(region.maxY, cy);
      region.sumX += cx;
      region.sumY += cy;
      region.sumXX += cx * cx;
      region.sumYY += cy * cy;
      region.sumXY += cx * cy;

      const neighbors: number[] = [];
      if (cx > 0) neighbors.push(cur - 1);
      if (cx < width - 1) neighbors.push(cur + 1);
      if (cy > 0) neighbors.push(cur - width);
      if (cy < height - 1) neighbors.push(cur + width);
      for (const n of neighbors) {
        if (labels[n] !== 0) {
          continue;
        }
        if (border[n]) {
          labels[n] = -1;
          continue;
        }
        const ni = n * 4;
        const dist =
          Math.abs(seedR - data[ni]) + Math.abs(seedG - data[ni + 1]) + Math.abs(seedB - data[ni + 2]);
        if (dist > REGION_TOLERANCE) {
          continue;
        }
        labels[n] = label;
        stack.push(n);
      }
    }
    regions.push(region);
  }

  return { labels, regions };
}

/** Visvalingam simplification: drop the vertex forming the smallest triangle until under budget. */
function simplifyOutline(points: PointPct[], maxVertices: number, minTriangleAreaPct: number): PointPct[] {
  const pts = [...points];
  const triangleArea = (a: PointPct, b: PointPct, c: PointPct): number =>
    Math.abs((b.xPct - a.xPct) * (c.yPct - a.yPct) - (c.xPct - a.xPct) * (b.yPct - a.yPct)) / 2;
  while (pts.length > 3) {
    let smallest = Infinity;
    let smallestIdx = -1;
    for (let i = 0; i < pts.length; i++) {
      const area = triangleArea(
        pts[(i - 1 + pts.length) % pts.length],
        pts[i],
        pts[(i + 1) % pts.length],
      );
      if (area < smallest) {
        smallest = area;
        smallestIdx = i;
      }
    }
    if (pts.length <= maxVertices && smallest >= minTriangleAreaPct) {
      break;
    }
    pts.splice(smallestIdx, 1);
  }
  return pts;
}

/** Orientation + oriented extents of a region from its second moments (uniform-density model). */
function regionOrientation(region: RegionStats): { angleDeg: number; lengthPx: number; widthPx: number } {
  const n = region.count;
  const mx = region.sumX / n;
  const my = region.sumY / n;
  const cxx = region.sumXX / n - mx * mx;
  const cyy = region.sumYY / n - my * my;
  const cxy = region.sumXY / n - mx * my;
  const angleRad = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  // Eigenvalues of the 2x2 covariance matrix.
  const common = Math.sqrt(((cxx - cyy) / 2) ** 2 + cxy * cxy);
  const lambda1 = (cxx + cyy) / 2 + common;
  const lambda2 = Math.max(0, (cxx + cyy) / 2 - common);
  // For a uniform rectangle of half-extent a, variance = a²/3 → extent = 2·sqrt(3λ).
  return {
    angleDeg: (angleRad * 180) / Math.PI,
    lengthPx: 2 * Math.sqrt(3 * lambda1),
    widthPx: 2 * Math.sqrt(3 * Math.max(lambda2, 0.25)),
  };
}

interface LotMask {
  /** 1 = lot pixel, window-relative. */
  mask: Uint8Array;
  winX: number;
  winY: number;
  winW: number;
  winH: number;
}

/**
 * Solid lot mask: the aisle region PLUS every region enclosed within its window (bay
 * interiors, tree circles, …), morphologically closed so bay stripes/notches fuse into
 * one mass, then hole-filled. The traced boundary of this mask IS the lot shape — the
 * raw aisle region alone is a "fingers" shape (bay rows carve notches into it) that
 * simplifies into jagged spikes instead of the true outline.
 */
function buildLotMask(
  labels: Int32Array,
  regions: RegionStats[],
  lot: RegionStats,
  width: number,
  height: number,
): LotMask {
  const closeRadius = Math.max(4, Math.round(Math.min(width, height) * 0.015));
  const margin = closeRadius + 2;
  const winX = Math.max(0, lot.minX - margin);
  const winY = Math.max(0, lot.minY - margin);
  const winMaxX = Math.min(width - 1, lot.maxX + margin);
  const winMaxY = Math.min(height - 1, lot.maxY + margin);
  const winW = winMaxX - winX + 1;
  const winH = winMaxY - winY + 1;

  // Region labels whose bbox sits fully inside the lot window (and that aren't the page
  // background) get absorbed into the lot mass.
  const absorbed = new Set<number>([lot.label]);
  for (const region of regions) {
    if (
      region !== lot &&
      region.count < lot.count &&
      region.minX >= winX &&
      region.minY >= winY &&
      region.maxX <= winMaxX &&
      region.maxY <= winMaxY
    ) {
      absorbed.add(region.label);
    }
  }

  const mask = new Uint8Array(winW * winH);
  for (let y = winY; y <= winMaxY; y++) {
    for (let x = winX; x <= winMaxX; x++) {
      if (absorbed.has(labels[y * width + x])) {
        mask[(y - winY) * winW + (x - winX)] = 1;
      }
    }
  }

  const closed = closeMask(mask, winW, winH, closeRadius);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      closed[i] = 1; // closing must never lose original pixels
    }
  }

  // Hole fill: zeros unreachable from the window edge are enclosed (bay stripes, trees).
  const outside = new Uint8Array(winW * winH);
  const stack: number[] = [];
  for (let x = 0; x < winW; x++) {
    for (const idx of [x, (winH - 1) * winW + x]) {
      if (!closed[idx] && !outside[idx]) {
        outside[idx] = 1;
        stack.push(idx);
      }
    }
  }
  for (let y = 0; y < winH; y++) {
    for (const idx of [y * winW, y * winW + winW - 1]) {
      if (!closed[idx] && !outside[idx]) {
        outside[idx] = 1;
        stack.push(idx);
      }
    }
  }
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const cx = cur % winW;
    const cy = (cur - cx) / winW;
    const neighbors: number[] = [];
    if (cx > 0) neighbors.push(cur - 1);
    if (cx < winW - 1) neighbors.push(cur + 1);
    if (cy > 0) neighbors.push(cur - winW);
    if (cy < winH - 1) neighbors.push(cur + winW);
    for (const n of neighbors) {
      if (!closed[n] && !outside[n]) {
        outside[n] = 1;
        stack.push(n);
      }
    }
  }
  for (let i = 0; i < closed.length; i++) {
    if (!closed[i] && !outside[i]) {
      closed[i] = 1;
    }
  }

  return { mask: closed, winX, winY, winW, winH };
}

/** Sum-RGB distance below which a pixel counts as "the same colour as the page". */
const PAGE_BG_TOLERANCE = 120;

/**
 * 1 = page-background pixel: colour-similar to the image border's median colour AND
 * flood-connected to the border. Everything the plan actually draws (boundary strokes,
 * asphalt, stall strips, labels) is 0. Interior pockets that happen to be page-coloured
 * but are fully enclosed by ink also stay 0 — the flood cannot reach them.
 */
function computePageBackgroundMask(raster: ParkingPlanRaster): Uint8Array {
  const { data, width, height } = raster;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const pushPx = (x: number, y: number): void => {
    const i = (y * width + x) * 4;
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  };
  for (let x = 0; x < width; x++) {
    pushPx(x, 0);
    pushPx(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    pushPx(0, y);
    pushPx(width - 1, y);
  }
  const median = (arr: number[]): number => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const mr = median(rs);
  const mg = median(gs);
  const mb = median(bs);
  const isPage = (idx: number): boolean => {
    const i = idx * 4;
    return (
      Math.abs(data[i] - mr) + Math.abs(data[i + 1] - mg) + Math.abs(data[i + 2] - mb) <=
      PAGE_BG_TOLERANCE
    );
  };

  const bg = new Uint8Array(width * height);
  const stack: number[] = [];
  const seed = (idx: number): void => {
    if (!bg[idx] && isPage(idx)) {
      bg[idx] = 1;
      stack.push(idx);
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    if (cx > 0) seed(cur - 1);
    if (cx < width - 1) seed(cur + 1);
    if (cy > 0) seed(cur - width);
    if (cy < height - 1) seed(cur + width);
  }
  return bg;
}

/**
 * Lot outline traced from the plan's own drawing: the connected NON-page-background
 * mass containing the lot region, holes filled. The colour-region approach finds only
 * the asphalt — side stall strips, border walkways, the printed boundary stroke itself
 * are all different colours, so the traced block under-covers and then gets "repaired"
 * by growing crude rectangles around the codes (visible as bulges past the drawn
 * boundary and diagonal cuts across corners). The drawing's ink IS the boundary the
 * user sees, so trace exactly that. Returns null (caller falls back to the region
 * trace) when the picture doesn't behave like ink-on-page: the lot centroid sits on
 * page colour, the ink mass hits the area caps, or it fails to cover the lot region.
 */
function detectLotOutlineFromInk(
  raster: ParkingPlanRaster,
  labels: Int32Array,
  lot: RegionStats,
): PointPct[] | null {
  const { width, height } = raster;
  const bg = computePageBackgroundMask(raster);
  const seedX = Math.min(width - 1, Math.max(0, Math.round(lot.sumX / lot.count)));
  const seedY = Math.min(height - 1, Math.max(0, Math.round(lot.sumY / lot.count)));
  const seedIdx = seedY * width + seedX;
  if (bg[seedIdx]) {
    return null;
  }

  // Connected ink component containing the lot.
  const comp = new Int32Array(width * height);
  const stack: number[] = [seedIdx];
  comp[seedIdx] = 1;
  let compCount = 1;
  let minX = seedX;
  let minY = seedY;
  let maxX = seedX;
  let maxY = seedY;
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    const neighbors: number[] = [];
    if (cx > 0) neighbors.push(cur - 1);
    if (cx < width - 1) neighbors.push(cur + 1);
    if (cy > 0) neighbors.push(cur - width);
    if (cy < height - 1) neighbors.push(cur + width);
    for (const n of neighbors) {
      if (!bg[n] && comp[n] === 0) {
        comp[n] = 1;
        compCount++;
        const nx = n % width;
        const ny = (n - nx) / width;
        minX = Math.min(minX, nx);
        minY = Math.min(minY, ny);
        maxX = Math.max(maxX, nx);
        maxY = Math.max(maxY, ny);
        stack.push(n);
      }
    }
  }

  // Hole fill: non-component pixels unreachable from the image border are enclosed
  // (bay interiors, page-coloured courtyards) and belong to the block.
  const outside = new Uint8Array(width * height);
  stack.length = 0;
  const seedOutside = (idx: number): void => {
    if (!outside[idx] && comp[idx] === 0) {
      outside[idx] = 1;
      stack.push(idx);
    }
  };
  for (let x = 0; x < width; x++) {
    seedOutside(x);
    seedOutside((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seedOutside(y * width);
    seedOutside(y * width + width - 1);
  }
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    if (cx > 0) seedOutside(cur - 1);
    if (cx < width - 1) seedOutside(cur + 1);
    if (cy > 0) seedOutside(cur - width);
    if (cy < height - 1) seedOutside(cur + width);
  }
  for (let i = 0; i < comp.length; i++) {
    if (comp[i] === 0 && !outside[i]) {
      comp[i] = 1;
      compCount++;
    }
  }

  const fraction = compCount / (width * height);
  if (fraction < LOT_MIN_AREA_FRACTION || fraction > LOT_MAX_AREA_FRACTION) {
    return null;
  }
  // The ink mass must actually contain the colour-detected lot — otherwise the picture
  // isn't ink-on-page (dark theme, full-bleed photo) and the region trace knows better.
  let lotSampled = 0;
  let lotCovered = 0;
  for (let i = 0; i < labels.length; i += 2) {
    if (labels[i] === lot.label) {
      lotSampled++;
      if (comp[i] === 1) {
        lotCovered++;
      }
    }
  }
  if (lotSampled === 0 || lotCovered / lotSampled < 0.9) {
    return null;
  }

  const traced = extractBoundaryPolygon(comp, 1, width, height, minX, minY, maxX, maxY);
  if (traced.length < 3) {
    return null;
  }
  return simplifyOutline(traced, MAX_OUTLINE_VERTICES, OUTLINE_MIN_TRIANGLE_PCT);
}

function maskAtPct(lotMask: LotMask, xPct: number, yPct: number, width: number, height: number): boolean {
  const x = Math.round((xPct / 100) * width) - lotMask.winX;
  const y = Math.round((yPct / 100) * height) - lotMask.winY;
  if (x < 0 || y < 0 || x >= lotMask.winW || y >= lotMask.winH) {
    return false;
  }
  return lotMask.mask[y * lotMask.winW + x] === 1;
}

function shoelaceAreaPct(points: PointPct[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    area += points[j].xPct * points[i].yPct - points[i].xPct * points[j].yPct;
  }
  return Math.abs(area) / 2;
}

/** Andrew's monotone-chain convex hull. */
function convexHullPct(points: PointPct[]): PointPct[] {
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

/** Circular mean of orientations that are equivalent mod 180° (line directions). */
function meanLineAngleDeg(angles: number[]): number {
  let sumSin = 0;
  let sumCos = 0;
  for (const a of angles) {
    const rad = (a * Math.PI) / 90; // double the angle so 0° ≡ 180°
    sumSin += Math.sin(rad);
    sumCos += Math.cos(rad);
  }
  return (Math.atan2(sumSin, sumCos) * 90) / Math.PI;
}

interface StripeStats {
  cx: number;
  cy: number;
  angleDeg: number;
  lengthPx: number;
}

/**
 * Bays drawn as OPEN white divider stripes (no closed box): find thin elongated white
 * components inside the lot, group parallel colinear stripes into rows, and emit one
 * bay per gap between consecutive stripes.
 */
function detectStripeBays(
  raster: ParkingPlanRaster,
  lotMask: LotMask,
): DetectedParkingBay[] {
  const { data, width, height } = raster;
  const { winX, winY, winW, winH } = lotMask;
  const isWhiteInLot = (x: number, y: number): boolean => {
    if (!lotMask.mask[(y - winY) * winW + (x - winX)]) {
      return false;
    }
    const i = (y * width + x) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    return l > 200 && chroma < 45;
  };

  // Label thin white components (8-connected) within the lot window.
  const labels = new Int32Array(winW * winH);
  const stripes: StripeStats[] = [];
  let nextLabel = 1;
  const stack: number[] = [];
  const maxStripeLen = Math.min(width, height) * 0.2;
  for (let wy = 0; wy < winH; wy++) {
    for (let wx = 0; wx < winW; wx++) {
      const idx = wy * winW + wx;
      if (labels[idx] !== 0 || !isWhiteInLot(wx + winX, wy + winY)) {
        continue;
      }
      const label = nextLabel++;
      labels[idx] = label;
      stack.length = 0;
      stack.push(idx);
      let count = 0;
      let sumX = 0;
      let sumY = 0;
      let sumXX = 0;
      let sumYY = 0;
      let sumXY = 0;
      while (stack.length > 0) {
        const cur = stack.pop()!;
        const cx = cur % winW;
        const cy = (cur - cx) / winW;
        count += 1;
        sumX += cx;
        sumY += cy;
        sumXX += cx * cx;
        sumYY += cy * cy;
        sumXY += cx * cy;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= winW || ny >= winH) {
              continue;
            }
            const nIdx = ny * winW + nx;
            if (labels[nIdx] === 0 && isWhiteInLot(nx + winX, ny + winY)) {
              labels[nIdx] = label;
              stack.push(nIdx);
            }
          }
        }
      }
      if (count < 8) {
        continue;
      }
      const region: RegionStats = {
        label,
        count,
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0,
        sumX,
        sumY,
        sumXX,
        sumYY,
        sumXY,
      };
      const { angleDeg, lengthPx, widthPx } = regionOrientation(region);
      if (lengthPx < 8 || lengthPx > maxStripeLen || widthPx > 6 || lengthPx / Math.max(1, widthPx) < 3) {
        continue;
      }
      stripes.push({
        cx: sumX / count + winX,
        cy: sumY / count + winY,
        angleDeg,
        lengthPx,
      });
    }
  }
  if (stripes.length < 4) {
    return [];
  }

  // Union-find rows: parallel stripes whose centres sit on one line perpendicular to
  // the stripe direction, within a plausible pitch of each other.
  const parent = stripes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const angleDiff = (a: number, b: number): number => {
    const d = Math.abs(a - b) % 180;
    return d > 90 ? 180 - d : d;
  };
  for (let i = 0; i < stripes.length; i++) {
    for (let j = i + 1; j < stripes.length; j++) {
      if (angleDiff(stripes[i].angleDeg, stripes[j].angleDeg) > 10) {
        continue;
      }
      const rad = (stripes[i].angleDeg * Math.PI) / 180;
      const ux = Math.cos(rad); // stripe/depth axis
      const uy = Math.sin(rad);
      const dx = stripes[j].cx - stripes[i].cx;
      const dy = stripes[j].cy - stripes[i].cy;
      const alongDepth = Math.abs(dx * ux + dy * uy);
      const alongRow = Math.abs(-dx * uy + dy * ux);
      const len = Math.max(stripes[i].lengthPx, stripes[j].lengthPx);
      if (alongDepth <= len * 0.45 && alongRow <= len * 1.6) {
        parent[find(i)] = find(j);
      }
    }
  }
  const rows = new Map<number, number[]>();
  for (let i = 0; i < stripes.length; i++) {
    const root = find(i);
    const list = rows.get(root);
    if (list) {
      list.push(i);
    } else {
      rows.set(root, [i]);
    }
  }

  const bays: DetectedParkingBay[] = [];
  for (const row of rows.values()) {
    if (row.length < 4) {
      continue; // too few dividers to be a real bay row
    }
    const rowAngle = meanLineAngleDeg(row.map((i) => stripes[i].angleDeg));
    const rad = (rowAngle * Math.PI) / 180;
    const rowUx = -Math.sin(rad); // direction along the row
    const rowUy = Math.cos(rad);
    const sorted = [...row].sort(
      (a, b) =>
        stripes[a].cx * rowUx + stripes[a].cy * rowUy - (stripes[b].cx * rowUx + stripes[b].cy * rowUy),
    );
    const gaps: number[] = [];
    for (let k = 0; k < sorted.length - 1; k++) {
      const a = stripes[sorted[k]];
      const b = stripes[sorted[k + 1]];
      gaps.push(Math.hypot(b.cx - a.cx, b.cy - a.cy));
    }
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
    for (let k = 0; k < sorted.length - 1; k++) {
      if (gaps[k] < medianGap * 0.55 || gaps[k] > medianGap * 1.8) {
        continue; // aisle break or double-marked line — not a bay
      }
      const a = stripes[sorted[k]];
      const b = stripes[sorted[k + 1]];
      const cx = (a.cx + b.cx) / 2;
      const cy = (a.cy + b.cy) / 2;
      bays.push({
        cxPct: (cx / width) * 100,
        cyPct: (cy / height) * 100,
        rotationDeg: rowAngle,
        lengthPx: (a.lengthPx + b.lengthPx) / 2,
        widthPx: gaps[k],
      });
    }
  }
  return bays;
}

function segmentsProperlyIntersect(
  a1: { xPct: number; yPct: number },
  a2: { xPct: number; yPct: number },
  b1: { xPct: number; yPct: number },
  b2: { xPct: number; yPct: number },
): boolean {
  const cross = (o: typeof a1, p: typeof a1, q: typeof a1) =>
    (p.xPct - o.xPct) * (q.yPct - o.yPct) - (p.yPct - o.yPct) * (q.xPct - o.xPct);
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  return (d1 > 0 !== d2 > 0) && (d3 > 0 !== d4 > 0) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

/**
 * A self-intersecting (bowtie) outline renders with an unfilled "hole" under the SVG
 * default (nonzero) fill rule even though ray-cast containment tests still say points
 * in that hole are "inside" — exactly the bug where slots render but the block behind
 * them doesn't. Checks only non-adjacent edge pairs (adjacent edges share a vertex by
 * construction and would always "touch" there).
 */
export function polygonSelfIntersects(poly: PointPct[]): boolean {
  const n = poly.length;
  if (n < 4) {
    return false;
  }
  for (let i = 0; i < n; i++) {
    const a1 = poly[i];
    const a2 = poly[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) {
        continue; // adjacent edges share vertex a2/b1 — not a real crossing
      }
      const b1 = poly[j];
      const b2 = poly[(j + 1) % n];
      if (segmentsProperlyIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }
  return false;
}

/** Fills a %-space polygon into a small raster mask via a scanline (even-odd) rule. */
function rasterizePolygonPctInto(mask: Uint8Array, w: number, h: number, poly: { xPct: number; yPct: number }[]): void {
  if (poly.length < 3) {
    return;
  }
  const ys = poly.map((p) => (p.yPct / 100) * h);
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  for (let y = minY; y <= maxY; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i++) {
      const yi = (poly[i].yPct / 100) * h;
      const yj = (poly[j].yPct / 100) * h;
      if (yi === yj || yc < Math.min(yi, yj) || yc >= Math.max(yi, yj)) {
        continue;
      }
      const xi = (poly[i].xPct / 100) * w;
      const xj = (poly[j].xPct / 100) * w;
      xs.push(xi + ((yc - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xStart = Math.max(0, Math.round(xs[k]));
      const xEnd = Math.min(w - 1, Math.round(xs[k + 1]) - 1);
      for (let x = xStart; x <= xEnd; x++) {
        mask[y * w + x] = 1;
      }
    }
  }
}

/** 4 corners of a bay's own oriented rectangle, in image-%, padded outward by `padPx`. */
function bayCornersPct(
  bay: DetectedParkingBay,
  imageWidthPx: number,
  imageHeightPx: number,
  padPx: number,
): { xPct: number; yPct: number }[] {
  const rad = (bay.rotationDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const hl = bay.lengthPx / 2 + padPx;
  const hw = bay.widthPx / 2 + padPx;
  const cx = (bay.cxPct / 100) * imageWidthPx;
  const cy = (bay.cyPct / 100) * imageHeightPx;
  return [
    { x: cx + ux * hl - uy * hw, y: cy + uy * hl + ux * hw },
    { x: cx + ux * hl + uy * hw, y: cy + uy * hl - ux * hw },
    { x: cx - ux * hl + uy * hw, y: cy - uy * hl - ux * hw },
    { x: cx - ux * hl - uy * hw, y: cy - uy * hl + ux * hw },
  ].map((p) => ({ xPct: (p.x / imageWidthPx) * 100, yPct: (p.y / imageHeightPx) * 100 }));
}

/**
 * The area block must always come first and must actually contain the detected slots.
 * When the traced lot outline fails that (degenerate mask, leak, or excludes a cluster
 * of bays — e.g. a narrow side column of stalls that didn't fuse into the main lot
 * mask), the block is repaired by UNIONING the existing outline with a small rect
 * around every bay, then re-tracing the result. This pulls in outlier clusters as
 * local bulges while preserving the outline's real notches/concavities elsewhere — a
 * plain convex hull of every bay (the previous approach) discards genuine concave
 * shapes (an L-shaped lot, a beveled exit corner) for a crude, oversized polygon.
 */
/** Padded convex hull of every bay rectangle — guaranteed to contain every bay by construction. */
function hullOutlineFromBays(
  bays: DetectedParkingBay[],
  imageWidthPx: number,
  imageHeightPx: number,
): PointPct[] {
  const cornersPx: { x: number; y: number }[] = [];
  for (const bay of bays) {
    const rad = (bay.rotationDeg * Math.PI) / 180;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);
    const hl = bay.lengthPx / 2;
    const hw = bay.widthPx / 2;
    const cx = (bay.cxPct / 100) * imageWidthPx;
    const cy = (bay.cyPct / 100) * imageHeightPx;
    cornersPx.push(
      { x: cx + ux * hl - uy * hw, y: cy + uy * hl + ux * hw },
      { x: cx + ux * hl + uy * hw, y: cy + uy * hl - ux * hw },
      { x: cx - ux * hl + uy * hw, y: cy - uy * hl - ux * hw },
      { x: cx - ux * hl - uy * hw, y: cy - uy * hl + ux * hw },
    );
  }
  const hull = convexHullPct(
    cornersPx.map((p) => ({ xPct: (p.x / imageWidthPx) * 100, yPct: (p.y / imageHeightPx) * 100 })),
  );
  if (hull.length < 3) {
    return [];
  }
  const lens = bays.map((b) => b.lengthPx).sort((a, b) => a - b);
  const padPx = lens[Math.floor(lens.length / 2)] * 0.6;
  const hullPx = hull.map((p) => ({ x: (p.xPct / 100) * imageWidthPx, y: (p.yPct / 100) * imageHeightPx }));
  const centroidX = hullPx.reduce((s, p) => s + p.x, 0) / hullPx.length;
  const centroidY = hullPx.reduce((s, p) => s + p.y, 0) / hullPx.length;
  const padded = hullPx.map((p) => {
    const dx = p.x - centroidX;
    const dy = p.y - centroidY;
    const dist = Math.hypot(dx, dy) || 1;
    return {
      xPct: (Math.min(imageWidthPx, Math.max(0, p.x + (dx / dist) * padPx)) / imageWidthPx) * 100,
      yPct: (Math.min(imageHeightPx, Math.max(0, p.y + (dy / dist) * padPx)) / imageHeightPx) * 100,
    };
  });
  return simplifyOutline(padded, MAX_OUTLINE_VERTICES, 5);
}

export function ensureOutlineContainsBays(
  outlinePct: PointPct[],
  bays: DetectedParkingBay[],
  imageWidthPx: number,
  imageHeightPx: number,
  /**
   * When supplied, growth is clipped to the plan's drawing: padding halo that lands on
   * page background gets trimmed, so a repair can never bulge past the printed boundary.
   * The base outline's own footprint and the (unpadded) bay rects are never trimmed.
   */
  raster?: ParkingPlanRaster,
): PointPct[] {
  if (bays.length < 8) {
    return outlinePct;
  }
  const insideCount = bays.filter((b) => pointInPolygon(b.cxPct, b.cyPct, outlinePct)).length;
  const hasBaseOutline = outlinePct.length >= 3 && !polygonSelfIntersects(outlinePct);
  if (hasBaseOutline && insideCount / bays.length >= 0.97) {
    return outlinePct;
  }

  // No real traced shape to preserve — the best available approximation is a hull of
  // every bay, which is at least guaranteed to actually contain all of them (a mask
  // union has no "anchor" region to grow from here, and bays that don't happen to
  // touch each other would otherwise be scattered, disconnected islands).
  if (!hasBaseOutline) {
    const hull = hullOutlineFromBays(bays, imageWidthPx, imageHeightPx);
    return hull.length >= 3 ? hull : outlinePct;
  }

  // Has a real traced shape: union it with padded bay rects and re-trace. This pulls in
  // outlier clusters (e.g. a narrow side column that never fused into the main lot mask)
  // as local bulges while preserving genuine concavities/notches elsewhere — a plain
  // hull of every bay would discard those (an L-shaped lot, a beveled exit corner) for
  // a crude, oversized polygon.
  const lens = bays.map((b) => b.lengthPx).sort((a, b) => a - b);
  const padPx = lens[Math.floor(lens.length / 2)] * 0.55;

  const maskW = 320;
  const maskH = Math.max(1, Math.round((imageHeightPx / imageWidthPx) * maskW));
  const mask = new Uint8Array(maskW * maskH);
  rasterizePolygonPctInto(mask, maskW, maskH, outlinePct);
  // Footprints that must survive the page-background clip below: the real traced shape,
  // and each bay's own (unpadded) cell.
  const baseMask = mask.slice();
  const coreMask = new Uint8Array(maskW * maskH);
  // Remember one pixel guaranteed to be inside the base outline's own footprint, so the
  // component that contains it — not just "whichever component happens to be biggest"
  // — is the one kept; the real traced shape must never lose to a large bay cluster.
  const anchorCentroid = outlinePct.reduce(
    (acc, p) => ({ xPct: acc.xPct + p.xPct / outlinePct.length, yPct: acc.yPct + p.yPct / outlinePct.length }),
    { xPct: 0, yPct: 0 },
  );
  const anchorX = Math.min(maskW - 1, Math.max(0, Math.round((anchorCentroid.xPct / 100) * maskW)));
  const anchorY = Math.min(maskH - 1, Math.max(0, Math.round((anchorCentroid.yPct / 100) * maskH)));

  for (const bay of bays) {
    rasterizePolygonPctInto(mask, maskW, maskH, bayCornersPct(bay, imageWidthPx, imageHeightPx, padPx));
    rasterizePolygonPctInto(coreMask, maskW, maskH, bayCornersPct(bay, imageWidthPx, imageHeightPx, 0));
  }

  // Fuse nearby bulges / smooth the union — NOT a hole-fill, so real notches survive.
  const closeRadius = Math.max(1, Math.round(maskW * 0.012));
  const closed = closeMask(mask, maskW, maskH, closeRadius);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      closed[i] = 1; // closing must never lose original coverage
    }
  }

  // Clip the padding halo to the plan's drawing: halo cells sitting on page background
  // are outside the printed boundary — trimming them stops the repair bulging past it.
  if (raster) {
    const bg = computePageBackgroundMask(raster);
    for (let y = 0; y < maskH; y++) {
      for (let x = 0; x < maskW; x++) {
        const i = y * maskW + x;
        if (!closed[i] || baseMask[i] || coreMask[i]) {
          continue;
        }
        const rx = Math.min(raster.width - 1, Math.round(((x + 0.5) / maskW) * raster.width));
        const ry = Math.min(raster.height - 1, Math.round(((y + 0.5) / maskH) * raster.height));
        if (bg[ry * raster.width + rx]) {
          closed[i] = 0;
        }
      }
    }
  }

  // 4-connected flood fill over the small mask to find every component.
  const compLabels = new Int32Array(maskW * maskH);
  let nextLabel = 1;
  const stack: number[] = [];
  for (let start = 0; start < maskW * maskH; start++) {
    if (!closed[start] || compLabels[start] !== 0) {
      continue;
    }
    const label = nextLabel++;
    compLabels[start] = label;
    stack.length = 0;
    stack.push(start);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const cx = cur % maskW;
      const cy = (cur - cx) / maskW;
      const neighbors: number[] = [];
      if (cx > 0) neighbors.push(cur - 1);
      if (cx < maskW - 1) neighbors.push(cur + 1);
      if (cy > 0) neighbors.push(cur - maskW);
      if (cy < maskH - 1) neighbors.push(cur + maskW);
      for (const n of neighbors) {
        if (closed[n] && compLabels[n] === 0) {
          compLabels[n] = label;
          stack.push(n);
        }
      }
    }
  }

  // Anchor pixel might land just outside the mask footprint at low resolution — widen
  // the search ring by ring until a labelled pixel is found.
  let anchorLabel = 0;
  for (let r = 0; r <= Math.max(maskW, maskH) && anchorLabel === 0; r++) {
    for (let dy = -r; dy <= r && anchorLabel === 0; dy++) {
      for (let dx = -r; dx <= r && anchorLabel === 0; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) {
          continue;
        }
        const x = anchorX + dx;
        const y = anchorY + dy;
        if (x < 0 || y < 0 || x >= maskW || y >= maskH) {
          continue;
        }
        const label = compLabels[y * maskW + x];
        if (label !== 0) {
          anchorLabel = label;
        }
      }
    }
  }
  if (anchorLabel === 0) {
    const hull = hullOutlineFromBays(bays, imageWidthPx, imageHeightPx);
    return hull.length >= 3 ? hull : outlinePct;
  }

  let minX = maskW;
  let minY = maskH;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < maskH; y++) {
    for (let x = 0; x < maskW; x++) {
      if (compLabels[y * maskW + x] !== anchorLabel) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const traced = extractBoundaryPolygon(compLabels, anchorLabel, maskW, maskH, minX, minY, maxX, maxY);
  if (traced.length < 3) {
    const hull = hullOutlineFromBays(bays, imageWidthPx, imageHeightPx);
    return hull.length >= 3 ? hull : outlinePct;
  }
  let repaired = simplifyOutline(traced, MAX_OUTLINE_VERTICES, OUTLINE_MIN_TRIANGLE_PCT);
  if (polygonSelfIntersects(repaired)) {
    repaired = simplifyOutline(convexHullPct(repaired), MAX_OUTLINE_VERTICES, 5);
  }
  // The base outline may itself have been unrelated garbage (or too small/oddly placed
  // to ever fuse with the bay cluster even after padding) — if the anchored component
  // still doesn't actually cover the bays, a hull of the bays themselves is strictly
  // more useful than a "repaired" shape built around the wrong anchor.
  const repairedInside = bays.filter((b) => pointInPolygon(b.cxPct, b.cyPct, repaired)).length;
  if (repairedInside / bays.length < 0.9) {
    const hull = hullOutlineFromBays(bays, imageWidthPx, imageHeightPx);
    return hull.length >= 3 ? hull : repaired;
  }
  return repaired;
}

/** Traced boundary of one bay region (image-%), trimmed to a small vertex budget. */
function bayPolygonPct(
  labels: Int32Array,
  region: RegionStats,
  width: number,
  height: number,
): PointPct[] | undefined {
  const poly = extractBoundaryPolygon(
    labels,
    region.label,
    width,
    height,
    region.minX,
    region.minY,
    region.maxX,
    region.maxY,
  );
  if (poly.length < 3) {
    return undefined;
  }
  return simplifyOutline(poly, 8, 0);
}

/**
 * Traces the drawn stall cell UNDER each given point (image-%) — no lot gate, no
 * dominant-size-cluster filter. The main bay pass only keeps cells inside the asphalt
 * colour-region at the plan's dominant cell size, which drops legitimate side columns
 * (drawn on a border strip, at their own smaller size — the T-column case); a printed
 * code is proof its stall exists at that exact spot, so the cell under it is read
 * directly. Points whose region doesn't look like a cell (open aisle, page) get null.
 *
 * `hPct` (the code's glyph height) distinguishes a stall's label CHIP — a small badge
 * drawn around the code, barely bigger than the text — from the stall cell itself: when
 * the point lands on a chip, the cell is the surrounding region that CONTAINS the
 * chip's bounding box.
 */
export function detectCellsAtPoints(
  rawRaster: ParkingPlanRaster,
  points: { xPct: number; yPct: number; hPct?: number }[],
): (DetectedParkingBay | null)[] {
  const raster = normalizeForDetection(rawRaster);
  const { width, height } = raster;
  const totalPx = width * height;
  if (totalPx < 10_000 || points.length === 0) {
    return points.map(() => null);
  }
  // Same gradient-enhanced segmentation as the main bay pass — crisp cell separation.
  const { labels, regions } = segmentRegions(raster, isBorderPixel, true);
  const regionByLabel = new Map<number, RegionStats>();
  for (const region of regions) {
    regionByLabel.set(region.label, region);
  }
  const maxAreaPx = totalPx * BAY_MAX_AREA_FRACTION * 3;

  /** Region at (px, py), spiralling out a few pixels to step off text ink / cell lines. */
  const regionAt = (px: number, py: number): RegionStats | null => {
    for (let r = 0; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) {
            continue;
          }
          const x = px + dx;
          const y = py + dy;
          if (x < 0 || y < 0 || x >= width || y >= height) {
            continue;
          }
          const region = regionByLabel.get(labels[y * width + x]);
          if (region) {
            return region;
          }
        }
      }
    }
    return null;
  };

  const plausibleCell = (region: RegionStats): boolean => {
    if (region.count < BAY_MIN_AREA_PX || region.count > maxAreaPx) {
      return false;
    }
    const { lengthPx, widthPx } = regionOrientation(region);
    if (widthPx < 4) {
      return false;
    }
    // Cells are solid-ish; rules out lines, rings, and scattered fragments.
    return region.count / Math.max(1, lengthPx * widthPx) >= 0.5;
  };

  const toBay = (region: RegionStats): DetectedParkingBay => {
    const { angleDeg, lengthPx, widthPx } = regionOrientation(region);
    return {
      cxPct: (region.sumX / region.count / width) * 100,
      cyPct: (region.sumY / region.count / height) * 100,
      rotationDeg: angleDeg,
      lengthPx,
      widthPx,
      polygonPct: bayPolygonPct(labels, region, width, height),
    };
  };

  return points.map((p) => {
    const px = Math.min(width - 1, Math.max(0, Math.round((p.xPct / 100) * width)));
    const py = Math.min(height - 1, Math.max(0, Math.round((p.yPct / 100) * height)));
    const inner = regionAt(px, py);
    if (!inner) {
      return null;
    }
    // Chip-sized region (a label badge, barely bigger than the glyphs) → climb to the
    // surrounding cell. A full-size region is taken as-is — never climbed, so a cell
    // inside a bigger strip band cannot be replaced by the band.
    const glyphPx = Math.max(4, ((p.hPct ?? 2) / 100) * height);
    const chipLike =
      inner.maxX - inner.minX <= glyphPx * 4 && inner.maxY - inner.minY <= glyphPx * 4;
    if (chipLike) {
      const midX = Math.round((inner.minX + inner.maxX) / 2);
      const midY = Math.round((inner.minY + inner.maxY) / 2);
      const probes: [number, number][] = [
        [inner.minX - 2, midY],
        [inner.maxX + 2, midY],
        [midX, inner.minY - 2],
        [midX, inner.maxY + 2],
      ];
      let best: RegionStats | null = null;
      for (const [qx, qy] of probes) {
        if (qx < 0 || qy < 0 || qx >= width || qy >= height) {
          continue;
        }
        const outer = regionByLabel.get(labels[qy * width + qx]);
        if (
          outer &&
          outer !== inner &&
          plausibleCell(outer) &&
          outer.minX <= inner.minX + 1 &&
          outer.minY <= inner.minY + 1 &&
          outer.maxX >= inner.maxX - 1 &&
          outer.maxY >= inner.maxY - 1 &&
          (!best || outer.count < best.count)
        ) {
          best = outer; // smallest containing region = the cell, not a whole strip band
        }
      }
      if (best) {
        return toBay(best);
      }
    }
    return plausibleCell(inner) ? toBay(inner) : null;
  });
}

/**
 * Otsu's method: the luminance cutoff that best splits the image's own tonal
 * distribution into two classes (maximises between-class variance). A FIXED cutoff
 * (e.g. "140") only works for images whose lines/background happen to land on the
 * right side of that one number — a plan drawn in medium-contrast tones (a tan/gold
 * bay fill on a medium-gray lot, say) can sit right on top of a fixed guess. Deriving
 * the cutoff from the actual image adapts to whatever two tones that specific plan
 * uses, without needing a new hand-picked constant per colour scheme.
 */
function otsuLuminanceThreshold(raster: ParkingPlanRaster, fallback = 140): number {
  const { data, width, height } = raster;
  const hist = new Array<number>(256).fill(0);
  const stepX = Math.max(1, Math.floor(width / 200));
  const stepY = Math.max(1, Math.floor(height / 200));
  let total = 0;
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 100) {
        continue;
      }
      const l = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      hist[Math.min(255, Math.max(0, l))] += 1;
      total += 1;
    }
  }
  if (total === 0) {
    return fallback;
  }
  let sumAll = 0;
  for (let t = 0; t < 256; t++) {
    sumAll += t * hist[t];
  }
  let sumB = 0;
  let weightB = 0;
  let bestThreshold = fallback;
  let bestVariance = -1;
  for (let t = 0; t < 256; t++) {
    weightB += hist[t];
    if (weightB === 0) {
      continue;
    }
    const weightF = total - weightB;
    if (weightF === 0) {
      break;
    }
    sumB += t * hist[t];
    const meanB = sumB / weightB;
    const meanF = (sumAll - sumB) / weightF;
    const between = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (between > bestVariance) {
      bestVariance = between;
      bestThreshold = t;
    }
  }
  return bestThreshold;
}

/** Dark drawing lines only — the boundary rule for line-art plans, cutoff from `otsuLuminanceThreshold`. */
function makeIsDarkLinePixel(threshold: number): (r: number, g: number, b: number, a: number) => boolean {
  return (r, g, b, a) => {
    if (a < 100) {
      return true;
    }
    return 0.299 * r + 0.587 * g + 0.114 * b < threshold;
  };
}

/**
 * Real bay rows sit on one of two perpendicular axes — the main rows, plus any side
 * column turned 90° to hug a perimeter wall. Stray candidates from unrelated glyphs
 * (curved traffic-flow arrows, angled legend text, dimension arrowheads) land at
 * essentially random angles instead. Voting for the dominant angle mod 90° (so a
 * perpendicular side column counts as the same "grid family" as the main rows) and
 * dropping anything far from every voted axis clears those false positives — visible in
 * a real plan as isolated diagonal slots scattered among otherwise-neat rows — without
 * disturbing genuine perpendicular side columns.
 */
export function filterOrientationOutliers<T extends { rotationDeg: number }>(
  candidates: T[],
  toleranceDeg = 14,
): T[] {
  if (candidates.length < 8) {
    return candidates;
  }
  const BUCKET = 5;
  const BUCKET_COUNT = 90 / BUCKET;
  const votes = new Array<number>(BUCKET_COUNT).fill(0);
  for (const c of candidates) {
    const mod = ((c.rotationDeg % 90) + 90) % 90;
    votes[Math.round(mod / BUCKET) % BUCKET_COUNT] += 1;
  }
  let dominantBucket = 0;
  let best = -1;
  for (let i = 0; i < BUCKET_COUNT; i++) {
    if (votes[i] > best) {
      best = votes[i];
      dominantBucket = i;
    }
  }
  const dominantMod = dominantBucket * BUCKET;
  const filtered = candidates.filter((c) => {
    const mod = ((c.rotationDeg % 90) + 90) % 90;
    const diff = Math.min(Math.abs(mod - dominantMod), 90 - Math.abs(mod - dominantMod));
    return diff <= toleranceDeg;
  });
  return filtered.length >= 8 ? filtered : candidates;
}

/**
 * Collapses near-duplicate candidates that are almost certainly split fragments of the
 * same physical bay (a printed bay code or a faint line cutting one cell's flood-filled
 * region into two adjacent blobs) — keeps the larger of any pair whose centres sit
 * closer than 60% of the smaller one's own width. Left unchecked, split fragments double
 * up as two overlapping slots at render time.
 */
export function dedupeCloseCandidates<T extends { cxPct: number; cyPct: number; widthPx: number; areaPx: number }>(
  candidates: T[],
  imageWidthPx: number,
  imageHeightPx: number,
): T[] {
  const sorted = [...candidates].sort((a, b) => b.areaPx - a.areaPx);
  const kept: T[] = [];
  for (const c of sorted) {
    const cx = (c.cxPct / 100) * imageWidthPx;
    const cy = (c.cyPct / 100) * imageHeightPx;
    const tooClose = kept.some((k) => {
      const kx = (k.cxPct / 100) * imageWidthPx;
      const ky = (k.cyPct / 100) * imageHeightPx;
      return Math.hypot(cx - kx, cy - ky) < Math.min(c.widthPx, k.widthPx) * 0.6;
    });
    if (!tooClose) {
      kept.push(c);
    }
  }
  return kept;
}

/**
 * Fallback for LINE-DRAWING plans (white background, black outlines, no filled lot —
 * e.g. a CAD-style "VIP parking" sheet): there is no gray region to trace, but every
 * bay is a closed white cell between dark lines. Detect those cells directly, then
 * build the block as the padded hull of the bays (`ensureOutlineContainsBays`).
 */
function detectLineArtPlan(raster: ParkingPlanRaster): ParkingPlanDetection | null {
  const { width, height } = raster;
  const totalPx = width * height;
  const isDarkLinePixel = makeIsDarkLinePixel(otsuLuminanceThreshold(raster));
  const { labels, regions } = segmentRegions(raster, isDarkLinePixel);

  const candidates: (DetectedParkingBay & { areaPx: number })[] = [];
  const bayMaxAreaPx = totalPx * BAY_MAX_AREA_FRACTION;
  for (const region of regions) {
    if (region.count < BAY_MIN_AREA_PX || region.count > bayMaxAreaPx) {
      continue;
    }
    const { angleDeg, lengthPx, widthPx } = regionOrientation(region);
    if (widthPx < 4) {
      continue;
    }
    const aspect = lengthPx / Math.max(1, widthPx);
    if (aspect < BAY_MIN_ASPECT || aspect > BAY_MAX_ASPECT) {
      continue;
    }
    // Slightly looser than the filled-lot path — the bay code ("A10") printed inside
    // the cell eats a few percent of its area.
    const fillRatio = region.count / Math.max(1, lengthPx * widthPx);
    if (fillRatio < 0.55) {
      continue;
    }
    candidates.push({
      cxPct: (region.sumX / region.count / width) * 100,
      cyPct: (region.sumY / region.count / height) * 100,
      rotationDeg: angleDeg,
      lengthPx,
      widthPx,
      polygonPct: bayPolygonPct(labels, region, width, height),
      areaPx: region.count,
    });
  }
  if (candidates.length < 8) {
    return null;
  }
  const cleaned = dedupeCloseCandidates(filterOrientationOutliers(candidates), width, height);

  const sortedAreas = cleaned.map((c) => c.areaPx).sort((a, b) => a - b);
  const medianArea = sortedAreas[Math.floor(sortedAreas.length / 2)];
  const sortedWidths = cleaned.map((c) => c.widthPx).sort((a, b) => a - b);
  const medianWidth = sortedWidths[Math.floor(sortedWidths.length / 2)];
  const bays = cleaned
    .filter(
      (c) =>
        c.areaPx >= medianArea * 0.45 &&
        c.areaPx <= medianArea * 2.2 &&
        c.widthPx >= medianWidth * 0.55 &&
        c.widthPx <= medianWidth * 1.8,
    )
    .map(({ areaPx: _areaPx, ...bay }) => bay);
  if (bays.length < 8) {
    return null;
  }

  const outlinePct = ensureOutlineContainsBays([], bays, width, height);
  if (outlinePct.length < 3) {
    return null;
  }
  return { widthPx: width, heightPx: height, outlinePct, bays };
}

/**
 * Detects the lot outline and the individual bays. Bays are found two ways and merged:
 * closed white-outlined boxes (solid small regions) and open divider stripes (gaps
 * between thin white lines). When no filled lot region exists at all, falls back to
 * line-art detection (white cells between dark lines, block = hull of the bays).
 */
/** Mean luminance across a coarse sample grid — cheap proxy for "is this plan dark-themed?" */
function estimateMeanLuminance(raster: ParkingPlanRaster): number {
  const { data, width, height } = raster;
  const stepX = Math.max(1, Math.floor(width / 60));
  const stepY = Math.max(1, Math.floor(height / 60));
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4;
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      count += 1;
    }
  }
  return count > 0 ? sum / count : 255;
}

/**
 * Every boundary rule in this file (`isBorderPixel`, `isDarkLinePixel`, …) assumes the
 * common case — a light/white background with dark or white lines. A dark-themed plan
 * (dark navy lot fill, light gold bay boxes) inverts that assumption: the background
 * itself has low luminance, so it gets misclassified as a border/boundary everywhere,
 * and nothing ever segments into a usable region ("Could not detect a parking area").
 * Detecting that up front and inverting the raster's colours fixes it for every rule at
 * once — geometry (positions, polygons) is colour-independent, and no colour value is
 * ever surfaced to the user from parking detection, so inverting is fully safe here.
 */
function normalizeForDetection(raster: ParkingPlanRaster): ParkingPlanRaster {
  if (estimateMeanLuminance(raster) >= 120) {
    return raster;
  }
  const { data, width, height } = raster;
  const inverted = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    inverted[i] = 255 - data[i];
    inverted[i + 1] = 255 - data[i + 1];
    inverted[i + 2] = 255 - data[i + 2];
    inverted[i + 3] = data[i + 3];
  }
  return { data: inverted, width, height };
}

export function detectParkingPlan(rawRaster: ParkingPlanRaster): ParkingPlanDetection | null {
  const raster = normalizeForDetection(rawRaster);
  const { width, height } = raster;
  const totalPx = width * height;
  if (totalPx < 10_000) {
    return null;
  }
  // Finding the LOT wants maximum connectivity — a big paved surface with soft
  // shading, road markings, or printed text should still read as one blob, so this
  // pass uses the plain border rule (no gradient reinforcement). Using the stricter
  // gradient-enhanced mask here over-fragments the lot into a smaller/notched region
  // (visible as a block that no longer covers the whole plan). Bay-cell detection
  // below wants the opposite — maximum edge sensitivity — so it gets its own pass.
  const { labels, regions } = segmentRegions(raster, isBorderPixel, false);

  let lot: RegionStats | null = null;
  for (const region of regions) {
    const fraction = region.count / totalPx;
    if (fraction < LOT_MIN_AREA_FRACTION || fraction > LOT_MAX_AREA_FRACTION) {
      continue;
    }
    if (!lot || region.count > lot.count) {
      lot = region;
    }
  }
  if (!lot) {
    return detectLineArtPlan(raster);
  }

  // --- Outline ---
  const lotMask = buildLotMask(labels, regions, lot, width, height);
  // Primary: trace the plan's own drawing (everything that isn't page background) —
  // that's the boundary the user sees, side strips and printed boundary stroke
  // included. The colour-region trace below finds only the asphalt, which then needs
  // growing around the codes — the source of bulges/diagonal cuts.
  let outlinePct = detectLotOutlineFromInk(raster, labels, lot);
  if (!outlinePct) {
    // Fallback: outline from the closed, hole-filled lot-region mask.
    const maskLabels = new Int32Array(width * height);
    const MASK_LABEL = 1;
    let mMinX = width;
    let mMinY = height;
    let mMaxX = 0;
    let mMaxY = 0;
    for (let wy = 0; wy < lotMask.winH; wy++) {
      for (let wx = 0; wx < lotMask.winW; wx++) {
        if (!lotMask.mask[wy * lotMask.winW + wx]) {
          continue;
        }
        const x = wx + lotMask.winX;
        const y = wy + lotMask.winY;
        maskLabels[y * width + x] = MASK_LABEL;
        mMinX = Math.min(mMinX, x);
        mMinY = Math.min(mMinY, y);
        mMaxX = Math.max(mMaxX, x);
        mMaxY = Math.max(mMaxY, y);
      }
    }
    const rawOutline = extractBoundaryPolygon(maskLabels, MASK_LABEL, width, height, mMinX, mMinY, mMaxX, mMaxY);
    if (rawOutline.length < 3) {
      return null;
    }
    outlinePct = simplifyOutline(rawOutline, MAX_OUTLINE_VERTICES, OUTLINE_MIN_TRIANGLE_PCT);
  }
  // Residual concavity guard: if deep notches survived (entrance cuts, leaked roads),
  // the convex hull is closer to the real lot shape than a spiky polygon.
  const hull = convexHullPct(outlinePct);
  const hullArea = shoelaceAreaPct(hull);
  if (hull.length >= 3 && hullArea > 0 && shoelaceAreaPct(outlinePct) / hullArea < 0.72) {
    outlinePct = simplifyOutline(hull, MAX_OUTLINE_VERTICES, 5);
  }
  // Self-intersection guard: vertex-decimation on a complex/concave contour can
  // occasionally cross its own edges (a bowtie), which renders with an unfilled hole
  // even though point-in-polygon still calls that area "inside" — never ship one.
  if (polygonSelfIntersects(outlinePct)) {
    outlinePct = simplifyOutline(convexHullPct(outlinePct), MAX_OUTLINE_VERTICES, 5);
  }

  // --- Bays, path 1: closed white-outlined boxes (solid small regions in the lot) ---
  // Separate gradient-enhanced pass — crisp cell separation matters far more here than
  // it does for the lot outline, where the same sensitivity backfires (see above).
  const { labels: bayLabels, regions: bayRegions } = segmentRegions(raster, isBorderPixel, true);
  const candidates: (DetectedParkingBay & { areaPx: number })[] = [];
  const bayMaxAreaPx = totalPx * BAY_MAX_AREA_FRACTION;
  for (const region of bayRegions) {
    if (region.count < BAY_MIN_AREA_PX || region.count > bayMaxAreaPx) {
      continue;
    }
    const { angleDeg, lengthPx, widthPx } = regionOrientation(region);
    if (widthPx < 4) {
      continue;
    }
    const aspect = lengthPx / Math.max(1, widthPx);
    if (aspect < BAY_MIN_ASPECT || aspect > BAY_MAX_ASPECT) {
      continue;
    }
    // The region must actually fill its oriented box (bays are solid rectangles) —
    // rules out L-shaped or ring-like fragments with rect-ish moments.
    const fillRatio = region.count / Math.max(1, lengthPx * widthPx);
    if (fillRatio < 0.6) {
      continue;
    }
    const cxPct = (region.sumX / region.count / width) * 100;
    const cyPct = (region.sumY / region.count / height) * 100;
    if (!maskAtPct(lotMask, cxPct, cyPct, width, height)) {
      continue;
    }
    candidates.push({
      cxPct,
      cyPct,
      rotationDeg: angleDeg,
      lengthPx,
      widthPx,
      polygonPct: bayPolygonPct(bayLabels, region, width, height),
      areaPx: region.count,
    });
  }

  // Drop stray glyphs (curved traffic arrows, angled legend text, dimension arrowheads)
  // that pass the aspect/fill checks but sit at an odd angle or duplicate a neighbour,
  // then keep only the dominant size cluster — drops trees, legend swatches, text boxes.
  const cleanedCandidates = dedupeCloseCandidates(filterOrientationOutliers(candidates), width, height);
  let closedBays: DetectedParkingBay[] = [];
  if (cleanedCandidates.length >= 4) {
    const sortedAreas = cleanedCandidates.map((c) => c.areaPx).sort((a, b) => a - b);
    const medianArea = sortedAreas[Math.floor(sortedAreas.length / 2)];
    const sortedWidths = cleanedCandidates.map((c) => c.widthPx).sort((a, b) => a - b);
    const medianWidth = sortedWidths[Math.floor(sortedWidths.length / 2)];
    closedBays = cleanedCandidates
      .filter(
        (c) =>
          c.areaPx >= medianArea * 0.45 &&
          c.areaPx <= medianArea * 2.2 &&
          c.widthPx >= medianWidth * 0.55 &&
          c.widthPx <= medianWidth * 1.8,
      )
      .map(({ areaPx: _areaPx, ...bay }) => bay);
  }

  // --- Bays, path 2: open divider stripes — dedupe against the closed boxes ---
  const stripeBays = detectStripeBays(raster, lotMask);
  const bays = [...closedBays];
  for (const stripeBay of stripeBays) {
    const sx = (stripeBay.cxPct / 100) * width;
    const sy = (stripeBay.cyPct / 100) * height;
    const duplicate = closedBays.some((closed) => {
      const cx = (closed.cxPct / 100) * width;
      const cy = (closed.cyPct / 100) * height;
      return Math.hypot(sx - cx, sy - cy) < Math.max(closed.widthPx, stripeBay.widthPx) * 0.7;
    });
    if (!duplicate) {
      bays.push(stripeBay);
    }
  }

  // The block comes first: guarantee the outline encloses the detected slots (rebuild
  // it from the bays' own hull when the traced one fails), then keep only slots that
  // are actually inside the final block.
  const finalOutline = ensureOutlineContainsBays(outlinePct, bays, width, height, raster);
  const containedBays =
    finalOutline.length >= 3 ? bays.filter((b) => pointInPolygon(b.cxPct, b.cyPct, finalOutline)) : bays;

  return { widthPx: width, heightPx: height, outlinePct: finalOutline, bays: containedBays };
}

/** Extracts "160.0 m"-style dimension labels from OCR tokens (also pairs "160.0" + "m"). */
export function parseDimensionTokens(tokens: OcrToken[]): ParkingDimensionLabel[] {
  const dims: ParkingDimensionLabel[] = [];
  const numberOnly: { value: number; xPct: number; yPct: number }[] = [];
  const bareM: { xPct: number; yPct: number }[] = [];

  for (const token of tokens) {
    const text = token.text.trim();
    const withUnit = /^(\d{1,4}(?:[.,]\d{1,2})?)\s*m\.?$/i.exec(text);
    if (withUnit) {
      const value = parseFloat(withUnit[1].replace(',', '.'));
      if (value >= 3 && value <= 2000) {
        dims.push({ valueM: value, xPct: token.xPct, yPct: token.yPct });
      }
      continue;
    }
    const pureNumber = /^(\d{1,4}(?:[.,]\d{1,2})?)$/.exec(text);
    if (pureNumber) {
      const value = parseFloat(pureNumber[1].replace(',', '.'));
      if (value >= 3 && value <= 2000) {
        numberOnly.push({ value, xPct: token.xPct, yPct: token.yPct });
      }
      continue;
    }
    if (/^m\.?$/i.test(text)) {
      bareM.push({ xPct: token.xPct, yPct: token.yPct });
    }
  }

  // OCR often splits "160.0 m" into two tokens — pair each bare "m" with its nearest number.
  for (const m of bareM) {
    let best: (typeof numberOnly)[number] | null = null;
    let bestDist = Infinity;
    for (const num of numberOnly) {
      const dist = Math.hypot(num.xPct - m.xPct, num.yPct - m.yPct);
      if (dist < bestDist) {
        bestDist = dist;
        best = num;
      }
    }
    if (best && bestDist <= 4) {
      dims.push({ valueM: best.value, xPct: best.xPct, yPct: best.yPct });
      numberOnly.splice(numberOnly.indexOf(best), 1);
    }
  }

  return dims;
}

/** Plan title for the layout-name field: the largest OCR token that isn't a dimension or legend text. */
export function suggestPlanName(tokens: OcrToken[]): string | null {
  let best: OcrToken | null = null;
  for (const token of tokens) {
    const text = token.text.trim();
    if (text.length < 4 || !/[a-z]/i.test(text)) {
      continue;
    }
    if (/\d\s*m\.?$/i.test(text)) {
      continue;
    }
    if (token.yPct > 88) {
      continue; // legend / notes band
    }
    if (!best || (token.hPct ?? 0) > (best.hPct ?? 0)) {
      best = token;
    }
  }
  return best ? best.text.trim() : null;
}

/**
 * Resolves raster px-per-metre: preferred from OCR dimension labels matched to their
 * nearest outline edge; falls back to median bay width = the default car slot width.
 */
export function resolveParkingPlanScale(
  detection: ParkingPlanDetection,
  dimensions: ParkingDimensionLabel[],
  carDefaults: ParkingSlotDefaults,
): ParkingPlanScale | null {
  const { widthPx, heightPx, outlinePct } = detection;
  const toPx = (p: { xPct: number; yPct: number }) => ({
    x: (p.xPct / 100) * widthPx,
    y: (p.yPct / 100) * heightPx,
  });

  const n = outlinePct.length;
  const estimates: { ppm: number; edgeLenPx: number }[] = [];
  const maxLabelDistPx = Math.min(widthPx, heightPx) * 0.18;
  for (const dim of dimensions) {
    const labelPx = toPx(dim);
    let bestEdgeLen = 0;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const a = toPx(outlinePct[i]);
      const b = toPx(outlinePct[(i + 1) % n]);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1) {
        continue;
      }
      const t = Math.max(0, Math.min(1, ((labelPx.x - a.x) * dx + (labelPx.y - a.y) * dy) / lenSq));
      const dist = Math.hypot(labelPx.x - (a.x + t * dx), labelPx.y - (a.y + t * dy));
      if (dist < bestDist) {
        bestDist = dist;
        bestEdgeLen = Math.sqrt(lenSq);
      }
    }
    if (bestDist <= maxLabelDistPx && bestEdgeLen > 0) {
      estimates.push({ ppm: bestEdgeLen / dim.valueM, edgeLenPx: bestEdgeLen });
    }
  }

  const bayDefaultPpm = ((): number | null => {
    if (detection.bays.length < 4 || carDefaults.widthM <= 0) {
      return null;
    }
    const widths = detection.bays.map((b) => b.widthPx).sort((a, b) => a - b);
    const medianWidth = widths[Math.floor(widths.length / 2)];
    return medianWidth / carDefaults.widthM;
  })();

  if (estimates.length > 0) {
    const ppms = estimates.map((e) => e.ppm);
    const spread = Math.max(...ppms) / Math.max(1e-6, Math.min(...ppms));
    let ocrPpm: number;
    if (spread > 1.6) {
      // Disagreeing labels — trust the one attached to the longest edge.
      const longest = estimates.reduce((a, b) => (b.edgeLenPx > a.edgeLenPx ? b : a));
      ocrPpm = longest.ppm;
    } else {
      const totalLen = estimates.reduce((sum, e) => sum + e.edgeLenPx, 0);
      ocrPpm = estimates.reduce((sum, e) => sum + e.ppm * (e.edgeLenPx / totalLen), 0);
    }
    // Prefer printed dimension labels for scale so slots match the uploaded plan's
    // drawn stall size relative to "180.0 m" edges. Only reject OCR when it is
    // wildly smaller than bay-implied ppm (wrong short-edge match).
    if (bayDefaultPpm && ocrPpm < bayDefaultPpm * 0.2) {
      return { ppm: bayDefaultPpm, source: 'bay-default' };
    }
    return { ppm: ocrPpm, source: 'ocr' };
  }

  if (bayDefaultPpm) {
    return { ppm: bayDefaultPpm, source: 'bay-default' };
  }

  return null;
}

/** Real-world length (m) for every outline edge from the resolved scale, rounded to 0.1 m. */
export function assignEdgeLengths(
  outlinePct: PointPct[],
  widthPx: number,
  heightPx: number,
  ppm: number,
): number[] {
  const n = outlinePct.length;
  const lengths: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = outlinePct[i];
    const b = outlinePct[(i + 1) % n];
    const dx = ((b.xPct - a.xPct) / 100) * widthPx;
    const dy = ((b.yPct - a.yPct) / 100) * heightPx;
    lengths.push(Math.max(0.1, Math.round((Math.hypot(dx, dy) / ppm) * 10) / 10));
  }
  return lengths;
}

/**
 * Converts detected bays into slot placements: clusters bays into row lanes
 * (union-find over orientation + colinearity), sizes them in metres from the scale,
 * and orders each lane along its row for A1..An numbering.
 */
export function buildDetectedSlots(
  detection: ParkingPlanDetection,
  ppm: number,
  carDefaults: ParkingSlotDefaults,
): DetectedParkingSlotPlacement[] {
  const bays = detection.bays;
  if (bays.length === 0 || ppm <= 0) {
    return [];
  }

  const lens = bays.map((b) => b.lengthPx).sort((a, b) => a - b);
  const widths = bays.map((b) => b.widthPx).sort((a, b) => a - b);
  // Used only as a connectivity tolerance for lane clustering below, not as the final
  // rendered slot size — a plan-wide median doesn't hold across genuinely different bay
  // families (a narrow side-stall column pitched much tighter than the main grid).
  const medLenPx = lens[Math.floor(lens.length / 2)];
  const medWidthPx = widths[Math.floor(widths.length / 2)];

  // Union-find lane clustering in raster px space.
  const toPx = (b: DetectedParkingBay) => ({
    x: (b.cxPct / 100) * detection.widthPx,
    y: (b.cyPct / 100) * detection.heightPx,
  });
  const parent = bays.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };
  const angleDiff = (a: number, b: number): number => {
    let d = Math.abs(a - b) % 180;
    return d > 90 ? 180 - d : d;
  };
  for (let i = 0; i < bays.length; i++) {
    for (let j = i + 1; j < bays.length; j++) {
      if (angleDiff(bays[i].rotationDeg, bays[j].rotationDeg) > 15) {
        continue;
      }
      const pi = toPx(bays[i]);
      const pj = toPx(bays[j]);
      // Row direction is perpendicular to the bay depth axis.
      const depthRad = (bays[i].rotationDeg * Math.PI) / 180;
      const rowX = -Math.sin(depthRad);
      const rowY = Math.cos(depthRad);
      const dx = pj.x - pi.x;
      const dy = pj.y - pi.y;
      const along = Math.abs(dx * rowX + dy * rowY);
      const perp = Math.abs(dx * Math.cos(depthRad) + dy * Math.sin(depthRad));
      if (perp <= medLenPx * 0.5 && along <= medWidthPx * 2.6) {
        union(i, j);
      }
    }
  }

  // Deterministic lane order: by cluster centroid (top-to-bottom, then left-to-right).
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < bays.length; i++) {
    const root = find(i);
    const list = clusters.get(root);
    if (list) {
      list.push(i);
    } else {
      clusters.set(root, [i]);
    }
  }
  const ordered = [...clusters.values()].sort((a, b) => {
    const ca = a.reduce((s, i) => s + bays[i].cyPct * 1000 + bays[i].cxPct, 0) / a.length;
    const cb = b.reduce((s, i) => s + bays[i].cyPct * 1000 + bays[i].cxPct, 0) / b.length;
    return ca - cb;
  });

  const placements: DetectedParkingSlotPlacement[] = [];
  ordered.forEach((cluster, laneIndex) => {
    // Size each lane from its OWN bays, not a plan-wide median — a narrow side-stall
    // column (tighter pitch, smaller bays than the main grid) must render at its own
    // real size or its slots overlap into a solid stacked mass at the render step.
    const laneLens = cluster.map((i) => bays[i].lengthPx).sort((a, b) => a - b);
    const laneWidths = cluster.map((i) => bays[i].widthPx).sort((a, b) => a - b);
    let laneLengthM = laneLens[Math.floor(laneLens.length / 2)] / ppm;
    let laneWidthM = laneWidths[Math.floor(laneWidths.length / 2)] / ppm;
    // Keep the plan's drawn size (px/ppm). Do not snap/hard-cap to vehicle defaults —
    // schematic plans draw stalls larger than a real car, and clamping made slots look
    // tiny against the uploaded image.
    laneWidthM = Math.min(MEASURED_MAX_M, Math.max(MEASURED_MIN_M, Math.round(laneWidthM * 10) / 10));
    laneLengthM = Math.min(MEASURED_MAX_M, Math.max(MEASURED_MIN_M, Math.round(laneLengthM * 10) / 10));

    // One rotation for the whole lane — a single cell corrupted by an arrow/label can
    // skew PCA by tens of degrees; neighbours in the same cluster already agree within
    // the lane join threshold, so the median is the stable stall orientation.
    const laneAngles = cluster.map((i) => bays[i].rotationDeg).sort((a, b) => a - b);
    const laneRotationDeg = Math.round(laneAngles[Math.floor(laneAngles.length / 2)] * 10) / 10;

    // Sort along the row direction so numbering runs down the lane.
    const depthRad = (laneRotationDeg * Math.PI) / 180;
    const rowX = -Math.sin(depthRad);
    const rowY = Math.cos(depthRad);
    const sorted = [...cluster].sort((a, b) => {
      const pa = toPx(bays[a]);
      const pb = toPx(bays[b]);
      return pa.x * rowX + pa.y * rowY - (pb.x * rowX + pb.y * rowY);
    });
    for (const i of sorted) {
      placements.push({
        xPct: bays[i].cxPct,
        yPct: bays[i].cyPct,
        rotationDeg: laneRotationDeg,
        lengthM: laneLengthM,
        widthM: laneWidthM,
        laneIndex,
        shapePoints: bayShapePoints(bays[i], detection.widthPx, detection.heightPx),
      });
    }
  });
  return placements;
}

/**
 * Auto-detect never attaches custom slot polygons.
 *
 * Mid-quality flood-fill traces (arrows through cells, OCR badges, divider noise)
 * used to land in a mid boxRatio band and become jagged `shapePoints`, which rendered
 * as distorted overlapping polygons while neighbours stayed clean rects. Parking-plan
 * stalls are rectangles — prefer the oriented box (centre + rotation + lane size).
 * Manual custom-slot drawing still supports polygons via its own path.
 */
export function bayShapePoints(
  _bay: DetectedParkingBay,
  _imageWidthPx: number,
  _imageHeightPx: number,
): { xPct: number; yPct: number }[] | undefined {
  return undefined;
}

/** Downscaled RGBA raster from an image file (same ≤1200px pattern as detect-blocks). */
export async function rasterizeParkingPlanFile(file: File): Promise<ParkingPlanRaster> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not load the image.'));
      image.src = url;
    });
    const scale = Math.min(1, 1200 / img.width);
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Could not create analysis canvas.');
    }
    ctx.drawImage(img, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    return { data: imageData.data, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
