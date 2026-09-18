import {
  type DiningLayoutReferenceImage,
  type ElementPosition,
  type ShapeId,
} from '../models/layout-element.model';
import {
  curvedRectanglePath,
  dEndPath,
  localPointsToSvg,
  polygonPath,
  type PixelRect,
} from './geometry';

export interface DiningBackgroundClipSource {
  shape?: ShapeId | string;
  customPoints?: ElementPosition[] | null;
  polygonSides?: number;
  curveDeg?: number;
}

export type DiningBackgroundFitMode = 'cover' | 'contain';

export interface DiningBackgroundFit {
  scale: number;
  offsetXPct: number;
  offsetYPct: number;
  rotationDeg: number;
  opacity: number;
  visible: boolean;
  fitMode: DiningBackgroundFitMode;
}

export interface DiningBackgroundDraw {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
  opacity: number;
  transform: string;
}

export type DiningBackgroundClipKind = 'polygon' | 'path' | 'ellipse' | 'rect';

export interface DiningBackgroundPreviewLayout {
  outerWidth: number;
  outerHeight: number;
  pad: number;
  rect: PixelRect;
  clipKind: DiningBackgroundClipKind;
  polygonPoints: string;
  pathD: string;
  ellipse: { cx: number; cy: number; rx: number; ry: number };
  rectRx: number;
  overlayPath: string;
  /** CSS clip-path for the crop inner box (block-local 0–100%). */
  cssClip: string;
}

const MIN_SCALE = 0.35;
const MAX_SCALE = 4;

export function clampDiningBackgroundScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function defaultDiningBackgroundFit(): DiningBackgroundFit {
  return {
    scale: 1,
    offsetXPct: 50,
    offsetYPct: 50,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    fitMode: 'cover',
  };
}

/**
 * `<base href="/">` makes CSS `url(#id)` resolve against the site root, so SVG
 * clipPaths are not found and clipped images disappear. Resolve against the
 * current document path instead.
 */
export function svgLocalClipUrl(fragmentId: string): string {
  if (typeof window === 'undefined') {
    return `url(#${fragmentId})`;
  }
  const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  return `url("${base}#${fragmentId}")`;
}

export function diningBackgroundCssClip(
  source: DiningBackgroundClipSource | ElementPosition[] | null | undefined,
): string {
  const clip = normalizeClipSource(source);
  const pts = clip.customPoints;
  if (pts && pts.length >= 3) {
    return `polygon(${pts.map((p) => `${p.xPct}% ${p.yPct}%`).join(', ')})`;
  }
  switch (clip.shape) {
    case 'circle':
    case 'oval':
      return 'ellipse(50% 50% at 50% 50%)';
    default:
      return 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
  }
}

export function diningBackgroundFitFromRef(
  ref: DiningLayoutReferenceImage | null | undefined,
): DiningBackgroundFit {
  const fallback = defaultDiningBackgroundFit();
  if (!ref) {
    return fallback;
  }
  return {
    scale: clampDiningBackgroundScale(ref.scale ?? fallback.scale),
    offsetXPct: ref.offsetXPct ?? fallback.offsetXPct,
    offsetYPct: ref.offsetYPct ?? fallback.offsetYPct,
    rotationDeg: ref.rotationDeg ?? fallback.rotationDeg,
    opacity: Math.min(1, Math.max(0.08, ref.opacity ?? fallback.opacity)),
    visible: ref.visible !== false,
    fitMode: ref.fitMode === 'contain' ? 'contain' : 'cover',
  };
}

/** True when the user has applied a pan/zoom/rotate fit (vs detection contentBounds). */
export function diningBackgroundUsesManualFit(
  ref: DiningLayoutReferenceImage | null | undefined,
): boolean {
  if (!ref) {
    return false;
  }
  return (
    ref.scale != null ||
    ref.offsetXPct != null ||
    ref.offsetYPct != null ||
    ref.rotationDeg != null ||
    ref.fitMode != null
  );
}

