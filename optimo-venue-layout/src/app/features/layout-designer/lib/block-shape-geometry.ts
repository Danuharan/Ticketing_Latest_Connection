/**
 * Central block-shape reconstruction for centerpiece elements.
 *
 * Single place that turns `shape` + optional `geometry` + legacy
 * `position`/`size`/`curveDeg`/`customPoints` into draw instructions.
 * Canvas-stage, preview, and dining clip all consume this helper.
 */

import type {
  BlockGeometry,
  BlockGridElement,
  BlockGridShapeId,
  BlockPathCommand,
  CanvasConfig,
  CenterpieceElement,
  ElementPosition,
  ElementSize,
  ShapeId,
} from '../models/layout-element.model';
import { hasTracedBlockOutline } from '../models/layout-element.model';
import {
  clamp,
  curvedRectanglePath,
  dEndPath,
  localPointsToSvg,
  MAX_CURVE_DEG,
  polygonPath,
  rectFromPositionSize,
  type PixelRect,
} from './geometry';

export type ResolvedShapeMode = 'ellipse' | 'rect' | 'path' | 'polygon';

export interface ResolvedCenterpieceShape {
  shapeMode: ResolvedShapeMode | undefined;
  /** Bounding box used for drawing / labels (may be derived from geometry). */
  rect: PixelRect;
  pathD?: string;
  rectRx?: number;
  /** True when draw params came from `geometry` rather than legacy size alone. */
  fromGeometry: boolean;
}

export type CenterpieceShapeSource = Pick<
  CenterpieceElement,
  | 'shape'
  | 'position'
  | 'size'
  | 'curveDeg'
  | 'polygonSides'
  | 'customPoints'
  | 'geometry'
  | 'blockType'
  | 'edgeBowAmounts'
>;

/** Build circle geometry (canvas %) from element centre + size. */
export function geometryFromCircleBounds(
  position: ElementPosition,
  size: ElementSize,
  canvas: CanvasConfig,
): Extract<BlockGeometry, { type: 'circle' }> {
  const rect = rectFromPositionSize(position, size, canvas);
  const radiusPx = Math.min(rect.width, rect.height) / 2;
  const radiusPct = canvas.width > 0 ? (radiusPx / canvas.width) * 100 : size.wPct / 2;
  return {
    type: 'circle',
    center: { xPct: position.xPct, yPct: position.yPct },
    radiusPct,
  };
}

/** Build ellipse geometry (canvas %) from element centre + size. */
export function geometryFromEllipseBounds(
  position: ElementPosition,
  size: ElementSize,
): Extract<BlockGeometry, { type: 'ellipse' }> {
  return {
    type: 'ellipse',
    center: { xPct: position.xPct, yPct: position.yPct },
    radiusXPct: size.wPct / 2,
    radiusYPct: size.hPct / 2,
  };
}

/**
 * Sample the existing bowed-rectangle algorithm into local-% path commands.
 * Keeps one curved representation rooted in `curvedRectanglePath` / `curveDeg`.
 */
export function pathCommandsFromCurveDeg(curveDeg: number): BlockPathCommand[] {
  const safeCurve = clamp(curveDeg, -MAX_CURVE_DEG, MAX_CURVE_DEG);
  if (Math.abs(safeCurve) < 0.25) {
    return [
      { command: 'M', xPct: 0, yPct: 0 },
      { command: 'L', xPct: 100, yPct: 0 },
      { command: 'L', xPct: 100, yPct: 100 },
      { command: 'L', xPct: 0, yPct: 100 },
      { command: 'Z' },
    ];
  }

  // Local box is 0–100; bow uses min side (=100) like curvedRectanglePath.
  const arcOffset = (safeCurve / MAX_CURVE_DEG) * 100 * 0.55;
  const steps = 24;
  const bowAt = (t: number) => Math.sin(t * Math.PI) * arcOffset;
  const commands: BlockPathCommand[] = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const xPct = 100 * t;
    const yPct = 0 - bowAt(t);
    if (i === 0) {
      commands.push({ command: 'M', xPct, yPct });
    } else {
      commands.push({ command: 'L', xPct, yPct });
    }
  }
  for (let i = steps; i >= 0; i -= 1) {
    const t = i / steps;
    commands.push({
      command: 'L',
      xPct: 100 * t,
      yPct: 100 - bowAt(t),
    });
  }
  commands.push({ command: 'Z' });
  return commands;
}

