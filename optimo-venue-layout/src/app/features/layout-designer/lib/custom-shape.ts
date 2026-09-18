import { PixelRect, rectFromPositionSize } from './geometry';
import {
  CanvasConfig,
  CenterpieceElement,
  ElementPosition,
  ElementSize,
} from '../models/layout-element.model';

export interface CanvasPoint {
  x: number;
  y: number;
}

export function renormalizeFromCanvasPoints(points: ElementPosition[]): {
  position: ElementPosition;
  size: ElementSize;
  customPoints: ElementPosition[];
} | null {
  if (points.length < 3) {
    return null;
  }
  const xs = points.map((p) => p.xPct);
  const ys = points.map((p) => p.yPct);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const wPct = Math.max(2, maxX - minX);
  const hPct = Math.max(2, maxY - minY);
  const customPoints = points.map((p) => ({
    xPct: ((p.xPct - minX) / wPct) * 100,
    yPct: ((p.yPct - minY) / hPct) * 100,
  }));
  return {
    position: { xPct: minX + wPct / 2, yPct: minY + hPct / 2 },
    size: { wPct, hPct },
    customPoints,
  };
}

export function localPointsToAbsolute(
  el: CenterpieceElement,
  canvas: CanvasConfig,
): ElementPosition[] {
  const rect = rectFromPositionSize(el.position, el.size, canvas);
  return (el.customPoints ?? []).map((p) => localToCanvasPct(p, rect, el.rotation ?? 0, canvas));
}

export function localToCanvasPct(
  local: ElementPosition,
  rect: PixelRect,
  rotationDeg: number,
  canvas: CanvasConfig,
): ElementPosition {
  let px = rect.x + (local.xPct / 100) * rect.width;
  let py = rect.y + (local.yPct / 100) * rect.height;
  if (rotationDeg) {
    const rad = (rotationDeg * Math.PI) / 180;
    const dx = px - rect.cx;
    const dy = py - rect.cy;
    px = rect.cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    py = rect.cy + dx * Math.sin(rad) + dy * Math.cos(rad);
  }
  return { xPct: (px / canvas.width) * 100, yPct: (py / canvas.height) * 100 };
}

export function canvasPctToLocalPoint(
  el: CenterpieceElement,
  canvasPct: ElementPosition,
  canvas: CanvasConfig,
): ElementPosition {
  const rect = rectFromPositionSize(el.position, el.size, canvas);
  let px = (canvasPct.xPct / 100) * canvas.width;
  let py = (canvasPct.yPct / 100) * canvas.height;
  const rotation = el.rotation ?? 0;
  if (rotation) {
    const rad = (-rotation * Math.PI) / 180;
    const dx = px - rect.cx;
    const dy = py - rect.cy;
    px = rect.cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    py = rect.cy + dx * Math.sin(rad) + dy * Math.cos(rad);
  }
  return {
    xPct: ((px - rect.x) / Math.max(1, rect.width)) * 100,
    yPct: ((py - rect.y) / Math.max(1, rect.height)) * 100,
  };
}

/** Quick polygon inside the element box (1=line, 2=open, 3+=closed). */
export function buildQuickCustomShapeOutline(
  level: number,
  rect: PixelRect,
): { points: CanvasPoint[]; closed: boolean } {
  const safe = Math.max(1, Math.min(12, Math.round(level)));
  const insetX = rect.width * 0.14;
  const insetY = rect.height * 0.14;
  const left = rect.x + insetX;
  const right = rect.x + rect.width - insetX;
  const top = rect.y + insetY;
  const bottom = rect.y + rect.height - insetY;
  const cx = rect.cx;
  const cy = rect.cy;
  const rx = Math.max(6, rect.width / 2 - insetX);
  const ry = Math.max(6, rect.height / 2 - insetY);

  if (safe === 1) {
    return { points: [{ x: left, y: cy }, { x: right, y: cy }], closed: false };
  }
  if (safe === 2) {
    return {
      points: [
        { x: left, y: bottom },
        { x: cx, y: top },
        { x: right, y: bottom },
      ],
      closed: false,
    };
  }

  const points: CanvasPoint[] = [];
  for (let i = 0; i < safe; i++) {
    const angle = (-90 + (360 / safe) * i) * (Math.PI / 180);
    points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  }
  return { points, closed: true };
}

export function canvasPxToPct(point: CanvasPoint, canvas: CanvasConfig): ElementPosition {
  return { xPct: (point.x / canvas.width) * 100, yPct: (point.y / canvas.height) * 100 };
}
