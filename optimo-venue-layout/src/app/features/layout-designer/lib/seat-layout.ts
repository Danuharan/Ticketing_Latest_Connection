/**
 * Seat-position math. Given an element's pixel box, these helpers produce the
 * individual seat dots (centre + radius) and row labels. The renderer just maps
 * the output to <circle>/<text> nodes — no drawing library involved.
 */

import { PixelRect, ellipsePoint, clamp } from './geometry';
import {
  SeatLabelStyle,
  SeatSectionRow,
} from '../models/layout-element.model';

export interface SeatNode {
  key: string;
  label: string;
  seatId?: string;
  x: number;
  y: number;
  radius: number;
  showNumber?: boolean;
}

export interface RowLabelNode {
  key: string;
  label: string;
  x: number;
  y: number;
  /** Custom-shape block row selection on canvas. */
  blockId?: string;
  rowIndex?: number;
  selected?: boolean;
  /** Canvas-unit font size; rows packed tighter than the default glyph shrink to fit. */
  fontSize?: number;
}

export interface SeatMap {
  seats: SeatNode[];
  rowLabels: RowLabelNode[];
}

/** Row label: 0 -> A, 25 -> Z, 26 -> AA … or 1-based numbers. */
export function rowLabel(rowIndex: number, style: SeatLabelStyle = 'letter'): string {
  if (style === 'number') {
    return String(rowIndex + 1);
  }
  let n = rowIndex;
  let result = '';
  do {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
}

/** Inverse of letter `rowLabel`: A → 0, Z → 25, AA → 26. Returns null if invalid. */
export function rowLabelToIndex(label: string): number | null {
  const raw = label.trim().toUpperCase();
  if (!raw || !/^[A-Z]+$/.test(raw)) {
    return null;
  }
  let n = 0;
  for (let i = 0; i < raw.length; i += 1) {
    n = n * 26 + (raw.charCodeAt(i) - 64);
  }
  return n - 1;
}

/** Rectangular block: rows × seats evenly spread inside the box. */
export function buildGridSeatMap(
  rect: PixelRect,
  rows: number,
  seatsPerRow: number,
  style: SeatLabelStyle,
): SeatMap {
  const safeRows = clamp(Math.round(rows), 0, 100);
  const safeSeats = clamp(Math.round(seatsPerRow), 0, 200);
  const seats: SeatNode[] = [];
  const rowLabels: RowLabelNode[] = [];
  if (safeRows === 0 || safeSeats === 0) {
    return { seats, rowLabels };
  }

  const padX = Math.min(22, rect.width * 0.08);
  const padY = Math.min(22, rect.height * 0.1);
  const innerW = Math.max(1, rect.width - padX * 2);
  const innerH = Math.max(1, rect.height - padY * 2);
  const colStep = innerW / safeSeats;
  const rowStep = innerH / safeRows;
  const radius = Math.max(1.5, Math.min(colStep, rowStep) * 0.36);

  for (let r = 0; r < safeRows; r++) {
    const label = rowLabel(r, style);
    const y = rect.y + padY + rowStep * (r + 0.5);
    rowLabels.push({ key: `${label}`, label, x: rect.x + padX * 0.4, y: y + radius * 0.4 });
    for (let c = 0; c < safeSeats; c++) {
      const x = rect.x + padX + colStep * (c + 0.5);
      seats.push({ key: `${label}-${c + 1}`, label: `${label}${c + 1}`, x, y, radius });
    }
  }
  return { seats, rowLabels };
}

/** Seat section: every row positioned + curved independently. */
export function buildSeatSectionSeatMap(
  rect: PixelRect,
  rows: SeatSectionRow[],
  rowGapPct: number,
  style: SeatLabelStyle,
): SeatMap {
  const seats: SeatNode[] = [];
  const rowLabels: RowLabelNode[] = [];
  const rowCount = Math.max(1, rows.length);
  const padX = Math.min(24, rect.width * 0.08);
  const padY = Math.min(24, rect.height * 0.1);
  const rowGapUnits = clamp(rowGapPct, 2, 24) / 8;
  const totalRowUnits = rowCount + (rowCount - 1) * rowGapUnits;
  const rowBand = Math.max(10, (rect.height - padY * 2) / Math.max(1, totalRowUnits));

  let top = rect.y + padY;
  rows.forEach((row, rowIndex) => {
    const label = rowLabel(rowIndex, style);
    const seatCount = clamp(Math.round(row.seatCount), 0, 100);
    const fitSpacing = (rect.width - padX * 2) / Math.max(1, seatCount);
    const desiredSpacing = Math.max(6, rect.width * (row.seatSpacingPct / 100));
    const spacing = Math.min(desiredSpacing, fitSpacing);
    const radius = Math.max(2, Math.min(rowBand * 0.28, spacing * 0.28));
    const centerX = rect.x + rect.width / 2 + (row.offsetXPct / 100) * rect.width;
    const centerY = top + rowBand / 2 + (row.offsetYPct / 100) * rect.height;
    const angle = (row.rotationDeg * Math.PI) / 180;
    const maxAmp = Math.min(rowBand * 0.95, Math.max(spacing * 1.6, rect.width * 0.18));

    if (seatCount > 0) {
      rowLabels.push({
        key: `${label}`,
        label,
        x: centerX - (spacing * seatCount) / 2 - radius * 2,
        y: centerY + radius * 0.4,
      });
    }

    for (let s = 0; s < seatCount; s++) {
      const centeredUnits = s - seatCount / 2 + 0.5;
      const localX = centeredUnits * spacing;
      const localY = curvedRowOffset(centeredUnits, seatCount, row.curveDeg, maxAmp);
      const rx = localX * Math.cos(angle) - localY * Math.sin(angle);
      const ry = localX * Math.sin(angle) + localY * Math.cos(angle);
      seats.push({
        key: `${label}-${s + 1}`,
        label: `${label}${s + 1}`,
        x: centerX + rx,
        y: centerY + ry,
        radius,
      });
    }
    top += rowBand + rowBand * rowGapUnits;
  });

  return { seats, rowLabels };
}

function curvedRowOffset(
  centeredUnits: number,
  totalUnits: number,
  curveAmount: number,
  maxAmplitude: number,
): number {
  if (curveAmount === 0 || totalUnits <= 1) {
    return 0;
  }
  const halfSpan = totalUnits / 2;
  const normalized = clamp(centeredUnits / Math.max(0.5, halfSpan), -1, 1);
  const arc = 1 - normalized * normalized;
  const amplitude = (curveAmount / 6) * maxAmplitude;
  return arc * amplitude;
}

/** Seats laid along the arcs of one ring sector (between inner and outer radii). */
export function buildSectorSeatMap(
  cx: number,
  cy: number,
  innerRx: number,
  innerRy: number,
  outerRx: number,
  outerRy: number,
  startDeg: number,
  endDeg: number,
  rows: number,
  seatsPerRow: number,
  style: SeatLabelStyle,
): SeatMap {
  const seats: SeatNode[] = [];
  const rowLabels: RowLabelNode[] = [];
  const safeRows = clamp(Math.round(rows), 0, 40);
  const safeSeats = clamp(Math.round(seatsPerRow), 0, 80);
  if (safeRows === 0 || safeSeats === 0) {
    return { seats, rowLabels };
  }
  const gap = 1.1;
  const a0 = startDeg + gap;
  const a1 = endDeg - gap;
  const spanRx = outerRx - innerRx;
  const spanRy = outerRy - innerRy;
  const radius = Math.max(
    1.5,
    Math.min((spanRx / safeRows) * 0.34, ((Math.abs(a1 - a0) / safeSeats) * Math.PI) / 180 * innerRx * 0.34),
  );

  for (let r = 0; r < safeRows; r++) {
    const t = (r + 0.5) / safeRows;
    const rx = innerRx + spanRx * t;
    const ry = innerRy + spanRy * t;
    const label = rowLabel(r, style);
    for (let s = 0; s < safeSeats; s++) {
      const at = (s + 0.5) / safeSeats;
      const angle = a0 + (a1 - a0) * at;
      const p = ellipsePoint(cx, cy, rx, ry, angle);
      seats.push({ key: `${label}-${s + 1}`, label: `${label}${s + 1}`, x: p.x, y: p.y, radius });
    }
  }
  return { seats, rowLabels };
}