export function geometryFromCurvedRect(curveDeg: number): Extract<BlockGeometry, { type: 'path' }> {
  return {
    type: 'path',
    commands: pathCommandsFromCurveDeg(curveDeg),
    closed: true,
  };
}

/** True when path is the unbowed unit rectangle (M/L/Z only at corners). */
function isAxisAlignedRectPath(commands: BlockPathCommand[]): boolean {
  const points = commands.filter(
    (c): c is Extract<BlockPathCommand, { command: 'M' | 'L' }> =>
      c.command === 'M' || c.command === 'L',
  );
  if (points.length < 4) {
    return false;
  }
  const corners = [
    { xPct: 0, yPct: 0 },
    { xPct: 100, yPct: 0 },
    { xPct: 100, yPct: 100 },
    { xPct: 0, yPct: 100 },
  ];
  return corners.every((corner) =>
    points.some(
      (p) => Math.abs(p.xPct - corner.xPct) < 0.5 && Math.abs(p.yPct - corner.yPct) < 0.5,
    ),
  );
}

export function rectFromCircleGeometry(
  geometry: Extract<BlockGeometry, { type: 'circle' }>,
  canvas: CanvasConfig,
): PixelRect {
  const cx = (geometry.center.xPct / 100) * canvas.width;
  const cy = (geometry.center.yPct / 100) * canvas.height;
  const r = (geometry.radiusPct / 100) * canvas.width;
  return {
    x: cx - r,
    y: cy - r,
    width: r * 2,
    height: r * 2,
    cx,
    cy,
  };
}

export function rectFromEllipseGeometry(
  geometry: Extract<BlockGeometry, { type: 'ellipse' }>,
  canvas: CanvasConfig,
): PixelRect {
  const cx = (geometry.center.xPct / 100) * canvas.width;
  const cy = (geometry.center.yPct / 100) * canvas.height;
  const rx = (geometry.radiusXPct / 100) * canvas.width;
  const ry = (geometry.radiusYPct / 100) * canvas.height;
  return {
    x: cx - rx,
    y: cy - ry,
    width: rx * 2,
    height: ry * 2,
    cx,
    cy,
  };
}

export function boundsFromCircleGeometry(
  geometry: Extract<BlockGeometry, { type: 'circle' }>,
  canvas: CanvasConfig,
): { position: ElementPosition; size: ElementSize } {
  const rect = rectFromCircleGeometry(geometry, canvas);
  return {
    position: { ...geometry.center },
    size: {
      wPct: canvas.width > 0 ? (rect.width / canvas.width) * 100 : geometry.radiusPct * 2,
      hPct: canvas.height > 0 ? (rect.height / canvas.height) * 100 : geometry.radiusPct * 2,
    },
  };
}

export function boundsFromEllipseGeometry(
  geometry: Extract<BlockGeometry, { type: 'ellipse' }>,
): { position: ElementPosition; size: ElementSize } {
  return {
    position: { ...geometry.center },
    size: {
      wPct: geometry.radiusXPct * 2,
      hPct: geometry.radiusYPct * 2,
    },
  };
}

/** Convert element-local path commands into an SVG `d` string for the given box. */
export function pathCommandsToSvgD(commands: BlockPathCommand[], rect: PixelRect): string {
  const mapX = (xPct: number) => rect.x + (xPct / 100) * rect.width;
  const mapY = (yPct: number) => rect.y + (yPct / 100) * rect.height;
  const parts: string[] = [];

  for (const cmd of commands) {
    switch (cmd.command) {
      case 'M':
        parts.push(`M${mapX(cmd.xPct).toFixed(2)} ${mapY(cmd.yPct).toFixed(2)}`);
        break;
      case 'L':
        parts.push(`L${mapX(cmd.xPct).toFixed(2)} ${mapY(cmd.yPct).toFixed(2)}`);
        break;
      case 'C':
        parts.push(
          `C${mapX(cmd.x1Pct).toFixed(2)} ${mapY(cmd.y1Pct).toFixed(2)} ${mapX(cmd.x2Pct).toFixed(2)} ${mapY(cmd.y2Pct).toFixed(2)} ${mapX(cmd.xPct).toFixed(2)} ${mapY(cmd.yPct).toFixed(2)}`,
        );
        break;
      case 'Q':
        parts.push(
          `Q${mapX(cmd.x1Pct).toFixed(2)} ${mapY(cmd.y1Pct).toFixed(2)} ${mapX(cmd.xPct).toFixed(2)} ${mapY(cmd.yPct).toFixed(2)}`,
        );
        break;
      case 'Z':
        parts.push('Z');
        break;
      default:
        break;
    }
  }
  return parts.join(' ');
}

