import {
  CenterpieceElement,
  DEFAULT_SERVICE_ROUTE_WIDTH_M,
  DEFAULT_TABLE_GAP_M,
  DiningAccessPointSpec,
  DiningExitSpec,
  DiningFoodPrepareSpec,
  DiningServiceRouteSpec,
  DiningStageSpec,
  DiningTableShape,
  DiningTableSpec,
  ElementPosition,
} from '../models/layout-element.model';
import type {
  DetectedDiningAisle,
  DetectedDiningFeature,
  DetectedDiningTable,
  DiningLayoutDetectionResult,
} from './detect-dining-layout';
import { polygonCanvasPointsFromBlock } from './block-viewpoint';
import {
  clampPointInsidePolygon,
  canvasPointToElementPct,
  pointInPolygon,
} from './custom-shape-seats';
import { PixelRect } from './geometry';
import { resolveBlockLengthM, resolveBlockWidthM } from './physical-dims';
import { tableLabel } from './dining-tables';

let tableCounter = 0;
let routeCounter = 0;

function nextTableId(): string {
  tableCounter += 1;
  return `tbl-img-${Date.now().toString(36)}-${tableCounter.toString(36)}`;
}

function nextRouteId(): string {
  routeCounter += 1;
  return `sr-img-${Date.now().toString(36)}-${routeCounter.toString(36)}`;
}

export interface DiningImageLayoutOptions {
  shape?: DiningTableShape;
  seats: number;
  widthM: number;
  depthM: number;
  stageWidthM?: number;
  stageDepthM?: number;
  foodPrepWidthM?: number;
  foodPrepDepthM?: number;
  gapM?: number;
  referenceImageDataUrl?: string;
  referenceImageName?: string;
}

const MIN_RENDER_M = 0.22;
const MAX_OBJECT_SPAN_FRAC = 0.95;

function referencePositionPct(layoutPct: ElementPosition): ElementPosition {
  return {
    xPct: Math.max(0, Math.min(100, layoutPct.xPct)),
    yPct: Math.max(0, Math.min(100, layoutPct.yPct)),
  };
}

function referenceLayoutToBlockPct(
  layoutPct: ElementPosition,
  element: CenterpieceElement,
  rect: PixelRect,
): ElementPosition | null {
  const mapped = referencePositionPct(layoutPct);
  const canvasPoint = {
    x: rect.x + (mapped.xPct / 100) * rect.width,
    y: rect.y + (mapped.yPct / 100) * rect.height,
  };
  const polygon = polygonCanvasPointsFromBlock(element.customPoints ?? [], rect);
  if (polygon.length < 3) {
    return mapped;
  }
  if (pointInPolygon(canvasPoint, polygon)) {
    return canvasPointToElementPct(canvasPoint, rect);
  }
  const clamped = clampPointInsidePolygon(canvasPoint, polygon);
  if (!pointInPolygon(clamped, polygon)) {
    return null;
  }
  return canvasPointToElementPct(clamped, rect);
}

function spanPctToMetres(pct: number, blockSpanM: number): number {
  const raw = (Math.max(0, pct) / 100) * blockSpanM;
  const capped = Math.min(blockSpanM * MAX_OBJECT_SPAN_FRAC, raw);
  return Math.max(MIN_RENDER_M, capped);
}

function referenceBoxMetres(
  wPct: number,
  hPct: number,
  element: CenterpieceElement,
): { widthM: number; depthM: number } {
  return {
    widthM: spanPctToMetres(wPct, resolveBlockWidthM(element)),
    depthM: spanPctToMetres(hPct, resolveBlockLengthM(element)),
  };
}

function inferSideEdgeFromFeature(feature: DetectedDiningFeature): number {
  const { xPct, yPct, wPct, hPct } = feature;
  const horizontal = wPct >= hPct * 0.85;
  if (horizontal) {
    return yPct <= 50 ? 0 : 2;
  }
  return xPct <= 50 ? 3 : 1;
}

function measureFeatureMetres(
  feature: DetectedDiningFeature,
  element: CenterpieceElement,
): { widthM: number; depthM: number } {
  const box = referenceBoxMetres(feature.wPct, feature.hPct, element);
  const horizontal = feature.wPct >= feature.hPct;
  return horizontal
    ? { widthM: box.widthM, depthM: box.depthM }
    : { widthM: box.depthM, depthM: box.widthM };
}

