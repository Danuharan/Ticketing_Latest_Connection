import { describe, expect, it } from 'vitest';

import { buildDiningTableChairArcs } from './dining-table-icon';

describe('buildDiningTableChairArcs measured chairs', () => {
  it('sizes and places chairs from real width/depth metres (via px)', () => {
    const tablePx = 100; // 1.0 m at 100 px/m
    const chairWidthPx = 45; // 0.45 m
    const chairDepthPx = 50; // 0.50 m

    const icon = buildDiningTableChairArcs(
      'round',
      tablePx,
      tablePx,
      4,
      undefined,
      undefined,
      { widthPx: chairWidthPx, depthPx: chairDepthPx },
    );

    expect(icon.chairHalfWidthPx).toBeCloseTo(chairWidthPx / 2, 5);
    expect(icon.chairHalfDepthPx).toBeCloseTo(chairDepthPx / 2, 5);
    expect(icon.chairArcs).toHaveLength(4);

    const tableR = tablePx / 2;
    const expectedOrbit = tableR + Math.max(0.5, (chairDepthPx / 2) * 0.08) + chairDepthPx / 2;
    for (const arc of icon.chairArcs) {
      const r = Math.hypot(arc.x, arc.y);
      expect(r).toBeCloseTo(expectedOrbit, 4);
    }
  });

  it('grows chair footprint when width/depth increase', () => {
    const small = buildDiningTableChairArcs('round', 80, 80, 3, undefined, undefined, {
      widthPx: 30,
      depthPx: 30,
    });
    const large = buildDiningTableChairArcs('round', 80, 80, 3, undefined, undefined, {
      widthPx: 60,
      depthPx: 70,
    });
    expect(large.chairHalfWidthPx).toBeGreaterThan(small.chairHalfWidthPx);
    expect(large.chairHalfDepthPx).toBeGreaterThan(small.chairHalfDepthPx);
    const smallOrbit = Math.hypot(small.chairArcs[0].x, small.chairArcs[0].y);
    const largeOrbit = Math.hypot(large.chairArcs[0].x, large.chairArcs[0].y);
    expect(largeOrbit).toBeGreaterThan(smallOrbit);
  });
});
