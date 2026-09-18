import { polygonCanvasPointsFromBlock } from './block-viewpoint';
import {
  canvasPointToElementPct,
  clampPointInsidePolygon,
  pointInPolygon,
} from './custom-shape-seats';
import {
  CenterpieceElement,
  DEFAULT_SERVICE_ROUTE_WIDTH_M,
  DiningServiceRouteSpec,
  ElementPosition,
} from '../models/layout-element.model';
import { PixelRect } from './geometry';
import { pxPerMeter, resolveBlockLengthM, resolveBlockWidthM } from './physical-dims';

let routeCounter = 0;

function nextRouteId(): string {
  routeCounter += 1;
  return `sr-${Date.now().toString(36)}-${routeCounter.toString(36)}`;
}

function routeLabel(index: number): string {
  return `Route ${index + 1}`;
}

function blockPolygon(element: CenterpieceElement, rect: PixelRect): { x: number; y: number }[] {
  return polygonCanvasPointsFromBlock(element.customPoints ?? [], rect);
}

function canvasPctToCanvasPoint(
  canvasPct: ElementPosition,
  canvas: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: (canvasPct.xPct / 100) * canvas.width,
    y: (canvasPct.yPct / 100) * canvas.height,
  };
}

function elementPctToCanvasPoint(xPct: number, yPct: number, rect: PixelRect): { x: number; y: number } {
  return {
    x: rect.x + (xPct / 100) * rect.width,
    y: rect.y + (yPct / 100) * rect.height,
  };
}

export interface DiningServiceRouteRenderNode {
  routeId: string;
  label: string;
  pointsStr: string;
  widthPx: number;
  selected: boolean;
  midX: number;
  midY: number;
  widthM: number;
}

export function resolveDefaultServiceRouteWidthM(el: CenterpieceElement): number {
  const v = el.defaultServiceRouteWidthM;
  return v != null && v > 0 ? v : DEFAULT_SERVICE_ROUTE_WIDTH_M;
}

export function buildDiningServiceRouteRenderList(
  element: CenterpieceElement,
  rect: PixelRect,
  selectedRouteId: string | null,
): DiningServiceRouteRenderNode[] {
  const routes = element.diningServiceRoutes ?? [];
  if (routes.length === 0) {
    return [];
  }
  const ppm = pxPerMeter(rect, resolveBlockLengthM(element), resolveBlockWidthM(element));
  const widthM = resolveDefaultServiceRouteWidthM(element);

  return routes
    .filter((route) => (route.points?.length ?? 0) >= 2)
    .map((route) => {
      const points = route.points.map((p) => elementPctToCanvasPoint(p.xPct, p.yPct, rect));
      const pointsStr = points.map((p) => `${p.x},${p.y}`).join(' ');
      const mid = points[Math.floor(points.length / 2)] ?? points[0];
      const routeWidthM = route.widthM ?? widthM;
      return {
        routeId: route.id,
        label: route.label,
        pointsStr,
        widthPx: Math.max(3, routeWidthM * ppm),
        selected: route.id === selectedRouteId,
        midX: mid.x,
        midY: mid.y,
        widthM: routeWidthM,
      };
    });
}

export function addServiceRouteFromCanvasPoints(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  canvasPctPoints: ElementPosition[],
): Partial<CenterpieceElement> {
  const polygon = blockPolygon(element, rect);
  if (polygon.length < 3 || canvasPctPoints.length < 2) {
    return {};
  }

  const elementPoints: ElementPosition[] = [];
  for (const canvasPct of canvasPctPoints) {
    let placement = canvasPctToCanvasPoint(canvasPct, canvas);
    if (!pointInPolygon(placement, polygon)) {
      placement = clampPointInsidePolygon(placement, polygon);
      if (!pointInPolygon(placement, polygon)) {
        continue;
      }
    }
    elementPoints.push(canvasPointToElementPct(placement, rect));
  }

  if (elementPoints.length < 2) {
    return {};
  }

  const existing = element.diningServiceRoutes ?? [];
  const route: DiningServiceRouteSpec = {
    id: nextRouteId(),
    label: routeLabel(existing.length),
    points: elementPoints,
    widthM: resolveDefaultServiceRouteWidthM(element),
  };

  return {
    diningServiceRoutes: [...existing, route],
    defaultServiceRouteWidthM: resolveDefaultServiceRouteWidthM(element),
  };
}

export function deleteServiceRoute(
  element: CenterpieceElement,
  routeId: string,
): Partial<CenterpieceElement> {
  const routes = (element.diningServiceRoutes ?? []).filter((route) => route.id !== routeId);
  if (routes.length === (element.diningServiceRoutes?.length ?? 0)) {
    return {};
  }
  return { diningServiceRoutes: routes.length > 0 ? routes : undefined };
}

export function removeAllServiceRoutes(element: CenterpieceElement): Partial<CenterpieceElement> {
  return { diningServiceRoutes: undefined };
}

export function getDiningServiceRouteCount(element: CenterpieceElement): number {
  return element.diningServiceRoutes?.length ?? 0;
}
