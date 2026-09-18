/**
 * Client-side dining floor-plan blueprint analysis.
 * 1) Detect venue components (tables, chairs, stage, food prep, entrance/exit).
 * 2) Infer layout structure (banquet / grid / staggered) and aisle corridors.
 * 3) Emit a blueprint the 2D editor can recreate as editable dining elements.
 */

export interface DetectedDiningTable {
  xPct: number;
  yPct: number;
  shape: 'round' | 'rectangular';
  wPct: number;
  hPct: number;
  /** Small-dot chair count from the reference (exact — no extras). */
  seats: number;
  /** Head / VIP banquet table vs guest seating. */
  role?: 'head' | 'guest';
  /**
   * True when the detected blob includes the chair ring (merged ink).
   * Used to shrink metre size so the tabletop matches the reference top,
   * because the editor draws chairs outside widthM/depthM again.
   */
  includesChairs?: boolean;
  /**
   * Edges with no chair dots in the reference (0=top, 1=right, 2=bottom, 3=left).
   * Chairs are drawn only on the sides that had small dots.
   */
  suppressedChairEdges?: number[];
  /** Exact small-dot count per edge [top, right, bottom, left]. */
  seatsByEdge?: [number, number, number, number];
}

export interface DetectedDiningFeature {
  kind: 'stage' | 'food-prep' | 'exit' | 'entrance';
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  label?: string;
}

/** Corridor / aisle inferred between table clusters — becomes a service route. */
export interface DetectedDiningAisle {
  points: Array<{ xPct: number; yPct: number }>;
  widthPct: number;
  orientation: 'horizontal' | 'vertical';
}

export type DiningLayoutPattern =
  | 'banquet'
  | 'grid'
  | 'staggered'
  | 'mixed'
  | 'unknown';

export interface DiningLayoutStructure {
  pattern: DiningLayoutPattern;
  tableCount: number;
  roundCount: number;
  rectangularCount: number;
  rowCount: number;
  columnCount: number;
  hasHeadTable: boolean;
  hasStage: boolean;
  hasExit: boolean;
  hasEntrance: boolean;
  hasFoodPrep: boolean;
  aisleCount: number;
  summary: string;
}

export interface DiningLayoutContentBounds {
  minXPct: number;
  minYPct: number;
  maxXPct: number;
  maxYPct: number;
}

export interface DiningLayoutDetectionResult {
  width: number;
  height: number;
  contentBounds: DiningLayoutContentBounds;
  tables: DetectedDiningTable[];
  features: DetectedDiningFeature[];
  aisles: DetectedDiningAisle[];
  structure: DiningLayoutStructure;
  confidence: 'low' | 'medium' | 'high';
  notes: string;
}

const MAX_ANALYSIS_WIDTH = 1000;
const CONTENT_PADDING_PX = 4;

interface Component {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
  pixels: number;
}

interface ContentBoundsPx {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface NormalizedBlob {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  area: number;
  circularity: number;
  aspect: number;
}

function lum(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function isInkPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 120) {
    return false;
  }
  const l = lum(r, g, b);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  // Ignore white/near-white background and light gray room borders or grid lines.
  if (l > 175 && chroma < 35) {
    return false;
  }
  // Floor-plan marks are typically dark ink or saturated accents.
  return l < 175 || chroma > 35;
}

function findContentBoundsPx(mask: Uint8Array, width: number, height: number): ContentBoundsPx | null {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) {
        continue;
      }
      found = true;
      if (x < minX) {
        minX = x;
      }
      if (x > maxX) {
        maxX = x;
      }
      if (y < minY) {
        minY = y;
      }
      if (y > maxY) {
        maxY = y;
      }
    }
  }

  if (!found) {
    return null;
  }

  return trimSparseContentMargins(
    {
      minX: Math.max(0, minX - CONTENT_PADDING_PX),
      minY: Math.max(0, minY - CONTENT_PADDING_PX),
      maxX: Math.min(width - 1, maxX + CONTENT_PADDING_PX),
      maxY: Math.min(height - 1, maxY + CONTENT_PADDING_PX),
    },
    mask,
    width,
    height,
  );
}

/** Drop nearly-empty rows/columns so reference overlays don't show large blank margins. */
function trimSparseContentMargins(
  bounds: ContentBoundsPx,
  mask: Uint8Array,
  width: number,
  height: number,
): ContentBoundsPx {
  const minInkPerRow = Math.max(4, Math.floor((bounds.maxX - bounds.minX + 1) * 0.004));
  const minInkPerCol = Math.max(4, Math.floor((bounds.maxY - bounds.minY + 1) * 0.004));

  let { minX, minY, maxX, maxY } = bounds;

  while (maxY > minY) {
    let ink = 0;
    for (let x = minX; x <= maxX; x += 1) {
      if (mask[maxY * width + x]) {
        ink += 1;
      }
    }
    if (ink >= minInkPerRow) {
      break;
    }
    maxY -= 1;
  }

  while (minY < maxY) {
    let ink = 0;
    for (let x = minX; x <= maxX; x += 1) {
      if (mask[minY * width + x]) {
        ink += 1;
      }
    }
    if (ink >= minInkPerRow) {
      break;
    }
    minY += 1;
  }

  while (maxX > minX) {
    let ink = 0;
    for (let y = minY; y <= maxY; y += 1) {
      if (mask[y * width + maxX]) {
        ink += 1;
      }
    }
    if (ink >= minInkPerCol) {
      break;
    }
    maxX -= 1;
  }

  while (minX < maxX) {
    let ink = 0;
    for (let y = minY; y <= maxY; y += 1) {
      if (mask[y * width + minX]) {
        ink += 1;
      }
    }
    if (ink >= minInkPerCol) {
      break;
    }
    minX += 1;
  }

  return { minX, minY, maxX, maxY };
}

