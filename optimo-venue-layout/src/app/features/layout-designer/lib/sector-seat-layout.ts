import { clamp, radialSectorPath } from './geometry';
import { SeatMap, SeatNode, rowLabel } from './seat-layout';
import { SeatLabelStyle, SeatLayoutSpec, SectorBlock } from '../models/layout-element.model';

export interface SectorSeatBounds {
  cx: number;
  cy: number;
  innerRx: number;
  innerRy: number;
  outerRx: number;
  outerRy: number;
  startDeg: number;
  endDeg: number;
  sideInsetDeg?: number;
}

interface SeatCell {
  seatId: string;
  rowIndex: number;
  seatNumber: number;
  rowLabelText: string;
  isHidden: boolean;
}

const MAX_ROWS = 100;
const MAX_SEATS_PER_ROW = 200;
const AISLE_GAP_UNITS = 0.8;

function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(Number.isFinite(value) ? value : min);
  return Math.max(min, Math.min(max, rounded));
}

function clampFloat(value: number, min: number, max: number): number {
  const next = Number.isFinite(value) ? value : min;
  return Math.max(min, Math.min(max, next));
}

export function seatIdFor(rowIndex: number, seatIndex: number, style: SeatLabelStyle): string {
  return `${rowLabel(rowIndex, style)}${seatIndex + 1}`;
}

function normalizeRowSeatCounts(
  rowSeatCounts: number[] | undefined,
  rows: number,
  seatsPerRow: number,
): number[] {
  return Array.from({ length: rows }, (_, rowIndex) =>
    clampInt(rowSeatCounts?.[rowIndex] ?? seatsPerRow, 0, MAX_SEATS_PER_ROW),
  );
}

function normalizeRowOffsets(offsets: number[] | undefined, rows: number): number[] {
  return Array.from({ length: rows }, (_, rowIndex) =>
    clampFloat(offsets?.[rowIndex] ?? 0, -40, 40),
  );
}

export function createDefaultSeatLayout(
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
    showSeatNumbers: true,
    showRowLabels: true,
  };
}

export function resolveSeatLayout(
  block: SectorBlock,
  fallbackRowLabelStyle: SeatLabelStyle,
): SeatLayoutSpec {
  const fallbackRows = clampInt(block.rows, 0, MAX_ROWS);
  const fallbackSeats = clampInt(block.seatsPerRow, 0, MAX_SEATS_PER_ROW);
  if (fallbackRows === 0 || fallbackSeats === 0) {
    return {
      rows: 0,
      seatsPerRow: 0,
      rowLabelStyle: block.rowLabelStyle ?? block.seatLayout?.rowLabelStyle ?? fallbackRowLabelStyle,
      showSeatNumbers: false,
      showRowLabels: false,
    };
  }

  const spec = block.seatLayout;
  const rows = clampInt(spec?.rows ?? fallbackRows, 1, MAX_ROWS);
  const seatsPerRow = clampInt(spec?.seatsPerRow ?? fallbackSeats, 1, MAX_SEATS_PER_ROW);
  const rowSeatCounts = normalizeRowSeatCounts(spec?.rowSeatCounts, rows, seatsPerRow);
  const seatNumberLimit = Math.max(seatsPerRow, ...rowSeatCounts);
  const rowStyle = spec?.rowLabelStyle ?? block.rowLabelStyle ?? fallbackRowLabelStyle;
  const hiddenSeatIds = Array.from(new Set((spec?.hiddenSeatIds ?? []).map((id) => id.trim().toUpperCase()).filter(Boolean)));
  const aisleAfterSeatNumbers = Array.from(
    new Set(
      (spec?.aisleAfterSeatNumbers ?? [])
        .map((value) => clampInt(value, 1, Math.max(1, seatNumberLimit - 1)))
        .filter((value) => value < seatNumberLimit),
    ),
  ).sort((a, b) => a - b);

  return {
    rows,
    seatsPerRow,
    rowSeatCounts,
    rowOffsetXPcts: normalizeRowOffsets(spec?.rowOffsetXPcts, rows),
    rowOffsetYPcts: normalizeRowOffsets(spec?.rowOffsetYPcts, rows),
    rowLabelStyle: rowStyle,
    hiddenSeatIds,
    aisleAfterSeatNumbers,
    showSeatNumbers: spec?.showSeatNumbers ?? true,
    showRowLabels: spec?.showRowLabels ?? true,
  };
}

