/** Two-point custom aisle: a walkway band seats must not occupy. */

export interface DrawnAislePctPoint {
  xPct: number;
  yPct: number;
}

export interface DrawnAisleBand {
  start: { x: number; y: number };
  end: { x: number; y: number };
  halfWidthPx: number;
}

export function distancePointToSegmentPx(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const abx = end.x - start.x;
  const aby = end.y - start.y;
  const apx = point.x - start.x;
  const apy = point.y - start.y;
  const ab2 = abx * abx + aby * aby;
  const t = ab2 < 1e-9 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
  return Math.hypot(point.x - (start.x + t * abx), point.y - (start.y + t * aby));
}

export function pointHitsDrawnAisle(
  point: { x: number; y: number },
  bands: DrawnAisleBand[],
  extraRadiusPx = 0,
): boolean {
  for (const band of bands) {
    if (distancePointToSegmentPx(point, band.start, band.end) < band.halfWidthPx + extraRadiusPx) {
      return true;
    }
  }
  return false;
}

export function isCompleteDrawnAisle(slot: {
  type?: string;
  drawStart?: DrawnAislePctPoint;
  drawEnd?: DrawnAislePctPoint;
}): boolean {
  return (
    slot.type === 'draw' &&
    slot.drawStart != null &&
    slot.drawEnd != null &&
    Number.isFinite(slot.drawStart.xPct) &&
    Number.isFinite(slot.drawStart.yPct) &&
    Number.isFinite(slot.drawEnd.xPct) &&
    Number.isFinite(slot.drawEnd.yPct)
  );
}

export function drawnAislePctPointsEqual(
  a: DrawnAislePctPoint | undefined,
  b: DrawnAislePctPoint | undefined,
): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return Math.abs(a.xPct - b.xPct) < 0.05 && Math.abs(a.yPct - b.yPct) < 0.05;
}

export function drawnAisleSlotsToBands(
  slots: {
    start: DrawnAislePctPoint;
    end: DrawnAislePctPoint;
    widthM: number;
  }[],
  rect: { x: number; y: number; width: number; height: number },
  ppm: number,
): DrawnAisleBand[] {
  const bands: DrawnAisleBand[] = [];
  for (const slot of slots) {
    const widthM = slot.widthM > 0 && Number.isFinite(slot.widthM) ? slot.widthM : 0;
    if (widthM <= 0) {
      continue;
    }
    bands.push({
      start: {
        x: rect.x + (slot.start.xPct / 100) * rect.width,
        y: rect.y + (slot.start.yPct / 100) * rect.height,
      },
      end: {
        x: rect.x + (slot.end.xPct / 100) * rect.width,
        y: rect.y + (slot.end.yPct / 100) * rect.height,
      },
      halfWidthPx: (widthM * Math.max(1, ppm)) / 2,
    });
  }
  return bands;
}