function normalizeWithinContent(
  cx: number,
  cy: number,
  w: number,
  h: number,
  bounds: ContentBoundsPx,
): NormalizedBlob {
  const contentW = Math.max(1, bounds.maxX - bounds.minX + 1);
  const contentH = Math.max(1, bounds.maxY - bounds.minY + 1);
  const bboxArea = Math.max(1, w * h);
  return {
    xPct: ((cx - bounds.minX) / contentW) * 100,
    yPct: ((cy - bounds.minY) / contentH) * 100,
    wPct: (w / contentW) * 100,
    hPct: (h / contentH) * 100,
    area: w * h,
    circularity: 0,
    aspect: w / Math.max(h, 1),
  };
}

function contentBoundsToPct(bounds: ContentBoundsPx, width: number, height: number): DiningLayoutContentBounds {
  return {
    minXPct: (bounds.minX / width) * 100,
    minYPct: (bounds.minY / height) * 100,
    maxXPct: ((bounds.maxX + 1) / width) * 100,
    maxYPct: ((bounds.maxY + 1) / height) * 100,
  };
}

function floodComponent(
  mask: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  label: number,
  labels: Int32Array,
): Component | null {
  const stack: number[] = [startY * width + startX];
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;
  let area = 0;

  while (stack.length > 0) {
    const idx = stack.pop()!;
    if (labels[idx] !== 0 || !mask[idx]) {
      continue;
    }
    labels[idx] = label;
    area += 1;
    const x = idx % width;
    const y = (idx / width) | 0;
    if (x < minX) {
      minX = x;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
    if (x > 0) {
      stack.push(idx - 1);
    }
    if (x < width - 1) {
      stack.push(idx + 1);
    }
    if (y > 0) {
      stack.push(idx - width);
    }
    if (y < height - 1) {
      stack.push(idx + width);
    }
  }

  if (area < 8) {
    return null;
  }
  return { minX, minY, maxX, maxY, area, pixels: area };
}

function findComponents(mask: Uint8Array, width: number, height: number): Component[] {
  const labels = new Int32Array(width * height);
  const components: Component[] = [];
  let label = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (!mask[idx] || labels[idx] !== 0) {
        continue;
      }
      label += 1;
      const comp = floodComponent(mask, width, height, x, y, label, labels);
      if (comp) {
        components.push(comp);
      }
    }
  }
  return components;
}

function componentCircularity(comp: Component): number {
  const w = comp.maxX - comp.minX + 1;
  const h = comp.maxY - comp.minY + 1;
  const bboxArea = w * h;
  if (bboxArea <= 0) {
    return 0;
  }
  return comp.area / bboxArea;
}

function isInsideContent(comp: Component, bounds: ContentBoundsPx): boolean {
  const cx = (comp.minX + comp.maxX) / 2;
  const cy = (comp.minY + comp.maxY) / 2;
  return cx >= bounds.minX && cx <= bounds.maxX && cy >= bounds.minY && cy <= bounds.maxY;
}

function isNearPerimeter(xPct: number, yPct: number, margin = 11): boolean {
  return xPct < margin || xPct > 100 - margin || yPct < margin || yPct > 100 - margin;
}

function tableFootprintRadiusPct(table: DetectedDiningTable): number {
  if (table.shape === 'rectangular' && table.wPct > table.hPct * 1.6) {
    return Math.max(4, table.hPct * 0.7);
  }
  return Math.max(4, Math.max(table.wPct, table.hPct) * 0.42);
}

function tablesShareSameSpot(a: DetectedDiningTable, b: DetectedDiningTable): boolean {
  const dist = Math.hypot(a.xPct - b.xPct, a.yPct - b.yPct);
  const mergeRadius = Math.max(tableFootprintRadiusPct(a), tableFootprintRadiusPct(b));
  return dist < mergeRadius;
}

function pickPreferredTable(a: DetectedDiningTable, b: DetectedDiningTable): DetectedDiningTable {
  if (a.seats !== b.seats) {
    return a.seats > b.seats ? a : b;
  }
  const areaA = a.wPct * a.hPct;
  const areaB = b.wPct * b.hPct;
  if (areaA !== areaB) {
    return areaA > areaB ? a : b;
  }
  if (a.shape !== b.shape) {
    return a.shape === 'round' ? a : b;
  }
  return a;
}

/** One reference table → one detected table. Drops overlapping blobs (number rings, double circles). */
function dedupeDetectedTables(tables: DetectedDiningTable[]): DetectedDiningTable[] {
  const sorted = [...tables].sort((a, b) => b.wPct * b.hPct - a.wPct * a.hPct);
  const kept: DetectedDiningTable[] = [];

  for (const table of sorted) {
    const matchIndex = kept.findIndex((other) => tablesShareSameSpot(table, other));
    if (matchIndex >= 0) {
      kept[matchIndex] = pickPreferredTable(kept[matchIndex], table);
      continue;
    }
    kept.push(table);
  }

  return kept;
}

