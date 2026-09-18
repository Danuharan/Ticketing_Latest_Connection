/**
 * Client-side stadium chart block detection.
 *
 * Segments colored seating blocks separated by white/black border pixels and
 * colour-gradient edges, traces each region's outer contour point-by-point, and
 * returns canvas-% polygons ready for the layout designer.
 *
 * Robustness layers (in pipeline order):
 *  1. Small charts are upsampled so 1-px separators and glyph strokes survive.
 *  2. Printed block labels (dark glyphs, or outlined light glyphs) are recognised
 *     as small dark connected components and made *passable* — a block grows
 *     straight through its own label instead of being carved or split by it.
 *  3. Each region mask is repaired before tracing: enclosed holes (white glyphs,
 *     label boxes) are filled and thin edge notches are closed, so the traced
 *     outline is the block's true outer shape with nothing "inside" it.
 *  4. Non-chart artwork (banner logos, legend swatches, letter holes) is dropped
 *     by surround / isolation tests instead of fixed image-position cut-offs.
 */

import { extractBoundaryPolygon, pointInPolygon } from './contour-geometry';
import type { PointPct } from './contour-geometry';

/** Default colour-distance tolerance kept for the public detect API (UI slider). */
const DEFAULT_TRACE_TOLERANCE = 48;

export type DetectedPitchShape = 'rectangle' | 'oval' | 'circle';

export interface DetectedPitch {
  name: string;
  /** Inferred from mask fill ratio (rectangle fills its box; oval/circle do not). */
  detectedShape: DetectedPitchShape;
  /** Optional traced outline; pitch is rendered from position + size + detectedShape. */
  polygon?: PointPct[];
  position: { xPct: number; yPct: number };
  size: { wPct: number; hPct: number };
}

export interface DetectedBlock {
  id: number;
  name: string;
  polygon: PointPct[];
  cxPct: number;
  cyPct: number;
  fillColor: string;
  ringIndex: number;
  pixelArea: number;
}

export interface DetectedStand {
  name: string;
  xPct: number;
  yPct: number;
}

/** Shared seed descriptor for OCR label positions and CV region centres. */
export interface BlockSeed {
  xPct: number;
  yPct: number;
  source: 'ocr' | 'cv';
  tokenText?: string;
  hPct?: number;
}

/** CV luminance region used as a trace seed and optional contour fallback. */
export interface CvBlockSeed extends BlockSeed {
  source: 'cv';
  regionLabel: number;
  regionMinX: number;
  regionMinY: number;
  regionMaxX: number;
  regionMaxY: number;
  fillColorHint: string;
}

/** Low-res segmentation output for batch trace (seeds + label grid for fallback contours). */
export interface BlockSeedDiscoveryResult {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  seeds: CvBlockSeed[];
  labels: Int32Array;
  pitch: DetectedPitch | null;
  notes: string;
}

export interface BlockDetectionResult {
  width: number;
  height: number;
  blocks: DetectedBlock[];
  pitch: DetectedPitch | null;
  stands: DetectedStand[];
  confidence: 'low' | 'medium' | 'high';
  notes: string;
}

/**
 * How far below the page-white level a near-neutral fill must sit before it is
 * read as a pale *block* rather than as a separator line. Small on purpose: on a
 * white page the pale greys used for unsold tiers (#ececec ≈ 236) are only ~15
 * below white, while the lines themselves are at white.
 */
const PALE_BELOW_PAGE_WHITE = 6;
/** Erosion radius that a pale component must survive to count as a block core. */
const PALE_CORE_RADIUS = 2;

const MAX_ANALYSIS_WIDTH = 1400;
/**
 * Small charts (e.g. 500 px wide) are upsampled before analysis: 1-px separators
 * and glyph strokes become 2 px, which morphology and contour tracing need.
 */
const MIN_ANALYSIS_WIDTH = 1000;
const MAX_UPSCALE = 2.5;

/** Analysis raster scale for a source image width (down- or up-sampling). */
export function analysisScaleForWidth(width: number): number {
  if (width <= 0) {
    return 1;
  }
  if (width >= MIN_ANALYSIS_WIDTH) {
    return Math.min(1, MAX_ANALYSIS_WIDTH / width);
  }
  return Math.min(MAX_UPSCALE, MIN_ANALYSIS_WIDTH / width);
}

export interface AnalysisImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function lum(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Near-white / near-page pixel (separator lines, label boxes, white glyphs). */
function isBackgroundLike(r: number, g: number, b: number): boolean {
  const l = lum(r, g, b);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  return l > 200 && chroma < 40;
}

/** Dark pixel — glyph strokes, glyph outlines, dark banners/outlines. */
function isDarkPixel(r: number, g: number, b: number): boolean {
  return lum(r, g, b) < 100;
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

/* ------------------------------------------------------------------------ */
/* Local (window) morphology — separable, O(n) per radius                    */
/* ------------------------------------------------------------------------ */

function dilateWindow(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    let run = -1;
    for (let x = 0; x < w; x += 1) {
      if (src[row + x]) {
        run = x;
      }
      // Any set pixel within [x-r, x+r]? Track last set pixel to the left and
      // look ahead to the right only when needed.
      if (run >= 0 && x - run <= r) {
        tmp[row + x] = 1;
        continue;
      }
      let on = 0;
      for (let k = 1; k <= r && x + k < w; k += 1) {
        if (src[row + x + k]) {
          on = 1;
          break;
        }
      }
      tmp[row + x] = on;
    }
  }
  const out = new Uint8Array(src.length);
  for (let x = 0; x < w; x += 1) {
    let run = -1;
    for (let y = 0; y < h; y += 1) {
      if (tmp[y * w + x]) {
        run = y;
      }
      if (run >= 0 && y - run <= r) {
        out[y * w + x] = 1;
        continue;
      }
      let on = 0;
      for (let k = 1; k <= r && y + k < h; k += 1) {
        if (tmp[(y + k) * w + x]) {
          on = 1;
          break;
        }
      }
      out[y * w + x] = on;
    }
  }
  return out;
}

function erodeWindow(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  // Erosion = complement of dilation of the complement (window edge counts as off).
  const inv = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i += 1) {
    inv[i] = src[i] ? 0 : 1;
  }
  const dil = dilateWindow(inv, w, h, r);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const nearEdge = x < r || y < r || x >= w - r || y >= h - r;
      out[i] = dil[i] || nearEdge ? 0 : 1;
    }
  }
  return out;
}

/**
 * Fill enclosed holes of a window mask. `accept(pixels)` decides per hole
 * (return false to keep it open, e.g. when it encloses the pitch).
 */
function fillMaskHoles(
  mask: Uint8Array,
  w: number,
  h: number,
  accept: (holePixels: number[]) => boolean,
): void {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const pushIfOpen = (i: number): void => {
    if (!mask[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x += 1) {
    pushIfOpen(x);
    pushIfOpen((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 1) {
    pushIfOpen(y * w);
    pushIfOpen(y * w + w - 1);
  }
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const x = cur % w;
    const y = (cur - x) / w;
    if (x > 0) pushIfOpen(cur - 1);
    if (x < w - 1) pushIfOpen(cur + 1);
    if (y > 0) pushIfOpen(cur - w);
    if (y < h - 1) pushIfOpen(cur + w);
  }
  const seen = new Uint8Array(w * h);
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] || outside[start] || seen[start]) {
      continue;
    }
    const hole: number[] = [start];
    seen[start] = 1;
    for (let k = 0; k < hole.length; k += 1) {
      const cur = hole[k];
      const x = cur % w;
      const y = (cur - x) / w;
      const tryPush = (n: number): void => {
        if (!mask[n] && !outside[n] && !seen[n]) {
          seen[n] = 1;
          hole.push(n);
        }
      };
      if (x > 0) tryPush(cur - 1);
      if (x < w - 1) tryPush(cur + 1);
      if (y > 0) tryPush(cur - w);
      if (y < h - 1) tryPush(cur + w);
    }
    if (accept(hole)) {
      for (const p of hole) {
        mask[p] = 1;
      }
    }
  }
}

function isBorderPixel(r: number, g: number, b: number, a: number): boolean {
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

function isPitchPixel(r: number, g: number, b: number): boolean {
  return g > r + 18 && g > b + 10 && g > 70 && lum(r, g, b) < 210;
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function erodeMask(src: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (!src[idx]) {
        continue;
      }
      let allOn = 1;
      outer: for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height || !src[yy * width + xx]) {
            allOn = 0;
            break outer;
          }
        }
      }
      out[idx] = allOn;
    }
  }
  return out;
}

export function closeMask(src: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return erodeMask(dilateMask(src, width, height, radius), width, height, radius);
}

export function dilateMask(src: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let on = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const xx = x + k;
        if (xx < 0 || xx >= width) {
          continue;
        }
        if (src[row + xx]) {
          on = 1;
          break;
        }
      }
      tmp[row + x] = on;
    }
  }
  const out = new Uint8Array(src.length);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let on = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const yy = y + k;
        if (yy < 0 || yy >= height) {
          continue;
        }
        if (tmp[yy * width + x]) {
          on = 1;
          break;
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
}

