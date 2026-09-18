import type {
  CenterpieceElement,
  CustomShapeSeatPosition,
  SeatLayoutSpec,
} from '../models/layout-element.model';
import {
  getRowGapExtraM,
  getSeatGapExtraM,
  hasSeatSpacingAdjustments,
} from './block-seat-layout';
import type { CanvasPoint } from './custom-shape';
import {
  canvasPointToElementPct,
  parseOverrideSeatId,
  pointInsidePolygonWithPadding,
  resolveSeatBodyRadiusPx,
} from './custom-shape-seats';
import { buildViewpointSeatFrame, computeDirectionalPxPerMetre } from './drag-seats';
import type { PixelRect } from './geometry';
import {
  chairPitchPx,
  pxPerMeter,
  resolveBlockLengthM,
  resolveBlockWidthM,
} from './physical-dims';

/**
 * Custom row-pair / seat-pair gaps for a seating block.
 *
 * The seat grid is always generated with the block's uniform `rowGapM` /
 * `seatGapM`. On top of that "straight" baseline this module inserts the extra
 * metres stored in `SeatLayoutSpec.rowGapExtraM` (before a row) and
 * `SeatLayoutSpec.seatGapExtraM` (after a seat in a row):
 *
 * - widening the gap before row C moves rows C, D, E… deeper into the block
 *   (away from the VIEW POINT) — the rows in front never move;
 * - widening the gap after seat 4 in row C moves seats 5, 6… of that row
 *   along the row — the seats before it never move.
 *
 * Any seat whose chair no longer fits inside the outline after the shift is
 * reported as hidden (not deleted): the moment the gap shrinks again it comes
 * back in the same place.
 */

export interface SeatSpacingResult {
  /** Shifted seat centres (element %), hidden seats removed. */
  positions: Record<string, CustomShapeSeatPosition>;
  /** Seats pushed outside the outline by the custom gaps. */
  hiddenSeatIds: string[];
}

interface RowSeat {
  id: string;
  seatIndex: number;
  point: CanvasPoint;
}

function elementPctToCanvasPoint(xPct: number, yPct: number, rect: PixelRect): CanvasPoint {
  return {
    x: rect.x + (xPct / 100) * rect.width,
    y: rect.y + (yPct / 100) * rect.height,
  };
}

function centroidOf(seats: RowSeat[]): CanvasPoint {
  const sum = seats.reduce(
    (acc, s) => ({ x: acc.x + s.point.x, y: acc.y + s.point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / seats.length, y: sum.y / seats.length };
}

/**
 * Along (seat order) and depth (row order) unit vectors for the placed grid.
 *
 * The straight baseline is the ground truth: `along` is the direction of the
 * widest row from seat 1 to its last seat, `depth` is perpendicular to it and
 * points from the first row toward the last. The VIEW POINT frame is only the
 * fallback for degenerate grids (single seat / single row).
 */
function resolveSpacingAxes(
  element: CenterpieceElement,
  rect: PixelRect,
  byRow: Map<number, RowSeat[]>,
): { along: CanvasPoint; depth: CanvasPoint; frame: ReturnType<typeof buildViewpointSeatFrame> } {
  const frame = buildViewpointSeatFrame(element, rect);
  const frameAlong: CanvasPoint | null = frame ? { x: frame.frame.ux, y: frame.frame.uy } : null;
  const frameDepth: CanvasPoint | null = frame
    ? { x: frame.frame.perpX, y: frame.frame.perpY }
    : null;

  const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]);

  // Seat-order direction measured from the widest row.
  let dataAlong: CanvasPoint | null = null;
  let bestSpan = 0;
  for (const [, seats] of rows) {
    if (seats.length < 2) {
      continue;
    }
    const first = seats[0].point;
    const last = seats[seats.length - 1].point;
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const len = Math.hypot(dx, dy);
    if (len > bestSpan && len > 1e-6) {
      bestSpan = len;
      dataAlong = { x: dx / len, y: dy / len };
    }
  }

  // Row-order direction from the first placed row to the last.
  let dataDepth: CanvasPoint | null = null;
  if (rows.length >= 2) {
    const first = centroidOf(rows[0][1]);
    const last = centroidOf(rows[rows.length - 1][1]);
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) {
      dataDepth = { x: dx / len, y: dy / len };
    }
  }

  let along: CanvasPoint;
  if (dataAlong) {
    along = dataAlong;
  } else if (dataDepth) {
    // Single-seat rows: the row direction is perpendicular to the row stack.
    along = { x: -dataDepth.y, y: dataDepth.x };
  } else {
    along = frameAlong ?? { x: 1, y: 0 };
  }

  // Depth is always perpendicular to the row so a row shift never slides
  // seats sideways; pick the sign that walks from the first row to the last.
  let depth: CanvasPoint = { x: -along.y, y: along.x };
  const reference = dataDepth ?? frameDepth;
  if (reference && reference.x * depth.x + reference.y * depth.y < 0) {
    depth = { x: -depth.x, y: -depth.y };
  }

  return { along, depth, frame };
}