function isDecorativeIcon(table: DetectedDiningTable): boolean {
  const inCorner =
    (table.xPct < 16 && table.yPct < 18) ||
    (table.xPct > 84 && table.yPct < 18) ||
    (table.xPct < 16 && table.yPct > 82) ||
    (table.xPct > 84 && table.yPct > 82);
  return inCorner && table.shape === 'round' && table.seats < 4;
}

function filterDetectedTables(tables: DetectedDiningTable[]): DetectedDiningTable[] {
  return tables.filter((table) => {
    if (isDecorativeIcon(table)) {
      return false;
    }
    // Keep round tables even when chair dots were not found — defaults fill seats later.
    return true;
  });
}

function overlapsDetectedTable(blob: NormalizedBlob, tables: DetectedDiningTable[]): boolean {
  for (const table of tables) {
    const dist = Math.hypot(blob.xPct - table.xPct, blob.yPct - table.yPct);
    const radius = Math.max(table.wPct, table.hPct) * 0.7;
    if (dist < radius) {
      return true;
    }
  }
  return false;
}

/** Exit/arrow markers only conflict if they sit almost on a table center. */
function overlapsTableCore(blob: NormalizedBlob, tables: DetectedDiningTable[]): boolean {
  for (const table of tables) {
    const dist = Math.hypot(blob.xPct - table.xPct, blob.yPct - table.yPct);
    const core = Math.max(table.wPct, table.hPct) * 0.35;
    if (dist < Math.max(3, core)) {
      return true;
    }
  }
  return false;
}

function classifyTableShape(normalized: NormalizedBlob): 'round' | 'rectangular' | null {
  const { aspect, circularity } = normalized;
  const isSquare = aspect > 0.82 && aspect < 1.22 && circularity >= 0.88;
  const isCircleCore =
    !isSquare && circularity >= 0.55 && circularity < 0.9 && aspect > 0.68 && aspect < 1.45;
  const isRoundWithChairs =
    !isSquare && aspect > 0.72 && aspect < 1.5 && circularity >= 0.28 && circularity < 0.68;
  const isRectangle = aspect > 1.35 || aspect < 0.72;

  if (isCircleCore || isRoundWithChairs) {
    return 'round';
  }
  if (isSquare || isRectangle) {
    return 'rectangular';
  }
  if (circularity > 0.45 && aspect < 1.55) {
    return 'round';
  }
  if (aspect >= 0.35 && aspect <= 3.5) {
    return 'rectangular';
  }
  return null;
}

function isBanquetHeadTable(blob: NormalizedBlob): boolean {
  // Long thin bars are banquet / rectangular tables (even when they dominate content bounds).
  const horizontal = blob.aspect > 2.2 || (blob.wPct > 22 && blob.aspect > 1.7);
  const thinBar = blob.aspect > 2.4 || blob.hPct < blob.wPct * 0.55;
  return horizontal && thinBar;
}

/**
 * Arrow, doorway stub, or entrance glyph near the perimeter → exit/entrance marker.
 * Triangles and chevrons have low circularity; door stubs sit on the edge.
 */
function isLikelyExitMarker(blob: NormalizedBlob, areaPx: number, contentArea: number): boolean {
  if (!isNearPerimeter(blob.xPct, blob.yPct, 16)) {
    return false;
  }
  const areaRatio = areaPx / contentArea;
  if (areaRatio > 0.025 || areaRatio < 0.00015) {
    return false;
  }

  const maxDim = Math.max(blob.wPct, blob.hPct);
  const minDim = Math.min(blob.wPct, blob.hPct);
  // Never treat chair dots or round table discs as exits.
  if (isNearCircularBlob(blob) && maxDim <= 3.6) {
    return false;
  }
  if (isNearCircularBlob(blob) && maxDim >= 4.8 && blob.circularity >= 0.65) {
    return false;
  }

  const compact = blob.wPct < 24 && blob.hPct < 24;
  if (!compact) {
    return false;
  }

  const pointerLike = blob.aspect > 1.55 || blob.aspect < 0.65;
  // Triangular arrow heads fill their bbox poorly.
  const arrowLike = blob.circularity > 0 && blob.circularity < 0.62 && maxDim >= 2.5 && maxDim <= 20;
  const doorwayStub = maxDim < 16 && minDim >= 1.2 && isNearPerimeter(blob.xPct, blob.yPct, 10);
  const rightOrLeftGate = (blob.xPct > 80 || blob.xPct < 20) && areaRatio < 0.02 && maxDim < 18;

  return pointerLike || arrowLike || doorwayStub || rightOrLeftGate;
}

function isNearCircularBlob(blob: NormalizedBlob): boolean {
  return blob.aspect > 0.7 && blob.aspect < 1.4 && blob.circularity >= 0.5;
}

/**
 * Reference convention:
 * - Small circular dots → chairs
 * - Larger circular discs → round tables
 * Thresholds adapt when content bounds tightly hug the drawn furniture.
 */