function isolateMainPitch(
  pitch: Uint8Array,
  width: number,
  height: number,
  totalPixels: number,
  centerX: number,
  centerY: number,
): void {
  // No pre-dilation: the pitch and the same-coloured green seating blocks
  // (e.g. L01–L10, KG–KP, 121) are separated only by thin block outlines.
  // Any dilation bridges those outlines and swallows the blocks into the pitch.
  // Work on the raw mask so the outlines are kept, then reunite the pitch's own
  // inner pieces via a bounding-box test so it becomes one solid shape.
  interface PitchComp {
    id: number;
    count: number;
    sumX: number;
    sumY: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }
  const compOf = new Int32Array(totalPixels);
  const comps: PitchComp[] = [];
  const stack: number[] = [];
  let compCount = 0;

  for (let p = 0; p < totalPixels; p += 1) {
    if (!pitch[p] || compOf[p] !== 0) {
      continue;
    }
    compCount += 1;
    const id = compCount;
    const sx = p % width;
    const sy = (p - sx) / width;
    const comp: PitchComp = {
      id,
      count: 0,
      sumX: 0,
      sumY: 0,
      minX: sx,
      minY: sy,
      maxX: sx,
      maxY: sy,
    };
    compOf[p] = id;
    stack.push(p);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const px = cur % width;
      const py = (cur - px) / width;
      comp.count += 1;
      comp.sumX += px;
      comp.sumY += py;
      if (px < comp.minX) comp.minX = px;
      if (px > comp.maxX) comp.maxX = px;
      if (py < comp.minY) comp.minY = py;
      if (py > comp.maxY) comp.maxY = py;
      if (px > 0 && pitch[cur - 1] && compOf[cur - 1] === 0) {
        compOf[cur - 1] = id;
        stack.push(cur - 1);
      }
      if (px < width - 1 && pitch[cur + 1] && compOf[cur + 1] === 0) {
        compOf[cur + 1] = id;
        stack.push(cur + 1);
      }
      if (py > 0 && pitch[cur - width] && compOf[cur - width] === 0) {
        compOf[cur - width] = id;
        stack.push(cur - width);
      }
      if (py < height - 1 && pitch[cur + width] && compOf[cur + width] === 0) {
        compOf[cur + width] = id;
        stack.push(cur + width);
      }
    }
    comps.push(comp);
  }

  const maxDim = Math.max(width, height);
  const minMainArea = totalPixels * 0.002;

  // Main pitch = largest, most central green component.
  let mainComp: PitchComp | null = null;
  let bestScore = -Infinity;
  for (const comp of comps) {
    if (comp.count < minMainArea) {
      continue;
    }
    const ccx = comp.sumX / comp.count;
    const ccy = comp.sumY / comp.count;
    const distPct = Math.hypot(ccx - centerX, ccy - centerY) / maxDim;
    const score = comp.count * (1 - Math.min(1, distPct * 1.6));
    if (score > bestScore) {
      bestScore = score;
      mainComp = comp;
    }
  }

  if (!mainComp) {
    pitch.fill(0);
    return;
  }

  // Field bounding box: start from the main blob, then merge any other large
  // piece that lies in the central field band (e.g. the far half when a white
  // halfway line splits the pitch in two). Off-centre green stands are either
  // too small or outside the band, so they never grow the field box.
  let fMinX = mainComp.minX;
  let fMinY = mainComp.minY;
  let fMaxX = mainComp.maxX;
  let fMaxY = mainComp.maxY;
  const merged = new Set<number>([mainComp.id]);
  const adjGap = maxDim * 0.02;
  let grew = true;
  while (grew) {
    grew = false;
    for (const comp of comps) {
      if (merged.has(comp.id) || comp.count < mainComp.count * 0.3) {
        continue;
      }
      const ccx = comp.sumX / comp.count;
      const ccy = comp.sumY / comp.count;
      const inBand =
        Math.abs(ccx - centerX) < width * 0.35 && Math.abs(ccy - centerY) < height * 0.22;
      const touchesX = comp.minX <= fMaxX + adjGap && comp.maxX >= fMinX - adjGap;
      const touchesY = comp.minY <= fMaxY + adjGap && comp.maxY >= fMinY - adjGap;
      if (inBand && touchesX && touchesY) {
        merged.add(comp.id);
        fMinX = Math.min(fMinX, comp.minX);
        fMinY = Math.min(fMinY, comp.minY);
        fMaxX = Math.max(fMaxX, comp.maxX);
        fMaxY = Math.max(fMaxY, comp.maxY);
        grew = true;
      }
    }
  }

  // Keep every green piece whose centroid lies inside the field box — this pulls
  // in the pitch's own inner fragments (penalty boxes, centre circle, goal ends)
  // so the pitch renders as ONE solid shape with nothing inside it, while
  // excluding the surrounding stands (their centroids fall outside the box).
  const insetX = (fMaxX - fMinX) * 0.03;
  const insetY = (fMaxY - fMinY) * 0.03;
  const keep = new Set<number>(merged);
  for (const comp of comps) {
    const ccx = comp.sumX / comp.count;
    const ccy = comp.sumY / comp.count;
    if (
      ccx >= fMinX + insetX &&
      ccx <= fMaxX - insetX &&
      ccy >= fMinY + insetY &&
      ccy <= fMaxY - insetY
    ) {
      keep.add(comp.id);
    }
  }

  for (let p = 0; p < totalPixels; p += 1) {
    pitch[p] = pitch[p] && keep.has(compOf[p]) ? 1 : 0;
  }
}

function clusterRadii(values: number[], k: number): number[] {
  if (values.length === 0) {
    return [];
  }
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length <= k) {
    return sorted;
  }
  const buckets: number[][] = Array.from({ length: k }, () => []);
  for (const v of sorted) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < k; i += 1) {
      const center = buckets[i].length
        ? buckets[i].reduce((s, n) => s + n, 0) / buckets[i].length
        : sorted[Math.floor((sorted.length * (i + 0.5)) / k)];
      const d = Math.abs(v - center);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    buckets[best].push(v);
  }
  return buckets.map((b) => (b.length ? b.reduce((s, n) => s + n, 0) / b.length : 0));
}

function resolveLayerCount(blockCount: number): number {
  if (blockCount >= 35) {
    return 4;
  }
  if (blockCount >= 18) {
    return 3;
  }
  return Math.max(1, Math.min(2, Math.round(Math.cbrt(blockCount / 4))));
}

function polarFromCenter(
  x: number,
  y: number,
  cx: number,
  cy: number,
  width: number,
  height: number,
): { radiusPct: number } {
  const dx = x - cx;
  const dy = y - cy;
  const maxR = Math.max(width, height) / 2;
  return { radiusPct: (Math.hypot(dx, dy) / maxR) * 100 };
}

