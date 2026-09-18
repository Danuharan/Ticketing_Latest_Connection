/**
 * Parking-stall audit overlays — same image pair shape as stadium block audit,
 * but polygons are oriented slot rectangles in plan-image %.
 */

import type { PointPct } from './contour-geometry';
import {
  renderVerificationImages,
  type AuditBlockSummary,
  type AuditImagePayload,
} from './audit-overlay';

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 4 corners of an oriented slot rectangle in image-% coordinates. */
export function slotOrientedPolygon(
  cxPct: number,
  cyPct: number,
  lengthPct: number,
  widthPct: number,
  rotationDeg: number,
): PointPct[] {
  const halfL = lengthPct / 2;
  const halfW = widthPct / 2;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    { x: halfL, y: -halfW },
    { x: halfL, y: halfW },
    { x: -halfL, y: halfW },
    { x: -halfL, y: -halfW },
  ];
  return corners.map((c) => ({
    xPct: cxPct + c.x * cos - c.y * sin,
    yPct: cyPct + c.x * sin + c.y * cos,
  }));
}

export function summarizeParkingSlotsForAudit(
  slots: { label: string; cxPct: number; cyPct: number; wPct: number; hPct: number }[],
): AuditBlockSummary[] {
  return slots.map((s, i) => ({
    index: i + 1,
    label: s.label,
    cxPct: round1(s.cxPct),
    cyPct: round1(s.cyPct),
    wPct: round1(s.wPct),
    hPct: round1(s.hPct),
  }));
}

export async function renderParkingVerificationImages(
  file: File,
  polygons: { polygon: PointPct[] }[],
): Promise<{ original: AuditImagePayload; overlay: AuditImagePayload }> {
  return renderVerificationImages(file, polygons);
}
