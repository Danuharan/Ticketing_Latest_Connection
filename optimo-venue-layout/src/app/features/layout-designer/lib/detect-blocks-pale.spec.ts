import { describe, expect, it } from 'vitest';

import { detectBlocksFromImageData, type AnalysisImageData } from './detect-blocks';

/**
 * Regression cover for pale (near-neutral) seating blocks.
 *
 * Charts that grey out a whole tier draw the block fill and the separator line
 * in the same near-white band. Fixed luminance thresholds classify the fill as
 * border, so the block never seeds a region and disappears from the result.
 */

const PAGE_WHITE: [number, number, number] = [255, 255, 255];
/** A greyed-out tier, ~15 below page white — the case that used to vanish. */
const PALE_GREY: [number, number, number] = [236, 236, 236];
const BLUE: [number, number, number] = [60, 110, 200];

function makeRaster(
  width: number,
  height: number,
  bg: [number, number, number],
): AnalysisImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bg[0];
    data[i + 1] = bg[1];
    data[i + 2] = bg[2];
    data[i + 3] = 255;
  }
  return { data, width, height };
}

function fillRect(
  raster: AnalysisImageData,
  x: number,
  y: number,
  w: number,
  h: number,
  [r, g, b]: [number, number, number],
): void {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      const i = (yy * raster.width + xx) * 4;
      raster.data[i] = r;
      raster.data[i + 1] = g;
      raster.data[i + 2] = b;
      raster.data[i + 3] = 255;
    }
  }
}

/** Count blocks whose traced fill is near-neutral and clearly below page white. */
function countPaleBlocks(fills: string[]): number {
  return fills.filter((hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    return chroma < 25 && l > 190 && l < 250;
  }).length;
}

/** A pale tier and a saturated tier, separated by white lines on a white page. */
function makeMixedTierRaster(): AnalysisImageData {
  const raster = makeRaster(500, 400, PAGE_WHITE);
  const xs = [60, 175, 290];
  for (const x of xs) {
    fillRect(raster, x, 60, 110, 90, PALE_GREY);
    fillRect(raster, x, 200, 110, 90, BLUE);
  }
  return raster;
}

describe('pale seating blocks', () => {
  it('detects greyed-out tiers that sit just below page white', () => {
    const detection = detectBlocksFromImageData(makeMixedTierRaster(), 48);
    const fills = detection.blocks.map((b) => b.fillColor);

    // Both tiers must come through: 3 pale + 3 saturated.
    expect(countPaleBlocks(fills)).toBe(3);
    expect(detection.blocks.length).toBe(6);
  });

  it('keeps each pale block separate rather than merging across the white lines', () => {
    const detection = detectBlocksFromImageData(makeMixedTierRaster(), 48);
    const pale = detection.blocks.filter((b) => {
      const r = parseInt(b.fillColor.slice(1, 3), 16);
      return r > 200;
    });
    // Three distinct centres, one per block, not one merged strip.
    const centres = new Set(pale.map((b) => Math.round(b.cxPct / 5)));
    expect(centres.size).toBe(3);
  });

  it('does not invent blocks on a blank page', () => {
    const detection = detectBlocksFromImageData(makeRaster(500, 400, PAGE_WHITE), 48);
    expect(detection.blocks.length).toBe(0);
  });

  it('does not turn separator lines or page background into blocks', () => {
    // A white page whose only neutral non-white content is thin grid lines.
    const raster = makeRaster(500, 400, PAGE_WHITE);
    for (let x = 40; x < 460; x += 40) {
      fillRect(raster, x, 40, 2, 320, PALE_GREY);
    }
    for (let y = 40; y < 360; y += 40) {
      fillRect(raster, 40, y, 420, 2, PALE_GREY);
    }
    const detection = detectBlocksFromImageData(raster, 48);
    expect(countPaleBlocks(detection.blocks.map((b) => b.fillColor))).toBe(0);
  });
});
