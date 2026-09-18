import type { DiningTableShape } from '../models/layout-element.model';

export const DINING_TABLE_STROKE = '#5B9BD5';
export const DINING_TABLE_STROKE_SELECTED = '#2563EB';

export interface DiningTableChairArc {
  x: number;
  y: number;
  rotationDeg: number;
}

/** Optional real chair footprint in canvas pixels (width along edge, depth away from table). */
export interface DiningTableChairSizePx {
  widthPx: number;
  depthPx: number;
}

export interface DiningTableChairIcon {
  chairArcs: DiningTableChairArc[];
  /** @deprecated Prefer chairHalfWidthPx / chairHalfDepthPx; kept as max(halfW, halfD). */
  chairArcRadiusPx: number;
  chairHalfWidthPx: number;
  chairHalfDepthPx: number;
  strokeWidth: number;
  cornerRadiusPx: number;
}

/** Semi-circular chair arc opening toward -Y (faces table centre when rotated). */
export function diningTableChairArcPath(radiusPx: number): string {
  const r = radiusPx;
  return `M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0`;
}

function rotationDegTowardCenter(x: number, y: number): number {
  const towardCenter = Math.atan2(-y, -x);
  const arcDefault = -Math.PI / 2;
  return ((towardCenter - arcDefault) * 180) / Math.PI;
}

function allocateSeatsToEdges(
  edgeLengths: number[],
  total: number,
  allowedEdges?: number[],
): number[] {
  const counts = edgeLengths.map(() => 0);
  if (total <= 0) {
    return counts;
  }
  const allowed =
    allowedEdges && allowedEdges.length > 0
      ? allowedEdges.filter((i) => i >= 0 && i < edgeLengths.length)
      : edgeLengths.map((_, index) => index);
  if (allowed.length === 0) {
    return counts;
  }
  const perimeter = allowed.reduce((sum, index) => sum + edgeLengths[index], 0);
  if (perimeter <= 0) {
    // Equal split across allowed edges.
    const base = Math.floor(total / allowed.length);
    let remaining = total - base * allowed.length;
    for (const index of allowed) {
      counts[index] = base;
    }
    for (let i = 0; remaining > 0; i += 1, remaining -= 1) {
      counts[allowed[i % allowed.length]] += 1;
    }
    return counts;
  }
  const raw = allowed.map((index) => (edgeLengths[index] / perimeter) * total);
  for (let i = 0; i < allowed.length; i += 1) {
    counts[allowed[i]] = Math.floor(raw[i]);
  }
  let remaining = total - allowed.reduce((sum, index) => sum + counts[index], 0);
  const order = raw
    .map((value, i) => ({ index: allowed[i], remainder: value - counts[allowed[i]] }))
    .sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; remaining > 0; i += 1, remaining -= 1) {
    counts[order[i % order.length].index] += 1;
  }
  return counts;
}

/** Open (non-suppressed) edge indices — chairs only appear on these sides. */
function openChairEdges(suppressedChairEdges: number[]): number[] {
  const suppressed = new Set(suppressedChairEdges);
  const open = [0, 1, 2, 3].filter((edge) => !suppressed.has(edge));
  return open.length > 0 ? open : [0, 1, 2, 3];
}

function resolveChairHalfExtents(
  shape: DiningTableShape,
  widthPx: number,
  heightPx: number,
  chairSize?: DiningTableChairSizePx,
): { halfWidthPx: number; halfDepthPx: number } {
  if (
    chairSize &&
    Number.isFinite(chairSize.widthPx) &&
    Number.isFinite(chairSize.depthPx) &&
    chairSize.widthPx > 0 &&
    chairSize.depthPx > 0
  ) {
    return {
      halfWidthPx: Math.max(1, chairSize.widthPx / 2),
      halfDepthPx: Math.max(1, chairSize.depthPx / 2),
    };
  }
  // Legacy fallback: fraction of table size (pre-measurement chair icons).
  const radiusPx = Math.max(
    1.5,
    shape === 'round' ? widthPx * 0.065 : Math.min(widthPx, heightPx) * 0.055,
  );
  return { halfWidthPx: radiusPx, halfDepthPx: radiusPx };
}

function tableToChairGapPx(halfDepthPx: number): number {
  return Math.max(0.5, halfDepthPx * 0.08);
}

