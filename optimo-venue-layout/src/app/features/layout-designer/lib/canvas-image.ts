import { CanvasConfig } from '../models/layout-element.model';
import { DEFAULT_CANVAS } from '../models/layout-element.model';

const MAX_CANVAS_WIDTH = 2400;
const MAX_CANVAS_HEIGHT = 1800;

export function loadImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      });
    };
    image.onerror = () => reject(new Error('Failed to load image'));
    image.src = src;
  });
}

/** Scale the artboard to fit the image (up to max), preserving aspect ratio. */
export function canvasSizeForImage(naturalWidth: number, naturalHeight: number): CanvasConfig {
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return { ...DEFAULT_CANVAS };
  }
  const scale = Math.min(MAX_CANVAS_WIDTH / naturalWidth, MAX_CANVAS_HEIGHT / naturalHeight);
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
}

/**
 * Draw rect for the reference chart image.
 * When `geometryScale` is set (AI-detected layouts), scale the image about the
 * canvas centre so it stays aligned with scaled block polygons.
 * Otherwise letterbox to preserve the image aspect ratio inside the canvas.
 */
export function referenceImageDrawRect(
  canvas: CanvasConfig,
  imageWidth: number,
  imageHeight: number,
  geometryScale = 1,
): { x: number; y: number; width: number; height: number } {
  if (geometryScale !== 1) {
    const width = canvas.width * geometryScale;
    const height = canvas.height * geometryScale;
    return {
      x: (canvas.width - width) / 2,
      y: (canvas.height - height) / 2,
      width,
      height,
    };
  }
  if (imageWidth <= 0 || imageHeight <= 0) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  }
  const scale = Math.min(canvas.width / imageWidth, canvas.height / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (canvas.width - width) / 2,
    y: (canvas.height - height) / 2,
    width,
    height,
  };
}

/** Map canvas-% polygon points to reference-image-% (matches Azure OCR tokens). */
export function canvasPolygonToReferencePct(
  polygon: { xPct: number; yPct: number }[],
  canvas: CanvasConfig,
  drawRect: { x: number; y: number; width: number; height: number },
): { xPct: number; yPct: number }[] {
  if (drawRect.width <= 0 || drawRect.height <= 0) {
    return polygon;
  }
  return polygon.map((point) => canvasPointToReferencePct(point.xPct, point.yPct, canvas, drawRect));
}

/** Map one canvas pixel position to reference-image % (matches Azure OCR tokens). */
export function canvasPointToReferencePct(
  xPct: number,
  yPct: number,
  canvas: CanvasConfig,
  drawRect: { x: number; y: number; width: number; height: number },
): { xPct: number; yPct: number } {
  if (drawRect.width <= 0 || drawRect.height <= 0) {
    return { xPct, yPct };
  }
  const px = (xPct / 100) * canvas.width;
  const py = (yPct / 100) * canvas.height;
  return {
    xPct: ((px - drawRect.x) / drawRect.width) * 100,
    yPct: ((py - drawRect.y) / drawRect.height) * 100,
  };
}

/** Inverse of {@link canvasPointToReferencePct}. */
export function referencePctToCanvasPoint(
  refXPct: number,
  refYPct: number,
  canvas: CanvasConfig,
  drawRect: { x: number; y: number; width: number; height: number },
): { xPct: number; yPct: number } {
  if (drawRect.width <= 0 || drawRect.height <= 0) {
    return { xPct: refXPct, yPct: refYPct };
  }
  const px = drawRect.x + (refXPct / 100) * drawRect.width;
  const py = drawRect.y + (refYPct / 100) * drawRect.height;
  return {
    xPct: (px / canvas.width) * 100,
    yPct: (py / canvas.height) * 100,
  };
}