export function visibleSeatCount(block: SectorBlock, fallbackRowLabelStyle: SeatLabelStyle): number {
  return seatCells(block, fallbackRowLabelStyle).filter((cell) => !cell.isHidden).length;
}

export function seatCells(block: SectorBlock, fallbackRowLabelStyle: SeatLabelStyle): SeatCell[] {
  const spec = resolveSeatLayout(block, fallbackRowLabelStyle);
  if (spec.rows === 0) {
    return [];
  }
  const hidden = new Set(spec.hiddenSeatIds ?? []);
  const rowSeatCounts = spec.rowSeatCounts ?? [];
  const style = spec.rowLabelStyle ?? 'letter';
  const cells: SeatCell[] = [];
  for (let rowIndex = 0; rowIndex < spec.rows; rowIndex++) {
    const label = rowLabel(rowIndex, style);
    const rowSeatCount = rowSeatCounts[rowIndex] ?? 0;
    for (let seatIndex = 0; seatIndex < rowSeatCount; seatIndex++) {
      const id = seatIdFor(rowIndex, seatIndex, style);
      cells.push({
        seatId: id,
        rowIndex,
        seatNumber: seatIndex + 1,
        rowLabelText: label,
        isHidden: hidden.has(id),
      });
    }
  }
  return cells;
}

function rowAisleAfter(seatCount: number, aisleAfter: number[]): number[] {
  return aisleAfter.filter((seatNumber) => seatNumber > 0 && seatNumber < seatCount);
}

function totalUnitsForRow(seatCount: number, aisleAfter: number[]): number {
  if (seatCount <= 0) {
    return 0;
  }
  return seatCount + rowAisleAfter(seatCount, aisleAfter).length * AISLE_GAP_UNITS;
}

function unitsBeforeSeat(seatNumber: number, aisleAfter: number[]): number {
  let units = seatNumber - 1;
  for (const aisle of aisleAfter) {
    if (seatNumber > aisle) {
      units += AISLE_GAP_UNITS;
    }
  }
  return units;
}

/** Sync legacy rows/seatsPerRow fields when seat layout changes. */
export function seatLayoutToBlockFields(spec: SeatLayoutSpec): Pick<SectorBlock, 'rows' | 'seatsPerRow' | 'rowLabelStyle'> {
  return {
    rows: spec.rows,
    seatsPerRow: spec.seatsPerRow,
    rowLabelStyle: spec.rowLabelStyle,
  };
}

export function mergeSeatLayoutPatch(
  block: SectorBlock,
  fallbackRowLabelStyle: SeatLabelStyle,
  patch: Partial<SeatLayoutSpec>,
): SeatLayoutSpec {
  const current = resolveSeatLayout(block, fallbackRowLabelStyle);
  const rows = clampInt(patch.rows ?? current.rows, 1, MAX_ROWS);
  const seatsPerRow = clampInt(patch.seatsPerRow ?? current.seatsPerRow, 1, MAX_SEATS_PER_ROW);
  const rowSeatCounts = normalizeRowSeatCounts(
    patch.rowSeatCounts ?? current.rowSeatCounts,
    rows,
    seatsPerRow,
  );
  return {
    ...current,
    ...patch,
    rows,
    seatsPerRow,
    rowSeatCounts,
    rowOffsetXPcts: normalizeRowOffsets(patch.rowOffsetXPcts ?? current.rowOffsetXPcts, rows),
    rowOffsetYPcts: normalizeRowOffsets(patch.rowOffsetYPcts ?? current.rowOffsetYPcts, rows),
  };
}

export function addSeatsToLayout(spec: SeatLayoutSpec, count: number): SeatLayoutSpec {
  const safe = clampInt(count, 1, 20);
  const rowSeatCounts = (spec.rowSeatCounts ?? []).map((seatCount) =>
    clampInt(seatCount + safe, 0, MAX_SEATS_PER_ROW),
  );
  const maxSeats = rowSeatCounts.reduce((max, seatCount) => Math.max(max, seatCount), spec.seatsPerRow);
  return {
    ...spec,
    rowSeatCounts,
    seatsPerRow: Math.max(spec.seatsPerRow, maxSeats),
  };
}

