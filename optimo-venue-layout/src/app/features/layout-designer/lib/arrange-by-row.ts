import { PixelRect } from './geometry';
import {
  capSeatLayoutToCapacity,
  getSeatLayoutRowSeatCounts,
  getSeatLayoutSpec,
  resizeSeatLayoutRows,
  seatId,
} from './block-seat-layout';
import { rowLabel } from './seat-layout';
import {
  canvasPointToElementPct,
  clampPointInsidePolygon,
  createEmptyCustomShapeSeating,
  estimateMaxSeatsOnLine,
  getCustomShapeVisibleSeatCount,
  isCanvasPctInsideCustomShape,
  pointInPolygon,
  type PhysicalDimsInput,
} from './custom-shape-seats';
import {
  chairPitchPx,
  computePhysicalCapacity,
  totalSeatsInRowCounts,
} from './physical-dims';
import {
  CenterpieceElement,
  CustomShapeSeatPosition,
  ElementPosition,
  hasTracedBlockOutline,
  isCustomShapeSeatingEnabled,
  SeatLabelStyle,
} from '../models/layout-element.model';

interface CanvasPoint {
  x: number;
  y: number;
}

function getOutlineCanvasPoints(el: CenterpieceElement, rect: PixelRect): CanvasPoint[] {
  return (el.customPoints ?? []).map((p) => ({
    x: rect.x + (p.xPct / 100) * rect.width,
    y: rect.y + (p.yPct / 100) * rect.height,
  }));
}

function canvasPctToPoint(
  canvasPct: ElementPosition,
  canvas: { width: number; height: number },
): CanvasPoint {
  return {
    x: (canvasPct.xPct / 100) * canvas.width,
    y: (canvasPct.yPct / 100) * canvas.height,
  };
}

export function isArrangeByRowElement(el: CenterpieceElement): boolean {
  return (
    hasTracedBlockOutline(el) &&
    el.arrangeByRowMode === true &&
    (el.customSeatBlocks?.length ?? 0) === 0 &&
    !el.dragSeatsMode &&
    !el.perSeatPlacementMode
  );
}

export function parseElementSeatId(
  seatIdStr: string,
  style: SeatLabelStyle = 'letter',
): { rowIndex: number; seatIndex: number } | null {
  const match = seatIdStr.match(/^([A-Z]+)(\d+)$/i);
  if (!match) {
    return null;
  }
  const rowLabelText = match[1].toUpperCase();
  const seatIndex = Math.max(0, parseInt(match[2], 10) - 1);
  for (let rowIndex = 0; rowIndex < 100; rowIndex += 1) {
    if (rowLabel(rowIndex, style).toUpperCase() === rowLabelText) {
      return { rowIndex, seatIndex };
    }
  }
  return null;
}

/** True when the seat is the last column in an arrange-by-row row (draggable to extend). */
export function getArrangeByRowLastSeatInfo(
  element: CenterpieceElement,
  seatIdStr: string,
): { rowIndex: number; seatIndex: number } | null {
  if (!element.arrangeByRowMode || !element.seatLayout) {
    return null;
  }
  const style = element.rowLabelStyle ?? element.seatLayout.rowLabelStyle ?? 'letter';
  const parsed = parseElementSeatId(seatIdStr, style);
  if (!parsed) {
    return null;
  }
  const spec = getSeatLayoutSpec({
    rows: element.rows,
    seatsPerRow: element.seatsPerRow,
    rowLabelStyle: element.rowLabelStyle,
    seatLayout: element.seatLayout,
  });
  const rowSeatCounts = getSeatLayoutRowSeatCounts(spec);
  const rowCount = rowSeatCounts[parsed.rowIndex] ?? 0;
  if (rowCount <= 0 || parsed.seatIndex !== rowCount - 1) {
    return null;
  }
  const path = element.arrangeByRowRows?.[parsed.rowIndex];
  if (!path) {
    return null;
  }
  return parsed;
}

