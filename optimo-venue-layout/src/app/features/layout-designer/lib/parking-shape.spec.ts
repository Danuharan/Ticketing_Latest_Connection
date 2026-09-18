import { describe, expect, it } from 'vitest';

import { relaxParkingPolygonToLengths } from './parking-shape';
import { PixelRect } from './geometry';
import { ElementPosition } from '../models/layout-element.model';

// Canvas 1000x700, rect matches the element's bounding box in px.
const RECT: PixelRect = { x: 300, y: 150, width: 400, height: 400, cx: 500, cy: 350 };

function edgeLengthsPx(points: { x: number; y: number }[]): number[] {
  const n = points.length;
  return points.map((p, i) => {
    const q = points[(i + 1) % n];
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
}

describe('relaxParkingPolygonToLengths', () => {
  it('reshapes a triangle so measured edge lengths are proportional to their metres (SSS)', () => {
    // Freehand triangle where the drawn proportions do NOT match the real-world ratio yet.
    const customPoints: ElementPosition[] = [
      { xPct: 0, yPct: 0 },
      { xPct: 0, yPct: 100 },
      { xPct: 100, yPct: 100 },
    ];
    // Screenshot scenario: side 1 = 15m, side 2 = 4m, side 3 unmeasured.
    const relaxed = relaxParkingPolygonToLengths(RECT, customPoints, [15, 4, 0]);
    expect(relaxed).not.toBeNull();
    const lens = edgeLengthsPx(relaxed!);
    // Edge 0 (15m) should end up ~3.75x the pixel length of edge 1 (4m).
    expect(lens[0] / lens[1]).toBeCloseTo(15 / 4, 1);
  });

  it('converges to the exact SSS triangle once all three sides are measured', () => {
    const customPoints: ElementPosition[] = [
      { xPct: 10, yPct: 10 },
      { xPct: 90, yPct: 20 },
      { xPct: 40, yPct: 90 },
    ];
    const relaxed = relaxParkingPolygonToLengths(RECT, customPoints, [15, 4, 13]);
    expect(relaxed).not.toBeNull();
    const lens = edgeLengthsPx(relaxed!);
    const scale = lens[0] / 15;
    expect(lens[1] / scale).toBeCloseTo(4, 1);
    expect(lens[2] / scale).toBeCloseTo(13, 1);
  });

  it('leaves unmeasured edges close to their original length (soft constraint)', () => {
    const customPoints: ElementPosition[] = [
      { xPct: 0, yPct: 0 },
      { xPct: 100, yPct: 0 },
      { xPct: 100, yPct: 100 },
      { xPct: 0, yPct: 100 },
    ];
    // Only the first edge (top, 400px @ 10m) is measured.
    const relaxed = relaxParkingPolygonToLengths(RECT, customPoints, [10]);
    expect(relaxed).not.toBeNull();
    const lens = edgeLengthsPx(relaxed!);
    // Measured edge should stay ~400px (10m * 40px/m derived from itself).
    expect(lens[0]).toBeCloseTo(400, 0);
  });

  it('returns null when no edge has been measured yet', () => {
    const customPoints: ElementPosition[] = [
      { xPct: 0, yPct: 0 },
      { xPct: 100, yPct: 0 },
      { xPct: 100, yPct: 100 },
    ];
    expect(relaxParkingPolygonToLengths(RECT, customPoints, [])).toBeNull();
  });
});
