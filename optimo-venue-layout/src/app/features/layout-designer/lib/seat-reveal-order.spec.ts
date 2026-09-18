import { describe, expect, it } from 'vitest';

import { computeViewpointRevealDelays } from './seat-reveal-order';
import { projectOnViewpointFrame, buildViewpointSeatFrame } from './drag-seats';
import type { CenterpieceElement } from '../models/layout-element.model';
import type { PixelRect } from './geometry';

function makeBlock(overrides: Partial<CenterpieceElement> = {}): CenterpieceElement {
  return {
    id: 'blk-1',
    type: 'centerpiece',
    name: 'Block',
    shape: 'custom',
    label: 'Block',
    curveDeg: 0,
    customPoints: [
      { xPct: 0, yPct: 0 },
      { xPct: 100, yPct: 0 },
      { xPct: 100, yPct: 100 },
      { xPct: 0, yPct: 100 },
    ],
    // Top edge is VIEW POINT (stadium side 0).
    dragSeatsStadiumSideIndex: 0,
    blockViewpointAngleDeg: 0,
    position: { xPct: 50, yPct: 20 },
    size: { wPct: 20, hPct: 15 },
    rotation: 0,
    style: { fillColor: '#fff', strokeColor: '#000', labelColor: '#000' },
    ...overrides,
  };
}

/** Canvas box matching makeBlock on a 1000×700 canvas. */
const RECT: PixelRect = { x: 400, y: 87.5, width: 200, height: 105, cx: 500, cy: 140 };

describe('computeViewpointRevealDelays', () => {
  it('assigns lower delays to seats nearer the VIEW POINT edge', () => {
    const el = makeBlock();
    const vf = buildViewpointSeatFrame(el, RECT);
    expect(vf).not.toBeNull();

    // Scrambled array: back seats first, front seats last.
    const backLeft = { x: RECT.x + 40, y: RECT.y + RECT.height - 20, rowIndex: 2 };
    const backRight = { x: RECT.x + RECT.width - 40, y: RECT.y + RECT.height - 20, rowIndex: 2 };
    const frontLeft = { x: RECT.x + 40, y: RECT.y + 18, rowIndex: 0 };
    const frontRight = { x: RECT.x + RECT.width - 40, y: RECT.y + 18, rowIndex: 0 };
    const mid = { x: RECT.cx, y: RECT.cy, rowIndex: 1 };

    const seats = [backLeft, backRight, mid, frontRight, frontLeft];
    const delays = computeViewpointRevealDelays(seats, el, RECT, {
      maxStaggerMs: 1000,
      stepMs: 4,
    });

    expect(delays).toHaveLength(5);

    const frontDepth = projectOnViewpointFrame(vf!.frame, frontLeft).depth;
    const backDepth = projectOnViewpointFrame(vf!.frame, backLeft).depth;
    expect(frontDepth).toBeLessThan(backDepth);

    // Front seats (indices 3, 4) must fade in before back seats (indices 0, 1).
    expect(Math.max(delays[3], delays[4])).toBeLessThan(Math.min(delays[0], delays[1]));
    // Mid seat between front and back.
    expect(delays[2]).toBeGreaterThan(Math.min(delays[3], delays[4]));
    expect(delays[2]).toBeLessThan(Math.max(delays[0], delays[1]));
  });

  it('keeps delays monotonic for >220 seats (no % 220 wrap)', () => {
    const el = makeBlock();
    const seats = Array.from({ length: 250 }, (_, i) => {
      const row = Math.floor(i / 25);
      const col = i % 25;
      return {
        x: RECT.x + 10 + col * 7,
        y: RECT.y + 10 + row * 9,
        rowIndex: row,
      };
    });

    const delays = computeViewpointRevealDelays(seats, el, RECT, {
      maxStaggerMs: 1000,
      stepMs: 4,
    });

    expect(delays).toHaveLength(250);
    const minDelay = Math.min(...delays);
    const maxDelay = Math.max(...delays);
    expect(minDelay).toBe(0);
    expect(maxDelay).toBeGreaterThan(minDelay);
    // Cap keeps last seat within maxStaggerMs (rounded).
    expect(maxDelay).toBeLessThanOrEqual(1000);

    // First reveal (nearest VP) delay 0; farthest has the largest delay.
    const rankedByDelay = delays
      .map((d, index) => ({ d, index }))
      .sort((a, b) => a.d - b.d || a.index - b.index);
    const first = seats[rankedByDelay[0].index];
    const last = seats[rankedByDelay[rankedByDelay.length - 1].index];
    const vf = buildViewpointSeatFrame(el, RECT)!;
    expect(projectOnViewpointFrame(vf.frame, first).depth).toBeLessThanOrEqual(
      projectOnViewpointFrame(vf.frame, last).depth,
    );
  });

  it('falls back to rowIndex order when VIEW POINT frame is unavailable', () => {
    const el = makeBlock({ customPoints: [{ xPct: 0, yPct: 0 }] }); // < 3 points → no frame
    const seats = [
      { x: 10, y: 10, rowIndex: 2 },
      { x: 20, y: 20, rowIndex: 0 },
      { x: 30, y: 30, rowIndex: 1 },
    ];
    const delays = computeViewpointRevealDelays(seats, el, RECT, { stepMs: 10, maxStaggerMs: 100 });
    // row 0 first, then 1, then 2
    expect(delays[1]).toBeLessThan(delays[2]);
    expect(delays[2]).toBeLessThan(delays[0]);
  });
});