function resolveTargetRowIndex(element: CenterpieceElement): number {
  if (!element.seatLayout) {
    return 0;
  }
  const spec = getSeatLayoutSpec({
    rows: element.rows,
    seatsPerRow: element.seatsPerRow,
    rowLabelStyle: element.rowLabelStyle,
    seatLayout: element.seatLayout,
  });
  const rowSeatCounts = getSeatLayoutRowSeatCounts(spec);
  const empty = rowSeatCounts.findIndex((count) => count === 0);
  if (empty >= 0) {
    return empty;
  }
  const capacity = computePhysicalCapacity(element);
  if (spec.rows < capacity.maxRows) {
    return spec.rows;
  }
  return Math.max(0, rowSeatCounts.length - 1);
}

function maxSeatsForArrangeRowSpan(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  anchorPct: ElementPosition,
  endPct: ElementPosition,
  rowIndex: number,
): number {
  const lineMax = estimateMaxSeatsOnLine(element, rect, canvas, [anchorPct, endPct]);
  if (lineMax <= 0) {
    return 1;
  }
  const spec = element.seatLayout
    ? getSeatLayoutSpec({
        rows: element.rows,
        seatsPerRow: element.seatsPerRow,
        rowLabelStyle: element.rowLabelStyle,
        seatLayout: element.seatLayout,
      })
    : null;
  const rowSeatCounts = spec ? getSeatLayoutRowSeatCounts(spec) : [];
  const currentRow = rowSeatCounts[rowIndex] ?? 0;
  const otherTotal = totalSeatsInRowCounts(rowSeatCounts) - currentRow;
  const capacity = computePhysicalCapacity(element);
  return Math.max(1, Math.min(lineMax, capacity.maxCapacity - otherTotal, capacity.maxSeatsPerRow));
}

/** Seat count from anchor→end span; first seat at anchor, last at end. */
function seatCountForAnchorEndSpan(
  spanPx: number,
  pitchPx: number,
  maxCount: number,
): number {
  if (spanPx < pitchPx * 0.25) {
    return 1;
  }
  const count = Math.floor(spanPx / pitchPx) + 1;
  return Math.min(maxCount, Math.max(1, count));
}

/** Place seats with first at anchor and last at end; columns evenly between. */
function sampleSeatsAnchorToEnd(
  anchor: CanvasPoint,
  end: CanvasPoint,
  seatCount: number,
): CanvasPoint[] {
  if (seatCount <= 1) {
    return [{ ...anchor }];
  }
  return Array.from({ length: seatCount }, (_, index) => {
    const t = index / (seatCount - 1);
    return {
      x: anchor.x + (end.x - anchor.x) * t,
      y: anchor.y + (end.y - anchor.y) * t,
    };
  });
}