/**
 * Ensure optional `geometry` matches the named shape using existing bounds/curveDeg.
 * Traced polygons (`customPoints`) are left unchanged — polygon remains authoritative.
 */
export function syncCenterpieceGeometry(
  el: CenterpieceElement,
  canvas: CanvasConfig,
): CenterpieceElement {
  if (hasTracedBlockOutline(el)) {
    return el;
  }

  switch (el.shape) {
    case 'circle': {
      const geometry = geometryFromCircleBounds(el.position, el.size, canvas);
      const bounds = boundsFromCircleGeometry(geometry, canvas);
      return { ...el, geometry, position: bounds.position, size: bounds.size };
    }
    case 'oval': {
      const geometry = geometryFromEllipseBounds(el.position, el.size);
      return { ...el, geometry, position: geometry.center, size: boundsFromEllipseGeometry(geometry).size };
    }
    case 'curved': {
      // Editor source of truth remains `curveDeg` (existing bowed-rect algorithm);
      // persist matching path commands so JSON reconstructs without another table.
      // If the element already has freeform path commands and curveDeg is 0, keep them.
      if (
        el.geometry?.type === 'path' &&
        el.geometry.commands.length > 0 &&
        Math.abs(el.curveDeg) < 0.25 &&
        !isAxisAlignedRectPath(el.geometry.commands)
      ) {
        return el;
      }
      return { ...el, geometry: geometryFromCurvedRect(el.curveDeg) };
    }
    case 'square':
    case 'rectangle':
    case 'custom':
    case 'triangle':
    case 'hexagon':
    case 'octagon':
    case 'd-end':
      if (!el.geometry) {
        return el;
      }
      {
        const { geometry: _removed, ...rest } = el;
        return rest;
      }
    default:
      return el;
  }
}

/**
 * On load: if geometry is present, align position/size so drag handles match the drawn shape.
 * Does not invent geometry for legacy elements.
 */
export function hydrateCenterpieceFromGeometry(
  el: CenterpieceElement,
  canvas: CanvasConfig,
): CenterpieceElement {
  if (hasTracedBlockOutline(el) || !el.geometry) {
    return el;
  }
  if (el.geometry.type === 'circle') {
    const bounds = boundsFromCircleGeometry(el.geometry, canvas);
    return { ...el, position: bounds.position, size: bounds.size };
  }
  if (el.geometry.type === 'ellipse') {
    const bounds = boundsFromEllipseGeometry(el.geometry);
    return { ...el, position: bounds.position, size: bounds.size };
  }
  // path geometry: keep position/size as the transform box
  return el;
}

