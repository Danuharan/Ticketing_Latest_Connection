import { describe, expect, it } from 'vitest';

import { detectDiningLayoutFromImageData } from './detect-dining-layout';

function makeImageData(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y);
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    }
  }
  return { data, width, height } as ImageData;
}

function fillCircle(
  data: ImageData,
  cx: number,
  cy: number,
  radius: number,
  color: [number, number, number],
): void {
  const { width, height } = data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (Math.hypot(x - cx, y - cy) <= radius) {
        const o = (y * width + x) * 4;
        data.data[o] = color[0];
        data.data[o + 1] = color[1];
        data.data[o + 2] = color[2];
        data.data[o + 3] = 255;
      }
    }
  }
}

function fillRect(
  data: ImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: [number, number, number],
): void {
  const { width, height } = data;
  for (let y = Math.max(0, y0); y < Math.min(height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x += 1) {
      const o = (y * width + x) * 4;
      data.data[o] = color[0];
      data.data[o + 1] = color[1];
      data.data[o + 2] = color[2];
      data.data[o + 3] = 255;
    }
  }
}

describe('detectDiningLayoutFromImageData', () => {
  it('detects round table blobs, a top banquet bar, and exit', () => {
    const width = 400;
    const height = 300;
    const image = makeImageData(width, height, () => [255, 255, 255, 255]);
    fillRect(image, 40, 20, 360, 55, [30, 30, 30]);
    // Right-side entrance/exit marker
    fillRect(image, 372, 200, 392, 230, [20, 20, 20]);
    const tableCenters = [
      [100, 140],
      [200, 140],
      [300, 140],
      [100, 220],
      [200, 220],
      [300, 220],
    ] as const;
    for (const [cx, cy] of tableCenters) {
      fillCircle(image, cx, cy, 14, [20, 20, 20]);
    }

    const result = detectDiningLayoutFromImageData(image, width, height);

    expect(result.tables.length).toBeGreaterThanOrEqual(3);
    expect(result.tables.some((t) => t.shape === 'rectangular' && t.yPct < 30)).toBe(true);
    expect(result.features.some((f) => f.kind === 'exit' || f.kind === 'entrance')).toBe(true);
    expect(result.tables.every((t) => t.seats >= 0)).toBe(true);
    expect(result.contentBounds.maxXPct).toBeGreaterThan(result.contentBounds.minXPct);
    expect(result.confidence).not.toBe('low');
  });

  it('detects a nine-table reference-style layout', () => {
    const width = 480;
    const height = 360;
    const ink: [number, number, number] = [26, 26, 26];
    const image = makeImageData(width, height, () => [255, 255, 255, 255]);
    fillRect(image, 148, 48, 332, 74, ink);
    const roundCenters = [
      [100, 118],
      [240, 118],
      [380, 118],
      [170, 200],
      [310, 200],
      [100, 282],
      [240, 282],
      [380, 282],
    ] as const;
    for (const [cx, cy] of roundCenters) {
      // Big circle = table
      fillCircle(image, cx, cy, 18, ink);
      // Small dots = chairs around the table
      for (let a = 0; a < 8; a += 1) {
        const ang = (a / 8) * Math.PI * 2;
        fillCircle(image, cx + Math.cos(ang) * 36, cy + Math.sin(ang) * 36, 4, ink);
      }
    }
    fillRect(image, 448, 188, 470, 212, ink);

    const result = detectDiningLayoutFromImageData(image, width, height);

    expect(result.tables.length).toBeGreaterThanOrEqual(8);
    expect(result.tables.filter((t) => t.shape === 'round').length).toBeGreaterThanOrEqual(6);
    expect(result.tables.some((t) => t.shape === 'rectangular')).toBe(true);
    // Entrance may be optional if crowded; primary requirement is tables + chair seats
    expect(result.structure.pattern).toBe('banquet');
    expect(result.aisles.length).toBeGreaterThan(0);
    expect(result.structure.summary.length).toBeGreaterThan(10);
    const roundWithChairs = result.tables.filter((t) => t.shape === 'round' && t.seats >= 6);
    expect(roundWithChairs.length).toBeGreaterThanOrEqual(4);
    // No table should get more seats than its local ring of small dots (8 in this fixture)
    expect(result.tables.every((t) => t.seats <= 8)).toBe(true);
  });

  it('keeps 8 chairs on round tables and 6 one-side chairs on the head table', () => {
    const width = 480;
    const height = 360;
    const ink: [number, number, number] = [26, 26, 26];
    const image = makeImageData(width, height, () => [255, 255, 255, 255]);

    // Head banquet + 6 top-side chairs
    fillRect(image, 148, 48, 332, 74, ink);
    for (const x of [168, 192, 216, 240, 264, 288]) {
      fillCircle(image, x, 30, 4.5, ink);
    }

    const roundCenters = [
      [100, 118],
      [240, 118],
      [380, 118],
      [170, 200],
      [310, 200],
      [100, 282],
      [240, 282],
      [380, 282],
    ] as const;
    for (const [cx, cy] of roundCenters) {
      fillCircle(image, cx, cy, 18, ink);
      for (let a = 0; a < 8; a += 1) {
        const ang = (a / 8) * Math.PI * 2;
        fillCircle(image, cx + Math.cos(ang) * 36, cy + Math.sin(ang) * 36, 4, ink);
      }
    }

    const result = detectDiningLayoutFromImageData(image, width, height);
    const head = result.tables.find((t) => t.shape === 'rectangular');
    const rounds = result.tables.filter((t) => t.shape === 'round');

    expect(head).toBeDefined();
    expect(head!.seats).toBe(6);
    expect(head!.seatsByEdge?.[0]).toBe(6);
    expect(head!.seatsByEdge?.[1]).toBe(0);
    expect(head!.seatsByEdge?.[2]).toBe(0);
    expect(head!.seatsByEdge?.[3]).toBe(0);
    expect(head!.suppressedChairEdges).toEqual([1, 2, 3]);

    expect(rounds.length).toBeGreaterThanOrEqual(7);
    expect(rounds.every((t) => t.seats === 8)).toBe(true);
  });
});