interface NestableBlock {
  pixelArea: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Drops regions that sit almost entirely inside a much larger block — typically
 * a block's printed name-label border traced as its own polygon, which would
 * otherwise split one real block into two.
 */
function suppressNestedLabelBoxes<T extends NestableBlock>(blocks: T[]): T[] {
  const slackPx = 2;
  return blocks.filter(
    (b) =>
      !blocks.some(
        (parent) =>
          parent !== b &&
          parent.pixelArea > b.pixelArea * 3.3 &&
          b.minX >= parent.minX - slackPx &&
          b.maxX <= parent.maxX + slackPx &&
          b.minY >= parent.minY - slackPx &&
          b.maxY <= parent.maxY + slackPx,
      ),
  );
}

type SegmentedRawBlock = {
  polygon: PointPct[];
  cxPct: number;
  cyPct: number;
  fillColor: string;
  meanRadius: number;
  pixelArea: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** Drop aisle/gap fragments much smaller than a typical seating block in the same ring. */
function dropTinyFragmentBlocks<T extends { pixelArea: number; meanRadius: number }>(
  blocks: T[],
): T[] {
  if (blocks.length < 4) {
    return blocks;
  }

  const layerCount = resolveLayerCount(blocks.length);
  const ringCenters = clusterRadii(
    blocks.map((block) => block.meanRadius),
    layerCount,
  ).sort((a, b) => a - b);

  const buckets: T[][] = Array.from({ length: ringCenters.length }, () => []);
  for (const block of blocks) {
    let bestRing = 0;
    let bestDist = Infinity;
    for (let ring = 0; ring < ringCenters.length; ring += 1) {
      const dist = Math.abs(block.meanRadius - ringCenters[ring]);
      if (dist < bestDist) {
        bestDist = dist;
        bestRing = ring;
      }
    }
    buckets[bestRing].push(block);
  }

  const kept: T[] = [];
  for (const cluster of buckets) {
    if (cluster.length === 0) {
      continue;
    }
    if (cluster.length === 1) {
      kept.push(cluster[0]);
      continue;
    }
    const areas = cluster.map((block) => block.pixelArea).sort((a, b) => a - b);
    const median = areas[Math.floor(areas.length / 2)];
    const maxArea = areas[areas.length - 1];
    const isThinRing = median < maxArea * 0.35;
    // Label-split fragments are repaired upstream now, so this is only a
    // safety net for genuine slivers. Real micro tiers (aisle-number boxes that
    // share a ring with full B-blocks) sit around 8–12% of the ring median and
    // must survive.
    const ratio = isThinRing ? 0.04 : 0.05;
    const floor = isThinRing ? 18 : 35;
    const minArea = Math.max(floor, median * ratio);
    kept.push(...cluster.filter((block) => block.pixelArea >= minArea));
  }
  return kept;
}

function segmentFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  _tolerance: number = DEFAULT_TRACE_TOLERANCE,
  seedsOnly = false,
): BlockDetectionResult | BlockSeedDiscoveryResult {
  const totalPixels = width * height;
  const maxDim = Math.max(width, height);
  const border = new Uint8Array(totalPixels);
  const pitch = new Uint8Array(totalPixels);
  /** Border pixel that is dark (glyph stroke / outline / dark panel). */
  const dark = new Uint8Array(totalPixels);
  /** Border pixel that is near-white (separator line, label box, white glyph). */
  const bgLike = new Uint8Array(totalPixels);

  let colorSumX = 0;
  let colorSumY = 0;
  let colorWeight = 0;

  // Page background class from the outer frame — decides whether "surrounded
  // by dark pixels" means "sits on a banner" (light page) or nothing (dark page).
  const frame = Math.max(2, Math.round(maxDim * 0.015));
  let frameLight = 0;
  let frameTotal = 0;
  /** Luminance histogram of near-neutral frame pixels — its mode is "page white". */
  const frameNeutralHist = new Int32Array(256);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const idx = y * width + x;
      const inFrame = x < frame || y < frame || x >= width - frame || y >= height - frame;
      if (inFrame) {
        frameTotal += 1;
        if (a < 100 || isBackgroundLike(r, g, b)) {
          frameLight += 1;
        }
        if (a >= 100 && Math.max(r, g, b) - Math.min(r, g, b) < 40) {
          frameNeutralHist[Math.round(lum(r, g, b)) & 255] += 1;
        }
      }
      if (isBorderPixel(r, g, b, a)) {
        border[idx] = 1;
        if (a >= 100 && isDarkPixel(r, g, b)) {
          dark[idx] = 1;
        } else if (a < 100 || isBackgroundLike(r, g, b)) {
          bgLike[idx] = 1;
        }
        continue;
      }
      if (isPitchPixel(r, g, b)) {
        pitch[idx] = 1;
      }
      const l = lum(r, g, b);
      if (l > 40 && l < 240) {
        colorSumX += x * l;
        colorSumY += y * l;
        colorWeight += l;
      }
    }
  }
  const pageIsLight = frameTotal === 0 || frameLight / frameTotal >= 0.5;

  const EDGE_SUM = 55;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      if (border[idx] || pitch[idx]) {
        continue;
      }
      const i = idx * 4;
      const ri = data[i];
      const gi = data[i + 1];
      const bi = data[i + 2];
      const rIdx = (idx + 1) * 4;
      const dIdx = (idx + width) * 4;
      const drIdx = (idx + width + 1) * 4;
      const dlIdx = (idx + width - 1) * 4;
      const dRight =
        Math.abs(ri - data[rIdx]) + Math.abs(gi - data[rIdx + 1]) + Math.abs(bi - data[rIdx + 2]);
      const dDown =
        Math.abs(ri - data[dIdx]) + Math.abs(gi - data[dIdx + 1]) + Math.abs(bi - data[dIdx + 2]);
      const dDiagR =
        Math.abs(ri - data[drIdx]) +
        Math.abs(gi - data[drIdx + 1]) +
        Math.abs(bi - data[drIdx + 2]);
      const dDiagL =
        Math.abs(ri - data[dlIdx]) +
        Math.abs(gi - data[dlIdx + 1]) +
        Math.abs(bi - data[dlIdx + 2]);
      if (dRight > EDGE_SUM || dDown > EDGE_SUM || dDiagR > EDGE_SUM || dDiagL > EDGE_SUM) {
        border[idx] = 1;
        if (isDarkPixel(ri, gi, bi)) {
          dark[idx] = 1;
        } else if (isBackgroundLike(ri, gi, bi)) {
          bgLike[idx] = 1;
        }
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Pale seating blocks: neutral fills that are not separator lines          */
  /* ---------------------------------------------------------------------- */

  // Some charts draw a whole tier in pale grey (an unsold/!on-sale tier at
  // ~#ececec). Block fill and separator line then sit in the same "near-white
  // neutral" band, so isBorderPixel's fixed thresholds mark the entire block as
  // border and it never seeds a region — every pale block silently disappears.
  //
  // The two are separable by *how far below page white* they sit: the line and
  // the page are at white, the fill is measurably darker. Split on that, then
  // keep only components that behave like a block rather than a line — enclosed
  // (the page background reaches the image edge), thick enough to survive an
  // erosion (lines are a few px), and block-sized. Rescued pixels stop being
  // border, so region growing treats them like any other block colour.
  let pageWhiteLum = 0;
  {
    let modeCount = 0;
    for (let l = 150; l < 256; l += 1) {
      if (frameNeutralHist[l] > modeCount) {
        modeCount = frameNeutralHist[l];
        pageWhiteLum = l;
      }
    }
    // Only meaningful on a light page whose white level we actually measured.
    if (pageIsLight && pageWhiteLum >= 200) {
      const paleCeil = pageWhiteLum - PALE_BELOW_PAGE_WHITE;
      const minPaleArea = Math.max(35, totalPixels * 0.000025);
      const maxPaleArea = totalPixels * 0.08;
      const isPaleCandidate = (p: number): boolean => {
        if (!bgLike[p] || pitch[p]) {
          return false;
        }
        const pi = p * 4;
        return data[pi + 3] >= 100 && lum(data[pi], data[pi + 1], data[pi + 2]) < paleCeil;
      };
      const seenPale = new Uint8Array(totalPixels);
      const comp: number[] = [];
      for (let start = 0; start < totalPixels; start += 1) {
        if (seenPale[start] || !isPaleCandidate(start)) {
          continue;
        }
        comp.length = 0;
        comp.push(start);
        seenPale[start] = 1;
        let minX = start % width;
        let maxX = minX;
        let minY = (start - minX) / width;
        let maxY = minY;
        let touchesFrame = false;
        for (let k = 0; k < comp.length; k += 1) {
          const cur = comp[k];
          const x = cur % width;
          const y = (cur - x) / width;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
            touchesFrame = true;
          }
          if (x > 0 && !seenPale[cur - 1] && isPaleCandidate(cur - 1)) {
            seenPale[cur - 1] = 1;
            comp.push(cur - 1);
          }
          if (x < width - 1 && !seenPale[cur + 1] && isPaleCandidate(cur + 1)) {
            seenPale[cur + 1] = 1;
            comp.push(cur + 1);
          }
          if (y > 0 && !seenPale[cur - width] && isPaleCandidate(cur - width)) {
            seenPale[cur - width] = 1;
            comp.push(cur - width);
          }
          if (y < height - 1 && !seenPale[cur + width] && isPaleCandidate(cur + width)) {
            seenPale[cur + width] = 1;
            comp.push(cur + width);
          }
        }
        // The page background reaches the image edge; a seating block does not.
        if (touchesFrame || comp.length < minPaleArea || comp.length > maxPaleArea) {
          continue;
        }
        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        if (bw < 3 || bh < 3 || comp.length / (bw * bh) < 0.2) {
          continue;
        }
        // A separator line (or an anti-aliasing rim beside one) is a few px wide
        // and vanishes under erosion; a block keeps a solid core.
        const local = new Uint8Array(bw * bh);
        for (const p of comp) {
          const px = p % width;
          const py = (p - px) / width;
          local[(py - minY) * bw + (px - minX)] = 1;
        }
        const core = erodeWindow(local, bw, bh, PALE_CORE_RADIUS);
        let coreCount = 0;
        for (let i = 0; i < core.length; i += 1) {
          coreCount += core[i];
        }
        if (coreCount < 8 || coreCount < comp.length * 0.08) {
          continue;
        }
        // Loop 1 skipped these as border, so they never reached the chart-centre
        // centroid. On a chart that is mostly pale that would drag the centre off
        // the bowl and mis-assign every ring, so fold them in now.
        for (const p of comp) {
          border[p] = 0;
          bgLike[p] = 0;
          const pi = p * 4;
          const pl = lum(data[pi], data[pi + 1], data[pi + 2]);
          if (pl > 40 && pl < 240) {
            const px = p % width;
            colorSumX += px * pl;
            colorSumY += ((p - px) / width) * pl;
            colorWeight += pl;
          }
        }
      }
    }
  }

  const cx = colorWeight > 0 ? colorSumX / colorWeight : width / 2;
  const cy = colorWeight > 0 ? colorSumY / colorWeight : height / 2;
  isolateMainPitch(pitch, width, height, totalPixels, cx, cy);

  // Pitch bbox (pixel space) — regions inside it are pitch markings, not seats.
  let pitchMinX = width;
  let pitchMinY = height;
  let pitchMaxX = -1;
  let pitchMaxY = -1;
  for (let p = 0; p < totalPixels; p += 1) {
    if (!pitch[p]) {
      continue;
    }
    const px = p % width;
    const py = (p - px) / width;
    if (px < pitchMinX) pitchMinX = px;
    if (px > pitchMaxX) pitchMaxX = px;
    if (py < pitchMinY) pitchMinY = py;
    if (py > pitchMaxY) pitchMaxY = py;
  }
  const hasPitchBox = pitchMaxX > pitchMinX && pitchMaxY > pitchMinY;
  const insidePitchBox = (x: number, y: number): boolean => {
    if (!hasPitchBox) {
      return false;
    }
    const inset = Math.max(2, Math.min(pitchMaxX - pitchMinX, pitchMaxY - pitchMinY) * 0.04);
    return (
      x > pitchMinX + inset && x < pitchMaxX - inset && y > pitchMinY + inset && y < pitchMaxY - inset
    );
  };

  /* ---------------------------------------------------------------------- */
  /* Printed labels: small dark connected components are "text" and passable */
  /* ---------------------------------------------------------------------- */

  // Glyph clusters ("107", "B45", outlined "141") are compact dark blobs no
  // larger than a few % of the image. Block outlines / banners / dark stands
  // form far larger components and stay hard borders.
  const textMaxPx = Math.max(24, Math.min(64, Math.round(maxDim * 0.045)));
  const text = new Uint8Array(totalPixels);
  {
    const compSeen = new Uint8Array(totalPixels);
    const comp: number[] = [];
    /** Glyph-shaped dark blobs that border light pixels — candidate drop shadows
     *  of light glyphs ("440" printed white with a dark shadow). */
    const shadowCands: number[][] = [];
    for (let start = 0; start < totalPixels; start += 1) {
      if (!dark[start] || compSeen[start]) {
        continue;
      }
      comp.length = 0;
      comp.push(start);
      compSeen[start] = 1;
      let minX = start % width;
      let maxX = minX;
      let minY = (start - minX) / width;
      let maxY = minY;
      let touchesFrame = false;
      for (let k = 0; k < comp.length; k += 1) {
        const cur = comp[k];
        const x = cur % width;
        const y = (cur - x) / width;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
          touchesFrame = true;
        }
        for (let dy = -1; dy <= 1; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            if (nx < 0 || nx >= width || (dx === 0 && dy === 0)) continue;
            const n = ny * width + nx;
            if (dark[n] && !compSeen[n]) {
              compSeen[n] = 1;
              comp.push(n);
            }
          }
        }
        // Stop expanding once it is clearly not a label — saves work on outlines.
        if (comp.length > textMaxPx * textMaxPx) {
          break;
        }
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const longSide = Math.max(bw, bh);
      const shortSide = Math.min(bw, bh);
      // Glyphs fill a fair share of their bbox; a thin separator line (axis
      // aligned → extreme aspect, diagonal → near-empty bbox) does not.
      const fillRatio = comp.length / (bw * bh);
      let isGlyphCluster =
        !touchesFrame &&
        comp.length >= 6 &&
        comp.length <= textMaxPx * textMaxPx &&
        longSide <= textMaxPx &&
        shortSide >= 3 &&
        longSide / shortSide < 7 &&
        fillRatio >= 0.12;
      // The dark *outline* of a tiny box is glyph-sized too, but it encloses
      // most of its bbox (the box interior); glyph strokes enclose at most the
      // small counters of "0", "8", "D".
      if (isGlyphCluster) {
        const reached = new Uint8Array(bw * bh);
        const stackQ: number[] = [];
        for (let yy = minY; yy <= maxY; yy += 1) {
          for (let xx = minX; xx <= maxX; xx += 1) {
            const onEdge = yy === minY || yy === maxY || xx === minX || xx === maxX;
            if (onEdge && !dark[yy * width + xx]) {
              const li = (yy - minY) * bw + (xx - minX);
              reached[li] = 1;
              stackQ.push(li);
            }
          }
        }
        let open = stackQ.length;
        while (stackQ.length > 0) {
          const li = stackQ.pop()!;
          const lx = li % bw;
          const ly = (li - lx) / bw;
          const nbrs: Array<[number, number]> = [
            [lx - 1, ly],
            [lx + 1, ly],
            [lx, ly - 1],
            [lx, ly + 1],
          ];
          for (const [nx, ny] of nbrs) {
            if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
            const ni = ny * bw + nx;
            if (reached[ni] || dark[(minY + ny) * width + minX + nx]) continue;
            reached[ni] = 1;
            open += 1;
            stackQ.push(ni);
          }
        }
        const enclosed = bw * bh - comp.length - open;
        if (enclosed > bw * bh * 0.45) {
          isGlyphCluster = false;
        }
        // A broken frame (three sides of a tiny box) lies entirely on its bbox
        // perimeter; glyph strokes cross the interior.
        if (isGlyphCluster && bw >= 6 && bh >= 6) {
          let onPerimeter = 0;
          for (const p of comp) {
            const x = p % width;
            const y = (p - x) / width;
            if (x === minX || x === maxX || y === minY || y === maxY) {
              onPerimeter += 1;
            }
          }
          if (onPerimeter >= comp.length * 0.85) {
            isGlyphCluster = false;
          }
        }
      }
      // A glyph printed on a block is surrounded by block colour. A fragment of
      // a dark block *outline* (JPEG breaks outlines into short dashes) always
      // runs alongside the light separator — so are outlined white glyphs, which
      // are handled later as holes / label notches instead.
      if (isGlyphCluster) {
        let outsideN = 0;
        let lightN = 0;
        for (const p of comp) {
          const x = p % width;
          const y = (p - x) / width;
          const check = (n: number): void => {
            if (dark[n]) {
              return;
            }
            outsideN += 1;
            if (bgLike[n]) {
              lightN += 1;
            }
          };
          if (x > 0) check(p - 1);
          if (x < width - 1) check(p + 1);
          if (y > 0) check(p - width);
          if (y < height - 1) check(p + width);
        }
        if (outsideN === 0 || lightN / outsideN > 0.12) {
          isGlyphCluster = false;
          if (outsideN > 0) {
            shadowCands.push(comp.slice());
          }
        }
      }
      if (isGlyphCluster) {
        for (const p of comp) {
          text[p] = 1;
        }
      }
    }

    // Light glyphs with a dark drop shadow ("440" in white on saturated blue):
    // the shadow is a glyph-shaped dark blob and the glyph body is a small
    // light blob hugging it. A separator line next to an outline dash is light
    // too, but it runs on past the dash — so only light blobs that stay within
    // a few px of shadow pixels everywhere count as glyph bodies.
    if (shadowCands.length > 0) {
      const SHADOW_REACH = 3;
      const isLight = (p: number): boolean => border[p] === 1 && !dark[p] && !pitch[p];
      const lightSeen = new Int32Array(totalPixels);
      const lightComp: number[] = [];
      const acceptedBodies: Array<{ cand: number; pixels: number[]; revoked: boolean }> = [];
      for (let ci = 0; ci < shadowCands.length; ci += 1) {
        const c = shadowCands[ci];
        const stamp = ci + 1;
        // "Near" is measured from *this* shadow only — a chain of outline dashes
        // along a separator must not jointly cover the line.
        let cMinX = width;
        let cMinY = height;
        let cMaxX = -1;
        let cMaxY = -1;
        for (const p of c) {
          const px = p % width;
          const py = (p - px) / width;
          if (px < cMinX) cMinX = px;
          if (px > cMaxX) cMaxX = px;
          if (py < cMinY) cMinY = py;
          if (py > cMaxY) cMaxY = py;
        }
        const wx0 = Math.max(0, cMinX - SHADOW_REACH - 1);
        const wy0 = Math.max(0, cMinY - SHADOW_REACH - 1);
        const wx1 = Math.min(width - 1, cMaxX + SHADOW_REACH + 1);
        const wy1 = Math.min(height - 1, cMaxY + SHADOW_REACH + 1);
        const ww = wx1 - wx0 + 1;
        const wh = wy1 - wy0 + 1;
        const local = new Uint8Array(ww * wh);
        for (const p of c) {
          const px = p % width;
          const py = (p - px) / width;
          local[(py - wy0) * ww + (px - wx0)] = 1;
        }
        const localNear = dilateWindow(local, ww, wh, SHADOW_REACH);
        const nearShadow = (p: number): boolean => {
          const px = p % width;
          const py = (p - px) / width;
          if (px < wx0 || px > wx1 || py < wy0 || py > wy1) {
            return false;
          }
          return localNear[(py - wy0) * ww + (px - wx0)] === 1;
        };
        // The shadow of "339" is one blob; each digit body is its own light blob.
        for (const p of c) {
          const px = p % width;
          const py = (p - px) / width;
          const starts = [p - 1, p + 1, p - width, p + width];
          for (let si = 0; si < 4; si += 1) {
            const s = starts[si];
            if (
              (si === 0 && px === 0) ||
              (si === 1 && px === width - 1) ||
              (si === 2 && py === 0) ||
              (si === 3 && py === height - 1)
            ) {
              continue;
            }
            if (lightSeen[s] === stamp || text[s] || !isLight(s) || !nearShadow(s)) {
              continue;
            }
            lightComp.length = 0;
            lightComp.push(s);
            lightSeen[s] = stamp;
            let leaks = false;
            let lMinX = s % width;
            let lMaxX = lMinX;
            let lMinY = (s - lMinX) / width;
            let lMaxY = lMinY;
            for (let k = 0; k < lightComp.length && !leaks; k += 1) {
              const cur = lightComp[k];
              const x = cur % width;
              const y = (cur - x) / width;
              if (x < lMinX) lMinX = x;
              if (x > lMaxX) lMaxX = x;
              if (y < lMinY) lMinY = y;
              if (y > lMaxY) lMaxY = y;
              if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
                leaks = true;
                break;
              }
              for (const n of [cur - 1, cur + 1, cur - width, cur + width]) {
                if (!isLight(n)) {
                  continue;
                }
                if (!nearShadow(n)) {
                  leaks = true;
                  break;
                }
                if (lightSeen[n] !== stamp) {
                  lightSeen[n] = stamp;
                  lightComp.push(n);
                }
              }
              if (lightComp.length > textMaxPx * textMaxPx) {
                leaks = true;
              }
            }
            if (leaks) {
              continue;
            }
            const lw = lMaxX - lMinX + 1;
            const lh = lMaxY - lMinY + 1;
            if (lightComp.length < 4 || Math.max(lw, lh) > textMaxPx) {
              continue;
            }
            // A glyph body is mostly near-white; a mid-tone anti-aliasing strip
            // sandwiched between a dark separator edge and block colour is not.
            let whiteN = 0;
            for (const q of lightComp) {
              if (bgLike[q]) {
                whiteN += 1;
              }
            }
            if (whiteN < lightComp.length * 0.5) {
              continue;
            }
            for (const q of lightComp) {
              text[q] = 1;
            }
            acceptedBodies.push({ cand: ci, pixels: lightComp.slice(), revoked: false });
          }
        }
      }

      // A glyph whose shadow crosses a separator cuts a short piece out of the
      // line's light core; that piece passes every test above but is collinear
      // with the rest of the line — light, non-text pixels sit right past the
      // shadow. Revoke such bodies (real glyph bodies are surrounded by block
      // colour and their own shadow). Revoking one body can expose another, so
      // iterate to a fixpoint.
      const nearNonTextLight = (pixels: number[]): boolean => {
        for (const q of pixels) {
          const qx = q % width;
          const qy = (q - qx) / width;
          for (let dy = -2; dy <= 2; dy += 1) {
            const ny = qy + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -2; dx <= 2; dx += 1) {
              const nx = qx + dx;
              if (nx < 0 || nx >= width) continue;
              const n = ny * width + nx;
              if (bgLike[n] && !text[n]) {
                return true;
              }
            }
          }
        }
        return false;
      };
      for (let changed = true; changed; ) {
        changed = false;
        for (const body of acceptedBodies) {
          if (body.revoked || !nearNonTextLight(body.pixels)) {
            continue;
          }
          body.revoked = true;
          changed = true;
          for (const q of body.pixels) {
            text[q] = 0;
          }
        }
      }
      const bodyLight = new Int32Array(shadowCands.length);
      for (const body of acceptedBodies) {
        if (!body.revoked) {
          bodyLight[body.cand] += body.pixels.length;
        }
      }
      for (let ci = 0; ci < shadowCands.length; ci += 1) {
        const c = shadowCands[ci];
        if (bodyLight[ci] < c.length * 0.3) {
          continue;
        }
        // Only the shadow pixels hugging an accepted glyph body become text. The
        // same dark blob may continue as the dark edge of a separator (a glyph
        // touching the line joins the two) — that part must stay a hard border,
        // as must any dark pixel touching the (non-text) light separator core.
        for (const q of c) {
          const qx = q % width;
          const qy = (q - qx) / width;
          let nearBody = false;
          for (let dy = -SHADOW_REACH; dy <= SHADOW_REACH && !nearBody; dy += 1) {
            const ny = qy + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -SHADOW_REACH; dx <= SHADOW_REACH; dx += 1) {
              const nx = qx + dx;
              if (nx < 0 || nx >= width) continue;
              const n = ny * width + nx;
              if (text[n] && !dark[n]) {
                nearBody = true;
                break;
              }
            }
          }
          if (!nearBody) {
            continue;
          }
          const touchesCore =
            (qx > 0 && bgLike[q - 1] && !text[q - 1]) ||
            (qx < width - 1 && bgLike[q + 1] && !text[q + 1]) ||
            (qy > 0 && bgLike[q - width] && !text[q - width]) ||
            (qy < height - 1 && bgLike[q + width] && !text[q + width]);
          if (!touchesCore) {
            text[q] = 1;
          }
        }
      }
    }
    // Anti-aliased halo around glyphs (mid-tone edge pixels) is text too, but
    // never a light separator pixel — a label touching a separator must not
    // open a path into the neighbouring block.
    const halo = new Uint8Array(totalPixels);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const idx = y * width + x;
        if (!border[idx] || text[idx] || bgLike[idx] || pitch[idx]) {
          continue;
        }
        const hi = idx * 4;
        if (lum(data[hi], data[hi + 1], data[hi + 2]) >= 185) {
          continue;
        }
        // Anything touching the light core of a separator line (its dark edge,
        // its anti-aliased rim) is never halo — a glyph that touches the line
        // would otherwise open a path across it into the neighbouring block.
        if (
          (bgLike[idx - 1] && !text[idx - 1]) ||
          (bgLike[idx + 1] && !text[idx + 1]) ||
          (bgLike[idx - width] && !text[idx - width]) ||
          (bgLike[idx + width] && !text[idx + width])
        ) {
          continue;
        }
        if (text[idx - 1] || text[idx + 1] || text[idx - width] || text[idx + width]) {
          halo[idx] = 1;
        }
      }
    }
    for (let i = 0; i < totalPixels; i += 1) {
      if (halo[i]) {
        text[i] = 1;
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Region growing (4-connected), passing through the block's own label     */
  /* ---------------------------------------------------------------------- */

  const labels = new Int32Array(totalPixels);
  let nextLabel = 1;
  interface Region {
    label: number;
    sumR: number;
    sumG: number;
    sumB: number;
    /** All pixels, including absorbed label glyphs. */
    count: number;
    /** Coloured (non-glyph) pixels — colour average only. */
    colorCount: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    radiusSum: number;
  }
  const regions: Region[] = [];
  const regionByLabel = new Map<number, Region>();
  const stack: number[] = [];
  const LUM_TOLERANCE = 55;
  /** Plain block-to-block growth (summed RGB distance to the running mean). */
  const RGB_TOLERANCE = 120;
  /** Growth out of a glyph / soft-edge pixel — must clearly be the same block. */
  const STRICT_RGB_TOLERANCE = 45;
  /** Gradient-only border pixel that still counts as block colour. */
  const SOFT_EDGE_TOLERANCE = 60;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      if (border[idx] || pitch[idx] || labels[idx] !== 0) {
        continue;
      }
      const seedI = idx * 4;
      const seedR = data[seedI];
      const seedG = data[seedI + 1];
      const seedB = data[seedI + 2];
      const seedLum = lum(seedR, seedG, seedB);
      const label = nextLabel;
      nextLabel += 1;
      labels[idx] = label;
      const region: Region = {
        label,
        sumR: 0,
        sumG: 0,
        sumB: 0,
        count: 0,
        colorCount: 0,
        minX: x,
        minY: y,
        maxX: x,
        maxY: y,
        radiusSum: 0,
      };
      stack.push(idx);
      while (stack.length > 0) {
        const cur = stack.pop()!;
        const cxPx = cur % width;
        const cyPx = (cur - cxPx) / width;
        const pi = cur * 4;
        region.count += 1;
        if (!text[cur]) {
          region.sumR += data[pi];
          region.sumG += data[pi + 1];
          region.sumB += data[pi + 2];
          region.colorCount += 1;
        }
        if (cxPx < region.minX) region.minX = cxPx;
        if (cxPx > region.maxX) region.maxX = cxPx;
        if (cyPx < region.minY) region.minY = cyPx;
        if (cyPx > region.maxY) region.maxY = cyPx;
        region.radiusSum += polarFromCenter(cxPx, cyPx, cx, cy, width, height).radiusPct;
        for (const n of [cur - 1, cur + 1, cur - width, cur + width]) {
          const nx = n % width;
          const ny = (n - nx) / width;
          if (nx <= 0 || ny <= 0 || nx >= width - 1 || ny >= height - 1) {
            continue;
          }
          if (labels[n] !== 0 || pitch[n]) {
            continue;
          }
          const ni = n * 4;
          const nr = data[ni];
          const ng = data[ni + 1];
          const nb = data[ni + 2];
          const inv = 1 / Math.max(1, region.colorCount);
          const mr = region.colorCount > 0 ? region.sumR * inv : seedR;
          const mg = region.colorCount > 0 ? region.sumG * inv : seedG;
          const mb = region.colorCount > 0 ? region.sumB * inv : seedB;
          if (border[n]) {
            // Glyph pixels are absorbed (the label belongs to this block).
            if (text[n]) {
              labels[n] = label;
              stack.push(n);
              continue;
            }
            // Gradient-only border pixels (JPEG ringing, sub-pixel shading) are
            // block colour when they match the running mean closely — without
            // this, a small block with a printed number shatters into slivers.
            // Separator lines and outlines (near-white / dark) always stop the fill.
            if (
              !dark[n] &&
              !bgLike[n] &&
              colorDistance(mr, mg, mb, nr, ng, nb) <= SOFT_EDGE_TOLERANCE &&
              Math.abs(lum(nr, ng, nb) - seedLum) <= LUM_TOLERANCE
            ) {
              labels[n] = label;
              stack.push(n);
              continue;
            }
            continue;
          }
          if (Math.abs(lum(nr, ng, nb) - seedLum) > LUM_TOLERANCE) {
            continue;
          }
          // Stepping out of a glyph / soft-edge pixel may land in a neighbour
          // block — require a tight colour match against the running mean (the
          // scan-order seed pixel is often an anti-aliased edge pixel).
          const strict = text[cur] || border[cur];
          if (colorDistance(mr, mg, mb, nr, ng, nb) > (strict ? STRICT_RGB_TOLERANCE : RGB_TOLERANCE)) {
            continue;
          }
          labels[n] = label;
          stack.push(n);
        }
      }
      regions.push(region);
      regionByLabel.set(label, region);
    }
  }

  const minArea = Math.max(35, totalPixels * 0.000025);
  const maxArea = totalPixels * 0.08;
  const legendY = height * 0.88;
  type RawBlock = SegmentedRawBlock & { label: number };

  const rawBlocks: RawBlock[] = [];
  const cvSeeds: Array<CvBlockSeed & { pixelArea: number; meanRadius: number }> = [];

  // Pick an actual pixel that belongs to `region`, nearest the bbox centre, so
  // the flood-fill seed always lands on the right block (never on a neighbour or
  // a white label) — the bbox centre of an L-shaped/label-split region can miss.
  const seedPixelForRegion = (
    label: number,
    bcx: number,
    bcy: number,
    bMinX: number,
    bMinY: number,
    bMaxX: number,
    bMaxY: number,
  ): { x: number; y: number } => {
    const rcx = Math.round(bcx);
    const rcy = Math.round(bcy);
    if (rcx >= 0 && rcy >= 0 && rcx < width && rcy < height && labels[rcy * width + rcx] === label) {
      return { x: rcx, y: rcy };
    }
    const maxR = Math.max(bMaxX - bMinX, bMaxY - bMinY);
    for (let r = 1; r <= maxR; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) {
            continue;
          }
          const x = rcx + dx;
          const y = rcy + dy;
          if (x < 0 || y < 0 || x >= width || y >= height) {
            continue;
          }
          if (labels[y * width + x] === label) {
            return { x, y };
          }
        }
      }
    }
    return { x: rcx, y: rcy };
  };

  const passesShapeGate = (region: Region): boolean => {
    if (region.count < minArea || region.count > maxArea || region.colorCount === 0) {
      return false;
    }
    const bw = region.maxX - region.minX + 1;
    const bh = region.maxY - region.minY + 1;
    if (bw < 3 || bh < 3) {
      return false;
    }
    const shortSide = Math.max(1, Math.min(bw, bh));
    const aspect = Math.max(bw, bh) / shortSide;
    if (aspect > 45 || (aspect > 18 && shortSide < 3)) {
      return false;
    }
    // Diagonal slivers between blocks fill almost none of their bbox.
    if (region.count / (bw * bh) < 0.2) {
      return false;
    }
    return true;
  };

  // Typical block area, used to tell the lowest real seating row apart from the
  // small colour swatches in the legend that sits below the bowl.
  const candidateAreas: number[] = [];
  const candidateLabels = new Set<number>();
  for (const region of regions) {
    if (passesShapeGate(region)) {
      candidateAreas.push(region.count);
      candidateLabels.add(region.label);
    }
  }
  const medianBlockArea = candidateAreas.length
    ? [...candidateAreas].sort((a, b) => a - b)[Math.floor(candidateAreas.length / 2)]
    : 0;

  const regionMeanRgb = (r: Region): [number, number, number] => {
    const inv = 1 / Math.max(1, r.colorCount);
    return [r.sumR * inv, r.sumG * inv, r.sumB * inv];
  };

  // Pitch markings and thin slivers next to small blocks are not seating.
  for (const region of regions) {
    if (!candidateLabels.has(region.label)) {
      continue;
    }
    const bw = region.maxX - region.minX + 1;
    const bh = region.maxY - region.minY + 1;
    if (insidePitchBox((region.minX + region.maxX) / 2, (region.minY + region.maxY) / 2)) {
      candidateLabels.delete(region.label);
      continue;
    }
    if (
      medianBlockArea > 0 &&
      region.count < medianBlockArea * 0.3 &&
      Math.max(bw, bh) / Math.max(1, Math.min(bw, bh)) > 8
    ) {
      candidateLabels.delete(region.label);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Stand names printed in grey ("MAIN STAND"): rows of glyph-sized regions  */
  /* ---------------------------------------------------------------------- */
  {
    const glyphCands: Region[] = [];
    for (const region of regions) {
      if (!candidateLabels.has(region.label)) {
        continue;
      }
      const bw = region.maxX - region.minX + 1;
      const bh = region.maxY - region.minY + 1;
      const [mr, mg, mb] = regionMeanRgb(region);
      const chroma = Math.max(mr, mg, mb) - Math.min(mr, mg, mb);
      const small =
        region.count <= Math.max(minArea * 6, medianBlockArea * 0.2) && Math.max(bw, bh) <= textMaxPx;
      if (small && chroma < 40 && region.count / (bw * bh) <= 0.85) {
        glyphCands.push(region);
      }
    }
    if (glyphCands.length >= 3) {
      const parent = new Map<number, number>();
      const find = (l: number): number => {
        let root = l;
        while (parent.get(root) !== undefined && parent.get(root) !== root) {
          root = parent.get(root)!;
        }
        return root;
      };
      const union = (a: number, b: number): void => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) {
          parent.set(ra, rb);
        }
      };
      for (const g of glyphCands) {
        parent.set(g.label, g.label);
      }
      for (let i = 0; i < glyphCands.length; i += 1) {
        const a = glyphCands[i];
        const aw = a.maxX - a.minX + 1;
        const ah = a.maxY - a.minY + 1;
        for (let j = i + 1; j < glyphCands.length; j += 1) {
          const b = glyphCands[j];
          const bw2 = b.maxX - b.minX + 1;
          const bh2 = b.maxY - b.minY + 1;
          const gapX = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
          const gapY = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
          const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
          const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
          const hRow =
            Math.min(ah, bh2) / Math.max(ah, bh2) >= 0.5 &&
            overlapY >= Math.min(ah, bh2) * 0.5 &&
            gapX <= Math.max(ah, bh2) * 1.5;
          const vRow =
            Math.min(aw, bw2) / Math.max(aw, bw2) >= 0.5 &&
            overlapX >= Math.min(aw, bw2) * 0.5 &&
            gapY <= Math.max(aw, bw2) * 1.5;
          if (hRow || vRow) {
            union(a.label, b.label);
          }
        }
      }
      const rowSize = new Map<number, number>();
      for (const g of glyphCands) {
        const root = find(g.label);
        rowSize.set(root, (rowSize.get(root) ?? 0) + 1);
      }
      for (const g of glyphCands) {
        if ((rowSize.get(find(g.label)) ?? 0) >= 3) {
          candidateLabels.delete(g.label);
        }
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Reunite blocks split in two by their own printed label                  */
  /* ---------------------------------------------------------------------- */
  // A white outlined "139" running edge to edge cuts a block into two same-
  // colour halves. The strip between two such halves is label-like: it holds
  // dark glyph strokes/shadows *in its interior* (a separator's only dark
  // pixels are block outlines hugging the halves) and is not mostly a plain
  // white line. Halves are relabelled into one region before repair.
  {
    const cands = regions.filter((r) => candidateLabels.has(r.label));
    const dropped = new Set<number>();
    const maxGap = textMaxPx;
    const mergeInto = (a: Region, b: Region): void => {
      for (let y = b.minY; y <= b.maxY; y += 1) {
        for (let x = b.minX; x <= b.maxX; x += 1) {
          const idx = y * width + x;
          if (labels[idx] === b.label) {
            labels[idx] = a.label;
          }
        }
      }
      a.sumR += b.sumR;
      a.sumG += b.sumG;
      a.sumB += b.sumB;
      a.count += b.count;
      a.colorCount += b.colorCount;
      a.radiusSum += b.radiusSum;
      a.minX = Math.min(a.minX, b.minX);
      a.minY = Math.min(a.minY, b.minY);
      a.maxX = Math.max(a.maxX, b.maxX);
      a.maxY = Math.max(a.maxY, b.maxY);
      candidateLabels.delete(b.label);
      dropped.add(b.label);
    };
    const isLabelSplit = (a: Region, b: Region): boolean => {
      const [ar, ag, ab] = regionMeanRgb(a);
      const [br, bg, bb] = regionMeanRgb(b);
      if (colorDistance(ar, ag, ab, br, bg, bb) > 40) {
        return false;
      }
      if (a.count + b.count > maxArea) {
        return false;
      }
      const gapX = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
      const gapY = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
      if (gapX > maxGap || gapY > maxGap) {
        return false;
      }
      const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
      const minW = Math.min(a.maxX - a.minX, b.maxX - b.minX) + 1;
      const minH = Math.min(a.maxY - a.minY, b.maxY - b.minY) + 1;
      if (overlapX < minW * 0.5 && overlapY < minH * 0.5) {
        return false;
      }
      // Union window with room for the dilations.
      const pad = Math.ceil(maxGap / 2) + 3;
      const wx0 = Math.max(0, Math.min(a.minX, b.minX) - pad);
      const wy0 = Math.max(0, Math.min(a.minY, b.minY) - pad);
      const wx1 = Math.min(width - 1, Math.max(a.maxX, b.maxX) + pad);
      const wy1 = Math.min(height - 1, Math.max(a.maxY, b.maxY) + pad);
      const ww = wx1 - wx0 + 1;
      const wh = wy1 - wy0 + 1;
      const maskA = new Uint8Array(ww * wh);
      const maskB = new Uint8Array(ww * wh);
      for (let y = wy0; y <= wy1; y += 1) {
        for (let x = wx0; x <= wx1; x += 1) {
          const l = labels[y * width + x];
          const li = (y - wy0) * ww + (x - wx0);
          if (l === a.label) {
            maskA[li] = 1;
          } else if (l === b.label) {
            maskB[li] = 1;
          }
        }
      }
      // Glyph holes inside either half are that half's own label, not the gap.
      fillMaskHoles(maskA, ww, wh, (hole) => hole.length <= a.count);
      fillMaskHoles(maskB, ww, wh, (hole) => hole.length <= b.count);
      const both = new Uint8Array(ww * wh);
      for (let i = 0; i < both.length; i += 1) {
        both[i] = maskA[i] | maskB[i];
      }
      // Distance between the halves = min distance between their boundary pixels.
      const boundary = (mask: Uint8Array): number[] => {
        const out: number[] = [];
        for (let y = 0; y < wh; y += 1) {
          for (let x = 0; x < ww; x += 1) {
            const i = y * ww + x;
            if (!mask[i]) {
              continue;
            }
            if (
              x === 0 ||
              y === 0 ||
              x === ww - 1 ||
              y === wh - 1 ||
              !mask[i - 1] ||
              !mask[i + 1] ||
              !mask[i - ww] ||
              !mask[i + ww]
            ) {
              out.push(i);
            }
          }
        }
        return out;
      };
      const bA = boundary(maskA);
      const bB = boundary(maskB);
      let minDist2 = Infinity;
      for (const pa of bA) {
        const ax = pa % ww;
        const ay = (pa - ax) / ww;
        for (const pb of bB) {
          const bx = pb % ww;
          const by = (pb - bx) / ww;
          const d2 = (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
          if (d2 < minDist2) {
            minDist2 = d2;
          }
        }
      }
      const gapPx = Math.sqrt(minDist2) - 1;
      // A separator line (white + block outlines) is only a few px; a label strip
      // is a glyph tall.
      if (!(gapPx >= 6 && gapPx <= maxGap)) {
        return false;
      }
      const d = Math.ceil(gapPx / 2) + 2;
      const da = dilateWindow(maskA, ww, wh, d);
      const db = dilateWindow(maskB, ww, wh, d);
      const hug = dilateWindow(both, ww, wh, 2);
      let total = 0;
      let darkN = 0;
      let interiorDark = 0;
      let lightN = 0;
      let otherBlock = 0;
      for (let i = 0; i < da.length; i += 1) {
        if (!da[i] || !db[i] || both[i]) {
          continue;
        }
        const lx = i % ww;
        const ly = (i - lx) / ww;
        const g = (wy0 + ly) * width + (wx0 + lx);
        total += 1;
        const l = labels[g];
        if (pitch[g] || (l !== 0 && l !== a.label && l !== b.label && candidateLabels.has(l))) {
          otherBlock += 1;
        }
        if (dark[g]) {
          darkN += 1;
          if (!hug[i]) {
            interiorDark += 1;
          }
        } else if (bgLike[g]) {
          lightN += 1;
        }
      }
      if (total < 6 || otherBlock > 0) {
        return false;
      }
      return (
        darkN >= total * 0.08 &&
        interiorDark >= Math.max(3, total * 0.03) &&
        lightN <= total * 0.65
      );
    };
    for (let pass = 0; pass < 2; pass += 1) {
      let mergedAny = false;
      for (let i = 0; i < cands.length; i += 1) {
        const a = cands[i];
        if (dropped.has(a.label)) {
          continue;
        }
        for (let j = i + 1; j < cands.length; j += 1) {
          const b = cands[j];
          if (dropped.has(b.label)) {
            continue;
          }
          if (
            b.minX > a.maxX + maxGap ||
            b.maxX < a.minX - maxGap ||
            b.minY > a.maxY + maxGap ||
            b.maxY < a.minY - maxGap
          ) {
            continue;
          }
          if (isLabelSplit(a, b)) {
            mergeInto(a, b);
            mergedAny = true;
          }
        }
      }
      if (!mergedAny) {
        break;
      }
    }
  }

  // Oversized coloured regions that are not the page background (bbox does not
  // wrap the chart centre) are artwork panels — banners, title bars.
  const panelLabels = new Set<number>();
  for (const region of regions) {
    if (region.count <= maxArea) {
      continue;
    }
    const wrapsCentre =
      region.minX <= cx && region.maxX >= cx && region.minY <= cy && region.maxY >= cy;
    const coversPage = (region.maxX - region.minX) * (region.maxY - region.minY) > totalPixels * 0.6;
    if (!wrapsCentre && !coversPage) {
      panelLabels.add(region.label);
    }
  }

  for (const region of regions) {
    if (!candidateLabels.has(region.label)) {
      continue;
    }
    const centroidX = (region.minX + region.maxX) / 2;
    const centroidY = (region.minY + region.maxY) / 2;
    // Below the bowl sits the colour legend — small swatches, not seating. Only
    // reject genuinely small regions there; the lowest seating row (e.g. the
    // 403–409 blocks at the very bottom of the arc) is full block size and must
    // survive, even though it dips past the old flat legend cut-off.
    if (centroidY > legendY && region.count < medianBlockArea * 0.4) {
      continue;
    }
    if (Math.hypot(centroidX - cx, centroidY - cy) < Math.min(width, height) * 0.07) {
      continue;
    }
    const meanRadius = region.radiusSum / Math.max(1, region.count);

    if (seedsOnly) {
      const seed = seedPixelForRegion(
        region.label,
        centroidX,
        centroidY,
        region.minX,
        region.minY,
        region.maxX,
        region.maxY,
      );
      const xPct = (seed.x / width) * 100;
      const yPct = (seed.y / height) * 100;
      if (!cvSeeds.some((existing) => Math.hypot(existing.xPct - xPct, existing.yPct - yPct) < 1.2)) {
        cvSeeds.push({
          source: 'cv',
          xPct,
          yPct,
          regionLabel: region.label,
          regionMinX: region.minX,
          regionMinY: region.minY,
          regionMaxX: region.maxX,
          regionMaxY: region.maxY,
          fillColorHint: rgbToHex(
            region.sumR / region.colorCount,
            region.sumG / region.colorCount,
            region.sumB / region.colorCount,
          ),
          pixelArea: region.count,
          meanRadius,
        });
      }
      continue;
    }

    /* -------------------------------------------------------------------- */
    /* Mask repair: fill label holes, close thin notches, then trace          */
    /* -------------------------------------------------------------------- */

    const bw = region.maxX - region.minX + 1;
    const bh = region.maxY - region.minY + 1;
    const closeRadius = Math.max(1, Math.min(6, Math.round(Math.min(bw, bh) * 0.08)));
    const bigRadius = Math.min(24, Math.max(closeRadius + 1, Math.round(Math.min(bw, bh) * 0.3)));
    const margin = bigRadius + 2;
    const winX = Math.max(0, region.minX - margin);
    const winY = Math.max(0, region.minY - margin);
    const winMaxX = Math.min(width - 1, region.maxX + margin);
    const winMaxY = Math.min(height - 1, region.maxY + margin);
    const winW = winMaxX - winX + 1;
    const winH = winMaxY - winY + 1;
    const mask = new Uint8Array(winW * winH);
    for (let y = winY; y <= winMaxY; y += 1) {
      for (let x = winX; x <= winMaxX; x += 1) {
        if (labels[y * width + x] === region.label) {
          mask[(y - winY) * winW + (x - winX)] = 1;
        }
      }
    }
    const toGlobal = (i: number): number => {
      const lx = i % winW;
      const ly = (i - lx) / winW;
      return (winY + ly) * width + (winX + lx);
    };
    // A pixel may be taken over by this block's repair unless it is pitch or
    // belongs to another *real* (candidate) block.
    const claimable = (g: number): boolean => {
      if (pitch[g]) {
        return false;
      }
      const other = labels[g];
      return other === 0 || other === region.label || !candidateLabels.has(other);
    };

    // 0. Reclaim the anti-aliased rim.
    //
    //    A rendered edge blends block colour into the page over ~1 px, and those
    //    rim pixels fail the absolute SOFT_EDGE_TOLERANCE test, so every block is
    //    traced ~1 px inside its true edge on each side. That is invisible on a
    //    70 px block but removes a fifth of the height of a 14 px bar or a narrow
    //    entrance arrow, which is why thin elements come out visibly skinny.
    //
    //    Whether a rim pixel belongs to the block is a *relative* question, so
    //    decide it by nearest colour: reclaim it only when it is at least as
    //    close to this block's mean as it is to the page. Never reclaim the light
    //    core of a separator, a dark outline, another real block, or the pitch —
    //    so neighbours still cannot bleed into each other.
    {
      const [mr0, mg0, mb0] = regionMeanRgb(region);
      const pageLum = pageWhiteLum >= 200 ? pageWhiteLum : 255;
      const rim: number[] = [];
      for (let i = 0; i < mask.length; i += 1) {
        if (mask[i]) {
          continue;
        }
        const lx = i % winW;
        const ly = (i - lx) / winW;
        const touches =
          (lx > 0 && mask[i - 1]) ||
          (lx < winW - 1 && mask[i + 1]) ||
          (ly > 0 && mask[i - winW]) ||
          (ly < winH - 1 && mask[i + winW]);
        if (!touches) {
          continue;
        }
        const g = toGlobal(i);
        if (!border[g] || bgLike[g] || dark[g] || !claimable(g)) {
          continue;
        }
        const gi = g * 4;
        const toBlock = colorDistance(mr0, mg0, mb0, data[gi], data[gi + 1], data[gi + 2]);
        const toPage = colorDistance(pageLum, pageLum, pageLum, data[gi], data[gi + 1], data[gi + 2]);
        if (toBlock <= toPage) {
          rim.push(i);
        }
      }
      for (const i of rim) {
        mask[i] = 1;
      }
    }

    // 1. Holes — white glyphs, label boxes, outlined-text interiors.
    fillMaskHoles(mask, winW, winH, (hole) => {
      if (hole.length > region.count) {
        return false;
      }
      let blocked = 0;
      for (const p of hole) {
        if (!claimable(toGlobal(p))) {
          blocked += 1;
        }
      }
      return blocked <= hole.length * 0.15;
    });

    // 2. Thin notches where a glyph or label touched the block edge.
    const closed = erodeWindow(dilateWindow(mask, winW, winH, closeRadius), winW, winH, closeRadius);
    for (let i = 0; i < mask.length; i += 1) {
      if (!mask[i] && closed[i] && claimable(toGlobal(i))) {
        mask[i] = 1;
      }
    }

    // 3. Wide notches: a label (white glyphs / label box) that runs into the
    //    block's separator opens the label area to the outside, so it is not a
    //    hole. A much larger closing proposes fills; each proposed patch is
    //    accepted only when it looks like a label — compact (not a sliver along
    //    a curved edge), made of border pixels, small next to the block, and
    //    not overlapping any other real block or the pitch.
    if (bigRadius > closeRadius && winW > 2 * bigRadius + 2 && winH > 2 * bigRadius + 2) {
      const bigClosed = erodeWindow(dilateWindow(mask, winW, winH, bigRadius), winW, winH, bigRadius);
      const seen = new Uint8Array(mask.length);
      const patch: number[] = [];
      for (let start = 0; start < mask.length; start += 1) {
        if (mask[start] || !bigClosed[start] || seen[start]) {
          continue;
        }
        patch.length = 0;
        patch.push(start);
        seen[start] = 1;
        let pMinX = start % winW;
        let pMaxX = pMinX;
        let pMinY = (start - pMinX) / winW;
        let pMaxY = pMinY;
        if (!claimable(toGlobal(start))) {
          continue;
        }
        let borderCount = 0;
        let touchesOtherBlock = 0;
        for (let k = 0; k < patch.length; k += 1) {
          const cur = patch[k];
          const lx = cur % winW;
          const ly = (cur - lx) / winW;
          if (lx < pMinX) pMinX = lx;
          if (lx > pMaxX) pMaxX = lx;
          if (ly < pMinY) pMinY = ly;
          if (ly > pMaxY) pMaxY = ly;
          if (border[toGlobal(cur)]) {
            borderCount += 1;
          }
          // Other real blocks / the pitch are barriers: the patch never grows
          // into them, and a patch that leans on one is not a label notch.
          const tryPush = (n: number): void => {
            if (mask[n] || !bigClosed[n] || seen[n]) {
              return;
            }
            if (!claimable(toGlobal(n))) {
              touchesOtherBlock += 1;
              return;
            }
            seen[n] = 1;
            patch.push(n);
          };
          if (lx > 0) tryPush(cur - 1);
          if (lx < winW - 1) tryPush(cur + 1);
          if (ly > 0) tryPush(cur - winW);
          if (ly < winH - 1) tryPush(cur + winW);
        }
        const pw = pMaxX - pMinX + 1;
        const ph = pMaxY - pMinY + 1;
        const aspect = Math.max(pw, ph) / Math.max(1, Math.min(pw, ph));
        // Label-shaped (compact), or a shallow dent along an edge (thin but tiny
        // next to the block). Long slivers along a curved edge are neither.
        const compact = aspect <= 4 || patch.length <= region.count * 0.08;
        const isLabelPatch =
          touchesOtherBlock <= patch.length * 0.15 &&
          compact &&
          patch.length <= region.count * 0.5 &&
          borderCount >= patch.length * 0.6;
        if (isLabelPatch) {
          for (const p of patch) {
            mask[p] = 1;
          }
        }
      }
    }

    // 3. Reject slivers: a real block survives a 1-px erosion.
    let maskCount = 0;
    for (let i = 0; i < mask.length; i += 1) {
      maskCount += mask[i];
    }
    if (maskCount < minArea) {
      continue;
    }
    if (medianBlockArea > 0 && maskCount < medianBlockArea * 0.3) {
      const eroded = erodeWindow(mask, winW, winH, 1);
      let erodedCount = 0;
      for (let i = 0; i < eroded.length; i += 1) {
        erodedCount += eroded[i];
      }
      if (erodedCount < 8 || erodedCount < maskCount * 0.25) {
        continue;
      }
    }

    // Commit the repaired mask so the contour tracer (and dedup) see it.
    let rMinX = width;
    let rMinY = height;
    let rMaxX = 0;
    let rMaxY = 0;
    for (let i = 0; i < mask.length; i += 1) {
      if (!mask[i]) {
        continue;
      }
      const g = toGlobal(i);
      labels[g] = region.label;
      const gx = g % width;
      const gy = (g - gx) / width;
      if (gx < rMinX) rMinX = gx;
      if (gx > rMaxX) rMaxX = gx;
      if (gy < rMinY) rMinY = gy;
      if (gy > rMaxY) rMaxY = gy;
    }

    const polygon = extractBoundaryPolygon(
      labels,
      region.label,
      width,
      height,
      rMinX,
      rMinY,
      rMaxX,
      rMaxY,
    );
    if (polygon.length < 3) {
      continue;
    }
    const fillColor = rgbToHex(
      region.sumR / region.colorCount,
      region.sumG / region.colorCount,
      region.sumB / region.colorCount,
    );

    // Pixel-space bbox + centroid of the traced outline (for dedup + nesting).
    let pMinX = Infinity;
    let pMinY = Infinity;
    let pMaxX = -Infinity;
    let pMaxY = -Infinity;
    for (const p of polygon) {
      const px = (p.xPct / 100) * width;
      const py = (p.yPct / 100) * height;
      if (px < pMinX) pMinX = px;
      if (px > pMaxX) pMaxX = px;
      if (py < pMinY) pMinY = py;
      if (py > pMaxY) pMaxY = py;
    }
    const cXpct = ((pMinX + pMaxX) / 2 / width) * 100;
    const cYpct = ((pMinY + pMaxY) / 2 / height) * 100;

    // Dedup: two regions resolving to the same outline — keep only the first.
    if (rawBlocks.some((b) => pointInPolygon(cXpct, cYpct, b.polygon))) {
      continue;
    }

    rawBlocks.push({
      label: region.label,
      polygon,
      cxPct: cXpct,
      cyPct: cYpct,
      fillColor,
      meanRadius,
      pixelArea: maskCount,
      minX: pMinX,
      minY: pMinY,
      maxX: pMaxX,
      maxY: pMaxY,
    });
  }

  let pitchResult: DetectedPitch | null = null;
  const smoothRadius = Math.max(2, Math.round(maxDim * 0.004));
  const smoothedPitch = closeMask(pitch, width, height, smoothRadius);
  let smoothMinX = width;
  let smoothMinY = height;
  let smoothMaxX = 0;
  let smoothMaxY = 0;
  let smoothPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!smoothedPitch[y * width + x]) {
        continue;
      }
      smoothPixels += 1;
      smoothMinX = Math.min(smoothMinX, x);
      smoothMinY = Math.min(smoothMinY, y);
      smoothMaxX = Math.max(smoothMaxX, x);
      smoothMaxY = Math.max(smoothMaxY, y);
    }
  }
  if (smoothPixels > totalPixels * 0.003) {
    const pad = Math.max(1, smoothRadius);
    const bboxW = smoothMaxX - smoothMinX + 1;
    const bboxH = smoothMaxY - smoothMinY + 1;
    const cxPct = ((smoothMinX + smoothMaxX) / 2 / width) * 100;
    const cyPct = ((smoothMinY + smoothMaxY) / 2 / height) * 100;
    const wPct = Math.max(2, ((smoothMaxX - smoothMinX + pad) / width) * 100);
    const hPct = Math.max(2, ((smoothMaxY - smoothMinY + pad) / height) * 100);
    const fillRatio = bboxW * bboxH > 0 ? smoothPixels / (bboxW * bboxH) : 0;
    const aspect = bboxH > 0 ? bboxW / bboxH : 1;
    let detectedShape: DetectedPitchShape = 'oval';
    if (fillRatio >= 0.82) {
      detectedShape = 'rectangle';
    } else if (aspect >= 0.85 && aspect <= 1.15) {
      detectedShape = 'circle';
    }
    pitchResult = {
      name: 'Pitch',
      detectedShape,
      position: { xPct: cxPct, yPct: cyPct },
      size: { wPct, hPct },
    };
  }

  if (seedsOnly) {
    const keptSeeds = dropTinyFragmentBlocks(cvSeeds);
    const seeds: CvBlockSeed[] = keptSeeds.map(
      ({ pixelArea: _pixelArea, meanRadius: _meanRadius, ...seed }) => seed,
    );
    return {
      width,
      height,
      data,
      seeds,
      labels,
      pitch: pitchResult,
      notes: `Discovered ${seeds.length} CV seed(s) for batch trace.`,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Non-chart artwork filters                                               */
  /* ---------------------------------------------------------------------- */

  // (a) Blocks sitting on a dark banner / artwork panel: the ring just outside
  //     the block is dominated by non-glyph dark pixels or by panel pixels.
  //     Only meaningful on a light page — on a dark page every block would match.
  const onArtworkPanel = (b: RawBlock): boolean => {
    const side = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    const inner = 2;
    const outer = Math.max(6, Math.round(side * 0.1));
    const x0 = Math.max(0, Math.floor(b.minX) - outer);
    const y0 = Math.max(0, Math.floor(b.minY) - outer);
    const x1 = Math.min(width - 1, Math.ceil(b.maxX) + outer);
    const y1 = Math.min(height - 1, Math.ceil(b.maxY) + outer);
    const ix0 = Math.floor(b.minX) - inner;
    const iy0 = Math.floor(b.minY) - inner;
    const ix1 = Math.ceil(b.maxX) + inner;
    const iy1 = Math.ceil(b.maxY) + inner;
    let total = 0;
    let panel = 0;
    for (let y = y0; y <= y1; y += 1) {
      const inRowBand = y < iy0 || y > iy1;
      for (let x = x0; x <= x1; x += 1) {
        if (!inRowBand && x >= ix0 && x <= ix1) {
          continue;
        }
        const idx = y * width + x;
        if (labels[idx] === b.label) {
          continue;
        }
        total += 1;
        if (panelLabels.has(labels[idx])) {
          panel += 1;
        } else if (pageIsLight && dark[idx] && !text[idx]) {
          panel += 1;
        }
      }
    }
    return total > 0 && panel / total >= 0.6;
  };

  // (b) Legend swatches / stray icons: a small block in the outer band of the
  //     page with no other block anywhere near it.
  const isIsolatedArtwork = (b: RawBlock, all: RawBlock[]): boolean => {
    const bx = (b.cxPct / 100) * width;
    const by = (b.cyPct / 100) * height;
    const inOuterBand =
      by < height * 0.15 || by > height * 0.85 || bx < width * 0.1 || bx > width * 0.9;
    if (!inOuterBand) {
      return false;
    }
    if (medianBlockArea > 0 && b.pixelArea > medianBlockArea * 1.5) {
      return false;
    }
    const side = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    const reach = Math.max(side * 2.5, maxDim * 0.02);
    for (const other of all) {
      if (other === b) {
        continue;
      }
      const gapX = Math.max(0, Math.max(b.minX, other.minX) - Math.min(b.maxX, other.maxX));
      const gapY = Math.max(0, Math.max(b.minY, other.minY) - Math.min(b.maxY, other.maxY));
      if (Math.max(gapX, gapY) <= reach) {
        return false;
      }
    }
    return true;
  };

  const nested = suppressNestedLabelBoxes(rawBlocks);
  const withoutPanels = nested.filter((b) => !onArtworkPanel(b));
  const withoutIsolated = withoutPanels.filter((b) => !isIsolatedArtwork(b, withoutPanels));
  const keptBlocks = dropTinyFragmentBlocks(withoutIsolated);

  const layerCount = resolveLayerCount(keptBlocks.length);
  const ringCenters = clusterRadii(
    keptBlocks.map((b) => b.meanRadius),
    layerCount,
  ).sort((a, b) => a - b);

  const blocks: DetectedBlock[] = keptBlocks.map((b, i) => {
    let ringIndex = 0;
    let bestDist = Infinity;
    for (let r = 0; r < ringCenters.length; r += 1) {
      const d = Math.abs(b.meanRadius - ringCenters[r]);
      if (d < bestDist) {
        bestDist = d;
        ringIndex = r;
      }
    }
    return {
      id: i + 1,
      name: '',
      polygon: b.polygon,
      cxPct: b.cxPct,
      cyPct: b.cyPct,
      fillColor: b.fillColor,
      ringIndex,
      pixelArea: b.pixelArea,
    };
  });

  const confidence: BlockDetectionResult['confidence'] =
    blocks.length >= 20 ? 'high' : blocks.length >= 8 ? 'medium' : 'low';

  return {
    width,
    height,
    blocks,
    pitch: pitchResult,
    stands: [],
    confidence,
    notes: `Detected ${blocks.length} seating blocks across ${ringCenters.length} ring(s) using border segmentation.`,
  };
}

/**
 * Detect seating blocks from an uploaded image file (runs in the browser).
 * `tolerance` is the colour-distance sensitivity used by the per-block trace
 * (same value as the Trace-mode "Colour sensitivity" slider).
 */
export async function detectBlocksFromFile(
  file: File,
  tolerance: number = DEFAULT_TRACE_TOLERANCE,
): Promise<BlockDetectionResult> {
  const image = await loadAnalysisImageFromFile(file);
  return detectBlocksFromImageData(image, tolerance);
}

/** Load and downscale an image for CV analysis (shared with OCR recovery). */
export async function loadAnalysisImageFromFile(file: File): Promise<AnalysisImageData> {
  const bitmap = await loadImageBitmap(file);
  const scale = analysisScaleForWidth(bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Could not create analysis canvas.');
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return { data: imageData.data, width, height };
}

/** Run block segmentation on a pre-loaded analysis image. */
export function detectBlocksFromImageData(
  image: AnalysisImageData,
  tolerance: number = DEFAULT_TRACE_TOLERANCE,
): BlockDetectionResult {
  return segmentFromImageData(image.data, image.width, image.height, tolerance, false) as BlockDetectionResult;
}

/** Discover CV region seeds for batch trace (no per-block flood fill). */
export function detectBlockSeedsFromImageData(
  image: AnalysisImageData,
  tolerance: number = DEFAULT_TRACE_TOLERANCE,
): BlockSeedDiscoveryResult {
  return segmentFromImageData(image.data, image.width, image.height, tolerance, true) as BlockSeedDiscoveryResult;
}

function loadImageBitmap(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load the image.'));
    };
    img.src = url;
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

/** Rebuild a File from a data URL (for OCR on saved reference charts). */
export async function dataUrlToFile(dataUrl: string, filename = 'chart.png'): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const type = blob.type || 'image/png';
  return new File([blob], filename, { type });
}