function buildFeatureSpec<T extends DiningStageSpec | DiningFoodPrepareSpec | DiningExitSpec>(
  feature: DetectedDiningFeature,
  label: string,
  widthM: number,
  depthM: number,
  element: CenterpieceElement,
  rect: PixelRect,
): T | undefined {
  const pct = referenceLayoutToBlockPct(
    { xPct: feature.xPct, yPct: feature.yPct },
    element,
    rect,
  );
  if (!pct) {
    return undefined;
  }

  return {
    sideEdgeId: inferSideEdgeFromFeature(feature),
    widthM,
    depthM,
    xPct: pct.xPct,
    yPct: pct.yPct,
    insetFromEdgeM: 0,
    offsetAlongEdgeM: 0,
    label,
    alignment: 'center',
  } as T;
}

function buildStageFromDetection(
  element: CenterpieceElement,
  rect: PixelRect,
  detection: DiningLayoutDetectionResult,
): DiningStageSpec | undefined {
  const feature = detection.features.find((f) => f.kind === 'stage');
  if (!feature) {
    return undefined;
  }
  const measured = measureFeatureMetres(feature, element);
  return buildFeatureSpec<DiningStageSpec>(
    feature,
    'Stage',
    measured.widthM,
    measured.depthM,
    element,
    rect,
  );
}

function buildExitFromDetection(
  element: CenterpieceElement,
  rect: PixelRect,
  detection: DiningLayoutDetectionResult,
): DiningExitSpec | undefined {
  const feature = detection.features.find((f) => f.kind === 'exit');
  if (!feature) {
    return undefined;
  }
  const measured = measureFeatureMetres(feature, element);
  const spec = buildFeatureSpec<DiningExitSpec>(
    feature,
    'Exit',
    measured.widthM,
    measured.depthM,
    element,
    rect,
  );
  return spec ? { ...spec, kind: 'exit' } : undefined;
}

function buildEntranceFromDetection(
  element: CenterpieceElement,
  rect: PixelRect,
  detection: DiningLayoutDetectionResult,
): DiningAccessPointSpec | undefined {
  const feature = detection.features.find((f) => f.kind === 'entrance');
  if (!feature) {
    return undefined;
  }
  const measured = measureFeatureMetres(feature, element);
  const spec = buildFeatureSpec<DiningAccessPointSpec>(
    feature,
    'Entrance',
    measured.widthM,
    measured.depthM,
    element,
    rect,
  );
  return spec ? { ...spec, kind: 'entrance' } : undefined;
}

function buildFoodPrepFromDetection(
  element: CenterpieceElement,
  rect: PixelRect,
  detection: DiningLayoutDetectionResult,
): DiningFoodPrepareSpec | undefined {
  const feature = detection.features.find((f) => f.kind === 'food-prep');
  if (!feature) {
    return undefined;
  }
  const measured = measureFeatureMetres(feature, element);
  return buildFeatureSpec<DiningFoodPrepareSpec>(
    feature,
    'Food Prep',
    measured.widthM,
    measured.depthM,
    element,
    rect,
  );
}

const PLACED_TABLE_MIN_DIST_PCT = 5.5;

function tablesSharePlacedSpot(a: DiningTableSpec, b: DiningTableSpec): boolean {
  return Math.hypot(a.xPct - b.xPct, a.yPct - b.yPct) < PLACED_TABLE_MIN_DIST_PCT;
}

function placeTablesFromReference(candidates: DiningTableSpec[]): DiningTableSpec[] {
  const kept: DiningTableSpec[] = [];
  for (const table of candidates) {
    if (kept.some((other) => tablesSharePlacedSpot(table, other))) {
      continue;
    }
    kept.push(table);
  }
  return kept.map((table, index) => ({
    ...table,
    label: tableLabel(index),
  }));
}

/**
 * Big circle in the reference → tabletop size.
 * Small dots are chairs (counted as seats); the editor draws chair graphics again,
 * so we never expand widthM from the chair ring.
 */
