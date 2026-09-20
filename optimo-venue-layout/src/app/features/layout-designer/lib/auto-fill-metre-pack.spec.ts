import { describe, expect, it } from 'vitest';

import type { CenterpieceElement } from '../models/layout-element.model';
import {
  createArrangeByRowGridSeating,
  estimateArrangeByRowCapacity,
} from './drag-seats';

const CHAIR = {
  physicalLengthM: 30,
  physicalWidthM: 30,
  chairWidthM: 0.45,
  chairLengthM: 0.5,
  seatGapM: 0.061,
  rowGapM: 0.062,
  borderGapM: 0,
};

/** Small on-canvas block — the old 6px pitch floor made 30m and 100m identical. */
const SMALL_RECT = { x: 0, y: 0, width: 90, height: 90, cx: 45, cy: 45 };

function seatingBlock(sideM: number): CenterpieceElement {
  const sides = [sideM, sideM, sideM, sideM];
  return {
    id: 'blk-136',
    type: 'centerpiece',
    name: '136',
    code: '136',
    shape: 'custom',
    label: '136',
    curveDeg: 0,
    blockType: 'seating',
    customPoints: [
      { xPct: 0, yPct: 0 },
      { xPct: 100, yPct: 0 },
      { xPct: 100, yPct: 100 },
      { xPct: 0, yPct: 100 },
    ],
    position: { xPct: 50, yPct: 50 },
    size: { wPct: 8, hPct: 8 },
    rotation: 0,
    style: { fillColor: '#fff', strokeColor: '#000', labelColor: '#000' },
    customSideLengthsM: sides,
  };
}

function pack(sideM: number) {
  const el = seatingBlock(sideM);
  const sides = [sideM, sideM, sideM, sideM];
  const cap = estimateArrangeByRowCapacity(el, SMALL_RECT, sides, CHAIR, 0, 90);
  return {
    cap,
    result: createArrangeByRowGridSeating(
      el,
      SMALL_RECT,
      sides,
      ['Side 1', 'Side 2', 'Side 3', 'Side 4'],
      CHAIR,
      0,
      cap.maxRows,
      undefined,
      90,
    ),
  };
}

describe('Auto Fill packs from metres, not a 6px canvas floor', () => {
  it('100m sides fit far more seats than 30m sides on the same drawn block', () => {
    const at30 = pack(30);
    const at100 = pack(100);

    expect('error' in at30.result).toBe(false);
    expect('error' in at100.result).toBe(false);
    if ('error' in at30.result || 'error' in at100.result) {
      return;
    }

    const seats30 = Object.keys(at30.result.patch.seatPositionOverrides ?? {}).length;
    const seats100 = Object.keys(at100.result.patch.seatPositionOverrides ?? {}).length;

    // Physical scale is ~3.3×; even with row/column rounding it must not match.
    expect(seats100).toBeGreaterThan(Math.round(seats30 * 2.5));
    expect(at100.cap.maxRows).toBeGreaterThan(at30.cap.maxRows);
    expect(at100.cap.maxSeatsPerRow).toBeGreaterThan(at30.cap.maxSeatsPerRow);
  });

  it('fills the block depth instead of leaving an empty strip at the back', () => {
    const at65 = pack(65);
    expect('error' in at65.result).toBe(false);
    if ('error' in at65.result) {
      return;
    }
    const seats = Object.values(at65.result.patch.seatPositionOverrides ?? {});
    expect(seats.length).toBeGreaterThan(100);
    // 65m @ ~0.56m row pitch needs >100 rows — the old MAX_ROWS=100 cap
    // truncated them and left ~40% of the block empty.
    expect(at65.result.patch.seatLayout?.rows ?? 0).toBeGreaterThan(100);
    const yPcts = seats.map((s) => s.yPct);
    const spanY = Math.max(...yPcts) - Math.min(...yPcts);
    expect(spanY).toBeGreaterThan(85);
  });
});