function isChairDotBlob(blob: NormalizedBlob, areaPx: number, _contentArea: number): boolean {
  const maxDimPct = Math.max(blob.wPct, blob.hPct);
  if (maxDimPct > 10 || areaPx < 6 || areaPx > 200) {
    return false;
  }
  // Prefer circular dots; allow slightly imperfect small marks.
  return (
    (blob.circularity >= 0.4 && blob.aspect > 0.55 && blob.aspect < 1.7) ||
    (isNearCircularBlob(blob) && maxDimPct <= 8)
  );
}

function isRoundTableDisc(blob: NormalizedBlob, areaPx: number, contentArea: number): boolean {
  if (!isNearCircularBlob(blob)) {
    return false;
  }
  const maxDimPct = Math.max(blob.wPct, blob.hPct);
  // Big circles — clearly larger than chair dots.
  if (maxDimPct < 7.5 || maxDimPct > 40) {
    return false;
  }
  const areaRatio = areaPx / contentArea;
  return areaPx >= 120 && areaRatio <= 0.15;
}

/** Edge indices: 0=top, 1=right, 2=bottom, 3=left (matches chair renderer). */
function chairEdgeFromOffset(dx: number, dy: number, shape: 'round' | 'rectangular'): number {
  if (shape === 'rectangular') {
    // Banquet / rect: prefer long-side band so end chairs of a top row stay "top", not left/right.
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (dy < 0 && absDy >= absDx * 0.22) {
      return 0;
    }
    if (dy > 0 && absDy >= absDx * 0.22) {
      return 2;
    }
    if (dx >= 0 && absDx >= absDy * 0.22) {
      return 1;
    }
    if (dx < 0 && absDx >= absDy * 0.22) {
      return 3;
    }
  }
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy < 0 ? 0 : 2;
  }
  return dx >= 0 ? 1 : 3;
}

/** When one side owns most rect chairs, snap every count onto that side (reference one-side pattern). */
function snapRectSeatsToDominantSide(counts: [number, number, number, number]): [number, number, number, number] {
  const total = counts[0] + counts[1] + counts[2] + counts[3];
  if (total <= 0) {
    return counts;
  }
  let best = 0;
  for (let i = 1; i < 4; i += 1) {
    if (counts[i] > counts[best]) {
      best = i;
    }
  }
  // Majority (or all-but-one) on one side → force pure one-side layout.
  if (counts[best] >= Math.ceil(total * 0.55) || counts[best] >= total - 1) {
    return [0, 1, 2, 3].map((i) => (i === best ? total : 0)) as [number, number, number, number];
  }
  return counts;
}

/**
 * Assign every small chair-dot to tables matching the reference pattern:
 * 1) Round tables claim orbital ring chairs first (so banquet tables don't steal them).
 * 2) Remaining dots go to rectangular tables along edge bands.
 * 3) Rect with one dominant side → all chairs on that side only.
 * 4) Round with chairs on all 4 quadrants → even ring (no uneven seatsByEdge).
 */
