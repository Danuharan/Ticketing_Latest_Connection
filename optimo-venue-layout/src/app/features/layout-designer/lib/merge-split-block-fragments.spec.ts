import { describe, expect, it } from 'vitest';

import {
  bboxOverlapFraction,
  mergeSplitBlockFragments,
  type MergeableBlockFragment,
} from './merge-split-block-fragments';

function fragment(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  fillColor = '#782832',
  width = 400,
  height = 400,
): MergeableBlockFragment {
  const polygon = [
    { xPct: (minX / width) * 100, yPct: (minY / height) * 100 },
    { xPct: (maxX / width) * 100, yPct: (minY / height) * 100 },
    { xPct: (maxX / width) * 100, yPct: (maxY / height) * 100 },
    { xPct: (minX / width) * 100, yPct: (maxY / height) * 100 },
  ];
  return {
    polygon,
    cxPct: ((minX + maxX) / 2 / width) * 100,
    cyPct: ((minY + maxY) / 2 / height) * 100,
    fillColor,
    meanRadius: 50,
    pixelArea: (maxX - minX) * (maxY - minY),
    minX,
    minY,
    maxX,
    maxY,
  };
}

describe('bboxOverlapFraction', () => {
  it('returns 1 when boxes are identical', () => {
    const a = fragment(10, 10, 50, 50);
    expect(bboxOverlapFraction(a, a)).toBe(1);
  });
});

describe('mergeSplitBlockFragments', () => {
  it('merges top/bottom fragments split by a horizontal label stripe', () => {
    const top = fragment(20, 20, 180, 52, '#782832', 200, 120);
    const bottom = fragment(20, 60, 180, 100, '#782832', 200, 120);
    const medianArea = 160 * 80;
    const merged = mergeSplitBlockFragments([top, bottom], {
      width: 200,
      height: 120,
      gapPx: 12,
      medianArea,
    });
    expect(merged.length).toBe(1);
    expect(merged[0].minY).toBeLessThanOrEqual(20);
    expect(merged[0].maxY).toBeGreaterThanOrEqual(100);
  });

  it('does not merge two full-size neighbours in the same row', () => {
    const left = fragment(40, 320, 129, 380);
    const right = fragment(131, 320, 220, 380);
    const medianArea = 90 * 60;
    const merged = mergeSplitBlockFragments([left, right], {
      width: 400,
      height: 400,
      gapPx: 4,
      medianArea,
    });
    expect(merged.length).toBe(2);
  });

  it('does not merge different colours', () => {
    const a = fragment(40, 320, 129, 380, '#782832');
    const b = fragment(131, 320, 220, 380, '#2244aa');
    const merged = mergeSplitBlockFragments([a, b], { width: 400, height: 400 });
    expect(merged.length).toBe(2);
  });

  it('does not merge distant fragments', () => {
    const a = fragment(40, 320, 90, 380);
    const b = fragment(200, 320, 260, 380);
    const merged = mergeSplitBlockFragments([a, b], { width: 400, height: 400, gapPx: 4 });
    expect(merged.length).toBe(2);
  });

  it('does not merge a B-ring block with an adjacent micro column', () => {
    const bBlock = fragment(80, 200, 170, 260, '#c8a050', 400, 400);
    const microColumn = fragment(72, 200, 78, 260, '#c8a050', 400, 400);
    const medianArea = 90 * 60;
    const merged = mergeSplitBlockFragments([bBlock, microColumn], {
      width: 400,
      height: 400,
      gapPx: 4,
      medianArea,
    });
    expect(merged.length).toBe(2);
  });

  it('does not merge stacked micro blocks in a vertical column', () => {
    const blocks = [110, 118, 126, 134, 142, 150].map((y) =>
      fragment(200, y, 208, y + 7, '#c8a050', 400, 400),
    );
    const medianArea = 90 * 60;
    const merged = mergeSplitBlockFragments(blocks, {
      width: 400,
      height: 400,
      gapPx: 4,
      medianArea,
    });
    expect(merged.length).toBe(blocks.length);
  });
});