export function buildSectorSeatMapForBlock(
  block: SectorBlock,
  bounds: SectorSeatBounds,
  fallbackRowLabelStyle: SeatLabelStyle,
): SeatMap {
  const spec = resolveSeatLayout(block, fallbackRowLabelStyle);
  const seats: SeatNode[] = [];
  const rowLabels: SeatMap['rowLabels'] = [];
  if (spec.rows === 0) {
    return { seats, rowLabels };
  }

  const gap = bounds.sideInsetDeg ?? 0.8;
  const startDeg = bounds.startDeg + gap;
  const endDeg = bounds.endDeg - gap;
  const sweepDeg = Math.max(8, endDeg - startDeg);
  const aisleAfter = spec.aisleAfterSeatNumbers ?? [];
  const rowSeatCounts = spec.rowSeatCounts ?? [];
  const rowOffsetXPcts = spec.rowOffsetXPcts ?? [];
  const rowOffsetYPcts = spec.rowOffsetYPcts ?? [];
  const cells = seatCells(block, fallbackRowLabelStyle);
  const totalColUnits = Math.max(
    1,
    rowSeatCounts.reduce(
      (max, rowSeatCount) => Math.max(max, totalUnitsForRow(rowSeatCount, aisleAfter)),
      0,
    ),
  );
  const angleStep = sweepDeg / totalColUnits;
  const spanRx = bounds.outerRx - bounds.innerRx;
  const spanRy = bounds.outerRy - bounds.innerRy;
  const rowBandX = Math.max(2, spanRx);
  const rowBandY = Math.max(2, spanRy);
  const showNumbers = spec.showSeatNumbers !== false;

  for (const cell of cells) {
    if (cell.isHidden) {
      continue;
    }
    const rowSeatCount = rowSeatCounts[cell.rowIndex] ?? 0;
    const rowAisles = rowAisleAfter(rowSeatCount, aisleAfter);
    const rowTotalColUnits = Math.max(1, totalUnitsForRow(rowSeatCount, aisleAfter));
    const leadingUnits = (totalColUnits - rowTotalColUnits) / 2;
    const rowRatio = (cell.rowIndex + 0.5) / Math.max(1, spec.rows);
    const rx = bounds.innerRx + spanRx * rowRatio;
    const ry = bounds.innerRy + spanRy * rowRatio;
    const angleDeg =
      startDeg +
      (leadingUnits + unitsBeforeSeat(cell.seatNumber, rowAisles) + 0.5) * angleStep;
    const angleRad = (angleDeg * Math.PI) / 180;
    const arcRadius = ((rx + ry) / 2) * ((Math.PI / 180) * angleStep);
    const radialBand = Math.min(spanRx, spanRy) / Math.max(1, spec.rows);
    const radius = Math.max(1.2, Math.min(arcRadius, radialBand) * 0.28);
    const offsetScaleX = bounds.outerRx * 2;
    const offsetScaleY = bounds.outerRy * 2;
    seats.push({
      key: cell.seatId,
      seatId: cell.seatId,
      label: cell.seatId,
      x: bounds.cx + rx * Math.cos(angleRad) + ((rowOffsetXPcts[cell.rowIndex] ?? 0) / 100) * offsetScaleX,
      y: bounds.cy + ry * Math.sin(angleRad) + ((rowOffsetYPcts[cell.rowIndex] ?? 0) / 100) * offsetScaleY,
      radius,
      showNumber: showNumbers,
    });
  }

  if (spec.showRowLabels !== false) {
    const labelAngleRad = (startDeg * Math.PI) / 180;
    const style = spec.rowLabelStyle ?? 'letter';
    for (let rowIndex = 0; rowIndex < spec.rows; rowIndex++) {
      const rowSeatCount = rowSeatCounts[rowIndex] ?? 0;
      if (rowSeatCount <= 0) {
        continue;
      }
      const label = rowLabel(rowIndex, style);
      const rowRatio = (rowIndex + 0.5) / Math.max(1, spec.rows);
      const rx = bounds.innerRx + spanRx * rowRatio;
      const ry = bounds.innerRy + spanRy * rowRatio;
      const x = bounds.cx + rx * Math.cos(labelAngleRad) + ((rowOffsetXPcts[rowIndex] ?? 0) / 100) * (bounds.outerRx * 2);
      const y = bounds.cy + ry * Math.sin(labelAngleRad) + ((rowOffsetYPcts[rowIndex] ?? 0) / 100) * (bounds.outerRy * 2);
      rowLabels.push({
        key: `row-${label}`,
        label,
        x,
        y,
      });
    }
  }

  return { seats, rowLabels };
}