function assignChairsToTables(tables: DetectedDiningTable[], chairBlobs: NormalizedBlob[]): void {
  if (tables.length === 0 || chairBlobs.length === 0) {
    for (const table of tables) {
      table.seats = 0;
      table.suppressedChairEdges = undefined;
      table.seatsByEdge = undefined;
    }
    return;
  }

  const sideCounts = tables.map(() => [0, 0, 0, 0] as [number, number, number, number]);
  const used = new Set<number>();
  const roundIdx: number[] = [];
  const rectIdx: number[] = [];
  for (let t = 0; t < tables.length; t += 1) {
    if (tables[t].shape === 'round') {
      roundIdx.push(t);
    } else {
      rectIdx.push(t);
    }
  }

  const tableRadii = tables.map((table) => {
    const halfW = Math.max(table.wPct, 1) * 0.5;
    const halfH = Math.max(table.hPct, 1) * 0.5;
    return Math.max(halfW, halfH);
  });

  // Phase 1 — round tables claim chairs sitting on their seat orbit.
  for (let i = 0; i < chairBlobs.length; i += 1) {
    const chair = chairBlobs[i];
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const t of roundIdx) {
      const table = tables[t];
      const dx = chair.xPct - table.xPct;
      const dy = chair.yPct - table.yPct;
      const dist = Math.hypot(dx, dy);
      const tableR = tableRadii[t];
      const expectedOrbit = tableR * 2.0;
      const inner = tableR * 0.85;
      const outer = tableR * 3.15;
      if (dist <= inner || dist >= outer) {
        continue;
      }
      // Prefer orbit match over raw nearest-center (prevents head-table theft).
      const score = Math.abs(dist - expectedOrbit) * 2.2 + dist * 0.35;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }

    if (best < 0) {
      continue;
    }
    used.add(i);
    const dx = chair.xPct - tables[best].xPct;
    const dy = chair.yPct - tables[best].yPct;
    const edge = chairEdgeFromOffset(dx, dy, 'round');
    sideCounts[best][edge] += 1;
  }

  // Phase 2 — leftover dots belong to rectangular / banquet tables.
  for (let i = 0; i < chairBlobs.length; i += 1) {
    if (used.has(i)) {
      continue;
    }
    const chair = chairBlobs[i];
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const t of rectIdx) {
      const table = tables[t];
      const dx = chair.xPct - table.xPct;
      const dy = chair.yPct - table.yPct;
      const dist = Math.hypot(dx, dy);
      const halfW = Math.max(table.wPct, 1) * 0.5;
      const halfH = Math.max(table.hPct, 1) * 0.5;
      const outer = Math.hypot(halfW, halfH) + Math.max(6, Math.max(halfW, halfH) * 1.6);
      if (dist >= outer) {
        continue;
      }
      // Must sit clearly outside the table top (band along an edge).
      const insideX = Math.abs(dx) <= halfW * 1.15;
      const insideY = Math.abs(dy) <= halfH * 1.15;
      const outsideTop = dy < -halfH * 0.35 && insideX;
      const outsideBottom = dy > halfH * 0.35 && insideX;
      const outsideRight = dx > halfW * 0.35 && insideY;
      const outsideLeft = dx < -halfW * 0.35 && insideY;
      if (!(outsideTop || outsideBottom || outsideRight || outsideLeft)) {
        continue;
      }
      const score = dist;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }

    if (best < 0) {
      continue;
    }
    used.add(i);
    const dx = chair.xPct - tables[best].xPct;
    const dy = chair.yPct - tables[best].yPct;
    const edge = chairEdgeFromOffset(dx, dy, 'rectangular');
    sideCounts[best][edge] += 1;
  }

  for (let t = 0; t < tables.length; t += 1) {
    let counts = sideCounts[t];
    if (tables[t].shape === 'rectangular') {
      counts = snapRectSeatsToDominantSide(counts);
    }

    const seats = Math.min(12, counts[0] + counts[1] + counts[2] + counts[3]);
    tables[t].seats = seats;

    const activeSides = [0, 1, 2, 3].filter((edge) => counts[edge] > 0);

    if (tables[t].shape === 'round' && activeSides.length === 4) {
      // Full ring — let the renderer space evenly around the circle.
      tables[t].seatsByEdge = undefined;
      tables[t].suppressedChairEdges = undefined;
    } else if (seats > 0 && activeSides.length > 0 && activeSides.length < 4) {
      tables[t].seatsByEdge = [counts[0], counts[1], counts[2], counts[3]];
      tables[t].suppressedChairEdges = [0, 1, 2, 3].filter((edge) => counts[edge] === 0);
    } else if (seats > 0) {
      tables[t].seatsByEdge = [counts[0], counts[1], counts[2], counts[3]];
      tables[t].suppressedChairEdges = undefined;
    } else {
      tables[t].seatsByEdge = undefined;
      tables[t].suppressedChairEdges = undefined;
    }

    if (seats > 0) {
      tables[t].includesChairs = false;
    }
  }
}

function classifyFeature(blob: NormalizedBlob): DetectedDiningFeature['kind'] | null {
  const { xPct, yPct, wPct, hPct, aspect, circularity } = blob;
  const nearEdge = isNearPerimeter(xPct, yPct, 16);
  const compact = wPct < 24 && hPct < 24;
  const arrowLike = circularity > 0 && circularity < 0.62 && compact;
  const pointerLike = aspect > 1.55 || aspect < 0.65;

  // Arrows / entrance glyphs around the perimeter are always exit markers.
  if (nearEdge && compact && (arrowLike || pointerLike || wPct < 14 || hPct < 14)) {
    return 'exit';
  }

  const horizontal = aspect > 2 || wPct > 24;
  const vertical = aspect < 0.55 || hPct > 18;
  if (!horizontal && !vertical) {
    return null;
  }

  const nearTop = yPct < 24;
  const nearBottom = yPct > 76;
  const nearLeft = xPct < 20;
  const nearRight = xPct > 80;

  if (nearTop || nearBottom || wPct > 32) {
    return 'stage';
  }
  if (nearLeft || nearRight) {
    return 'food-prep';
  }
  return 'stage';
}

function clusterPctValues(values: number[], tolerance = 8): number[] {
  if (values.length === 0) {
    return [];
  }
  const sorted = [...values].sort((a, b) => a - b);
  const centers: number[] = [];
  let group: number[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - group[group.length - 1] <= tolerance) {
      group.push(sorted[i]);
    } else {
      centers.push(group.reduce((s, v) => s + v, 0) / group.length);
      group = [sorted[i]];
    }
  }
  centers.push(group.reduce((s, v) => s + v, 0) / group.length);
  return centers;
}

