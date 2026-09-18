import { describe, expect, it } from 'vitest';

import { applyAutoFillToBlock, applyAutoFillToBlocks } from './auto-fill-seating';
import { DEFAULT_AUTO_FILL_SEATING_CONFIG } from '../models/auto-fill-seating.model';
import type { CenterpieceElement } from '../models/layout-element.model';

function block(
  id: string,
  sides: number[],
  sizePct = 8,
): CenterpieceElement {
  return {
    id,
    type: 'centerpiece',
    name: id,
    code: id,
    shape: 'custom',
    label: id,
    curveDeg: 0,
    blockType: 'seating',
    customPoints: [
      { xPct: 0, yPct: 0 },
      { xPct: 100, yPct: 0 },
      { xPct: 100, yPct: 100 },
      { xPct: 0, yPct: 100 },
    ],
    position: { xPct: 50, yPct: 50 },
    size: { wPct: sizePct, hPct: sizePct },
    rotation: 0,
    style: { fillColor: '#fff', strokeColor: '#000', labelColor: '#000' },
    customSideLengthsM: sides,
    physicalLengthM: sides[1],
    physicalWidthM: sides[0],
  };
}

describe('measurement seat scaling', () => {
  const canvas = { width: 2000, height: 1500 };
  const cfg = { ...DEFAULT_AUTO_FILL_SEATING_CONFIG, curveEnabled: false };

  it('adds seats when block side lengths increase on a small blueprint', () => {
    const smallEl = block('small', [10, 8, 10, 8]);
    const mediumEl = block('medium', [20, 16, 20, 16]);
    const largeEl = block('large', [40, 32, 40, 32]);
    const small = applyAutoFillToBlock(smallEl, [smallEl], canvas, cfg);
    const medium = applyAutoFillToBlock(mediumEl, [mediumEl], canvas, cfg);
    const large = applyAutoFillToBlock(largeEl, [largeEl], canvas, cfg);
    expect('error' in small).toBe(false);
    expect('error' in medium).toBe(false);
    expect('error' in large).toBe(false);
    if ('error' in small || 'error' in medium || 'error' in large) {
      return;
    }
    expect(medium.seatCount).toBeGreaterThan(small.seatCount);
    // Very large metres on the same outline can hit a packing ceiling; still
    // must never produce fewer seats than a shorter-measurement block.
    expect(large.seatCount).toBeGreaterThanOrEqual(medium.seatCount);
  });

  it('packs each selected block from its own measurements, not a shared template count', () => {
    const small = block('small', [10, 8, 10, 8], 8);
    const large = block('large', [40, 32, 40, 32], 8);
    const batch = applyAutoFillToBlocks([small, large], [small, large], canvas, {
      ...cfg,
      // Shared reference config must not force both blocks to the same seat count.
      referenceBlockId: 'large',
      referenceBaselineSideLengthsM: [10, 8, 10, 8],
      referenceSideLengthsM: [40, 32, 40, 32],
      applyBlockMeasurementScale: true,
      blockMeasurementBaselines: {
        small: [10, 8, 10, 8],
        large: [10, 8, 10, 8],
      },
    });
    expect(batch.successCount).toBe(2);
    const smallResult = batch.results.find((r) => r.elementId === 'small');
    const largeResult = batch.results.find((r) => r.elementId === 'large');
    expect(smallResult?.success).toBe(true);
    expect(largeResult?.success).toBe(true);
    expect(largeResult!.seatCount!).toBeGreaterThan(smallResult!.seatCount!);
  });
});
