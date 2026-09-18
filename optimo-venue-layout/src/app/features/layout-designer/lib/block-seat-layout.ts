import { SeatLabelStyle, SeatLayoutSpec } from '../models/layout-element.model';
import { rowLabel } from './seat-layout';

const MAX_ROWS = 100;
const MAX_SEATS_PER_ROW = 200;

function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(Number.isFinite(value) ? value : min);
  return Math.max(min, Math.min(max, rounded));
}

function clampFloat(value: number, min: number, max: number): number {
  const next = Number.isFinite(value) ? value : min;
  return Math.max(min, Math.min(max, next));
}

export interface SeatCell {
  seatId: string;
  rowIndex: number;
  seatIndex: number;
  seatNumber: number;
  rowLabelText: string;
  isHidden: boolean;
}

export function seatId(rowIndex: number, seatIndex: number, style: SeatLabelStyle = 'letter'): string {
  return `${rowLabel(rowIndex, style)}${seatIndex + 1}`;
}

export function createSeatLayoutSpec(
  rows: number,
  seatsPerRow: number,
  rowLabelStyle: SeatLabelStyle = 'letter',
): SeatLayoutSpec {
  const safeRows = clampInt(rows, 1, MAX_ROWS);
  const safeSeats = clampInt(seatsPerRow, 1, MAX_SEATS_PER_ROW);
  return {
    rows: safeRows,
    seatsPerRow: safeSeats,
    rowSeatCounts: Array.from({ length: safeRows }, () => safeSeats),
    rowOffsetXPcts: Array.from({ length: safeRows }, () => 0),
    rowOffsetYPcts: Array.from({ length: safeRows }, () => 0),
    rowLabelStyle,
    hiddenSeatIds: [],
    aisleAfterSeatNumbers: [],
    showSeatNumbers: false,
    rowCurveDeg: 0,
    rowCurveDegs: Array.from({ length: safeRows }, () => 0),
    rowRotationDeg: 0,
    seatSpacingPct: 4,
    rowGapPct: 8,
    showRowLabels: true,
  };
}

type SeatLayoutSource = {
  rows?: number;
  seatsPerRow?: number;
  rowLabelStyle?: SeatLabelStyle;
  seatLayout?: SeatLayoutSpec;
};

export function getSeatLayoutSpec(source: SeatLayoutSource): SeatLayoutSpec {
  const fallbackRows = clampInt(source.rows ?? 1, 1, MAX_ROWS);
  const fallbackSeats = clampInt(source.seatsPerRow ?? 1, 1, MAX_SEATS_PER_ROW);
  const spec = source.seatLayout;
  const rows = clampInt(spec?.rows ?? fallbackRows, 1, MAX_ROWS);
  const seatsPerRow = clampInt(spec?.seatsPerRow ?? fallbackSeats, 1, MAX_SEATS_PER_ROW);
  const style = spec?.rowLabelStyle ?? source.rowLabelStyle ?? 'letter';
  return {
    rows,
    seatsPerRow,
    rowSeatCounts: normalizeRowSeatCounts(spec?.rowSeatCounts, rows, seatsPerRow),
    rowOffsetXPcts: normalizeRowOffsets(spec?.rowOffsetXPcts, rows),
    rowOffsetYPcts: normalizeRowOffsets(spec?.rowOffsetYPcts, rows),
    rowLabelStyle: style,
    hiddenSeatIds: spec?.hiddenSeatIds ?? [],
    aisleAfterSeatNumbers: spec?.aisleAfterSeatNumbers ?? [],
    showSeatNumbers: spec?.showSeatNumbers === true,
    rowCurveDeg: spec?.rowCurveDeg ?? 0,
    rowCurveDegs: normalizeRowCurves(spec?.rowCurveDegs, rows),
    rowRotationDeg: spec?.rowRotationDeg ?? 0,
    seatSpacingPct: spec?.seatSpacingPct ?? 4,
    rowGapPct: spec?.rowGapPct ?? 8,
    showRowLabels: spec?.showRowLabels !== false,
    customShapeSeatPitchPx: spec?.customShapeSeatPitchPx,
    rowGapExtraM: normalizeRowGapExtras(spec?.rowGapExtraM, rows),
    seatGapExtraM: normalizeSeatGapExtras(spec?.seatGapExtraM, rows),
    spacingHiddenSeatIds: spec?.spacingHiddenSeatIds ?? [],
  };
}

/** Largest extra gap (m) accepted for a single row / seat pair. */
export const MAX_GAP_EXTRA_M = 20;

function normalizeRowGapExtras(extras: number[] | undefined, rows: number): number[] | undefined {
  if (!extras || extras.length === 0) {
    return undefined;
  }
  const next = Array.from({ length: rows }, (_, i) =>
    i === 0 ? 0 : clampFloat(extras[i] ?? 0, -MAX_GAP_EXTRA_M, MAX_GAP_EXTRA_M),
  );
  return next.some((v) => v !== 0) ? next : undefined;
}

export function seatGapExtraKey(rowIndex: number, seatIndex: number): string {
  return `${rowIndex}:${seatIndex}`;
}