function resolveSpacingPxPerMetre(
  element: CenterpieceElement,
  rect: PixelRect,
  polygon: CanvasPoint[],
  frame: ReturnType<typeof buildViewpointSeatFrame>,
): { ppmAlong: number; ppmDepth: number } {
  const sideLengthsM = element.customSideLengthsM ?? [];
  if (frame && polygon.length >= 3 && sideLengthsM.length >= 3) {
    const { ppmAlong, ppmDepth } = computeDirectionalPxPerMetre(polygon, sideLengthsM, frame.frame);
    if (ppmAlong > 0 && ppmDepth > 0) {
      return { ppmAlong, ppmDepth };
    }
  }
  const ppm = pxPerMeter(rect, resolveBlockLengthM(element), resolveBlockWidthM(element));
  return { ppmAlong: ppm, ppmDepth: ppm };
}

/**
 * Shift the straight seat grid by the custom row / seat gaps in `spec` and
 * report the seats that no longer fit inside `polygon`.
 */
export function applySeatSpacingToPositions(
  element: CenterpieceElement,
  rect: PixelRect,
  polygon: CanvasPoint[],
  straight: Record<string, CustomShapeSeatPosition>,
  spec: SeatLayoutSpec | undefined,
): SeatSpacingResult {
  const ids = Object.keys(straight);
  if (!spec || ids.length === 0 || polygon.length < 3 || !hasSeatSpacingAdjustments(spec)) {
    return { positions: { ...straight }, hiddenSeatIds: [] };
  }

  const positions: Record<string, CustomShapeSeatPosition> = {};
  const byRow = new Map<number, RowSeat[]>();
  for (const id of ids) {
    const parsed = parseOverrideSeatId(id);
    const pos = straight[id];
    if (!parsed) {
      positions[id] = { ...pos };
      continue;
    }
    const list = byRow.get(parsed.rowIndex) ?? [];
    list.push({
      id,
      seatIndex: parsed.seatIndex,
      point: elementPctToCanvasPoint(pos.xPct, pos.yPct, rect),
    });
    byRow.set(parsed.rowIndex, list);
  }
  for (const seats of byRow.values()) {
    seats.sort((a, b) => a.seatIndex - b.seatIndex);
  }

  const { along, depth, frame } = resolveSpacingAxes(element, rect, byRow);
  const { ppmAlong, ppmDepth } = resolveSpacingPxPerMetre(element, rect, polygon, frame);

  const pitch =
    spec.customShapeSeatPitchPx && spec.customShapeSeatPitchPx > 0
      ? spec.customShapeSeatPitchPx
      : chairPitchPx(element, rect);
  const radius = resolveSeatBodyRadiusPx(pitch);
  const borderGapPx = Math.max(0, element.borderGapM ?? 0) * Math.min(ppmAlong, ppmDepth);
  // A chair counts as "fitting" while most of its body stays inside the
  // outline and honours the block's border gap.
  const fitPaddingPx = radius * 0.85 + borderGapPx;

  const hiddenSeatIds: string[] = [];
  const rowIndices = [...byRow.keys()].sort((a, b) => a - b);
  let depthShiftPx = 0;
  let previousRow: number | null = null;
  for (const rowIndex of rowIndices) {
    // Gaps for rows that were never placed still accumulate, so numbering stays
    // consistent with the stored spec (row i is always "gap before row i").
    const from = previousRow == null ? 1 : previousRow + 1;
    for (let i = Math.max(1, from); i <= rowIndex; i += 1) {
      depthShiftPx += getRowGapExtraM(spec, i) * ppmDepth;
    }
    previousRow = rowIndex;

    const seats = byRow.get(rowIndex) ?? [];
    const alongTs = placeRowAlongAxis(seats, along, radius, pitch, (seatIndex) =>
      getSeatGapExtraM(spec, rowIndex, seatIndex) * ppmAlong,
    );

    for (let k = 0; k < seats.length; k += 1) {
      const seat = seats[k];
      const alongShiftPx = alongTs.next[k] - alongTs.base[k];
      const shifted = Math.abs(alongShiftPx) > 1e-3 || Math.abs(depthShiftPx) > 1e-6;
      const point: CanvasPoint = shifted
        ? {
            x: seat.point.x + along.x * alongShiftPx + depth.x * depthShiftPx,
            y: seat.point.y + along.y * alongShiftPx + depth.y * depthShiftPx,
          }
        : seat.point;

      if (shifted && !pointInsidePolygonWithPadding(point, polygon, fitPaddingPx)) {
        hiddenSeatIds.push(seat.id);
        continue;
      }
      positions[seat.id] = shifted
        ? { ...straight[seat.id], ...canvasPointToElementPct(point, rect) }
        : { ...straight[seat.id] };
    }
  }

  return { positions, hiddenSeatIds };
}

