import { describe, expect, it } from 'vitest';

import {
  clampDiningTableMixCounts,
  computeDiningTableMixCapacity,
  type DiningTableMixEntry,
  type DiningTableMixSharedOptions,
} from './dining-table-mix';
import type { CenterpieceElement } from '../models/layout-element.model';

function block(): CenterpieceElement {
  return {
    id: 'block-1',
    shape: 'custom',
    position: { xPct: 50, yPct: 50 },
    size: { wPct: 40, hPct: 40 },
    customPoints: [
      { xPct: 0, yPct: 0 },
      { xPct: 100, yPct: 0 },
      { xPct: 100, yPct: 100 },
      { xPct: 0, yPct: 100 },
    ],
    blockType: 'dining-table',
    physicalWidthM: 16,
    physicalLengthM: 12,
  } as unknown as CenterpieceElement;
}

const shared: DiningTableMixSharedOptions = {
  gapM: 0.6,
  featureClearanceM: 0.8,
  wallClearanceM: 0.4,
};

function round(count: number): DiningTableMixEntry {
  return {
    shape: 'round',
    widthM: 1.2,
    depthM: 1.2,
    seats: 6,
    chairWidthM: 0.45,
    chairLengthM: 0.5,
    count,
  };
}

function rectangular(count: number): DiningTableMixEntry {
  return {
    shape: 'rectangular',
    widthM: 1.7,
    depthM: 0.8,
    seats: 4,
    chairWidthM: 0.45,
    chairLengthM: 0.5,
    count,
  };
}

describe('computeDiningTableMixCapacity', () => {
  it('gives a single lane the whole block', () => {
    const capacity = computeDiningTableMixCapacity(block(), [round(0)], shared);
    const lane = capacity.shapes[0]!;
    expect(lane.soloMaxCount).toBeGreaterThan(0);
    expect(lane.maxCount).toBe(lane.soloMaxCount);
  });

  it('lowers one lane ceiling as the other lane grows', () => {
    const el = block();
    const soloRect = computeDiningTableMixCapacity(el, [rectangular(0)], shared).shapes[0]!
      .soloMaxCount;

    const few = computeDiningTableMixCapacity(el, [round(2), rectangular(0)], shared);
    const many = computeDiningTableMixCapacity(el, [round(8), rectangular(0)], shared);

    const rectWithFew = few.shapes[1]!.maxCount;
    const rectWithMany = many.shapes[1]!.maxCount;
    expect(rectWithFew).toBeLessThan(soloRect);
    expect(rectWithMany).toBeLessThan(rectWithFew);
  });

  it('hands the space back when a lane count drops again', () => {
    const el = block();
    const raised = computeDiningTableMixCapacity(el, [round(8), rectangular(0)], shared);
    const lowered = computeDiningTableMixCapacity(el, [round(2), rectangular(0)], shared);
    expect(lowered.shapes[1]!.maxCount).toBeGreaterThan(raised.shapes[1]!.maxCount);
  });

  it('reports the mix as not fitting once the lanes exceed the block', () => {
    const el = block();
    const soloRound = computeDiningTableMixCapacity(el, [round(0)], shared).shapes[0]!.soloMaxCount;
    const capacity = computeDiningTableMixCapacity(
      el,
      [round(soloRound), rectangular(4)],
      shared,
    );
    expect(capacity.fits).toBe(false);
    expect(capacity.shapes[1]!.overBudget).toBe(true);
  });

  it('totals counts and seats across lanes', () => {
    const capacity = computeDiningTableMixCapacity(block(), [round(3), rectangular(2)], shared);
    expect(capacity.totalCount).toBe(5);
    expect(capacity.totalSeats).toBe(3 * 6 + 2 * 4);
  });
});

describe('clampDiningTableMixCounts', () => {
  it('leaves a mix that already fits untouched', () => {
    const entries = [round(2), rectangular(2)];
    expect(clampDiningTableMixCounts(block(), entries, shared)).toEqual(entries);
  });

  it('reduces the other lane and protects the one being edited', () => {
    const el = block();
    const soloRound = computeDiningTableMixCapacity(el, [round(0)], shared).shapes[0]!.soloMaxCount;
    const clamped = clampDiningTableMixCounts(
      el,
      [round(soloRound), rectangular(6)],
      shared,
      'round',
    );
    expect(clamped[0]!.count).toBe(soloRound);
    expect(clamped[1]!.count).toBeLessThan(6);
    expect(computeDiningTableMixCapacity(el, clamped, shared).fits).toBe(true);
  });
});