export function parseSeatGapExtraKey(key: string): { rowIndex: number; seatIndex: number } | null {
  const match = key.match(/^(\d+):(\d+)$/);
  if (!match) {
    return null;
  }
  return { rowIndex: Number.parseInt(match[1], 10), seatIndex: Number.parseInt(match[2], 10) };
}

function normalizeSeatGapExtras(
  extras: Record<string, number> | undefined,
  rows: number,
): Record<string, number> | undefined {
  if (!extras) {
    return undefined;
  }
  const next: Record<string, number> = {};
  for (const [key, raw] of Object.entries(extras)) {
    const parsed = parseSeatGapExtraKey(key);
    if (!parsed || parsed.rowIndex >= rows) {
      continue;
    }
    const value = clampFloat(raw, -MAX_GAP_EXTRA_M, MAX_GAP_EXTRA_M);
    if (value !== 0) {
      next[key] = value;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Extra metres inserted before `rowIndex` (0 when unset or for the first row). */
export function getRowGapExtraM(spec: SeatLayoutSpec | undefined, rowIndex: number): number {
  if (!spec || rowIndex <= 0) {
    return 0;
  }
  const v = spec.rowGapExtraM?.[rowIndex];
  return v != null && Number.isFinite(v) ? v : 0;
}

/** Extra metres inserted after seat `seatIndex` in `rowIndex` (0 when unset). */
export function getSeatGapExtraM(
  spec: SeatLayoutSpec | undefined,
  rowIndex: number,
  seatIndex: number,
): number {
  const v = spec?.seatGapExtraM?.[seatGapExtraKey(rowIndex, seatIndex)];
  return v != null && Number.isFinite(v) ? v : 0;
}

/** True when any row-pair or seat-pair gap differs from the uniform block gaps. */
export function hasSeatSpacingAdjustments(spec: SeatLayoutSpec | undefined): boolean {
  if (!spec) {
    return false;
  }
  if ((spec.rowGapExtraM ?? []).some((v, i) => i > 0 && Number.isFinite(v) && v !== 0)) {
    return true;
  }
  return Object.values(spec.seatGapExtraM ?? {}).some((v) => Number.isFinite(v) && v !== 0);
}

/**
 * Carry custom gaps from a previous spec onto a freshly generated one (Create
 * seats re-grids the block; the user's per-row / per-seat tweaks survive).
 */
export function carrySeatSpacingAdjustments(
  previous: SeatLayoutSpec | undefined,
  next: SeatLayoutSpec,
): SeatLayoutSpec {
  if (!previous || !hasSeatSpacingAdjustments(previous)) {
    return next;
  }
  return {
    ...next,
    rowGapExtraM: normalizeRowGapExtras(previous.rowGapExtraM, next.rows),
    seatGapExtraM: normalizeSeatGapExtras(previous.seatGapExtraM, next.rows),
  };
}

function normalizeRowSeatCounts(
  rowSeatCounts: number[] | undefined,
  rows: number,
  seatsPerRow: number,
): number[] {
  return Array.from({ length: rows }, (_, i) =>
    clampInt(rowSeatCounts?.[i] ?? seatsPerRow, 0, MAX_SEATS_PER_ROW),
  );
}

function normalizeRowOffsets(offsets: number[] | undefined, rows: number): number[] {
  return Array.from({ length: rows }, (_, i) => clampFloat(offsets?.[i] ?? 0, -40, 40));
}

function normalizeRowCurves(curves: number[] | undefined, rows: number): number[] {
  return Array.from({ length: rows }, (_, i) => clampFloat(curves?.[i] ?? 0, -60, 60));
}

export function getSeatLayoutRowSeatCounts(spec: SeatLayoutSpec): number[] {
  return normalizeRowSeatCounts(spec.rowSeatCounts, spec.rows, spec.seatsPerRow);
}

export function getSeatLayoutRowOffsets(spec: SeatLayoutSpec): {
  rowOffsetXPcts: number[];
  rowOffsetYPcts: number[];
} {
  return {
    rowOffsetXPcts: normalizeRowOffsets(spec.rowOffsetXPcts, spec.rows),
    rowOffsetYPcts: normalizeRowOffsets(spec.rowOffsetYPcts, spec.rows),
  };
}

export function getAisleAfterSeatNumbers(spec: SeatLayoutSpec): number[] {
  return spec.aisleAfterSeatNumbers ?? [];
}

export function getSeatLayoutMaxAssignedSeatsPerRow(spec: SeatLayoutSpec): number {
  return Math.max(spec.seatsPerRow, ...getSeatLayoutRowSeatCounts(spec));
}

export function getSeatCellsFromSpec(spec: SeatLayoutSpec): SeatCell[] {
  const style = spec.rowLabelStyle ?? 'letter';
  // Manually deleted seats plus seats pushed out of the outline by custom gaps.
  const hidden = new Set([...(spec.hiddenSeatIds ?? []), ...(spec.spacingHiddenSeatIds ?? [])]);
  const rowSeatCounts = getSeatLayoutRowSeatCounts(spec);
  const cells: SeatCell[] = [];
  for (let rowIndex = 0; rowIndex < spec.rows; rowIndex += 1) {
    const count = rowSeatCounts[rowIndex] ?? 0;
    const label = rowLabel(rowIndex, style);
    for (let seatIndex = 0; seatIndex < count; seatIndex += 1) {
      const id = seatId(rowIndex, seatIndex, style);
      cells.push({
        seatId: id,
        rowIndex,
        seatIndex,
        seatNumber: seatIndex + 1,
        rowLabelText: label,
        isHidden: hidden.has(id),
      });
    }
  }
  return cells;
}

export function getVisibleSeatCountFromSpec(spec: SeatLayoutSpec): number {
  return getSeatLayoutDisplayStats(spec).totalSeats;
}

/** Occupied rows / max seats in a row / visible seats — hidden cells are excluded. */
export function getSeatLayoutDisplayStats(spec: SeatLayoutSpec): {
  rows: number;
  columns: number;
  totalSeats: number;
} {
  const visible = getSeatCellsFromSpec(spec).filter((cell) => !cell.isHidden);
  if (visible.length === 0) {
    return { rows: 0, columns: 0, totalSeats: 0 };
  }
  const perRow = new Map<number, number>();
  for (const cell of visible) {
    perRow.set(cell.rowIndex, (perRow.get(cell.rowIndex) ?? 0) + 1);
  }
  let columns = 0;
  for (const count of perRow.values()) {
    if (count > columns) {
      columns = count;
    }
  }
  return {
    rows: perRow.size,
    columns,
    totalSeats: visible.length,
  };
}

export function capSeatLayoutToCapacity(
  spec: SeatLayoutSpec,
  maxRows: number,
  maxSeatsPerRow: number,
): SeatLayoutSpec {
  const rows = clampInt(Math.min(spec.rows, maxRows), 1, MAX_ROWS);
  const seatsPerRow = clampInt(Math.min(spec.seatsPerRow, maxSeatsPerRow), 1, MAX_SEATS_PER_ROW);
  const rowSeatCounts = getSeatLayoutRowSeatCounts(spec)
    .slice(0, rows)
    .map((c) => clampInt(Math.min(c, maxSeatsPerRow), 0, MAX_SEATS_PER_ROW));
  while (rowSeatCounts.length < rows) {
    rowSeatCounts.push(seatsPerRow);
  }
  return {
    ...spec,
    rows,
    seatsPerRow,
    rowSeatCounts,
    rowOffsetXPcts: normalizeRowOffsets(spec.rowOffsetXPcts, rows),
    rowOffsetYPcts: normalizeRowOffsets(spec.rowOffsetYPcts, rows),
    rowCurveDegs: normalizeRowCurves(spec.rowCurveDegs, rows),
    rowGapExtraM: normalizeRowGapExtras(spec.rowGapExtraM, rows),
    seatGapExtraM: normalizeSeatGapExtras(spec.seatGapExtraM, rows),
  };
}

export function resizeSeatLayoutRows(spec: SeatLayoutSpec, nextRows: number): SeatLayoutSpec {
  const safeRows = clampInt(nextRows, 1, MAX_ROWS);
  const rowSeatCounts = getSeatLayoutRowSeatCounts(spec);
  const { rowOffsetXPcts, rowOffsetYPcts } = getSeatLayoutRowOffsets(spec);
  return {
    ...spec,
    rows: safeRows,
    rowSeatCounts: Array.from({ length: safeRows }, (_, i) => rowSeatCounts[i] ?? spec.seatsPerRow),
    rowOffsetXPcts: Array.from({ length: safeRows }, (_, i) => rowOffsetXPcts[i] ?? 0),
    rowOffsetYPcts: Array.from({ length: safeRows }, (_, i) => rowOffsetYPcts[i] ?? 0),
    rowCurveDegs: Array.from({ length: safeRows }, (_, i) => spec.rowCurveDegs?.[i] ?? 0),
    rowGapExtraM: normalizeRowGapExtras(spec.rowGapExtraM, safeRows),
    seatGapExtraM: normalizeSeatGapExtras(spec.seatGapExtraM, safeRows),
  };
}

export function updateDefaultSeatsPerRow(spec: SeatLayoutSpec, next: number): SeatLayoutSpec {
  const safe = clampInt(next, 1, MAX_SEATS_PER_ROW);
  const rowSeatCounts = getSeatLayoutRowSeatCounts(spec).map((c) =>
    c === spec.seatsPerRow ? safe : c,
  );
  return { ...spec, seatsPerRow: safe, rowSeatCounts };
}

export function updateRowSeatCount(spec: SeatLayoutSpec, rowIndex: number, next: number): SeatLayoutSpec {
  const safe = clampInt(next, 0, MAX_SEATS_PER_ROW);
  const rowSeatCounts = getSeatLayoutRowSeatCounts(spec).map((c, i) =>
    i === rowIndex ? safe : c,
  );
  return { ...spec, rowSeatCounts };
}