function tableSizeFromDetection(
  detected: DetectedDiningTable,
  element: CenterpieceElement,
): { widthM: number; depthM: number | undefined } {
  const box = referenceBoxMetres(detected.wPct, detected.hPct, element);

  if (detected.shape === 'round') {
    // Diameter of the big table disc (not the small chair dots).
    let diameter = (box.widthM + box.depthM) / 2;
    if (detected.includesChairs && detected.seats === 0) {
      diameter *= 0.58;
    }
    return { widthM: Math.max(MIN_RENDER_M, diameter), depthM: undefined };
  }

  let widthM = box.widthM;
  let depthM = box.depthM;
  if (detected.includesChairs && detected.seats === 0) {
    widthM *= 0.9;
    depthM *= 0.72;
  }
  return {
    widthM: Math.max(MIN_RENDER_M, widthM),
    depthM: Math.max(MIN_RENDER_M, depthM),
  };
}

function buildTablesFromDetection(
  element: CenterpieceElement,
  rect: PixelRect,
  detection: DiningLayoutDetectionResult,
  options: DiningImageLayoutOptions,
): DiningTableSpec[] {
  const tables: DiningTableSpec[] = [];
  const ordered = [...detection.tables].sort(
    (a, b) => a.yPct - b.yPct || a.xPct - b.xPct,
  );

  for (const detected of ordered) {
    const pct = referenceLayoutToBlockPct(
      { xPct: detected.xPct, yPct: detected.yPct },
      element,
      rect,
    );
    if (!pct) {
      continue;
    }

    const size = tableSizeFromDetection(detected, element);
    // Prefer chair-dot count from the reference image — never inflate from draft defaults.
    // Small dots around the table = exact seat count (0 if none detected).
    const seats = Math.max(0, Math.min(12, Math.round(detected.seats)));

    tables.push({
      id: nextTableId(),
      label: tableLabel(tables.length),
      xPct: pct.xPct,
      yPct: pct.yPct,
      shape: detected.shape,
      seats,
      widthM: size.widthM,
      depthM: size.depthM,
      rotationDeg: 0,
      accessCategory: detected.role === 'head' ? 'vip' : undefined,
      suppressedChairEdges:
        detected.suppressedChairEdges && detected.suppressedChairEdges.length > 0
          ? [...detected.suppressedChairEdges]
          : undefined,
      seatsByEdge: detected.seatsByEdge
        ? ([...detected.seatsByEdge] as [number, number, number, number])
        : undefined,
    });
  }
  return placeTablesFromReference(tables);
}