export function resolveCenterpieceShapeDraw(
  el: CenterpieceShapeSource,
  canvas: CanvasConfig,
  options?: {
    /** Parking outline builder (injected to avoid a parking→geometry cycle). */
    buildParkingPath?: (
      rect: PixelRect,
      points: ElementPosition[],
      edgeBowAmounts: number[],
    ) => string;
  },
): ResolvedCenterpieceShape {
  const baseRect = rectFromPositionSize(el.position, el.size, canvas);
  const outlinePts = el.customPoints ?? [];

  // Traced seating / custom outlines always win — never swap to ellipse/rect primitives.
  if (outlinePts.length >= 3) {
    const isParking = el.blockType === 'parking';
    const pathD =
      isParking && options?.buildParkingPath
        ? options.buildParkingPath(baseRect, outlinePts, el.edgeBowAmounts ?? [])
        : localPointsToSvg(outlinePts, baseRect);
    return {
      shapeMode: isParking ? 'path' : 'polygon',
      rect: baseRect,
      pathD,
      fromGeometry: false,
    };
  }

  // Explicit circle geometry
  if (el.shape === 'circle' && el.geometry?.type === 'circle') {
    const rect = rectFromCircleGeometry(el.geometry, canvas);
    return { shapeMode: 'ellipse', rect, fromGeometry: true };
  }

  // Explicit oval / ellipse geometry
  if ((el.shape === 'oval' || el.shape === 'circle') && el.geometry?.type === 'ellipse') {
    const rect = rectFromEllipseGeometry(el.geometry, canvas);
    return { shapeMode: 'ellipse', rect, fromGeometry: true };
  }

  // Curved: path geometry (element-local) or legacy curveDeg bowed rect
  if (el.shape === 'curved') {
    if (el.geometry?.type === 'path' && el.geometry.commands.length > 0) {
      return {
        shapeMode: 'path',
        rect: baseRect,
        pathD: pathCommandsToSvgD(el.geometry.commands, baseRect),
        fromGeometry: true,
      };
    }
    const curved = curvedRectanglePath(baseRect, el.curveDeg);
    if (curved) {
      return { shapeMode: 'path', rect: baseRect, pathD: curved, fromGeometry: false };
    }
    return { shapeMode: 'rect', rect: baseRect, rectRx: 8, fromGeometry: false };
  }

  switch (el.shape) {
    case 'rectangle':
    case 'square': {
      const curved = curvedRectanglePath(baseRect, el.curveDeg);
      if (curved) {
        return { shapeMode: 'path', rect: baseRect, pathD: curved, fromGeometry: false };
      }
      return { shapeMode: 'rect', rect: baseRect, rectRx: 8, fromGeometry: false };
    }
    case 'hexagon':
    case 'octagon':
      return {
        shapeMode: 'path',
        rect: baseRect,
        pathD: polygonPath(
          baseRect.cx,
          baseRect.cy,
          baseRect.width / 2,
          baseRect.height / 2,
          el.polygonSides ?? (el.shape === 'hexagon' ? 6 : 8),
        ),
        fromGeometry: false,
      };
    case 'd-end':
      return {
        shapeMode: 'path',
        rect: baseRect,
        pathD: dEndPath(baseRect.cx, baseRect.cy, baseRect.width / 2, baseRect.height / 2),
        fromGeometry: false,
      };
    case 'triangle': {
      const tri: ElementPosition[] = [
        { xPct: 50, yPct: 0 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ];
      return {
        shapeMode: 'polygon',
        rect: baseRect,
        pathD: localPointsToSvg(tri, baseRect),
        fromGeometry: false,
      };
    }
    case 'custom':
      return { shapeMode: undefined, rect: baseRect, fromGeometry: false };
    case 'circle':
    case 'oval':
    default:
      // Legacy oval/circle without geometry — ellipse from position/size.
      return { shapeMode: 'ellipse', rect: baseRect, fromGeometry: false };
  }
}

/** Shapes that persist an optional `geometry` object on save. */
export function shapeUsesGeometryField(shape: ShapeId): boolean {
  return shape === 'circle' || shape === 'oval' || shape === 'curved';
}

/** Effective Block Grid outline shape (legacy JSON without `shape` → square). */
export function resolveBlockGridShape(el: Pick<BlockGridElement, 'shape'>): BlockGridShapeId {
  return el.shape ?? 'square';
}

/**
 * Curved top + straight sides/bottom — "Curved + Line" Block Grid outline.
 * Uses cubic (C) for the bow and line (L) for the remaining edges.
 */
export function pathCommandsFromCurvedLine(curveDeg = 28): BlockPathCommand[] {
  const safeCurve = clamp(curveDeg, -MAX_CURVE_DEG, MAX_CURVE_DEG);
  const bow = Math.max(8, Math.abs(safeCurve) * 0.55);
  const topY = bow;
  const ctrlY = safeCurve >= 0 ? 0 : bow * 2;
  return [
    { command: 'M', xPct: 0, yPct: topY },
    {
      command: 'C',
      x1Pct: 25,
      y1Pct: ctrlY,
      x2Pct: 75,
      y2Pct: ctrlY,
      xPct: 100,
      yPct: topY,
    },
    { command: 'L', xPct: 100, yPct: 100 },
    { command: 'L', xPct: 0, yPct: 100 },
    { command: 'Z' },
  ];
}

export function geometryFromCurvedLine(curveDeg = 28): Extract<BlockGeometry, { type: 'path' }> {
  return {
    type: 'path',
    commands: pathCommandsFromCurvedLine(curveDeg),
    closed: true,
  };
}

export type BlockGridShapeSource = Pick<
  BlockGridElement,
  'shape' | 'position' | 'size' | 'curveDeg' | 'geometry'
>;

/**
 * Resolve Block Grid outline draw instructions.
 * Reuses the same circle / ellipse / path reconstruction as centerpieces.
 */
export function resolveBlockGridShapeDraw(
  el: BlockGridShapeSource,
  canvas: CanvasConfig,
): ResolvedCenterpieceShape {
  const shape = resolveBlockGridShape(el);
  const baseRect = rectFromPositionSize(el.position, el.size, canvas);

  if (shape === 'square') {
    return { shapeMode: 'rect', rect: baseRect, rectRx: 6, fromGeometry: false };
  }

  if (shape === 'circle' && el.geometry?.type === 'circle') {
    // Position is the live drag source of truth (same as square / curved-line).
    // Keep radii from geometry; do not pin the outline to a stale geometry.center.
    const rect = rectFromCircleGeometry(
      { ...el.geometry, center: { xPct: el.position.xPct, yPct: el.position.yPct } },
      canvas,
    );
    return { shapeMode: 'ellipse', rect, fromGeometry: true };
  }

  if (shape === 'oval' && el.geometry?.type === 'ellipse') {
    const rect = rectFromEllipseGeometry(
      { ...el.geometry, center: { xPct: el.position.xPct, yPct: el.position.yPct } },
      canvas,
    );
    return { shapeMode: 'ellipse', rect, fromGeometry: true };
  }

  if (shape === 'curved-line') {
    if (el.geometry?.type === 'path' && el.geometry.commands.length > 0) {
      return {
        shapeMode: 'path',
        rect: baseRect,
        pathD: pathCommandsToSvgD(el.geometry.commands, baseRect),
        fromGeometry: true,
      };
    }
    const fallback = geometryFromCurvedLine(el.curveDeg ?? 28);
    return {
      shapeMode: 'path',
      rect: baseRect,
      pathD: pathCommandsToSvgD(fallback.commands, baseRect),
      fromGeometry: false,
    };
  }

  if (shape === 'circle' || shape === 'oval') {
    return { shapeMode: 'ellipse', rect: baseRect, fromGeometry: false };
  }

  return { shapeMode: 'rect', rect: baseRect, rectRx: 6, fromGeometry: false };
}

/** Keep optional `geometry` in sync with Block Grid shape + bounds. */
export function syncBlockGridGeometry(
  el: BlockGridElement,
  canvas: CanvasConfig,
): BlockGridElement {
  const shape = resolveBlockGridShape(el);

  switch (shape) {
    case 'circle': {
      const geometry = geometryFromCircleBounds(el.position, el.size, canvas);
      const bounds = boundsFromCircleGeometry(geometry, canvas);
      return { ...el, shape, geometry, position: bounds.position, size: bounds.size };
    }
    case 'oval': {
      const geometry = geometryFromEllipseBounds(el.position, el.size);
      return {
        ...el,
        shape,
        geometry,
        position: geometry.center,
        size: boundsFromEllipseGeometry(geometry).size,
      };
    }
    case 'curved-line': {
      if (
        el.geometry?.type === 'path' &&
        el.geometry.commands.length > 0 &&
        el.curveDeg == null
      ) {
        return { ...el, shape };
      }
      return {
        ...el,
        shape,
        geometry: geometryFromCurvedLine(el.curveDeg ?? 28),
      };
    }
    case 'square':
    default: {
      if (!el.geometry && el.shape === 'square') {
        return el;
      }
      if (!el.geometry && el.shape == null) {
        return el;
      }
      const { geometry: _removed, ...rest } = el;
      return { ...rest, shape: 'square' };
    }
  }
}

/** On load: align position/size from saved circle/ellipse geometry. */
export function hydrateBlockGridFromGeometry(
  el: BlockGridElement,
  canvas: CanvasConfig,
): BlockGridElement {
  if (!el.geometry) {
    return el;
  }
  if (el.geometry.type === 'circle') {
    const bounds = boundsFromCircleGeometry(el.geometry, canvas);
    return { ...el, shape: el.shape ?? 'circle', position: bounds.position, size: bounds.size };
  }
  if (el.geometry.type === 'ellipse') {
    const bounds = boundsFromEllipseGeometry(el.geometry);
    return { ...el, shape: el.shape ?? 'oval', position: bounds.position, size: bounds.size };
  }
  return { ...el, shape: el.shape ?? 'curved-line' };
}