/** Ratio of the row pitch above which a gap between neighbours is an aisle, not spacing. */
const AISLE_GAP_PITCH_RATIO = 1.5;

/**
 * Re-place one row along its axis, seat by seat.
 *
 * - `base` are the baseline 1-D positions (projection on `along`).
 * - Each seat sits one normal pitch (its baseline pitch plus the extra gap
 *   requested after the previous seat) behind the previous seat.
 * - Aisles are read from the baseline itself: a jump between consecutive seat
 *   numbers wider than 1.5× the pitch is an aisle band. Bands are fixed
 *   obstacles — a chair that would land in one is carried to the far end of
 *   the aisle, so seats never sit in the walkway and the rest of the row
 *   continues from there.
 *
 * With no extra gaps the result reproduces the baseline exactly.
 */
function placeRowAlongAxis(
  seats: RowSeat[],
  along: CanvasPoint,
  radius: number,
  fallbackPitch: number,
  extraAfterPx: (seatIndex: number) => number,
): { base: number[]; next: number[] } {
  const base = seats.map((s) => s.point.x * along.x + s.point.y * along.y);
  const next = [...base];
  if (seats.length < 2) {
    return { base, next };
  }

  // Normal neighbour pitch = smallest positive step between consecutive seat numbers.
  let rowPitch = Number.POSITIVE_INFINITY;
  for (let k = 1; k < seats.length; k += 1) {
    if (seats[k].seatIndex !== seats[k - 1].seatIndex + 1) {
      continue;
    }
    const diff = base[k] - base[k - 1];
    if (diff > 1e-3 && diff < rowPitch) {
      rowPitch = diff;
    }
  }
  if (!Number.isFinite(rowPitch)) {
    rowPitch = Math.max(1, fallbackPitch);
  }

  // Aisle bands: free space between the chair bodies on either side of a jump.
  const bands: { start: number; end: number }[] = [];
  for (let k = 1; k < seats.length; k += 1) {
    const diff = base[k] - base[k - 1];
    if (
      seats[k].seatIndex === seats[k - 1].seatIndex + 1 &&
      diff > rowPitch * AISLE_GAP_PITCH_RATIO
    ) {
      bands.push({ start: base[k - 1] + radius, end: base[k] - radius });
    }
  }
  const epsilon = Math.max(0.25, radius * 0.1);

  for (let k = 1; k < seats.length; k += 1) {
    const diff = base[k] - base[k - 1];
    const crossesAisle =
      seats[k].seatIndex === seats[k - 1].seatIndex + 1 && diff > rowPitch * AISLE_GAP_PITCH_RATIO;
    // Across an aisle the normal pitch applies; the band below carries the
    // chair to the far side. Otherwise keep this pair's own baseline pitch.
    const step = crossesAisle ? rowPitch : diff;
    let extra = 0;
    for (let j = seats[k - 1].seatIndex; j < seats[k].seatIndex; j += 1) {
      extra += extraAfterPx(j);
    }
    let candidate = next[k - 1] + step + extra;
    for (const band of bands) {
      const overlapsBand = candidate - radius < band.end - epsilon && candidate + radius > band.start + epsilon;
      if (overlapsBand) {
        candidate = band.end + radius;
      }
    }
    next[k] = candidate;
  }

  return { base, next };
}

