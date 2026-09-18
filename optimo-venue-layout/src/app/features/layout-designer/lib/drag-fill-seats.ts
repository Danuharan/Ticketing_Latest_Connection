import { seatFacingDegFromViewpoint } from './block-label';
import { PixelRect } from './geometry';
import {
  capSeatLayoutToCapacity,
  getSeatLayoutRowSeatCounts,
  getSeatLayoutSpec,
  resizeSeatLayoutRows,
  seatId,
} from './block-seat-layout';
import {
  beginArrangeByRowAnchor,
  parseElementSeatId,
} from './arrange-by-row';
import {
  canvasPointToElementPct,
  createEmptyCustomShapeSeating,
  getCustomShapeVisibleSeatCount,
  isCanvasPctInsideCustomShape,
  pointInPolygon,
  pointInsidePolygonWithPadding,
  type PhysicalDimsInput,
} from './custom-shape-seats';
import {
  buildViewpointSeatFrame,
  clampAlongOnViewpointRow,
  computePxPerMetre,
  placeMaxSeatsAtViewpointDepth,
  placeSeatsOnViewpointSpan,
  projectOnViewpointFrame,
  resolveStadiumSideIndex,
  resolvePitchPx as resolveDragSeatsPitchPx,
  resolveRowGapPx as resolveDragSeatsRowGapPx,
  viewpointFirstRowDepthPx,
  viewpointPointOnFrame,
  type ViewpointSeatFrame,
} from './drag-seats';
import {
  chairPitchPx,
  computePhysicalCapacity,
  resolveBlockLengthM,
  resolveBlockWidthM,
  resolveChairLengthM,
  resolveChairWidthM,
  resolveSeatGapM,
} from './physical-dims';
import {
  ArrangeByRowPath,
  CenterpieceElement,
  CustomShapeSeatPosition,
  ElementPosition,
  hasTracedBlockOutline,
} from '../models/layout-element.model';

interface CanvasPoint {
  x: number;
  y: number;
}