/** Infer walkway corridors between table columns/rows from the reference arrangement. */
function inferAislesFromTables(tables: DetectedDiningTable[]): DetectedDiningAisle[] {
  if (tables.length < 2) {
    return [];
  }

  const guestTables = tables.filter((t) => t.role !== 'head');
  const pool = guestTables.length >= 2 ? guestTables : tables;
  const colCenters = clusterPctValues(pool.map((t) => t.xPct), 10);
  const rowCenters = clusterPctValues(pool.map((t) => t.yPct), 10);
  const aisles: DetectedDiningAisle[] = [];

  const yMin = Math.min(...pool.map((t) => t.yPct));
  const yMax = Math.max(...pool.map((t) => t.yPct));
  const xMin = Math.min(...pool.map((t) => t.xPct));
  const xMax = Math.max(...pool.map((t) => t.xPct));

  for (let i = 0; i < colCenters.length - 1; i += 1) {
    const gap = colCenters[i + 1] - colCenters[i];
    if (gap < 12 || gap > 45) {
      continue;
    }
    const midX = (colCenters[i] + colCenters[i + 1]) / 2;
    aisles.push({
      points: [
        { xPct: midX, yPct: Math.max(8, yMin - 6) },
        { xPct: midX, yPct: Math.min(92, yMax + 6) },
      ],
      widthPct: Math.min(10, gap * 0.35),
      orientation: 'vertical',
    });
  }

  for (let i = 0; i < rowCenters.length - 1; i += 1) {
    const gap = rowCenters[i + 1] - rowCenters[i];
    if (gap < 12 || gap > 40) {
      continue;
    }
    const midY = (rowCenters[i] + rowCenters[i + 1]) / 2;
    aisles.push({
      points: [
        { xPct: Math.max(8, xMin - 6), yPct: midY },
        { xPct: Math.min(92, xMax + 6), yPct: midY },
      ],
      widthPct: Math.min(10, gap * 0.35),
      orientation: 'horizontal',
    });
  }

  // Prefer a few main corridors to keep the layout editable and clear.
  return aisles.slice(0, 4);
}

function assignTableRoles(tables: DetectedDiningTable[]): void {
  if (tables.length === 0) {
    return;
  }
  let headIndex = -1;
  let bestScore = -1;
  for (let i = 0; i < tables.length; i += 1) {
    const t = tables[i];
    if (t.shape !== 'rectangular') {
      continue;
    }
    const horizontal = t.wPct >= t.hPct * 1.35;
    const nearTop = t.yPct < 32;
    const wide = t.wPct > 18;
    const score = (horizontal ? 3 : 0) + (nearTop ? 2 : 0) + (wide ? 2 : 0) + t.wPct / 20;
    if (score > bestScore) {
      bestScore = score;
      headIndex = i;
    }
  }
  for (let i = 0; i < tables.length; i += 1) {
    tables[i].role = i === headIndex && bestScore >= 4 ? 'head' : 'guest';
  }
}

function analyzeLayoutStructure(
  tables: DetectedDiningTable[],
  features: DetectedDiningFeature[],
  aisles: DetectedDiningAisle[],
): DiningLayoutStructure {
  const guest = tables.filter((t) => t.role !== 'head');
  const pool = guest.length > 0 ? guest : tables;
  const rowCount = clusterPctValues(pool.map((t) => t.yPct), 10).length;
  const columnCount = clusterPctValues(pool.map((t) => t.xPct), 10).length;
  const roundCount = tables.filter((t) => t.shape === 'round').length;
  const rectangularCount = tables.filter((t) => t.shape === 'rectangular').length;
  const hasHeadTable = tables.some((t) => t.role === 'head');

  let pattern: DiningLayoutPattern = 'unknown';
  if (hasHeadTable && roundCount >= 2) {
    pattern = 'banquet';
  } else if (rowCount >= 2 && columnCount >= 2) {
    const countsPerRow = clusterPctValues(pool.map((t) => t.yPct), 10).map((rowY) =>
      pool.filter((t) => Math.abs(t.yPct - rowY) <= 10).length,
    );
    const staggered = countsPerRow.some((c, i) => i > 0 && c !== countsPerRow[0]);
    pattern = staggered ? 'staggered' : 'grid';
  } else if (rectangularCount > 0 && roundCount > 0) {
    pattern = 'mixed';
  } else if (tables.length > 0) {
    pattern = rectangularCount >= roundCount ? 'mixed' : 'grid';
  }

  const hasStage = features.some((f) => f.kind === 'stage');
  const hasExit = features.some((f) => f.kind === 'exit');
  const hasEntrance = features.some((f) => f.kind === 'entrance');
  const hasFoodPrep = features.some((f) => f.kind === 'food-prep');

  const parts: string[] = [];
  parts.push(`${tables.length} table${tables.length === 1 ? '' : 's'}`);
  if (hasHeadTable) {
    parts.push('head table');
  }
  if (rowCount > 0 && columnCount > 0) {
    parts.push(`${rowCount}×${columnCount} seating`);
  }
  if (aisles.length > 0) {
    parts.push(`${aisles.length} aisle${aisles.length === 1 ? '' : 's'}`);
  }
  if (hasStage) {
    parts.push('stage');
  }
  if (hasEntrance) {
    parts.push('entrance');
  }
  if (hasExit) {
    parts.push('exit');
  }
  if (hasFoodPrep) {
    parts.push('food prep');
  }

  return {
    pattern,
    tableCount: tables.length,
    roundCount,
    rectangularCount,
    rowCount,
    columnCount,
    hasHeadTable,
    hasStage,
    hasExit,
    hasEntrance,
    hasFoodPrep,
    aisleCount: aisles.length,
    summary: `Detected ${pattern} layout: ${parts.join(', ')}.`,
  };
}