function buildServiceRoutesFromAisles(
  element: CenterpieceElement,
  rect: PixelRect,
  aisles: DetectedDiningAisle[],
): DiningServiceRouteSpec[] | undefined {
  if (aisles.length === 0) {
    return undefined;
  }
  const blockWidthM = resolveBlockWidthM(element);
  const routes: DiningServiceRouteSpec[] = [];

  for (const aisle of aisles) {
    const points: ElementPosition[] = [];
    for (const p of aisle.points) {
      const mapped = referenceLayoutToBlockPct(p, element, rect);
      if (mapped) {
        points.push(mapped);
      }
    }
    if (points.length < 2) {
      continue;
    }
    routes.push({
      id: nextRouteId(),
      label: aisle.orientation === 'vertical' ? `Aisle ${routes.length + 1}` : `Cross ${routes.length + 1}`,
      points,
      widthM: spanPctToMetres(aisle.widthPct, blockWidthM),
    });
  }

  return routes.length > 0 ? routes : undefined;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function buildDiningLayoutFromImageDetection(
  element: CenterpieceElement,
  rect: PixelRect,
  detection: DiningLayoutDetectionResult,
  options: DiningImageLayoutOptions,
): Partial<CenterpieceElement> {
  const stage = buildStageFromDetection(element, rect, detection);
  const foodPrepare = buildFoodPrepFromDetection(element, rect, detection);
  const entrance = buildEntranceFromDetection(element, rect, detection);
  const exit = buildExitFromDetection(element, rect, detection);
  const tables = buildTablesFromDetection(element, rect, detection, options);
  const routes = buildServiceRoutesFromAisles(element, rect, detection.aisles ?? []);

  const guestWidths = tables.filter((t) => t.shape === 'round').map((t) => t.widthM);
  const rectDepths = tables
    .filter((t) => t.shape === 'rectangular' && t.depthM != null)
    .map((t) => t.depthM!);

  return {
    diningTables: tables.length > 0 ? tables : undefined,
    diningStage: stage,
    diningFoodPrepare: foodPrepare,
    diningEntrance: entrance,
    diningExit: exit,
    diningServiceRoutes: routes,
    diningLayoutReferenceImage: options.referenceImageDataUrl
      ? {
          dataUrl: options.referenceImageDataUrl,
          name: options.referenceImageName,
          contentBounds: detection.contentBounds,
          imageWidth: detection.width,
          imageHeight: detection.height,
        }
      : undefined,
    defaultDiningTableShape: options.shape ?? 'round',
    // Keep default seats aligned with detected chair-dot counts (never higher draft leftovers).
    defaultTableSeats: tables.length > 0 ? (median(tables.map((t) => t.seats)) ?? 0) : options.seats,
    defaultTableWidthM: median(guestWidths) ?? median(tables.map((t) => t.widthM)) ?? options.widthM,
    defaultTableDepthM: median(rectDepths) ?? options.depthM,
    defaultTableGapM: options.gapM ?? element.defaultTableGapM ?? DEFAULT_TABLE_GAP_M,
    defaultServiceRouteWidthM:
      routes?.[0]?.widthM ?? element.defaultServiceRouteWidthM ?? DEFAULT_SERVICE_ROUTE_WIDTH_M,
    blockViewpointAngleDeg: element.blockViewpointAngleDeg ?? 0,
    appliedDiningLayoutTemplateId: 'image-upload',
    tablePlacementMode: undefined,
    tableGridMode: undefined,
  };
}

export function buildDiningImageLayoutPreviewSvg(detection: DiningLayoutDetectionResult): string {
  const parts: string[] = [
    '<svg viewBox="0 0 100 72" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">',
    '<rect x="2" y="2" width="96" height="68" rx="3" fill="#f8fafc" stroke="#7c3aed" stroke-width="1.2"/>',
  ];

  const mapX = (xPct: number) => 2 + (xPct / 100) * 96;
  const mapY = (yPct: number) => 2 + (yPct / 100) * 68;

  for (const aisle of detection.aisles ?? []) {
    if (aisle.points.length < 2) {
      continue;
    }
    const d = aisle.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${mapX(p.xPct).toFixed(1)} ${mapY(p.yPct).toFixed(1)}`)
      .join(' ');
    parts.push(
      `<path d="${d}" fill="none" stroke="#94a3b8" stroke-width="1.4" stroke-dasharray="2 1.5" opacity="0.9"/>`,
    );
  }

  for (const feature of detection.features) {
    const fill =
      feature.kind === 'stage'
        ? '#d8dde4'
        : feature.kind === 'entrance'
          ? '#15803d'
          : feature.kind === 'exit'
            ? '#16a34a'
            : '#d7e4df';
    const label =
      feature.kind === 'stage'
        ? 'Stage'
        : feature.kind === 'entrance'
          ? 'IN'
          : feature.kind === 'exit'
            ? 'EXIT'
            : 'Food Prep';
    const textFill =
      feature.kind === 'stage' || feature.kind === 'food-prep' ? '#334155' : '#fff';
    const x = mapX(feature.xPct - feature.wPct / 2);
    const y = mapY(feature.yPct - feature.hPct / 2);
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${((feature.wPct / 100) * 96).toFixed(1)}" height="${((feature.hPct / 100) * 68).toFixed(1)}" rx="1" fill="${fill}"/>`,
      `<text x="${mapX(feature.xPct).toFixed(1)}" y="${mapY(feature.yPct).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="${textFill}" font-size="3.5" font-family="sans-serif">${label}</text>`,
    );
  }

  for (const table of detection.tables.slice(0, 48)) {
    const cx = mapX(table.xPct);
    const cy = mapY(table.yPct);
    const rw = Math.max(1.8, (table.wPct / 100) * 96);
    const rh = Math.max(1.4, (table.hPct / 100) * 68);
    if (table.shape === 'rectangular') {
      parts.push(
        `<rect x="${(cx - rw / 2).toFixed(1)}" y="${(cy - rh / 2).toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" rx="0.4" fill="#7c3aed" opacity="0.85"/>`,
      );
    } else {
      parts.push(
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(Math.max(rw, rh) / 2).toFixed(1)}" fill="#7c3aed" opacity="0.85"/>`,
      );
    }
  }

  parts.push('</svg>');
  return parts.join('');
}