export function diningBackgroundCoverScale(
  imageWidth: number,
  imageHeight: number,
  viewWidth: number,
  viewHeight: number,
): number {
  if (imageWidth <= 0 || imageHeight <= 0 || viewWidth <= 0 || viewHeight <= 0) {
    return 1;
  }
  return Math.max(viewWidth / imageWidth, viewHeight / imageHeight);
}

export function diningBackgroundContainScale(
  imageWidth: number,
  imageHeight: number,
  viewWidth: number,
  viewHeight: number,
): number {
  if (imageWidth <= 0 || imageHeight <= 0 || viewWidth <= 0 || viewHeight <= 0) {
    return 1;
  }
  return Math.min(viewWidth / imageWidth, viewHeight / imageHeight);
}

/** 90° steps swap visual width/height; used so Fit/Fill stay correct after rotate. */
export function diningBackgroundEffectiveImageSize(
  imageWidth: number,
  imageHeight: number,
  rotationDeg: number,
): { width: number; height: number } {
  const rot = ((Math.round(rotationDeg) % 360) + 360) % 360;
  if (rot === 90 || rot === 270) {
    return { width: imageHeight, height: imageWidth };
  }
  return { width: imageWidth, height: imageHeight };
}

function coverScaleForFit(
  imgW: number,
  imgH: number,
  rect: PixelRect,
  rotationDeg: number,
): number {
  const visual = diningBackgroundEffectiveImageSize(imgW, imgH, rotationDeg);
  return diningBackgroundCoverScale(visual.width, visual.height, rect.width, rect.height);
}

function containScaleForFit(
  imgW: number,
  imgH: number,
  rect: PixelRect,
  rotationDeg: number,
): number {
  const visual = diningBackgroundEffectiveImageSize(imgW, imgH, rotationDeg);
  return diningBackgroundContainScale(visual.width, visual.height, rect.width, rect.height);
}

/** User scale relative to cover-fit (1 = Fill / Cover). */
export function diningBackgroundUserScaleForMode(
  imgW: number,
  imgH: number,
  rect: PixelRect,
  rotationDeg: number,
  mode: DiningBackgroundFitMode,
): number {
  const cover = coverScaleForFit(imgW, imgH, rect, rotationDeg);
  if (mode === 'cover' || cover <= 0) {
    return 1;
  }
  const contain = containScaleForFit(imgW, imgH, rect, rotationDeg);
  return clampDiningBackgroundScale(contain / cover);
}

/**
 * Draw the dining background image inside a block rect using cover-fit × user scale,
 * centred then offset, then rotated about the image centre.
 */
