/**
 * Renders the image pair sent to the AI verification pass:
 *   - the original blueprint (downscaled JPEG)
 *   - a composite overlay: blueprint at 40% opacity with every detected block
 *     polygon stroked and tagged with a numbered badge
 * Badge numbers are 1-based and match the `index` field of the block summary
 * table, so the model can reference issues by badge number.
 */

import type { PointPct } from './contour-geometry';
import type { LabeledBlock } from './assign-ocr-labels';

export interface AuditImagePayload {
  /** Raw base64 (no data: prefix). */
  base64: string;
  mimeType: 'image/jpeg';
}

export interface AuditBlockSummary {
  /** 1-based, matches the overlay badge number. */
  index: number;
  /** OCR-assigned label; empty when unlabeled. */
  label: string;
  cxPct: number;
  cyPct: number;
  wPct: number;
  hPct: number;
}

const STROKE_COLOR = '#e11d48';
const FILL_COLOR = 'rgba(225,29,72,0.12)';
const JPEG_QUALITY = 0.85;

/** Bounding box of a polygon in image-% coordinates. */
function polygonBounds(polygon: PointPct[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.xPct);
    minY = Math.min(minY, p.yPct);
    maxX = Math.max(maxX, p.xPct);
    maxY = Math.max(maxY, p.yPct);
  }
  return { minX, minY, maxX, maxY };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Compact block table for the verification prompt (image-%, 1 decimal). */
export function summarizeBlocksForAudit(blocks: LabeledBlock[]): AuditBlockSummary[] {
  return blocks.map((block, i) => {
    const b = polygonBounds(block.polygon);
    return {
      index: i + 1,
      label: block.labelFromOcr ? block.assignedLabel : '',
      cxPct: round1((b.minX + b.maxX) / 2),
      cyPct: round1((b.minY + b.maxY) / 2),
      wPct: round1(b.maxX - b.minX),
      hPct: round1(b.maxY - b.minY),
    };
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load the blueprint image.'));
    };
    img.src = url;
  });
}

function canvasToPayload(canvas: HTMLCanvasElement): AuditImagePayload {
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'image/jpeg' };
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
): void {
  const radius = 11;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = STROKE_COLOR;
  ctx.stroke();
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/** Renders the downscaled original + numbered-overlay JPEG pair. */
export async function renderVerificationImages(
  file: File,
  blocks: { polygon: PointPct[] }[],
  // 1024 keeps block outlines + printed labels legible for the QA model while
  // cutting ~60% of the pixels vs 1600 — the single biggest verify speedup.
  maxLongEdge = 1024,
): Promise<{ original: AuditImagePayload; overlay: AuditImagePayload }> {
  const img = await loadImage(file);
  const scale = Math.min(1, maxLongEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const originalCanvas = document.createElement('canvas');
  originalCanvas.width = width;
  originalCanvas.height = height;
  const originalCtx = originalCanvas.getContext('2d');
  if (!originalCtx) {
    throw new Error('Canvas 2D context unavailable.');
  }
  originalCtx.fillStyle = '#ffffff';
  originalCtx.fillRect(0, 0, width, height);
  originalCtx.drawImage(img, 0, 0, width, height);

  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = width;
  overlayCanvas.height = height;
  const ctx = overlayCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable.');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 0.4;
  ctx.drawImage(img, 0, 0, width, height);
  ctx.globalAlpha = 1;

  for (let i = 0; i < blocks.length; i += 1) {
    const polygon = blocks[i].polygon;
    if (polygon.length < 3) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo((polygon[0].xPct / 100) * width, (polygon[0].yPct / 100) * height);
    for (let p = 1; p < polygon.length; p += 1) {
      ctx.lineTo((polygon[p].xPct / 100) * width, (polygon[p].yPct / 100) * height);
    }
    ctx.closePath();
    ctx.fillStyle = FILL_COLOR;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = STROKE_COLOR;
    ctx.stroke();
  }

  // Badges last so overlapping polygons never cover a number.
  for (let i = 0; i < blocks.length; i += 1) {
    const polygon = blocks[i].polygon;
    if (polygon.length < 3) {
      continue;
    }
    const b = polygonBounds(polygon);
    drawBadge(
      ctx,
      (((b.minX + b.maxX) / 2) / 100) * width,
      (((b.minY + b.maxY) / 2) / 100) * height,
      String(i + 1),
    );
  }

  return { original: canvasToPayload(originalCanvas), overlay: canvasToPayload(overlayCanvas) };
}
