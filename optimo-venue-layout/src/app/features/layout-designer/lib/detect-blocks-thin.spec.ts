import { describe, expect, it } from 'vitest';

import { detectBlocksFromImageData, type AnalysisImageData } from './detect-blocks';

/**
 * Regression cover for thin seating elements (narrow bars, entrance arrows).
 *
 * A rendered edge blends block colour into the page over about a pixel. Losing
 * that rim costs a tall block ~3% of its height but a 14 px bar over 20%, so
 * thin elements used to trace visibly skinnier than they are drawn.
 */

const WHITE: [number, number, number] = [255, 255, 255];
const TAUPE: [number, number, number] = [139, 125, 107];
const PINK: [number, number, number] = [236, 72, 130];
const RED: [number, number, number] = [190, 40, 45];
const INK: [number, number, number] = [55, 48, 44];

const BAR_W = 88;
const BAR_H = 14;

function makeRaster(w: number, h: number): AnalysisImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = WHITE[0];
    data[i + 1] = WHITE[1];
    data[i + 2] = WHITE[2];
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

function fillRect(
  r: AnalysisImageData,
  x: number,
  y: number,
  w: number,
  h: number,
  [rr, gg, bb]: [number, number, number],
): void {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      if (xx < 0 || yy < 0 || xx >= r.width || yy >= r.height) continue;
      const i = (yy * r.width + xx) * 4;
      r.data[i] = rr;
      r.data[i + 1] = gg;
      r.data[i + 2] = bb;
      r.data[i + 3] = 255;
    }
  }
}

/** Blend one rim pixel at every colour boundary, the way a real render does. */
function antiAlias(raster: AnalysisImageData): void {
  const src = new Uint8ClampedArray(raster.data);
  const at = (x: number, y: number): [number, number, number] => {
    const i = (y * raster.width + x) * 4;
    return [src[i], src[i + 1], src[i + 2]];
  };
  for (let y = 1; y < raster.height - 1; y += 1) {
    for (let x = 1; x < raster.width - 1; x += 1) {
      const [r0, g0, b0] = at(x, y);
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      let differs = false;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const [r1, g1, b1] = at(x + dx, y + dy);
          sr += r1;
          sg += g1;
          sb += b1;
          n += 1;
          if (Math.abs(r1 - r0) + Math.abs(g1 - g0) + Math.abs(b1 - b0) > 30) {
            differs = true;
          }
        }
      }
      if (!differs) continue;
      const i = (y * raster.width + x) * 4;
      raster.data[i] = Math.round((r0 + sr / n) / 2);
      raster.data[i + 1] = Math.round((g0 + sg / n) / 2);
      raster.data[i + 2] = Math.round((b0 + sb / n) / 2);
    }
  }
}

/** Tall blocks, labelled thin bars, and tapered arrows — all anti-aliased. */
function makeThinElementRaster(): AnalysisImageData {
  const raster = makeRaster(600, 420);
  for (let k = 0; k < 5; k += 1) {
    fillRect(raster, 60 + k * 100, 40, 94, 70, RED);
  }
  for (let k = 0; k < 4; k += 1) {
    const bx = 70 + k * 100;
    fillRect(raster, bx, 120, BAR_W, BAR_H, TAUPE);
    // A two-glyph label ("B1") printed inside the bar.
    fillRect(raster, bx + 38, 123, 4, 8, INK);
    fillRect(raster, bx + 45, 123, 4, 8, INK);
  }
  for (let k = 0; k < 3; k += 1) {
    const ay = 190 + k * 70;
    for (let row = 0; row < 46; row += 1) {
      const taper = row < 8 ? 8 - row : 0;
      fillRect(raster, 70 + taper, ay + row, 12 - taper, 1, PINK);
    }
    fillRect(raster, 110, ay, 60, 46, RED);
  }
  antiAlias(raster);
  return raster;
}

function boxOf(polygon: Array<{ xPct: number; yPct: number }>, w: number, h: number) {
  const xs = polygon.map((p) => (p.xPct / 100) * w);
  const ys = polygon.map((p) => (p.yPct / 100) * h);
  return {
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

describe('thin seating elements', () => {
  const raster = makeThinElementRaster();
  const detection = detectBlocksFromImageData(raster, 48);

  it('finds every element, thin ones included', () => {
    // 5 tall + 4 bars + 3 arrows + 3 small = 15
    expect(detection.blocks.length).toBe(15);
  });

  it('keeps a thin labelled bar close to its drawn height', () => {
    const bars = detection.blocks.filter((b) => b.fillColor === '#8b7d6b');
    expect(bars.length).toBe(4);
    for (const bar of bars) {
      const box = boxOf(bar.polygon, raster.width, raster.height);
      // The rim costs at most a pixel; it must not eat a fifth of the bar.
      expect(box.h).toBeGreaterThanOrEqual(BAR_H - 2);
      expect(box.w).toBeGreaterThanOrEqual(BAR_W - 2);
      // Area within 10% of the drawn bar, so the label is absorbed, not carved.
      expect(bar.pixelArea).toBeGreaterThanOrEqual(BAR_W * BAR_H * 0.9);
    }
  });

  it('keeps narrow tapered arrows as one tapered shape', () => {
    const arrows = detection.blocks.filter((b) => {
      const r = parseInt(b.fillColor.slice(1, 3), 16);
      const g = parseInt(b.fillColor.slice(3, 5), 16);
      return r > 200 && g < 120;
    });
    expect(arrows.length).toBe(3);
    for (const arrow of arrows) {
      const box = boxOf(arrow.polygon, raster.width, raster.height);
      expect(box.h).toBeGreaterThanOrEqual(43);
      expect(box.w).toBeGreaterThanOrEqual(10);
      // The taper survives: a plain rectangle would trace as 4 points.
      expect(arrow.polygon.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('does not let the rim merge neighbouring blocks', () => {
    // Every block stays its own colour; a merge would average two fills.
    const fills = new Set(detection.blocks.map((b) => b.fillColor));
    expect(fills.size).toBeLessThanOrEqual(3);
    for (const block of detection.blocks) {
      expect(block.pixelArea).toBeLessThan(94 * 70 * 1.25);
    }
  });
});
