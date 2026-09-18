/**
 * Geometry helpers: convert percentage-based element data into canvas pixels and
 * build the SVG path strings for non-trivial shapes (polygons, D-end, curved
 * rectangles, radial sectors). All pure functions — no framework dependency.
 */

import {
  CanvasConfig,
  ElementPosition,
  ElementSize,
} from '../models/layout-element.model';

const DEG_TO_RAD = Math.PI / 180;

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** `position` is the element centre; `size` is its width/height — both in %. */
export function rectFromPositionSize(
  position: ElementPosition,
  size: ElementSize,
  canvas: CanvasConfig,
): PixelRect {
  const width = (size.wPct / 100) * canvas.width;
  const height = (size.hPct / 100) * canvas.height;
  const cx = (position.xPct / 100) * canvas.width;
  const cy = (position.yPct / 100) * canvas.height;
  return { x: cx - width / 2, y: cy - height / 2, width, height, cx, cy };
}

export function pctToPixels(pct: number, canvas: CanvasConfig): number {
  return (pct / 100) * canvas.width;
}

/** Regular polygon (hexagon, octagon, …) inscribed in the (rx, ry) ellipse. */
export function polygonPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  sides: number,
  rotationDeg = -90,
): string {
  if (sides < 3) {
    return '';
  }
  const points: string[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (rotationDeg + (360 / sides) * i) * DEG_TO_RAD;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return `M${points[0]} L${points.slice(1).join(' ')} Z`;
}

/** D-end: straight on three sides, a semicircular arc on the right (cricket). */
export function dEndPath(cx: number, cy: number, rx: number, ry: number): string {
  const left = cx - rx;
  const right = cx + rx;
  const top = cy - ry;
  const bottom = cy + ry;
  const arcRx = rx * 0.5;
  return [
    `M${left.toFixed(2)},${top.toFixed(2)}`,
    `L${(right - arcRx).toFixed(2)},${top.toFixed(2)}`,
    `A${arcRx.toFixed(2)},${ry.toFixed(2)},0,0,1,${(right - arcRx).toFixed(2)},${bottom.toFixed(2)}`,
    `L${left.toFixed(2)},${bottom.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export const MAX_CURVE_DEG = 60;

/** Arc-bowed rectangle. Returns null when the curve is negligible (use a rect). */
export function curvedRectanglePath(rect: PixelRect, curveDeg: number): string | null {
  const safeCurve = clamp(curveDeg, -MAX_CURVE_DEG, MAX_CURVE_DEG);
  if (Math.abs(safeCurve) < 0.25) {
    return null;
  }
  const { x, y, width, height } = rect;
  const arcOffset = (safeCurve / MAX_CURVE_DEG) * Math.min(width, height) * 0.55;
  const steps = 24;
  const parts: string[] = [];
  const bowAt = (t: number) => Math.sin(t * Math.PI) * arcOffset;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = x + width * t;
    const py = y - bowAt(t);
    parts.push(i === 0 ? `M ${px.toFixed(2)} ${py.toFixed(2)}` : `L ${px.toFixed(2)} ${py.toFixed(2)}`);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const px = x + width * t;
    const py = y + height - bowAt(t);
    parts.push(`L ${px.toFixed(2)} ${py.toFixed(2)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

/** Annular (donut) ellipse path using even-odd fill to punch the centre hole. */
export function annularEllipsePath(
  cx: number,
  cy: number,
  innerRx: number,
  innerRy: number,
  outerRx: number,
  outerRy: number,
): string {
  return [
    `M${(cx - outerRx).toFixed(2)},${cy.toFixed(2)}`,
    `a${outerRx.toFixed(2)},${outerRy.toFixed(2)},0,1,0,${(outerRx * 2).toFixed(2)},0`,
    `a${outerRx.toFixed(2)},${outerRy.toFixed(2)},0,1,0,${(-outerRx * 2).toFixed(2)},0`,
    'Z',
    `M${(cx - innerRx).toFixed(2)},${cy.toFixed(2)}`,
    `a${innerRx.toFixed(2)},${innerRy.toFixed(2)},0,1,1,${(innerRx * 2).toFixed(2)},0`,
    `a${innerRx.toFixed(2)},${innerRy.toFixed(2)},0,1,1,${(-innerRx * 2).toFixed(2)},0`,
    'Z',
  ].join(' ');
}

export interface RadialSector {
  cx: number;
  cy: number;
  innerRx: number;
  innerRy: number;
  outerRx: number;
  outerRy: number;
  startDeg: number;
  endDeg: number;
  gapDeg?: number;
}

/** One sector (pie slice with a hole) of a layer ring. */
export function radialSectorPath(s: RadialSector): string {
  const gap = s.gapDeg ?? 1.1;
  const a0 = s.startDeg + gap;
  const a1 = s.endDeg - gap;
  const largeArc = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const c0 = Math.cos(a0 * DEG_TO_RAD);
  const s0 = Math.sin(a0 * DEG_TO_RAD);
  const c1 = Math.cos(a1 * DEG_TO_RAD);
  const s1 = Math.sin(a1 * DEG_TO_RAD);

  const ix1 = s.cx + s.innerRx * c0;
  const iy1 = s.cy + s.innerRy * s0;
  const ix2 = s.cx + s.innerRx * c1;
  const iy2 = s.cy + s.innerRy * s1;
  const ox1 = s.cx + s.outerRx * c0;
  const oy1 = s.cy + s.outerRy * s0;
  const ox2 = s.cx + s.outerRx * c1;
  const oy2 = s.cy + s.outerRy * s1;

  return [
    `M${ix1.toFixed(2)},${iy1.toFixed(2)}`,
    `A${s.innerRx.toFixed(2)},${s.innerRy.toFixed(2)},0,${largeArc},1,${ix2.toFixed(2)},${iy2.toFixed(2)}`,
    `L${ox2.toFixed(2)},${oy2.toFixed(2)}`,
    `A${s.outerRx.toFixed(2)},${s.outerRy.toFixed(2)},0,${largeArc},0,${ox1.toFixed(2)},${oy1.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export function ellipsePoint(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angleDeg: number,
): { x: number; y: number } {
  const a = angleDeg * DEG_TO_RAD;
  return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
}

/** Convert element-local outline points (0–100) into an SVG points string. */
export function localPointsToSvg(points: ElementPosition[], rect: PixelRect): string {
  return points
    .map((p) => {
      const x = rect.x + (p.xPct / 100) * rect.width;
      const y = rect.y + (p.yPct / 100) * rect.height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}