function buildRoundTableChairArcs(
  widthPx: number,
  seats: number,
  halfWidthPx: number,
  halfDepthPx: number,
  suppressedChairEdges: number[] = [],
  seatsByEdge?: [number, number, number, number],
): DiningTableChairArc[] {
  if (seats <= 0) {
    return [];
  }
  const tableRadius = widthPx / 2;
  const gap = tableToChairGapPx(halfDepthPx);
  const orbitRadius = tableRadius + gap + halfDepthPx;
  const arcs: DiningTableChairArc[] = [];

  const hasCustomSides = Boolean(seatsByEdge && seatsByEdge.some((n) => n > 0));
  const open = openChairEdges(suppressedChairEdges);
  // Default / full ring: equal angular gap between every chair.
  if (!hasCustomSides && open.length === 4) {
    for (let index = 0; index < seats; index += 1) {
      // Start at top (-90°) so the ring reads evenly around the table.
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / seats;
      const x = orbitRadius * Math.cos(angle);
      const y = orbitRadius * Math.sin(angle);
      arcs.push({
        x,
        y,
        rotationDeg: rotationDegTowardCenter(x, y),
      });
    }
    return arcs;
  }

  // Exact per-side counts from reference (one side only → only that side gets chairs).
  let seatCounts: number[];
  if (hasCustomSides && seatsByEdge) {
    seatCounts = [...seatsByEdge];
  } else {
    seatCounts = allocateSeatsToEdges([1, 1, 1, 1], seats, open);
  }

  // Edge angle centers: top=-90°, right=0°, bottom=90°, left=180°
  const edgeCentersDeg = [-90, 0, 90, 180];
  // Span each side so chairs of real width stay near that edge (not wrapping around).
  const chordHalf = halfWidthPx;
  const halfSpanDeg = Math.min(
    40,
    Math.max(12, (Math.asin(Math.min(1, chordHalf / Math.max(orbitRadius, 1))) * 180) / Math.PI + 8),
  );

  for (let edge = 0; edge < 4; edge += 1) {
    const count = seatCounts[edge];
    if (count <= 0) {
      continue;
    }
    for (let index = 0; index < count; index += 1) {
      // Equal gap within the side arc (including equal end margins).
      const t = count === 1 ? 0.5 : (index + 1) / (count + 1);
      const deg = edgeCentersDeg[edge] - halfSpanDeg + t * (halfSpanDeg * 2);
      const angle = (deg * Math.PI) / 180;
      const x = orbitRadius * Math.cos(angle);
      const y = orbitRadius * Math.sin(angle);
      arcs.push({
        x,
        y,
        rotationDeg: rotationDegTowardCenter(x, y),
      });
    }
  }
  return arcs;
}

/** Point + outward normal on the rectangle outline at a perimeter distance from top-left, clockwise. */
function rectPerimeterPoint(
  halfW: number,
  halfH: number,
  widthPx: number,
  heightPx: number,
  distance: number,
): { x: number; y: number; nx: number; ny: number } {
  const perimeter = 2 * (widthPx + heightPx);
  let d = ((distance % perimeter) + perimeter) % perimeter;
  if (d <= widthPx) {
    return { x: -halfW + d, y: -halfH, nx: 0, ny: -1 };
  }
  d -= widthPx;
  if (d <= heightPx) {
    return { x: halfW, y: -halfH + d, nx: 1, ny: 0 };
  }
  d -= heightPx;
  if (d <= widthPx) {
    return { x: halfW - d, y: halfH, nx: 0, ny: 1 };
  }
  d -= widthPx;
  return { x: -halfW, y: halfH - d, nx: -1, ny: 0 };
}

function buildRectangularTableChairArcs(
  widthPx: number,
  heightPx: number,
  seats: number,
  halfWidthPx: number,
  halfDepthPx: number,
  suppressedChairEdges: number[] = [],
  seatsByEdge?: [number, number, number, number],
): DiningTableChairArc[] {
  if (seats <= 0) {
    return [];
  }
  const halfW = widthPx / 2;
  const halfH = heightPx / 2;
  const gap = tableToChairGapPx(halfDepthPx);
  const offset = gap + halfDepthPx;
  const edgeLengths = [widthPx, heightPx, widthPx, heightPx];
  const arcs: DiningTableChairArc[] = [];

  const hasCustomSides = Boolean(seatsByEdge && seatsByEdge.some((n) => n > 0));
  const open = openChairEdges(suppressedChairEdges);

  // Default: equal centre-to-centre gap around the full perimeter.
  if (!hasCustomSides && open.length === 4) {
    const perimeter = 2 * (widthPx + heightPx);
    for (let index = 0; index < seats; index += 1) {
      const distance = ((index + 0.5) / seats) * perimeter;
      const p = rectPerimeterPoint(halfW, halfH, widthPx, heightPx, distance);
      const x = p.x + p.nx * offset;
      const y = p.y + p.ny * offset;
      arcs.push({
        x,
        y,
        rotationDeg: rotationDegTowardCenter(x, y),
      });
    }
    return arcs;
  }

  let seatCounts: number[];
  if (hasCustomSides && seatsByEdge) {
    // Exact reference pattern: only sides that had small dots get chairs.
    seatCounts = [...seatsByEdge];
  } else {
    seatCounts = allocateSeatsToEdges(edgeLengths, seats, open);
  }

  const edges: Array<{
    count: number;
    pointAt: (t: number) => { x: number; y: number };
    normal: { x: number; y: number };
  }> = [
    {
      count: seatCounts[0],
      pointAt: (t) => ({ x: -halfW + t * widthPx, y: -halfH }),
      normal: { x: 0, y: -1 },
    },
    {
      count: seatCounts[1],
      pointAt: (t) => ({ x: halfW, y: -halfH + t * heightPx }),
      normal: { x: 1, y: 0 },
    },
    {
      count: seatCounts[2],
      pointAt: (t) => ({ x: halfW - t * widthPx, y: halfH }),
      normal: { x: 0, y: 1 },
    },
    {
      count: seatCounts[3],
      pointAt: (t) => ({ x: -halfW, y: halfH - t * heightPx }),
      normal: { x: -1, y: 0 },
    },
  ];

  for (const edge of edges) {
    if (edge.count <= 0) {
      continue;
    }
    for (let index = 0; index < edge.count; index += 1) {
      // Equal gap along the side (equal margins at both ends).
      const t = (index + 1) / (edge.count + 1);
      const anchor = edge.pointAt(t);
      const x = anchor.x + edge.normal.x * offset;
      const y = anchor.y + edge.normal.y * offset;
      arcs.push({
        x,
        y,
        rotationDeg: rotationDegTowardCenter(x, y),
      });
    }
  }

  return arcs;
}