/** Round a metre value the way the gap editors store it (mm precision). */
export function roundGapM(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Renumber every row from the other end (seat 1 ↔ seat n) without moving a
 * chair. Manual hidden seats and per-seat gaps travel with their chairs so the
 * physical layout is unchanged — only the labels flip.
 */
export function mirrorSeatNumbering(
  positions: Record<string, CustomShapeSeatPosition>,
  spec: SeatLayoutSpec | undefined,
): {
  positions: Record<string, CustomShapeSeatPosition>;
  specPatch: Pick<SeatLayoutSpec, 'hiddenSeatIds' | 'seatGapExtraM'>;
} {
  const ID_PATTERN = /^(.*?)([A-Z]+)(\d+)$/i;
  const rowSeatCounts = spec?.rowSeatCounts ?? [];
  const rowSizes = new Map<number, number>();
  const parsedIds = new Map<string, { prefix: string; label: string; rowIndex: number; seatIndex: number }>();

  const register = (id: string) => {
    const match = id.trim().match(ID_PATTERN);
    const parsed = parseOverrideSeatId(id);
    if (!match || !parsed) {
      return;
    }
    parsedIds.set(id, {
      prefix: match[1],
      label: match[2],
      rowIndex: parsed.rowIndex,
      seatIndex: parsed.seatIndex,
    });
    rowSizes.set(
      parsed.rowIndex,
      Math.max(rowSizes.get(parsed.rowIndex) ?? 0, parsed.seatIndex + 1, rowSeatCounts[parsed.rowIndex] ?? 0),
    );
  };
  for (const id of Object.keys(positions)) {
    register(id);
  }
  for (const id of spec?.hiddenSeatIds ?? []) {
    register(id);
  }

  const mirrorId = (id: string): string => {
    const info = parsedIds.get(id);
    if (!info) {
      return id;
    }
    const size = rowSizes.get(info.rowIndex) ?? info.seatIndex + 1;
    const mirroredIndex = Math.max(0, size - 1 - info.seatIndex);
    return `${info.prefix}${info.label}${mirroredIndex + 1}`;
  };

  const nextPositions: Record<string, CustomShapeSeatPosition> = {};
  for (const [id, pos] of Object.entries(positions)) {
    nextPositions[mirrorId(id)] = { ...pos };
  }

  const hiddenSeatIds = (spec?.hiddenSeatIds ?? []).map(mirrorId);

  // Gap after seat j (between j and j+1) becomes the gap after seat n-2-j.
  const seatGapExtraM: Record<string, number> = {};
  for (const [key, value] of Object.entries(spec?.seatGapExtraM ?? {})) {
    const match = key.match(/^(\d+):(\d+)$/);
    if (!match) {
      continue;
    }
    const rowIndex = Number.parseInt(match[1], 10);
    const seatIndex = Number.parseInt(match[2], 10);
    const size = rowSizes.get(rowIndex) ?? rowSeatCounts[rowIndex] ?? 0;
    const mirrored = size - 2 - seatIndex;
    if (mirrored >= 0) {
      seatGapExtraM[`${rowIndex}:${mirrored}`] = value;
    }
  }

  return {
    positions: nextPositions,
    specPatch: {
      hiddenSeatIds,
      seatGapExtraM: Object.keys(seatGapExtraM).length > 0 ? seatGapExtraM : undefined,
    },
  };
}