interface RowGeometry {
  start: CanvasPoint;
  end: CanvasPoint;
  ux: number;
  uy: number;
  inwardX: number;
  inwardY: number;
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

function elementPctToCanvasPoint(xPct: number, yPct: number, rect: PixelRect): CanvasPoint {
  return {
    x: rect.x + (xPct / 100) * rect.width,
    y: rect.y + (yPct / 100) * rect.height,
  };
}

function getOutlineCanvasPoints(el: CenterpieceElement, rect: PixelRect): CanvasPoint[] {
  return (el.customPoints ?? []).map((p) => ({
    x: rect.x + (p.xPct / 100) * rect.width,
    y: rect.y + (p.yPct / 100) * rect.height,
  }));
}

function polygonCentroid(polygon: CanvasPoint[]): CanvasPoint {
  let sx = 0;
  let sy = 0;
  for (const point of polygon) {
    sx += point.x;
    sy += point.y;
  }
  const n = Math.max(1, polygon.length);
  return { x: sx / n, y: sy / n };
}

function resolvePhysicalDims(element: CenterpieceElement): PhysicalDimsInput {
  return {
    physicalLengthM: resolveBlockLengthM(element),
    physicalWidthM: resolveBlockWidthM(element),
    chairLengthM: resolveChairLengthM(element),
    chairWidthM: resolveChairWidthM(element),
    seatGapM: resolveSeatGapM(element),
    rowGapM: element.rowGapM ?? resolveSeatGapM(element),
  };
}

function resolvePitchPx(element: CenterpieceElement, rect: PixelRect): number {
  const polygon = getOutlineCanvasPoints(element, rect);
  const sideLengthsM = element.customSideLengthsM ?? [];
  if (polygon.length >= 3 && sideLengthsM.length >= 3) {
    const ppm = computePxPerMetre(polygon, sideLengthsM);
    return resolveDragSeatsPitchPx(element, ppm);
  }
  const frozen = element.seatLayout?.customShapeSeatPitchPx;
  if (frozen && frozen > 0) {
    return frozen;
  }
  return chairPitchPx(element, rect);
}

function resolveRowGapPx(element: CenterpieceElement, rect: PixelRect): number {
  const polygon = getOutlineCanvasPoints(element, rect);
  const sideLengthsM = element.customSideLengthsM ?? [];
  if (polygon.length >= 3 && sideLengthsM.length >= 3) {
    const ppm = computePxPerMetre(polygon, sideLengthsM);
    return resolveDragSeatsRowGapPx(element, ppm);
  }
  return Math.max(8, resolvePitchPx(element, rect));
}

function rowStyle(element: CenterpieceElement): 'letter' | 'number' {
  return element.rowLabelStyle ?? element.seatLayout?.rowLabelStyle ?? 'letter';
}

function withDragFillFlags(patch: Partial<CenterpieceElement>, element: CenterpieceElement): Partial<CenterpieceElement> {
  const facingDeg =
    element.blockViewpointAngleDeg != null
      ? seatFacingDegFromViewpoint(element.blockViewpointAngleDeg)
      : patch.seatFacingDeg ?? element.seatFacingDeg;
  return {
    ...patch,
    dragFillSeatsMode: true,
    arrangeByRowMode: true,
    seatFacingDeg: facingDeg,
  };
}

function syncArrangeByRowPaths(
  element: CenterpieceElement,
  rect: PixelRect,
): ArrangeByRowPath[] {
  if (!element.seatLayout) {
    return [];
  }
  const spec = getSeatLayoutSpec({
    rows: element.rows,
    seatsPerRow: element.seatsPerRow,
    rowLabelStyle: element.rowLabelStyle,
    seatLayout: element.seatLayout,
  });
  const style = spec.rowLabelStyle ?? 'letter';
  const rowSeatCounts = getSeatLayoutRowSeatCounts(spec);
  const overrides = element.seatPositionOverrides ?? {};
  const paths: ArrangeByRowPath[] = [];
  for (let rowIndex = 0; rowIndex < rowSeatCounts.length; rowIndex += 1) {
    const count = rowSeatCounts[rowIndex] ?? 0;
    if (count <= 0) {
      continue;
    }
    const first = overrides[seatId(rowIndex, 0, style)];
    const last = overrides[seatId(rowIndex, count - 1, style)];
    if (first && last) {
      paths[rowIndex] = { anchor: first, end: last };
    }
  }
  return paths;
}

function rowGeometry(
  element: CenterpieceElement,
  rect: PixelRect,
  rowIndex: number,
): RowGeometry | null {
  if (!element.seatLayout) {
    return null;
  }
  const polygon = getOutlineCanvasPoints(element, rect);
  const style = rowStyle(element);
  const spec = getSeatLayoutSpec({
    rows: element.rows,
    seatsPerRow: element.seatsPerRow,
    rowLabelStyle: element.rowLabelStyle,
    seatLayout: element.seatLayout,
  });
  const count = getSeatLayoutRowSeatCounts(spec)[rowIndex] ?? 0;
  if (count <= 0) {
    return null;
  }
  const overrides = element.seatPositionOverrides ?? {};
  const firstPos = overrides[seatId(rowIndex, 0, style)];
  const lastPos = overrides[seatId(rowIndex, count - 1, style)];
  if (!firstPos || !lastPos) {
    return null;
  }
  const start = elementPctToCanvasPoint(firstPos.xPct, firstPos.yPct, rect);
  const end = elementPctToCanvasPoint(lastPos.xPct, lastPos.yPct, rect);
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  if (Math.hypot(dx, dy) < 1) {
    dx = 1;
    dy = 0;
  }
  const rowLen = Math.hypot(dx, dy) || 1;
  const ux = dx / rowLen;
  const uy = dy / rowLen;
  const center = polygonCentroid(polygon);
  const candidates = [
    { x: -uy, y: ux },
    { x: uy, y: -ux },
  ];
  let inwardX = candidates[0].x;
  let inwardY = candidates[0].y;
  const toCenter = { x: center.x - start.x, y: center.y - start.y };
  for (const candidate of candidates) {
    if (candidate.x * toCenter.x + candidate.y * toCenter.y >= 0) {
      inwardX = candidate.x;
      inwardY = candidate.y;
      break;
    }
  }
  const inwardLen = Math.hypot(inwardX, inwardY) || 1;
  return { start, end, ux, uy, inwardX: inwardX / inwardLen, inwardY: inwardY / inwardLen };
}

function lastPopulatedRowIndex(rowSeatCounts: number[]): number {
  for (let index = rowSeatCounts.length - 1; index >= 0; index -= 1) {
    if ((rowSeatCounts[index] ?? 0) > 0) {
      return index;
    }
  }
  return -1;
}

function maxSeatsOnLineThroughPoint(
  polygon: CanvasPoint[],
  origin: CanvasPoint,
  ux: number,
  uy: number,
  pitchPx: number,
): CanvasPoint[] {
  const scanHalf = 4000;
  let minT = Number.POSITIVE_INFINITY;
  let maxT = Number.NEGATIVE_INFINITY;
  const step = Math.max(2, pitchPx / 4);
  for (let t = -scanHalf; t <= scanHalf; t += step) {
    const point = { x: origin.x + ux * t, y: origin.y + uy * t };
    if (pointInPolygon(point, polygon)) {
      minT = Math.min(minT, t);
      maxT = Math.max(maxT, t);
    }
  }
  if (minT > maxT) {
    return [];
  }
  const span = maxT - minT;
  const inset = Math.min(pitchPx * 0.5, span * 0.05);
  const innerMin = minT + inset;
  const innerMax = maxT - inset;
  if (innerMax < innerMin) {
    return [];
  }
  const maxCount = Math.max(1, Math.floor((innerMax - innerMin) / pitchPx) + 1);
  const groupWidth = (maxCount - 1) * pitchPx;
  const startT = innerMin + (innerMax - innerMin - groupWidth) / 2;
  const placements: CanvasPoint[] = [];
  for (let index = 0; index < maxCount; index += 1) {
    const t = startT + index * pitchPx;
    const point = { x: origin.x + ux * t, y: origin.y + uy * t };
    if (pointInPolygon(point, polygon)) {
      placements.push(point);
    }
  }
  return placements;
}

function seatsAlongRowDirection(
  polygon: CanvasPoint[],
  anchor: CanvasPoint,
  ux: number,
  uy: number,
  pitchPx: number,
  maxCount: number,
): CanvasPoint[] {
  const padding = Math.max(2.8, pitchPx * 0.42);
  const placements: CanvasPoint[] = [];
  for (let index = 0; index < maxCount; index += 1) {
    const point = {
      x: anchor.x + ux * index * pitchPx,
      y: anchor.y + uy * index * pitchPx,
    };
    if (!pointInPolygon(point, polygon)) {
      break;
    }
    if (!pointInsidePolygonWithPadding(point, polygon, padding)) {
      break;
    }
    placements.push(point);
  }
  return placements;
}

/** Fill one row along VIEW POINT row axis — first seat stays at anchor, whole seats toward drag. */
function placeRowAlongViewpointAnchored(
  polygon: CanvasPoint[],
  frame: ViewpointSeatFrame,
  depthPx: number,
  pitchPx: number,
  anchorPx: CanvasPoint,
  endCanvasPx: CanvasPoint,
): CanvasPoint[] {
  const anchorProj = projectOnViewpointFrame(frame, anchorPx);
  const dragProj = projectOnViewpointFrame(frame, endCanvasPx);
  const spanAlong = Math.abs(dragProj.along - anchorProj.along);
  const padding = Math.max(2.8, pitchPx * 0.42);

  if (spanAlong < pitchPx * 0.5) {
    return [{ ...anchorPx }];
  }

  const spanPlacements = placeSeatsOnViewpointSpan(
    polygon,
    frame,
    depthPx,
    pitchPx,
    anchorProj.along,
    dragProj.along,
  );

  if (spanPlacements.length >= 1) {
    spanPlacements[0] = { ...anchorPx };
    return spanPlacements;
  }

  const sign: 1 | -1 = dragProj.along >= anchorProj.along ? 1 : -1;
  const endAlong = dragProj.along;
  const maxByDrag = 1 + Math.floor((spanAlong + 1e-6) / pitchPx);
  const placements: CanvasPoint[] = [{ ...anchorPx }];
  for (let index = 1; index < maxByDrag && index < 512; index += 1) {
    const along = anchorProj.along + sign * index * pitchPx;
    const point = viewpointPointOnFrame(frame, along, depthPx);
    if (!pointInPolygon(point, polygon)) {
      break;
    }
    if (!pointInsidePolygonWithPadding(point, polygon, padding)) {
      break;
    }
    if (sign > 0 && along > endAlong + 0.01) {
      break;
    }
    if (sign < 0 && along < endAlong - 0.01) {
      break;
    }
    placements.push(point);
  }
  return placements;
}

function buildDragFillRowsPatch(
  element: CenterpieceElement,
  rect: PixelRect,
  fromRowIndex: number,
  rowPlacements: CanvasPoint[][],
): Partial<CenterpieceElement> {
  if (!element.seatLayout || rowPlacements.length === 0) {
    return {};
  }

  const style = rowStyle(element);
  let spec = getSeatLayoutSpec({
    rows: element.rows,
    seatsPerRow: element.seatsPerRow,
    rowLabelStyle: element.rowLabelStyle,
    seatLayout: element.seatLayout,
  });
  const rowSeatCounts = [...getSeatLayoutRowSeatCounts(spec)];
  const capacity = computePhysicalCapacity(element);
  const overrides: Record<string, CustomShapeSeatPosition> = {
    ...(element.seatPositionOverrides ?? {}),
  };
  const paths = [...(element.arrangeByRowRows ?? [])];

  for (let offset = 0; offset < rowPlacements.length; offset += 1) {
    const rowIndex = fromRowIndex + offset;
    if (rowIndex >= capacity.maxRows) {
      break;
    }
    const placements = rowPlacements[offset];
    if (!placements || placements.length === 0) {
      continue;
    }

    while (rowIndex >= rowSeatCounts.length) {
      if (spec.rows >= capacity.maxRows) {
        break;
      }
      spec = resizeSeatLayoutRows(spec, spec.rows + 1);
      rowSeatCounts.push(0);
    }
    if (rowIndex >= rowSeatCounts.length) {
      break;
    }

    for (let seatIndex = 0; seatIndex < Math.max(rowSeatCounts[rowIndex] ?? 0, spec.seatsPerRow); seatIndex += 1) {
      delete overrides[seatId(rowIndex, seatIndex, style)];
    }

    rowSeatCounts[rowIndex] = placements.length;
    for (let seatIndex = 0; seatIndex < placements.length; seatIndex += 1) {
      overrides[seatId(rowIndex, seatIndex, style)] = canvasPointToElementPct(
        placements[seatIndex],
        rect,
      );
    }

    const first = overrides[seatId(rowIndex, 0, style)];
    const last = overrides[seatId(rowIndex, placements.length - 1, style)];
    if (first && last) {
      paths[rowIndex] = { anchor: first, end: last };
    }
  }

  const pitchPx = resolvePitchPx(element, rect);
  const nextSpec = capSeatLayoutToCapacity(
    {
      ...spec,
      rowSeatCounts,
      seatsPerRow: Math.max(spec.seatsPerRow, ...rowSeatCounts),
      customShapeSeatPitchPx: pitchPx,
      seatAlign: 'center',
    },
    capacity.maxRows,
    capacity.maxSeatsPerRow,
  );

  return withDragFillFlags(
    {
      rows: nextSpec.rows,
      seatsPerRow: nextSpec.seatsPerRow,
      rowLabelStyle: nextSpec.rowLabelStyle,
      seatLayout: nextSpec,
      seatPositionOverrides: overrides,
      arrangeByRowRows: paths,
    },
    element,
  );
}

/** Extend one row along the VIEW POINT row line (sideways / along drag). */
function expandDragFillRowAlong(
  element: CenterpieceElement,
  rect: PixelRect,
  rowIndex: number,
  endCanvasPx: CanvasPoint,
): Partial<CenterpieceElement> {
  const vf = buildViewpointSeatFrame(element, rect);
  const style = rowStyle(element);
  const overrides = element.seatPositionOverrides ?? {};
  const firstPos = overrides[seatId(rowIndex, 0, style)];
  if (!firstPos) {
    return {};
  }

  const pitchPx = resolvePitchPx(element, rect);
  const anchorPx = elementPctToCanvasPoint(firstPos.xPct, firstPos.yPct, rect);

  let placements: CanvasPoint[];
  if (vf) {
    const depthPx = projectOnViewpointFrame(vf.frame, anchorPx).depth;
    placements = placeRowAlongViewpointAnchored(
      vf.polygon,
      vf.frame,
      depthPx,
      pitchPx,
      anchorPx,
      endCanvasPx,
    );
  } else {
    const geom = rowGeometry(element, rect, rowIndex);
    const polygon = getOutlineCanvasPoints(element, rect);
    if (!geom) {
      return {};
    }
    const dragAlong =
      (endCanvasPx.x - anchorPx.x) * geom.ux + (endCanvasPx.y - anchorPx.y) * geom.uy;
    const sign = dragAlong >= 0 ? 1 : -1;
    const ux = geom.ux * sign;
    const uy = geom.uy * sign;
    const countByDrag = Math.max(1, Math.floor(Math.abs(dragAlong) / pitchPx) + 1);
    placements = seatsAlongRowDirection(polygon, anchorPx, ux, uy, pitchPx, countByDrag);
  }

  if (placements.length === 0) {
    return {};
  }
  return applyRowPlacements(element, rect, rowIndex, placements);
}

/** Create multiple inward rows — each row gets max seats for block width at that depth. */
function expandDragFillRowsInward(
  element: CenterpieceElement,
  rect: PixelRect,
  fromRowIndex: number,
  canvasPoint: CanvasPoint,
  seatPx: CanvasPoint,
): Partial<CenterpieceElement> {
  const vf = buildViewpointSeatFrame(element, rect);
  if (!vf) {
    return {};
  }

  const style = rowStyle(element);
  const overrides = element.seatPositionOverrides ?? {};
  const firstPos = overrides[seatId(fromRowIndex, 0, style)];
  if (!firstPos) {
    return {};
  }

  const spec = getSeatLayoutSpec({
    rows: element.rows,
    seatsPerRow: element.seatsPerRow,
    rowLabelStyle: element.rowLabelStyle,
    seatLayout: element.seatLayout,
  });
  const rowSeatCounts = getSeatLayoutRowSeatCounts(spec);
  const currentRowCount = rowSeatCounts[fromRowIndex] ?? 0;

  const pitchPx = resolvePitchPx(element, rect);
  const rowGapPx = resolveRowGapPx(element, rect);
  const anchorPx = elementPctToCanvasPoint(firstPos.xPct, firstPos.yPct, rect);
  const seatProj = projectOnViewpointFrame(vf.frame, seatPx);
  const dragProj = projectOnViewpointFrame(vf.frame, canvasPoint);

  const depthSign: 1 | -1 = dragProj.depth >= seatProj.depth ? 1 : -1;
  const depths: number[] = [];
  let startPatchRow = fromRowIndex + 1;

  if (currentRowCount <= 1) {
    depths.push(seatProj.depth);
    startPatchRow = fromRowIndex;
    let nextDepth = seatProj.depth + depthSign * rowGapPx;
    while (depthSign > 0 ? nextDepth <= dragProj.depth + 1e-6 : nextDepth >= dragProj.depth - 1e-6) {
      depths.push(nextDepth);
      nextDepth += depthSign * rowGapPx;
    }
  } else {
    let nextDepth = seatProj.depth + depthSign * rowGapPx;
    while (depthSign > 0 ? nextDepth <= dragProj.depth + 1e-6 : nextDepth >= dragProj.depth - 1e-6) {
      depths.push(nextDepth);
      nextDepth += depthSign * rowGapPx;
    }
  }

  if (depths.length === 0) {
    return {};
  }

  const capacity = computePhysicalCapacity(element);
  const maxRows = Math.min(depths.length, capacity.maxRows - startPatchRow);
  const rowPlacements: CanvasPoint[][] = [];

  for (let index = 0; index < maxRows; index += 1) {
    const depthPx = depths[index];
    let placements: CanvasPoint[];
    if (startPatchRow + index === fromRowIndex && currentRowCount <= 1) {
      const seedAlong = projectOnViewpointFrame(vf.frame, anchorPx).along;
      const towardHi = placeSeatsOnViewpointSpan(
        vf.polygon,
        vf.frame,
        depthPx,
        pitchPx,
        seedAlong,
        seedAlong + 1e6,
      );
      const towardLo = placeSeatsOnViewpointSpan(
        vf.polygon,
        vf.frame,
        depthPx,
        pitchPx,
        seedAlong,
        seedAlong - 1e6,
      );
      placements = [...towardLo.slice().reverse().slice(0, -1), ...towardHi];
      if (placements.length === 0) {
        placements = [{ ...anchorPx }];
      } else {
        const seedIndex = Math.max(0, towardLo.length - 1);
        if (seedIndex < placements.length) {
          placements[seedIndex] = { ...anchorPx };
        }
      }
    } else {
      placements = placeMaxSeatsAtViewpointDepth(vf.polygon, vf.frame, depthPx, pitchPx, true);
    }
    if (placements.length === 0) {
      continue;
    }
    rowPlacements.push(placements);
  }

  if (rowPlacements.length === 0) {
    return {};
  }
  return buildDragFillRowsPatch(element, rect, startPatchRow, rowPlacements);
}

function isInwardDepthDrag(
  element: CenterpieceElement,
  rect: PixelRect,
  seatPx: CanvasPoint,
  canvasPoint: CanvasPoint,
): boolean {
  const vf = buildViewpointSeatFrame(element, rect);
  if (!vf) {
    const geom = rowGeometry(element, rect, 0);
    if (!geom) {
      return false;
    }
    const rowGapPx = resolveRowGapPx(element, rect);
    const dragX = canvasPoint.x - seatPx.x;
    const dragY = canvasPoint.y - seatPx.y;
    const along = dragX * geom.ux + dragY * geom.uy;
    const inward = dragX * geom.inwardX + dragY * geom.inwardY;
    return inward > Math.abs(along) * 0.65 && inward > rowGapPx * 0.3;
  }

  const rowGapPx = resolveRowGapPx(element, rect);
  const seatProj = projectOnViewpointFrame(vf.frame, seatPx);
  const dragProj = projectOnViewpointFrame(vf.frame, canvasPoint);
  const depthDelta = Math.abs(dragProj.depth - seatProj.depth);
  const alongDelta = Math.abs(dragProj.along - seatProj.along);
  return depthDelta > rowGapPx * 0.3 && depthDelta > alongDelta * 0.65;
}

function applyRowPlacements(
  element: CenterpieceElement,
  rect: PixelRect,
  rowIndex: number,
  placements: CanvasPoint[],
): Partial<CenterpieceElement> {
  if (!element.seatLayout || placements.length === 0) {
    return {};
  }

  const style = rowStyle(element);
  let spec = getSeatLayoutSpec({
    rows: element.rows,
    seatsPerRow: element.seatsPerRow,
    rowLabelStyle: element.rowLabelStyle,
    seatLayout: element.seatLayout,
  });
  const rowSeatCounts = [...getSeatLayoutRowSeatCounts(spec)];
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

  const overrides: Record<string, CustomShapeSeatPosition> = {
    ...(element.seatPositionOverrides ?? {}),
  };
  for (let seatIndex = 0; seatIndex < Math.max(rowSeatCounts[rowIndex] ?? 0, spec.seatsPerRow); seatIndex += 1) {
    delete overrides[seatId(rowIndex, seatIndex, style)];
  }

  rowSeatCounts[rowIndex] = placements.length;
  for (let seatIndex = 0; seatIndex < placements.length; seatIndex += 1) {
    overrides[seatId(rowIndex, seatIndex, style)] = canvasPointToElementPct(placements[seatIndex], rect);
  }

  const pitchPx =
    spec.customShapeSeatPitchPx && spec.customShapeSeatPitchPx > 0
      ? spec.customShapeSeatPitchPx
      : resolvePitchPx(element, rect);
  const capacity = computePhysicalCapacity(element);
  const nextSpec = capSeatLayoutToCapacity(
    {
      ...spec,
      rowSeatCounts,
      seatsPerRow: Math.max(spec.seatsPerRow, ...rowSeatCounts),
      customShapeSeatPitchPx: pitchPx,
      seatAlign: 'center',
    },
    capacity.maxRows,
    capacity.maxSeatsPerRow,
  );

  const paths = [...(element.arrangeByRowRows ?? [])];
  const first = overrides[seatId(rowIndex, 0, style)];
  const last = overrides[seatId(rowIndex, placements.length - 1, style)];
  if (first && last) {
    paths[rowIndex] = { anchor: first, end: last };
  }

  return withDragFillFlags(
    {
      rows: nextSpec.rows,
      seatsPerRow: nextSpec.seatsPerRow,
      rowLabelStyle: nextSpec.rowLabelStyle,
      seatLayout: nextSpec,
      seatPositionOverrides: overrides,
      arrangeByRowRows: paths,
    },
    element,
  );
}

export function isDragFillSeatsElement(el: CenterpieceElement): boolean {
  return (
    hasTracedBlockOutline(el) &&
    el.dragFillSeatsMode === true &&
    (el.customSeatBlocks?.length ?? 0) === 0
  );
}

export function enableDragFillSeats(
  element: CenterpieceElement,
  rect: PixelRect,
): Partial<CenterpieceElement> {
  const dims = resolvePhysicalDims(element);
  const hasSeating = Boolean(element.seatLayout) && getCustomShapeVisibleSeatCount(element, rect) > 0;
  const base = hasSeating ? {} : createEmptyCustomShapeSeating(element, rect, dims);
  const merged = { ...element, ...base };
  const polygon = getOutlineCanvasPoints(merged, rect);
  const sideIndex =
    polygon.length >= 3 ? resolveStadiumSideIndex(merged, polygon) : element.dragSeatsStadiumSideIndex ?? 0;
  const paths = hasSeating ? syncArrangeByRowPaths(merged, rect) : [];

  return {
    ...base,
    dragFillSeatsMode: true,
    arrangeByRowMode: true,
    arrangeByRowRows: paths.length > 0 ? paths : element.arrangeByRowRows ?? [],
    dragSeatsStadiumSideIndex: sideIndex,
    dragSeatsMode: undefined,
    perSeatPlacementMode: undefined,
    defineByRowColumnMode: undefined,
    defineByRowColumnRows: undefined,
    defineByRowColumnColumns: undefined,
    customLineSeatRows: undefined,
    seatFacingDeg:
      element.blockViewpointAngleDeg != null
        ? seatFacingDegFromViewpoint(element.blockViewpointAngleDeg)
        : element.seatFacingDeg,
  };
}

export function placeDragFillSeedSeat(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  anchorPct: ElementPosition,
): Partial<CenterpieceElement> {
  if (!isDragFillSeatsElement(element)) {
    return {};
  }
  if (getCustomShapeVisibleSeatCount(element, rect) > 0) {
    return {};
  }
  if (!isCanvasPctInsideCustomShape(element, rect, canvas, anchorPct)) {
    return {};
  }

  let seedPct = anchorPct;
  const vf = buildViewpointSeatFrame(element, rect);
  if (vf) {
    const clickPx = canvasPctToPoint(anchorPct, canvas);
    const pitchPx = resolvePitchPx(element, rect);
    const rowGapPx = resolveRowGapPx(element, rect);
    const firstDepth = viewpointFirstRowDepthPx(pitchPx, rowGapPx);
    const along = clampAlongOnViewpointRow(
      vf.polygon,
      vf.frame,
      firstDepth,
      pitchPx,
      projectOnViewpointFrame(vf.frame, clickPx).along,
    );
    const seed = viewpointPointOnFrame(vf.frame, along, firstDepth);
    if (pointInPolygon(seed, vf.polygon)) {
      seedPct = {
        xPct: (seed.x / Math.max(1, canvas.width)) * 100,
        yPct: (seed.y / Math.max(1, canvas.height)) * 100,
      };
    }
  }

  const result = beginArrangeByRowAnchor(
    { ...element, arrangeByRowMode: true },
    rect,
    canvas,
    seedPct,
  );
  if (!result) {
    return {};
  }
  return withDragFillFlags(result.patch, element);
}

export function getDragFillRowExtendInfo(
  element: CenterpieceElement,
  seatIdStr: string,
): { rowIndex: number; seatIndex: number } | null {
  if (!isDragFillSeatsElement(element) || !element.seatLayout) {
    return null;
  }
  const style = rowStyle(element);
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
  return parsed;
}

export function removeDragFillSeat(
  element: CenterpieceElement,
  rect: PixelRect,
  seatIdStr: string,
): Partial<CenterpieceElement> {
  if (!isDragFillSeatsElement(element) || !element.seatLayout) {
    return {};
  }

  const style = rowStyle(element);
  const parsed = parseElementSeatId(seatIdStr, style);
  if (!parsed) {
    return {};
  }

  let spec = getSeatLayoutSpec({
    rows: element.rows,
    seatsPerRow: element.seatsPerRow,
    rowLabelStyle: element.rowLabelStyle,
    seatLayout: element.seatLayout,
  });
  const rowSeatCounts = [...getSeatLayoutRowSeatCounts(spec)];
  const rowCount = rowSeatCounts[parsed.rowIndex] ?? 0;
  if (rowCount <= 0 || parsed.seatIndex < 0 || parsed.seatIndex >= rowCount) {
    return {};
  }

  const overrides: Record<string, CustomShapeSeatPosition> = {
    ...(element.seatPositionOverrides ?? {}),
  };
  for (let seatIndex = parsed.seatIndex + 1; seatIndex < rowCount; seatIndex += 1) {
    const nextPos = overrides[seatId(parsed.rowIndex, seatIndex, style)];
    if (nextPos) {
      overrides[seatId(parsed.rowIndex, seatIndex - 1, style)] = nextPos;
    }
    delete overrides[seatId(parsed.rowIndex, seatIndex, style)];
  }
  delete overrides[seatIdStr];
  rowSeatCounts[parsed.rowIndex] = rowCount - 1;

  const totalRemaining = rowSeatCounts.reduce((sum, count) => sum + count, 0);
  if (totalRemaining <= 0) {
    const dims = resolvePhysicalDims(element);
    return {
      ...createEmptyCustomShapeSeating(element, rect, dims),
      dragFillSeatsMode: true,
      arrangeByRowMode: true,
      arrangeByRowRows: [],
    };
  }

  const capacity = computePhysicalCapacity(element);
  const nextSpec = capSeatLayoutToCapacity(
    {
      ...spec,
      rowSeatCounts,
      seatsPerRow: Math.max(spec.seatsPerRow, ...rowSeatCounts),
    },
    capacity.maxRows,
    capacity.maxSeatsPerRow,
  );

  const paths = [...(element.arrangeByRowRows ?? [])];
  const nextRowCount = rowSeatCounts[parsed.rowIndex] ?? 0;
  if (nextRowCount > 0) {
    const first = overrides[seatId(parsed.rowIndex, 0, style)];
    const last = overrides[seatId(parsed.rowIndex, nextRowCount - 1, style)];
    if (first && last) {
      paths[parsed.rowIndex] = { anchor: first, end: last };
    }
  } else if (paths.length > parsed.rowIndex) {
    paths.splice(parsed.rowIndex, 1);
  }

  return withDragFillFlags(
    {
      rows: nextSpec.rows,
      seatsPerRow: nextSpec.seatsPerRow,
      rowLabelStyle: nextSpec.rowLabelStyle,
      seatLayout: nextSpec,
      seatPositionOverrides: overrides,
      arrangeByRowRows: paths,
    },
    element,
  );
}

/** Extend one row from its first seat toward the drag point — max seats that fit in the span. */
export function expandDragFillRowToCanvasPoint(
  element: CenterpieceElement,
  rect: PixelRect,
  _canvas: { width: number; height: number },
  rowIndex: number,
  endCanvasPx: CanvasPoint,
): Partial<CenterpieceElement> {
  if (!isDragFillSeatsElement(element) || !element.seatLayout) {
    return {};
  }
  return expandDragFillRowAlong(element, rect, rowIndex, endCanvasPx);
}

/** Last seat drag: extend row along VIEW POINT line, or stack inward rows with max seats each. */
export function expandDragFillAtCanvasPoint(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  seatIdStr: string,
  canvasPoint: CanvasPoint,
): Partial<CenterpieceElement> {
  if (!isDragFillSeatsElement(element) || !element.seatLayout) {
    return {};
  }

  const rowExtend = getDragFillRowExtendInfo(element, seatIdStr);
  if (!rowExtend) {
    return {};
  }

  const style = rowStyle(element);
  const parsed = parseElementSeatId(seatIdStr, style);
  if (!parsed) {
    return {};
  }

  const spec = getSeatLayoutSpec({
    rows: element.rows,
    seatsPerRow: element.seatsPerRow,
    rowLabelStyle: element.rowLabelStyle,
    seatLayout: element.seatLayout,
  });
  const rowSeatCounts = getSeatLayoutRowSeatCounts(spec);
  const lastInRow = (rowSeatCounts[parsed.rowIndex] ?? 1) - 1;
  if (parsed.seatIndex !== lastInRow) {
    return {};
  }

  const overrides = element.seatPositionOverrides ?? {};
  const seatPos = overrides[seatIdStr];
  if (!seatPos) {
    return {};
  }
  const seatPx = elementPctToCanvasPoint(seatPos.xPct, seatPos.yPct, rect);

  const lastRow = lastPopulatedRowIndex(rowSeatCounts);
  if (parsed.rowIndex === lastRow && lastRow >= 0 && isInwardDepthDrag(element, rect, seatPx, canvasPoint)) {
    return expandDragFillRowsInward(element, rect, parsed.rowIndex, canvasPoint, seatPx);
  }

  return expandDragFillRowAlong(element, rect, rowExtend.rowIndex, canvasPoint);
}

export function getDragFillSeatTotal(element: CenterpieceElement, rect: PixelRect): number {
  return getCustomShapeVisibleSeatCount(element, rect);
}
