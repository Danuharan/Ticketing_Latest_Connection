import { localPointsToAbsolute } from './custom-shape';
import {
  CanvasConfig,
  CenterpieceElement,
  ElementPosition,
  isCustomizableBlock,
  LayoutElement,
} from '../models/layout-element.model';

const PITCH_LABELS = new Set(['PITCH', 'GROUND', 'FIELD']);

interface CanvasBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function isPitchElement(el: LayoutElement): boolean {
  if (el.type !== 'centerpiece') {
    return false;
  }
  if (el.id.includes('cv-pitch-')) {
    return true;
  }
  const label = (el.label ?? el.name ?? '').trim().toUpperCase();
  return PITCH_LABELS.has(label);
}

function escapeSvgAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeSvgText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function polygonPathFromCanvasPct(points: ElementPosition[]): string {
  if (points.length < 3) {
    return '';
  }
  const segments = points.map((point, index) => {
    const cmd = index === 0 ? 'M' : 'L';
    return `${cmd}${point.xPct.toFixed(3)},${point.yPct.toFixed(3)}`;
  });
  return `${segments.join(' ')} Z`;
}

function rectBoundsFromElement(el: CenterpieceElement): CanvasBounds {
  return {
    minX: el.position.xPct - el.size.wPct / 2,
    minY: el.position.yPct - el.size.hPct / 2,
    maxX: el.position.xPct + el.size.wPct / 2,
    maxY: el.position.yPct + el.size.hPct / 2,
  };
}

