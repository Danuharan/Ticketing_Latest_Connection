import { describe, expect, it } from 'vitest';

import type { CenterpieceElement, ElementPosition } from '../models/layout-element.model';
import { rectFromPositionSize } from './geometry';
import {
  blockMetresFromSideLengths,
  pxPerMeter,
  resolveBlockLengthM,
  resolveBlockWidthM,
} from './physical-dims';

const CANVAS = { width: 1000, height: 700 };

const RECT_POINTS: ElementPosition[] = [
  { xPct: 0, yPct: 0 },
  { xPct: 100, yPct: 0 },
  { xPct: 100, yPct: 100 },
  { xPct: 0, yPct: 100 },
];

/** Drawn box shaped like a 4 m × 2.32 m room. */
function rectBlock(): CenterpieceElement {
  return {
    id: 'block-42',
    shape: 'custom',
    position: { xPct: 50, yPct: 50 },
    size: { wPct: 40, hPct: 33.14 },
    customPoints: RECT_POINTS,
    blockType: 'dining-table',
  } as unknown as CenterpieceElement;
}

describe('blockMetresFromSideLengths', () => {
  it('reads width from the horizontal sides and depth from the vertical sides', () => {
    const el = rectBlock();
    const rect = rectFromPositionSize(el.position, el.size, CANVAS);

    const dims = blockMetresFromSideLengths(el.customPoints, [4, 2.32, 4, 2.32], rect);

    expect(dims).toEqual({ physicalLengthM: 2.32, physicalWidthM: 4 });
  });

  it('gives a canvas scale that draws a 3 m stage across most of a 4 m wall', () => {
    const el = rectBlock();
    const rect = rectFromPositionSize(el.position, el.size, CANVAS);
    const dims = blockMetresFromSideLengths(el.customPoints, [4, 2.32, 4, 2.32], rect)!;

    const ppm = pxPerMeter(rect, dims.physicalLengthM, dims.physicalWidthM);

    expect(3 * ppm).toBeGreaterThan(rect.width * 0.7);
  });

  it('returns null while a side is still unmeasured so the previous dimensions survive', () => {
    const el = rectBlock();
    const rect = rectFromPositionSize(el.position, el.size, CANVAS);

    expect(blockMetresFromSideLengths(el.customPoints, [4, 0, 4, 2.32], rect)).toBeNull();
    expect(blockMetresFromSideLengths(el.customPoints, [4, 2.32], rect)).toBeNull();
    expect(blockMetresFromSideLengths(undefined, [4, 2.32, 4, 2.32], rect)).toBeNull();
  });
});

describe('resolveBlockLengthM / resolveBlockWidthM', () => {
  it('uses measured sides even when the stored physical dims are still the 10×8 default', () => {
    const el = {
      ...rectBlock(),
      customSideLengthsM: [4, 2.32, 4, 2.32],
      physicalLengthM: 10,
      physicalWidthM: 8,
    } as CenterpieceElement;

    expect(resolveBlockWidthM(el)).toBe(4);
    expect(resolveBlockLengthM(el)).toBe(2.32);
  });

  it('falls back to stored physical dims when sides are not fully measured', () => {
    const el = {
      ...rectBlock(),
      customSideLengthsM: [4, 0, 4, 2.32],
      physicalLengthM: 10,
      physicalWidthM: 8,
    } as CenterpieceElement;

    expect(resolveBlockWidthM(el)).toBe(8);
    expect(resolveBlockLengthM(el)).toBe(10);
  });
});