export function diningBackgroundDraw(
  ref: DiningLayoutReferenceImage,
  rect: PixelRect,
  fit?: DiningBackgroundFit,
): DiningBackgroundDraw | null {
  const imgW = ref.imageWidth ?? 0;
  const imgH = ref.imageHeight ?? 0;
  if (imgW <= 0 || imgH <= 0 || rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const resolved = fit ?? diningBackgroundFitFromRef(ref);
  const cover = coverScaleForFit(imgW, imgH, rect, resolved.rotationDeg);
  const scale = cover * resolved.scale;
  const width = imgW * scale;
  const height = imgH * scale;
  const cx = rect.x + (rect.width * resolved.offsetXPct) / 100;
  const cy = rect.y + (rect.height * resolved.offsetYPct) / 100;
  return {
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
    rotationDeg: resolved.rotationDeg,
    opacity: resolved.opacity,
    transform: `translate(${cx} ${cy}) rotate(${resolved.rotationDeg}) translate(${-width / 2} ${-height / 2})`,
  };
}

export function diningBackgroundClipSignature(
  source: DiningBackgroundClipSource | ElementPosition[] | null | undefined,
): string {
  const clip = normalizeClipSource(source);
  const pts = clip.customPoints;
  if (pts && pts.length >= 3) {
    return `custom:${pts.map((p) => `${p.xPct.toFixed(2)},${p.yPct.toFixed(2)}`).join('|')}`;
  }
  const shape = clip.shape || 'rectangle';
  return `${shape}:${clip.polygonSides ?? ''}:${clip.curveDeg ?? ''}`;
}

export function diningBackgroundNeedsReadjustment(
  ref: DiningLayoutReferenceImage | null | undefined,
  source: DiningBackgroundClipSource | ElementPosition[] | null | undefined,
): boolean {
  if (!ref?.clipSignature) {
    return false;
  }
  const current = diningBackgroundClipSignature(source);
  return current.length > 0 && current !== ref.clipSignature;
}

export function diningBackgroundImageFromFit(
  base: Pick<
    DiningLayoutReferenceImage,
    'dataUrl' | 'name' | 'imageWidth' | 'imageHeight' | 'contentBounds'
  >,
  fit: DiningBackgroundFit,
  clipSource?: DiningBackgroundClipSource | ElementPosition[] | null,
): DiningLayoutReferenceImage {
  return {
    dataUrl: base.dataUrl,
    name: base.name,
    imageWidth: base.imageWidth,
    imageHeight: base.imageHeight,
    contentBounds: base.contentBounds,
    scale: fit.scale,
    offsetXPct: fit.offsetXPct,
    offsetYPct: fit.offsetYPct,
    rotationDeg: fit.rotationDeg,
    opacity: fit.opacity,
    visible: fit.visible,
    fitMode: fit.fitMode,
    clipSignature: diningBackgroundClipSignature(clipSource) || undefined,
  };
}

const RECT_CLIP: ElementPosition[] = [
  { xPct: 0, yPct: 0 },
  { xPct: 100, yPct: 0 },
  { xPct: 100, yPct: 100 },
  { xPct: 0, yPct: 100 },
];

export function diningBackgroundClipPoints(
  points: ElementPosition[] | null | undefined,
): ElementPosition[] {
  return points && points.length >= 3 ? points : RECT_CLIP;
}

function normalizeClipSource(
  source: DiningBackgroundClipSource | ElementPosition[] | null | undefined,
): DiningBackgroundClipSource {
  if (!source) {
    return {};
  }
  if (Array.isArray(source)) {
    return { customPoints: source, shape: 'custom' };
  }
  return source;
}

function overlayFromPolygonPoints(outerWidth: number, outerHeight: number, polygonPoints: string): string {
  const pathPts = polygonPoints.trim().split(/\s+/).filter(Boolean);
  const hole = pathPts.length >= 3 ? `M${pathPts[0]} L${pathPts.slice(1).join(' ')} Z` : '';
  return `M0,0 H${outerWidth} V${outerHeight} H0 Z ${hole}`;
}

function overlayFromPath(outerWidth: number, outerHeight: number, pathD: string): string {
  return `M0,0 H${outerWidth} V${outerHeight} H0 Z ${pathD}`;
}

function overlayFromEllipse(
  outerWidth: number,
  outerHeight: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): string {
  return `M0,0 H${outerWidth} V${outerHeight} H0 Z M${cx - rx},${cy} a${rx},${ry} 0 1,0 ${rx * 2},0 a${rx},${ry} 0 1,0 ${-rx * 2},0`;
}

/** Same shape classes the canvas uses for the dining block clip. */
export function diningBackgroundClipGeom(
  source: DiningBackgroundClipSource | ElementPosition[] | null | undefined,
  rect: PixelRect,
  outerWidth: number,
  outerHeight: number,
): Pick<
  DiningBackgroundPreviewLayout,
  'clipKind' | 'polygonPoints' | 'pathD' | 'ellipse' | 'rectRx' | 'overlayPath' | 'cssClip'
> {
  const clip = normalizeClipSource(source);
  const cssClip = diningBackgroundCssClip(clip);
  const pts = clip.customPoints;
  const ellipse = {
    cx: rect.cx,
    cy: rect.cy,
    rx: rect.width / 2,
    ry: rect.height / 2,
  };
  if (pts && pts.length >= 3) {
    const polygonPoints = localPointsToSvg(pts, rect);
    return {
      clipKind: 'polygon',
      polygonPoints,
      pathD: '',
      ellipse,
      rectRx: 0,
      overlayPath: overlayFromPolygonPoints(outerWidth, outerHeight, polygonPoints),
      cssClip,
    };
  }
  switch (clip.shape) {
    case 'hexagon':
    case 'octagon': {
      const pathD = polygonPath(
        rect.cx,
        rect.cy,
        rect.width / 2,
        rect.height / 2,
        clip.polygonSides ?? (clip.shape === 'hexagon' ? 6 : 8),
      );
      return {
        clipKind: 'path',
        polygonPoints: '',
        pathD,
        ellipse,
        rectRx: 0,
        overlayPath: overlayFromPath(outerWidth, outerHeight, pathD),
        cssClip,
      };
    }
    case 'd-end': {
      const pathD = dEndPath(rect.cx, rect.cy, rect.width / 2, rect.height / 2);
      return {
        clipKind: 'path',
        polygonPoints: '',
        pathD,
        ellipse,
        rectRx: 0,
        overlayPath: overlayFromPath(outerWidth, outerHeight, pathD),
        cssClip,
      };
    }
    case 'rectangle':
    case 'square': {
      const curved = curvedRectanglePath(rect, clip.curveDeg ?? 0);
      if (curved) {
        return {
          clipKind: 'path',
          polygonPoints: '',
          pathD: curved,
          ellipse,
          rectRx: 0,
          overlayPath: overlayFromPath(outerWidth, outerHeight, curved),
          cssClip,
        };
      }
      return {
        clipKind: 'rect',
        polygonPoints: '',
        pathD: '',
        ellipse,
        rectRx: 8,
        overlayPath: overlayFromPolygonPoints(
          outerWidth,
          outerHeight,
          localPointsToSvg(RECT_CLIP, rect),
        ),
        cssClip,
      };
    }
    case 'circle':
    case 'oval':
      return {
        clipKind: 'ellipse',
        polygonPoints: '',
        pathD: '',
        ellipse,
        rectRx: 0,
        overlayPath: overlayFromEllipse(outerWidth, outerHeight, ellipse.cx, ellipse.cy, ellipse.rx, ellipse.ry),
        cssClip,
      };
    default: {
      const polygonPoints = localPointsToSvg(RECT_CLIP, rect);
      return {
        clipKind: 'polygon',
        polygonPoints,
        pathD: '',
        ellipse,
        rectRx: 0,
        overlayPath: overlayFromPolygonPoints(outerWidth, outerHeight, polygonPoints),
        cssClip,
      };
    }
  }
}

/** Layout for the crop dialog: padded stage + the same block outline used on the canvas. */
export function diningBackgroundPreviewLayout(
  clipSource: DiningBackgroundClipSource | ElementPosition[] | null | undefined,
  blockAspect: number,
  options?: { maxWidth?: number; maxHeight?: number; pad?: number },
): DiningBackgroundPreviewLayout {
  const maxWidth = options?.maxWidth ?? 600;
  const maxHeight = options?.maxHeight ?? 450;
  const pad = options?.pad ?? 32;
  const aspect = Math.max(0.28, Math.min(3.2, blockAspect || 1));
  const innerMaxW = Math.max(120, maxWidth - pad * 2);
  const innerMaxH = Math.max(120, maxHeight - pad * 2);
  let innerW = innerMaxW;
  let innerH = innerW / aspect;
  if (innerH > innerMaxH) {
    innerH = innerMaxH;
    innerW = innerH * aspect;
  }
  const outerWidth = innerW + pad * 2;
  const outerHeight = innerH + pad * 2;
  const rect: PixelRect = {
    x: pad,
    y: pad,
    width: innerW,
    height: innerH,
    cx: pad + innerW / 2,
    cy: pad + innerH / 2,
  };
  return {
    outerWidth,
    outerHeight,
    pad,
    rect,
    ...diningBackgroundClipGeom(clipSource, rect, outerWidth, outerHeight),
  };
}