export interface SectorSeatPreview {
  viewBox: string;
  path: string;
  map: SeatMap;
}

function sectorOutlinePoints(bounds: SectorSeatBounds): { x: number; y: number }[] {
  const gap = bounds.sideInsetDeg ?? 0.8;
  const startDeg = bounds.startDeg + gap;
  const endDeg = bounds.endDeg - gap;
  const points: { x: number; y: number }[] = [];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const deg = startDeg + ((endDeg - startDeg) * i) / steps;
    const rad = (deg * Math.PI) / 180;
    points.push({
      x: bounds.cx + bounds.innerRx * Math.cos(rad),
      y: bounds.cy + bounds.innerRy * Math.sin(rad),
    });
    points.push({
      x: bounds.cx + bounds.outerRx * Math.cos(rad),
      y: bounds.cy + bounds.outerRy * Math.sin(rad),
    });
  }
  return points;
}

/** Build a seat map + wedge path fitted to the selected block's actual angles. */
export function buildSectorSeatPreview(
  block: SectorBlock,
  fallbackRowLabelStyle: SeatLabelStyle,
  previewW: number,
  previewH: number,
): SectorSeatPreview {
  const pad = 14;
  const innerR = 55;
  const outerR = 100;
  const normBounds: SectorSeatBounds = {
    cx: 0,
    cy: 0,
    innerRx: innerR,
    innerRy: innerR,
    outerRx: outerR,
    outerRy: outerR,
    startDeg: block.startAngleDeg,
    endDeg: block.endAngleDeg,
  };
  const map = buildSectorSeatMapForBlock(block, normBounds, fallbackRowLabelStyle);
  const outline = sectorOutlinePoints(normBounds);
  const allPoints = [
    ...outline,
    ...map.seats.map((seat) => ({ x: seat.x, y: seat.y })),
    ...map.rowLabels.map((label) => ({ x: label.x, y: label.y })),
  ];
  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const bboxW = Math.max(1, maxX - minX);
  const bboxH = Math.max(1, maxY - minY);
  const scale = Math.min((previewW - pad * 2) / bboxW, (previewH - pad * 2) / bboxH);
  const cxNorm = (minX + maxX) / 2;
  const cyNorm = (minY + maxY) / 2;
  const tx = (x: number) => (x - cxNorm) * scale + previewW / 2;
  const ty = (y: number) => (y - cyNorm) * scale + previewH / 2;
  const path = radialSectorPath({
    cx: tx(0),
    cy: ty(0),
    innerRx: innerR * scale,
    innerRy: innerR * scale,
    outerRx: outerR * scale,
    outerRy: outerR * scale,
    startDeg: block.startAngleDeg + 0.8,
    endDeg: block.endAngleDeg - 0.8,
  });
  return {
    viewBox: `0 0 ${previewW} ${previewH}`,
    path,
    map: {
      seats: map.seats.map((seat) => ({
        ...seat,
        x: tx(seat.x),
        y: ty(seat.y),
        radius: seat.radius * scale,
      })),
      rowLabels: map.rowLabels.map((label) => ({
        ...label,
        x: tx(label.x),
        y: ty(label.y),
      })),
    },
  };
}

export function parseCommaNumbers(raw: string, maxSeatNumber: number): number[] {
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((value) => Number.isFinite(value) && value >= 1 && value < maxSeatNumber)
        .map((value) => Math.round(value)),
    ),
  ).sort((a, b) => a - b);
}

export function parseSeatIdList(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((part) => part.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}