function buildArrangeByRowPatch(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  rowIndex: number,
  anchorPct: ElementPosition,
  endPct: ElementPosition,
): Partial<CenterpieceElement> {
  if (!element.seatLayout) {
    return {};
  }
  const polygon = getOutlineCanvasPoints(element, rect);
  if (polygon.length < 3) {
    return {};
  }

  const anchorPx = canvasPctToPoint(anchorPct, canvas);
  let endPx = canvasPctToPoint(endPct, canvas);
  if (!pointInPolygon(endPx, polygon)) {
    endPx = clampPointInsidePolygon(endPx, polygon);
  }

  const pitch = chairPitchPx(element, rect);
  const spanPx = Math.hypot(endPx.x - anchorPx.x, endPx.y - anchorPx.y);
  const maxCount = maxSeatsForArrangeRowSpan(element, rect, canvas, anchorPct, endPct, rowIndex);
  const seatCount = seatCountForAnchorEndSpan(spanPx, pitch, maxCount);
  const placements = sampleSeatsAnchorToEnd(anchorPx, endPx, seatCount)
    .map((p) => clampPointInsidePolygon(p, polygon))
    .filter((p) => pointInPolygon(p, polygon));
  if (placements.length === 0) {
    return {};
  }

  let spec = getSeatLayoutSpec({
    rows: element.rows,
    seatsPerRow: element.seatsPerRow,
    rowLabelStyle: element.rowLabelStyle,
    seatLayout: element.seatLayout,
  });
  const rowSeatCounts = [...getSeatLayoutRowSeatCounts(spec)];
  const style = spec.rowLabelStyle ?? 'letter';

  while (rowIndex >= rowSeatCounts.length) {
    if (spec.rows >= computePhysicalCapacity(element).maxRows) {
      break;
    }
    spec = resizeSeatLayoutRows(spec, spec.rows + 1);
    rowSeatCounts.push(0);
  }
  if (rowIndex >= rowSeatCounts.length) {
    return {};
  }

  const previousCount = rowSeatCounts[rowIndex] ?? 0;
  const overrides: Record<string, CustomShapeSeatPosition> = {
    ...(element.seatPositionOverrides ?? {}),
  };
  for (let i = 0; i < Math.max(previousCount, spec.seatsPerRow); i += 1) {
    delete overrides[seatId(rowIndex, i, style)];
  }

  rowSeatCounts[rowIndex] = placements.length;
  for (let i = 0; i < placements.length; i += 1) {
    overrides[seatId(rowIndex, i, style)] = canvasPointToElementPct(placements[i], rect);
  }

  const capacity = computePhysicalCapacity(element);
  const nextSpec = capSeatLayoutToCapacity(
    {
      ...spec,
      rowSeatCounts,
      seatsPerRow: Math.max(spec.seatsPerRow, ...rowSeatCounts),
      customShapeSeatPitchPx: pitch,
      seatAlign: 'center',
    },
    capacity.maxRows,
    capacity.maxSeatsPerRow,
  );

  const paths = [...(element.arrangeByRowRows ?? [])];
  while (paths.length <= rowIndex) {
    paths.push({ anchor: anchorPct, end: endPct });
  }
  paths[rowIndex] = { anchor: anchorPct, end: endPct };

  return {
    rows: nextSpec.rows,
    seatsPerRow: nextSpec.seatsPerRow,
    rowLabelStyle: nextSpec.rowLabelStyle,
    seatLayout: nextSpec,
    seatPositionOverrides: overrides,
    arrangeByRowRows: paths,
    arrangeByRowMode: true,
  };
}

export function enableArrangeByRowSeating(
  element: CenterpieceElement,
  rect: PixelRect,
  dims: PhysicalDimsInput,
): Partial<CenterpieceElement> {
  return {
    ...createEmptyCustomShapeSeating(element, rect, dims),
    arrangeByRowMode: true,
    arrangeByRowRows: [],
  };
}

export function beginArrangeByRowAnchor(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  anchorPct: ElementPosition,
): { patch: Partial<CenterpieceElement>; rowIndex: number } | null {
  if (!isCanvasPctInsideCustomShape(element, rect, canvas, anchorPct)) {
    return null;
  }
  const rowIndex = resolveTargetRowIndex(element);
  const patch = buildArrangeByRowPatch(element, rect, canvas, rowIndex, anchorPct, anchorPct);
  if (Object.keys(patch).length === 0) {
    return null;
  }
  return { patch, rowIndex };
}

export function expandArrangeByRowRow(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  rowIndex: number,
  anchorPct: ElementPosition,
  endPct: ElementPosition,
): Partial<CenterpieceElement> {
  if (!isArrangeByRowElement(element) && !element.arrangeByRowMode) {
    return {};
  }
  return buildArrangeByRowPatch(element, rect, canvas, rowIndex, anchorPct, endPct);
}

export function expandArrangeByRowLastSeat(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  rowIndex: number,
  endPct: ElementPosition,
): Partial<CenterpieceElement> {
  const path = element.arrangeByRowRows?.[rowIndex];
  if (!path || !element.arrangeByRowMode) {
    return {};
  }
  
  return buildArrangeByRowPatch(element, rect, canvas, rowIndex, path.anchor, endPct);
}

export function getArrangeByRowSeatTotal(element: CenterpieceElement, rect: PixelRect): number {
  if (!isCustomShapeSeatingEnabled(element)) {
    return 0;
  }
  return getCustomShapeVisibleSeatCount(element, rect);
}
