import { describe, expect, it } from 'vitest';

import { detectBlocksFromImageData, type AnalysisImageData } from './detect-blocks';
import { mergeSplitBlockFragments, type MergeableBlockFragment } from './merge-split-block-fragments';

const MAROON: [number, number, number] = [120, 40, 50];
const WHITE: [number, number, number] = [255, 255, 255];
const NAVY: [number, number, number] = [15, 23, 42];
const GOLD: [number, number, number] = [210, 170, 50];

function makeRaster(width: number, height: number): AnalysisImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = NAVY[0];
    data[i + 1] = NAVY[1];
    data[i + 2] = NAVY[2];
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

function makeTripleBlockRaster(): AnalysisImageData {
  const raster = makeRaster(400, 400);
  fillRect(raster, 40, 320, 90, 60, MAROON);
  fillRect(raster, 131, 320, 90, 60, MAROON);
  fillRect(raster, 222, 320, 90, 60, MAROON);
  fillRect(raster, 130, 320, 1, 60, WHITE);
  fillRect(raster, 221, 320, 1, 60, WHITE);
  return raster;
}

function makeMicroBlockRaster(): AnalysisImageData {
  const raster = makeRaster(300, 200);
  fillRect(raster, 20, 60, 80, 60, MAROON);
  fillRect(raster, 110, 70, 12, 40, GOLD);
  fillRect(raster, 130, 60, 80, 60, MAROON);
  fillRect(raster, 108, 60, 1, 60, WHITE);
  fillRect(raster, 122, 60, 1, 60, WHITE);
  return raster;
}

describe('detectBlocksFromImageData hybrid tracing', () => {
  it('detects large separated blocks with simplified luminance contours', () => {
    const raster = makeTripleBlockRaster();
    const detection = detectBlocksFromImageData(raster, 48);
    expect(detection.blocks.length).toBeGreaterThanOrEqual(2);
    for (const block of detection.blocks) {
      expect(block.polygon.length).toBeGreaterThanOrEqual(3);
      expect(block.polygon.length).toBeLessThanOrEqual(14);
    }
  });

  it('detects blocks on a layout with a thin centre strip', () => {
    const raster = makeMicroBlockRaster();
    const detection = detectBlocksFromImageData(raster, 48);
    expect(detection.blocks.length).toBeGreaterThanOrEqual(2);
    expect(detection.notes).toContain('Detected');
  });
});

describe('mergeSplitBlockFragments integration with detection output', () => {
  it('can merge synthetic label-split fragments that share horizontal span', () => {
    const top: MergeableBlockFragment = {
      polygon: [
        { xPct: 10, yPct: 10 },
        { xPct: 90, yPct: 10 },
        { xPct: 90, yPct: 40 },
        { xPct: 10, yPct: 40 },
      ],
      cxPct: 50,
      cyPct: 25,
      fillColor: '#782832',
      meanRadius: 40,
      pixelArea: 4000,
      minX: 20,
      minY: 20,
      maxX: 180,
      maxY: 52,
    };
    const bottom: MergeableBlockFragment = {
      polygon: [
        { xPct: 10, yPct: 50 },
        { xPct: 90, yPct: 50 },
        { xPct: 90, yPct: 83 },
        { xPct: 10, yPct: 83 },
      ],
      cxPct: 50,
      cyPct: 66,
      fillColor: '#782832',
      meanRadius: 40,
      pixelArea: 4800,
      minX: 20,
      minY: 60,
      maxX: 180,
      maxY: 100,
    };
    const merged = mergeSplitBlockFragments([top, bottom], {
      width: 200,
      height: 120,
      gapPx: 12,
      medianArea: 12800,
    });
    expect(merged.length).toBe(1);
  });
});