function boundsFromPoints(points: ElementPosition[]): CanvasBounds {
  const xs = points.map((point) => point.xPct);
  const ys = points.map((point) => point.yPct);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function mergeBounds(a: CanvasBounds, b: CanvasBounds): CanvasBounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function expandBounds(bounds: CanvasBounds, paddingPct: number): CanvasBounds {
  return {
    minX: Math.max(0, bounds.minX - paddingPct),
    minY: Math.max(0, bounds.minY - paddingPct),
    maxX: Math.min(100, bounds.maxX + paddingPct),
    maxY: Math.min(100, bounds.maxY + paddingPct),
  };
}

function boundsIntersect(a: CanvasBounds, b: CanvasBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function polygonCentroid(points: ElementPosition[]): { xPct: number; yPct: number } {
  const xPct = points.reduce((sum, point) => sum + point.xPct, 0) / points.length;
  const yPct = points.reduce((sum, point) => sum + point.yPct, 0) / points.length;
  return { xPct, yPct };
}

function blockCanvasBounds(el: CenterpieceElement, canvas: CanvasConfig): CanvasBounds {
  if ((el.customPoints?.length ?? 0) >= 3) {
    return boundsFromPoints(localPointsToAbsolute(el, canvas));
  }
  return rectBoundsFromElement(el);
}

function cropViewBox(highlightBounds: CanvasBounds, pitchBounds: CanvasBounds | null): CanvasBounds {
  const span = Math.max(highlightBounds.maxX - highlightBounds.minX, highlightBounds.maxY - highlightBounds.minY);
  const padding = Math.max(5, span * 0.55);
  let view = expandBounds(highlightBounds, padding);

  if (pitchBounds && !boundsIntersect(view, pitchBounds)) {
    const towardPitch = {
      minX: Math.min(view.minX, pitchBounds.minX),
      minY: Math.min(view.minY, pitchBounds.minY),
      maxX: Math.max(view.maxX, pitchBounds.maxX),
      maxY: Math.max(view.maxY, pitchBounds.maxY),
    };
    view = expandBounds(mergeBounds(view, towardPitch), padding * 0.25);
  }

  const viewW = view.maxX - view.minX;
  const viewH = view.maxY - view.minY;
  const minSpan = Math.max(14, span * 1.8);
  if (viewW < minSpan) {
    const extra = (minSpan - viewW) / 2;
    view.minX = Math.max(0, view.minX - extra);
    view.maxX = Math.min(100, view.maxX + extra);
  }
  if (viewH < minSpan) {
    const extra = (minSpan - viewH) / 2;
    view.minY = Math.max(0, view.minY - extra);
    view.maxY = Math.min(100, view.maxY + extra);
  }

  return view;
}

function labelFontSize(bounds: CanvasBounds): number {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  return Math.max(3.2, Math.min(7.5, span * 0.42));
}

export interface BlockLocationPreviewOptions {
  elements: LayoutElement[];
  canvas: CanvasConfig;
  highlightBlockId: string;
  referenceImageDataUrl?: string | null;
  width?: number;
  height?: number;
}

/** Zoomed block preview SVG — cropped around the candidate like the block workspace view. */
export function buildBlockLocationPreviewSvg(options: BlockLocationPreviewOptions): string {
  const width = options.width ?? 96;
  const height = options.height ?? 68;
  const highlight = options.elements.find((el) => el.id === options.highlightBlockId);
  if (!highlight || !isCustomizableBlock(highlight)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"></svg>`;
  }

  const highlightPoints = localPointsToAbsolute(highlight, options.canvas);
  const highlightBounds = blockCanvasBounds(highlight, options.canvas);
  const pitch = options.elements.find(isPitchElement);
  const pitchBounds =
    pitch?.type === 'centerpiece'
      ? blockCanvasBounds(pitch, options.canvas)
      : null;
  const view = cropViewBox(highlightBounds, pitchBounds);
  const viewW = Math.max(0.001, view.maxX - view.minX);
  const viewH = Math.max(0.001, view.maxY - view.minY);
  const label = highlight.label?.trim() || highlight.name?.trim() || '';
  const centroid = polygonCentroid(highlightPoints);
  const fontSize = labelFontSize(highlightBounds);

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.minX.toFixed(3)} ${view.minY.toFixed(3)} ${viewW.toFixed(3)} ${viewH.toFixed(3)}" width="${width}" height="${height}" role="img" aria-hidden="true">`,
    `<rect x="${view.minX.toFixed(3)}" y="${view.minY.toFixed(3)}" width="${viewW.toFixed(3)}" height="${viewH.toFixed(3)}" fill="#f8fafc"/>`,
  ];

  if (options.referenceImageDataUrl) {
    parts.push(
      `<image href="${escapeSvgAttr(options.referenceImageDataUrl)}" x="0" y="0" width="100" height="100" preserveAspectRatio="none" opacity="0.72"/>`,
    );
  }

  if (pitch?.type === 'centerpiece' && pitchBounds && boundsIntersect(view, pitchBounds)) {
    const pitchPoints =
      (pitch.customPoints?.length ?? 0) >= 3
        ? localPointsToAbsolute(pitch, options.canvas)
        : null;
    const pitchPath = pitchPoints
      ? polygonPathFromCanvasPct(pitchPoints)
      : polygonPathFromCanvasPct([
          { xPct: pitchBounds.minX, yPct: pitchBounds.minY },
          { xPct: pitchBounds.maxX, yPct: pitchBounds.minY },
          { xPct: pitchBounds.maxX, yPct: pitchBounds.maxY },
          { xPct: pitchBounds.minX, yPct: pitchBounds.maxY },
        ]);
    if (pitchPath) {
      parts.push(
        `<path d="${pitchPath}" fill="rgba(34,197,94,0.28)" stroke="#16a34a" stroke-width="0.35"/>`,
      );
    }
  }

  for (const el of options.elements) {
    if (!isCustomizableBlock(el) || el.id === options.highlightBlockId) {
      continue;
    }
    const blockBounds = blockCanvasBounds(el, options.canvas);
    if (!boundsIntersect(view, blockBounds)) {
      continue;
    }
    const points = localPointsToAbsolute(el, options.canvas);
    const path = polygonPathFromCanvasPct(points);
    if (!path) {
      continue;
    }
    parts.push(
      `<path d="${path}" fill="rgba(148,163,184,0.22)" stroke="rgba(100,116,139,0.45)" stroke-width="0.25"/>`,
    );
  }

  const highlightPath = polygonPathFromCanvasPct(highlightPoints);
  if (highlightPath) {
    parts.push(
      `<path class="highlight" data-highlight="true" d="${highlightPath}" fill="rgba(37,99,235,0.38)" stroke="#1d4ed8" stroke-width="0.55"/>`,
      `<path d="${highlightPath}" fill="none" stroke="#ffffff" stroke-width="0.2" stroke-dasharray="0.8 0.5"/>`,
    );
    if (label) {
      parts.push(
        `<text x="${centroid.xPct.toFixed(3)}" y="${centroid.yPct.toFixed(3)}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize.toFixed(2)}" font-weight="700" fill="#0f172a" stroke="#ffffff" stroke-width="0.18" paint-order="stroke">${escapeSvgText(label)}</text>`,
      );
    }
  }

  parts.push('</svg>');
  return parts.join('');
}