export function detectDiningLayoutFromImageData(
  data: ImageData,
  width: number,
  height: number,
): DiningLayoutDetectionResult {
  const mask = new Uint8Array(width * height);
  const pixels = data.data;
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    mask[i] = isInkPixel(pixels[o], pixels[o + 1], pixels[o + 2], pixels[o + 3]) ? 1 : 0;
  }

  const contentBoundsPx =
    findContentBoundsPx(mask, width, height) ??
    ({ minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 } satisfies ContentBoundsPx);
  const contentBounds = contentBoundsToPct(contentBoundsPx, width, height);
  const contentArea = Math.max(1, (contentBoundsPx.maxX - contentBoundsPx.minX + 1) * (contentBoundsPx.maxY - contentBoundsPx.minY + 1));

  const components = findComponents(mask, width, height);
  // Size bands relative to floor-plan content (big circle = table, small dot = chair).
  const minChairArea = contentArea * 0.000008;
  const maxChairArea = contentArea * 0.0012;
  const minTableArea = contentArea * 0.0008;
  const maxRoundTableArea = contentArea * 0.12;
  const maxBanquetTableArea = contentArea * 0.28;
  const minFeatureArea = contentArea * 0.045;
  const minExitArea = contentArea * 0.00035;

  const chairBlobs: NormalizedBlob[] = [];
  const tableCandidates: DetectedDiningTable[] = [];
  const featureCandidates: Array<NormalizedBlob & { areaPx: number }> = [];

  for (const comp of components) {
    if (!isInsideContent(comp, contentBoundsPx)) {
      continue;
    }

    const w = comp.maxX - comp.minX + 1;
    const h = comp.maxY - comp.minY + 1;
    const cx = (comp.minX + comp.maxX) / 2;
    const cy = (comp.minY + comp.maxY) / 2;
    const normalized = normalizeWithinContent(cx, cy, w, h, contentBoundsPx);
    normalized.circularity = componentCircularity(comp);
    const maxDimPx = Math.max(w, h);

    // 1) Small dots in pixels → chairs (absolute size — independent of tight content crop).
    if (
      (comp.area <= 180 && maxDimPx <= 16 && maxDimPx >= 2) ||
      isChairDotBlob(normalized, comp.area, contentArea) ||
      (comp.area >= minChairArea &&
        comp.area <= Math.max(maxChairArea, 160) &&
        isNearCircularBlob(normalized) &&
        Math.max(normalized.wPct, normalized.hPct) <= 10)
    ) {
      chairBlobs.push(normalized);
      continue;
    }

    // 2) Arrow / entrance glyph (ambukuri) near edge → EXIT (must not be a small chair-sized mark).
    if (maxDimPx > 16 && isLikelyExitMarker(normalized, comp.area, contentArea)) {
      featureCandidates.push({ ...normalized, areaPx: comp.area });
      continue;
    }

    // 3) Large circular discs → round tables.
    if (isRoundTableDisc(normalized, comp.area, contentArea)) {
      tableCandidates.push({
        xPct: normalized.xPct,
        yPct: normalized.yPct,
        shape: 'round',
        wPct: normalized.wPct,
        hPct: normalized.hPct,
        seats: 0,
        includesChairs: false,
      });
      continue;
    }

    if (comp.area >= minFeatureArea) {
      if (isBanquetHeadTable(normalized)) {
        tableCandidates.push({
          xPct: normalized.xPct,
          yPct: normalized.yPct,
          shape: 'rectangular',
          wPct: normalized.wPct,
          hPct: normalized.hPct,
          seats: 0,
          includesChairs: false,
        });
        continue;
      }
      featureCandidates.push({ ...normalized, areaPx: comp.area });
      continue;
    }

    if (comp.area < minTableArea) {
      if (comp.area >= minExitArea && isNearPerimeter(normalized.xPct, normalized.yPct, 14)) {
        featureCandidates.push({ ...normalized, areaPx: comp.area });
      }
      continue;
    }

    if (isLikelyExitMarker(normalized, comp.area, contentArea)) {
      featureCandidates.push({ ...normalized, areaPx: comp.area });
      continue;
    }

    const tableShape = classifyTableShape(normalized);
    if (!tableShape) {
      if (comp.area >= minExitArea && isNearPerimeter(normalized.xPct, normalized.yPct, 14)) {
        featureCandidates.push({ ...normalized, areaPx: comp.area });
      }
      continue;
    }

    // Never promote a small circular chairs-sized blob to a table via fallback.
    if (tableShape === 'round' && Math.max(normalized.wPct, normalized.hPct) < 7.5) {
      chairBlobs.push(normalized);
      continue;
    }

    const maxArea = tableShape === 'round' ? maxRoundTableArea : maxBanquetTableArea;
    if (comp.area > maxArea) {
      continue;
    }

    tableCandidates.push({
      xPct: normalized.xPct,
      yPct: normalized.yPct,
      shape: tableShape,
      wPct: normalized.wPct,
      hPct: normalized.hPct,
      seats: 0,
      includesChairs: false,
    });
  }

  tableCandidates.sort((a, b) => a.yPct - b.yPct || a.xPct - b.xPct);
  let placedTables = dedupeDetectedTables(tableCandidates);
  assignChairsToTables(placedTables, chairBlobs);
  placedTables = dedupeDetectedTables(placedTables);
  placedTables = filterDetectedTables(placedTables);
  assignTableRoles(placedTables);

  featureCandidates.sort((a, b) => {
    const rank = (blob: NormalizedBlob) => {
      const kind = classifyFeature(blob);
      if (kind === 'entrance' || kind === 'exit') {
        return 2;
      }
      return 0;
    };
    const diff = rank(b) - rank(a);
    if (diff !== 0) {
      return diff;
    }
    return b.areaPx - a.areaPx;
  });

  const features: DetectedDiningFeature[] = [];
  for (const candidate of featureCandidates) {
    const kind = classifyFeature(candidate);
    if (!kind) {
      continue;
    }
    // Arrows / entrance space → always one EXIT feature in the dining block.
    const normalizedKind: DetectedDiningFeature['kind'] = kind === 'entrance' ? 'exit' : kind;
    const isExit = normalizedKind === 'exit';
    if (isExit ? overlapsTableCore(candidate, placedTables) : overlapsDetectedTable(candidate, placedTables)) {
      continue;
    }
    if (features.some((f) => f.kind === normalizedKind)) {
      continue;
    }
    features.push({
      kind: normalizedKind,
      xPct: candidate.xPct,
      yPct: candidate.yPct,
      wPct: candidate.wPct,
      hPct: candidate.hPct,
      label: normalizedKind === 'exit' ? 'EXIT' : undefined,
    });
  }

  const aisles = inferAislesFromTables(placedTables);
  const structure = analyzeLayoutStructure(placedTables, features, aisles);

  let confidence: DiningLayoutDetectionResult['confidence'] = 'low';
  if (placedTables.length >= 4) {
    confidence = placedTables.length >= 8 ? 'high' : 'medium';
  } else if (placedTables.length >= 2) {
    confidence = 'medium';
  }
  if (structure.aisleCount > 0 && features.length > 0 && confidence === 'medium') {
    confidence = 'high';
  }

  const notes =
    placedTables.length === 0
      ? 'No table shapes detected. Try a clearer floor plan with distinct table circles or rectangles.'
      : `${structure.summary} Recreated as an editable 2D layout — drag any element to fine-tune.`;

  return {
    width,
    height,
    contentBounds,
    tables: placedTables,
    features,
    aisles,
    structure,
    confidence,
    notes,
  };
}