export function buildDiningTableChairArcs(
  shape: DiningTableShape,
  widthPx: number,
  heightPx: number,
  seats: number,
  suppressedChairEdges?: number[],
  seatsByEdge?: [number, number, number, number],
  chairSize?: DiningTableChairSizePx,
): DiningTableChairIcon {
  const { halfWidthPx, halfDepthPx } = resolveChairHalfExtents(shape, widthPx, heightPx, chairSize);
  const chairArcRadiusPx = Math.max(halfWidthPx, halfDepthPx);
  const strokeWidth = Math.max(0.8, Math.min(widthPx, heightPx) * 0.03);
  const cornerRadiusPx = Math.min(3, Math.min(widthPx, heightPx) * 0.06);
  const chairArcs =
    shape === 'round'
      ? buildRoundTableChairArcs(
          widthPx,
          seats,
          halfWidthPx,
          halfDepthPx,
          suppressedChairEdges ?? [],
          seatsByEdge,
        )
      : buildRectangularTableChairArcs(
          widthPx,
          heightPx,
          seats,
          halfWidthPx,
          halfDepthPx,
          suppressedChairEdges ?? [],
          seatsByEdge,
        );
  return {
    chairArcs,
    chairArcRadiusPx,
    chairHalfWidthPx: halfWidthPx,
    chairHalfDepthPx: halfDepthPx,
    strokeWidth,
    cornerRadiusPx,
  };
}

/** Full visual half-extents from table centre (table outline + chair arcs). */
export function diningTableVisualHalfExtentsPx(
  shape: DiningTableShape,
  widthPx: number,
  heightPx: number,
  seats: number,
  chairSize?: DiningTableChairSizePx,
): { halfWidthPx: number; halfHeightPx: number } {
  const icon = buildDiningTableChairArcs(shape, widthPx, heightPx, seats, undefined, undefined, chairSize);
  if (shape === 'round') {
    const tableRadius = widthPx / 2;
    const gap = tableToChairGapPx(icon.chairHalfDepthPx);
    const orbitRadius = tableRadius + gap + icon.chairHalfDepthPx;
    const outer = orbitRadius + icon.chairHalfDepthPx;
    return { halfWidthPx: outer, halfHeightPx: outer };
  }
  let maxX = widthPx / 2;
  let maxY = heightPx / 2;
  for (const arc of icon.chairArcs) {
    maxX = Math.max(maxX, Math.abs(arc.x) + icon.chairHalfWidthPx, Math.abs(arc.x) + icon.chairHalfDepthPx);
    maxY = Math.max(maxY, Math.abs(arc.y) + icon.chairHalfWidthPx, Math.abs(arc.y) + icon.chairHalfDepthPx);
  }
  return { halfWidthPx: maxX, halfHeightPx: maxY };
}

export function diningTableVisualHalfExtentsM(
  shape: DiningTableShape,
  widthM: number,
  depthM: number,
  seats: number,
  chairSizeM?: { widthM: number; depthM: number },
): { halfWidthM: number; halfDepthM: number } {
  const ppm = 1000;
  const widthPx = widthM * ppm;
  const heightPx = (shape === 'round' ? widthM : depthM) * ppm;
  const chairSize =
    chairSizeM && chairSizeM.widthM > 0 && chairSizeM.depthM > 0
      ? { widthPx: chairSizeM.widthM * ppm, depthPx: chairSizeM.depthM * ppm }
      : undefined;
  const half = diningTableVisualHalfExtentsPx(shape, widthPx, heightPx, seats, chairSize);
  return { halfWidthM: half.halfWidthPx / ppm, halfDepthM: half.halfHeightPx / ppm };
}