export async function detectDiningLayoutFromFile(file: File): Promise<DiningLayoutDetectionResult> {
  const raster = await rasterizeDiningImageFile(file);
  return detectDiningLayoutFromImageData(raster.imageData, raster.width, raster.height);
}

export interface DiningImageRaster {
  imageData: ImageData;
  width: number;
  height: number;
  /** Always a PNG data URL so the canvas overlay can display SVG uploads too. */
  dataUrl: string;
  sourceName: string;
}

/** True for PNG/JPG/WEBP/SVG — uses extension when browser leaves file.type empty on drop. */
export function isDiningImageFile(file: File): boolean {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) {
    return true;
  }
  return /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name || '');
}

function isSvgFile(file: File): boolean {
  const type = (file.type || '').toLowerCase();
  return type === 'image/svg+xml' || /\.svg$/i.test(file.name || '');
}

/** Load any supported floor-plan image and rasterize to PNG-backed ImageData. */
export async function rasterizeDiningImageFile(file: File): Promise<DiningImageRaster> {
  if (!isDiningImageFile(file)) {
    throw new Error('Please choose an image file (PNG, JPG, WEBP, or SVG).');
  }

  const img = isSvgFile(file) ? await loadSvgHtmlImage(file) : await loadHtmlImage(file);
  const srcW = Math.max(1, img.naturalWidth || img.width || 480);
  const srcH = Math.max(1, img.naturalHeight || img.height || 360);

  const scale = Math.min(1, MAX_ANALYSIS_WIDTH / srcW);
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not analyze the image in this browser.');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/png');
  return { imageData, width, height, dataUrl, sourceName: file.name };
}

function parseSvgSize(text: string): { width: number; height: number } {
  const viewBox = text.match(/viewBox\s*=\s*["']([^"']+)["']/i);
  if (viewBox) {
    const parts = viewBox[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  const w = Number(text.match(/\bwidth\s*=\s*["'](\d+(?:\.\d+)?)/i)?.[1]);
  const h = Number(text.match(/\bheight\s*=\s*["'](\d+(?:\.\d+)?)/i)?.[1]);
  if (w > 0 && h > 0) {
    return { width: w, height: h };
  }
  return { width: 480, height: 360 };
}

/** Browsers often give SVG images 0×0 intrinsic size — inject width/height then load. */
async function loadSvgHtmlImage(file: File): Promise<HTMLImageElement> {
  let text = await file.text();
  const size = parseSvgSize(text);
  if (!/\bwidth\s*=/i.test(text)) {
    text = text.replace(/<svg\b/i, `<svg width="${size.width}" height="${size.height}"`);
  }
  if (!/\bheight\s*=/i.test(text)) {
    text = text.replace(/<svg\b/i, `<svg height="${size.height}"`);
  }
  const blob = new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
  return loadHtmlImage(new File([blob], file.name || 'floor-plan.svg', { type: 'image/svg+xml' }));
}

function loadHtmlImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the image file. Try exporting the floor plan as PNG.'));
    };
    img.src = url;
  });
}
