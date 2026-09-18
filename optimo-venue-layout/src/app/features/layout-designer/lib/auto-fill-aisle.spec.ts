import { describe, expect, it } from 'vitest';

import {
  parseAisleColumnIndices,
  parseAisleRowIndices,
  resolveAutoFillAislePlacement,
  validateAutoFillAisleRules,
} from './auto-fill-seating';
import { createArrangeByRowGridSeating } from './drag-seats';
import { rowLabel, rowLabelToIndex } from './seat-layout';
import type { CenterpieceElement } from '../models/layout-element.model';
import {
  autoFillAislesEqual,
  autoFillSeatingPatchIsNoop,
  createDefaultAisleSlot,
  DEFAULT_AUTO_FILL_SEATING_CONFIG,
  normalizeAutoFillAisles,
} from '../models/auto-fill-seating.model';

describe('rowLabelToIndex', () => {
  it('round-trips letter labels', () => {
    for (let i = 0; i < 40; i += 1) {
      expect(rowLabelToIndex(rowLabel(i, 'letter'))).toBe(i);
    }
  });
});

describe('parseAisleRowIndices', () => {
  it('parses comma-separated row letters', () => {
    expect(parseAisleRowIndices('C')).toEqual([2]);
    expect(parseAisleRowIndices('c, E')).toEqual([2, 4]);
  });
});

describe('parseAisleColumnIndices', () => {
  it('parses 1-based columns into 0-based indices', () => {
    expect(parseAisleColumnIndices('1')).toEqual([0]);
    expect(parseAisleColumnIndices('1, 5')).toEqual([0, 4]);
  });
});

describe('normalizeAutoFillAisles', () => {
  it('starts empty and keeps a dynamic list', () => {
    expect(normalizeAutoFillAisles([])).toEqual([]);
    expect(normalizeAutoFillAisles(undefined, { aislePlacementMode: 'none' })).toEqual([]);
    expect(normalizeAutoFillAisles([createDefaultAisleSlot('column')])).toHaveLength(1);
  });

  it('keeps aisle ids stable across repeated normalize calls', () => {
    const raw = [{ type: 'row' as const, rows: 'C', widthM: 1.2 }];
    const first = normalizeAutoFillAisles(raw);
    const second = normalizeAutoFillAisles(raw);
    expect(first[0].id).toBe('aisle-0');
    expect(second[0].id).toBe(first[0].id);
    expect(autoFillAislesEqual(first, second)).toBe(true);
  });
});

describe('autoFillSeatingPatchIsNoop', () => {
  it('ignores Auto Fill setting patches that do not change values', () => {
    const current = {
      ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
      chairWidthM: 0.5,
      aisleWidthM: 1,
      curveDeg: 6,
      aisles: [{ id: 'aisle-0', type: 'row' as const, rows: 'C', widthM: 1.2 }],
    };
    expect(autoFillSeatingPatchIsNoop(current, { chairWidthM: 0.5 })).toBe(true);
    expect(autoFillSeatingPatchIsNoop(current, { chairWidthM: 0.6 })).toBe(false);
    expect(
      autoFillSeatingPatchIsNoop(current, {
        aisles: [{ id: 'aisle-0', type: 'row', rows: 'C', widthM: 1.2 }],
      }),
    ).toBe(true);
    expect(
      autoFillSeatingPatchIsNoop(current, {
        aisles: [{ id: 'aisle-0', type: 'row', rows: 'C', widthM: 1.5 }],
      }),
    ).toBe(false);
  });
});

describe('resolveAutoFillAislePlacement', () => {
  it('merges multiple added aisles (row + column)', () => {
    expect(
      resolveAutoFillAislePlacement({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        aisles: [
          { type: 'row', rows: 'C', widthM: 2 },
          { type: 'column', columns: '1, 5', widthM: 1.5 },
        ],
      }),
    ).toMatchObject({
      aisleRowIndices: [2],
      aisleColumnIndices: [0, 4],
      rowAisleWidthM: 2,
      columnAisleWidthM: 1.5,
    });
  });

  it('counts multiple center aisles for even short-side splits', () => {
    expect(
      resolveAutoFillAislePlacement({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        aisles: [
          { type: 'center', widthM: 2, centerAxis: 'column' },
          { type: 'center', widthM: 1.5, centerAxis: 'column' },
        ],
      }),
    ).toMatchObject({
      centerAisle: true,
      centerColumnAisleWidthsM: [2, 1.5],
    });
  });

  it('respects center row vs column tick', () => {
    expect(
      resolveAutoFillAislePlacement({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        aisles: [
          { type: 'center', widthM: 2, centerAxis: 'row' },
          { type: 'center', widthM: 1, centerAxis: 'column' },
        ],
      }),
    ).toMatchObject({
      centerAisle: true,
      centerRowAisleWidthsM: [2],
      centerColumnAisleWidthsM: [1],
    });
  });

  it('supports center plus another aisle', () => {
    expect(
      resolveAutoFillAislePlacement({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        aisles: [
          { type: 'center', widthM: 2, centerAxis: 'column' },
          { type: 'row', rows: 'E', widthM: 1 },
        ],
      }),
    ).toMatchObject({
      aisleRowIndices: [4],
      centerAisle: true,
      centerColumnAisleWidthsM: [2],
    });
  });

  it('keeps row + column + center column together', () => {
    expect(
      resolveAutoFillAislePlacement({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        aisles: [
          { type: 'row', rows: 'D', widthM: 1.5 },
          { type: 'column', columns: '3', widthM: 1.2 },
          { type: 'center', widthM: 2, centerAxis: 'column' },
        ],
      }),
    ).toMatchObject({
      aisleRowIndices: [3],
      aisleColumnIndices: [2],
      rowAisleWidthM: 1.5,
      columnAisleWidthM: 1.2,
      centerAisle: true,
      centerColumnAisleWidthsM: [2],
    });
  });

  it('returns undefined when no aisles are added', () => {
    expect(
      resolveAutoFillAislePlacement({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        aisles: [],
      }),
    ).toBeUndefined();
  });

  it('requires complete aisle rules before create seats', () => {
    expect(
      validateAutoFillAisleRules({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        aisles: [{ type: 'row', rows: '', widthM: 1 }],
      }),
    ).toContain('row letters');
    expect(
      validateAutoFillAisleRules({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        aisles: [{ type: 'column', columns: '1', widthM: 1.2 }],
      }),
    ).toBeNull();
    expect(
      validateAutoFillAisleRules({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        aisles: [],
      }),
    ).toBeNull();
    expect(
      validateAutoFillAisleRules({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        aisles: [{ type: 'draw', widthM: 1 }],
      }),
    ).toBeNull();
    expect(
      validateAutoFillAisleRules({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        aisles: [
          {
            type: 'draw',
            widthM: 1.2,
            drawStart: { xPct: 10, yPct: 50 },
            drawEnd: { xPct: 90, yPct: 50 },
          },
        ],
      }),
    ).toBeNull();
  });

  it('resolves a drawn two-point aisle', () => {
    expect(
      resolveAutoFillAislePlacement({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        aisles: [
          {
            type: 'draw',
            widthM: 1.5,
            drawStart: { xPct: 20, yPct: 10 },
            drawEnd: { xPct: 20, yPct: 90 },
          },
        ],
      }),
    ).toMatchObject({
      drawnAisles: [
        {
          widthM: 1.5,
          start: { xPct: 20, yPct: 10 },
          end: { xPct: 20, yPct: 90 },
        },
      ],
    });
  });
});

function countLargeGaps(values: number[], typicalStep: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  let count = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - 1] > typicalStep * 1.75) {
      count += 1;
    }
  }
  return count;
}

function seatsByRow(
  overrides: Record<string, { xPct: number; yPct: number }>,
): Map<string, { xPct: number; yPct: number }[]> {
  const byRow = new Map<string, { xPct: number; yPct: number }[]>();
  for (const [id, pos] of Object.entries(overrides)) {
    const match = id.match(/^([A-Z]+)\d+$/i);
    const row = match?.[1]?.toUpperCase() ?? id;
    const list = byRow.get(row) ?? [];
    list.push(pos);
    byRow.set(row, list);
  }
  for (const list of byRow.values()) {
    list.sort((a, b) => a.xPct - b.xPct || a.yPct - b.yPct);
  }
  return byRow;
}

describe('create seats applies every aisle input together', () => {
  const rect = { x: 0, y: 0, width: 800, height: 600, cx: 400, cy: 300 };
  const sideLengthsM = [20, 15, 20, 15];
  const dims = {
    physicalLengthM: 15,
    physicalWidthM: 20,
    chairWidthM: 0.45,
    chairLengthM: 0.45,
    seatGapM: 0.05,
    rowGapM: 0.05,
    borderGapM: 0,
  };

  function block(): CenterpieceElement {
    return {
      id: 'blk-aisle',
      type: 'centerpiece',
      name: 'TEST',
      code: 'TEST',
      shape: 'custom',
      label: 'TEST',
      curveDeg: 0,
      customPoints: [
        { xPct: 0, yPct: 0 },
        { xPct: 100, yPct: 0 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
      position: { xPct: 50, yPct: 50 },
      size: { wPct: 40, hPct: 40 },
      rotation: 0,
      style: { fillColor: '#fff', strokeColor: '#000', labelColor: '#000' },
      customSideLengthsM: sideLengthsM,
    };
  }

  function place(aislePlacement?: Parameters<typeof createArrangeByRowGridSeating>[10]) {
    return createArrangeByRowGridSeating(
      block(),
      rect,
      sideLengthsM,
      ['Front', 'Right', 'Back', 'Left'],
      dims,
      0,
      12,
      undefined,
      90,
      undefined,
      aislePlacement,
    );
  }

  it('center column aisle is a straight walkway and seats pack leftover space', () => {
    const baseline = place();
    expect('error' in baseline).toBe(false);
    if ('error' in baseline) {
      return;
    }
    const centered = place({
      centerAisle: true,
      centerColumnAisleWidthsM: [2],
    });
    expect('error' in centered).toBe(false);
    if ('error' in centered) {
      return;
    }

    const baseSeats = Object.values(baseline.patch.seatPositionOverrides ?? {});
    const centeredSeats = Object.values(centered.patch.seatPositionOverrides ?? {});
    expect(centeredSeats.length).toBeGreaterThan(0);
    expect(centeredSeats.length).toBeLessThan(baseSeats.length);

    const alongOf = (seats: { xPct: number; yPct: number }[]) => {
      const xs = seats.map((s) => s.xPct);
      const ys = seats.map((s) => s.yPct);
      const xSpan = Math.max(...xs) - Math.min(...xs);
      const ySpan = Math.max(...ys) - Math.min(...ys);
      return ySpan >= xSpan ? ys : xs;
    };
    const byRow = seatsByRow(centered.patch.seatPositionOverrides ?? {});
    const gapMids: number[] = [];
    let rowsWithBothSides = 0;
    for (const seats of byRow.values()) {
      if (seats.length < 4) {
        continue;
      }
      const alongs = alongOf(seats).sort((a, b) => a - b);
      let maxGap = 0;
      let gapAt = 0;
      for (let i = 1; i < alongs.length; i += 1) {
        const gap = alongs[i] - alongs[i - 1];
        if (gap > maxGap) {
          maxGap = gap;
          gapAt = i;
        }
      }
      const typical =
        (alongs[alongs.length - 1] - alongs[0]) / Math.max(1, alongs.length - 1);
      if (maxGap > typical * 1.8) {
        gapMids.push((alongs[gapAt - 1] + alongs[gapAt]) / 2);
        if (gapAt >= 2 && alongs.length - gapAt >= 2) {
          rowsWithBothSides += 1;
        }
      }
    }
    expect(gapMids.length).toBeGreaterThan(2);
    expect(rowsWithBothSides).toBeGreaterThan(2);
    const avgMid = gapMids.reduce((sum, v) => sum + v, 0) / gapMids.length;
    expect(gapMids.every((mid) => Math.abs(mid - avgMid) < 8)).toBe(true);
  });

  it('center column aisle lines up with the VIEW POINT row chair centre', () => {
    const wedge = {
      ...block(),
      id: 'blk-wedge',
      customPoints: [
        { xPct: 0, yPct: 0 },
        { xPct: 40, yPct: 0 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
    };
    const baseline = createArrangeByRowGridSeating(
      wedge,
      rect,
      sideLengthsM,
      ['Front', 'Right', 'Back', 'Left'],
      dims,
      0,
      10,
      undefined,
      90,
    );
    expect('error' in baseline).toBe(false);
    if ('error' in baseline) {
      return;
    }
    const centered = createArrangeByRowGridSeating(
      wedge,
      rect,
      sideLengthsM,
      ['Front', 'Right', 'Back', 'Left'],
      dims,
      0,
      10,
      undefined,
      90,
      undefined,
      { centerAisle: true, centerColumnAisleWidthsM: [2] },
    );
    expect('error' in centered).toBe(false);
    if ('error' in centered) {
      return;
    }
    const frontRow = [...seatsByRow(baseline.patch.seatPositionOverrides ?? {}).values()][0] ?? [];
    expect(frontRow.length).toBeGreaterThan(2);
    const frontXs = frontRow.map((s) => s.xPct).sort((a, b) => a - b);
    const frontChairMid = (frontXs[0] + frontXs[frontXs.length - 1]) / 2;
    const blockMid = 50;

    const aisledFront = [...seatsByRow(centered.patch.seatPositionOverrides ?? {}).values()][0] ?? [];
    const aisledXs = aisledFront.map((s) => s.xPct).sort((a, b) => a - b);
    let maxGap = 0;
    let gapMid = frontChairMid;
    for (let i = 1; i < aisledXs.length; i += 1) {
      const gap = aisledXs[i] - aisledXs[i - 1];
      if (gap > maxGap) {
        maxGap = gap;
        gapMid = (aisledXs[i - 1] + aisledXs[i]) / 2;
      }
    }
    expect(Math.abs(gapMid - frontChairMid)).toBeLessThan(Math.abs(gapMid - blockMid));
    expect(Math.abs(gapMid - frontChairMid)).toBeLessThan(8);

    const aisledRows = [...seatsByRow(centered.patch.seatPositionOverrides ?? {}).values()];
    const aisledBack = aisledRows[aisledRows.length - 1] ?? [];
    const backXs = aisledBack.map((s) => s.xPct).sort((a, b) => a - b);
    let backMaxGap = 0;
    let backGapMid = blockMid;
    for (let i = 1; i < backXs.length; i += 1) {
      const gap = backXs[i] - backXs[i - 1];
      if (gap > backMaxGap) {
        backMaxGap = gap;
        backGapMid = (backXs[i - 1] + backXs[i]) / 2;
      }
    }
    expect(Math.abs(backGapMid - blockMid)).toBeLessThan(Math.abs(backGapMid - frontChairMid));
    expect(Math.abs(backGapMid - blockMid)).toBeLessThan(12);
  });

  it('center column aisle ends between two opposite sides', () => {
    const peaked = {
      ...block(),
      id: 'blk-two-back-sides',
      customPoints: [
        { xPct: 0, yPct: 0 },
        { xPct: 100, yPct: 0 },
        { xPct: 100, yPct: 55 },
        { xPct: 50, yPct: 100 },
        { xPct: 0, yPct: 55 },
      ],
    };
    const centered = createArrangeByRowGridSeating(
      peaked,
      rect,
      [20, 8, 12, 12, 8],
      ['Front', 'Right', 'BackR', 'BackL', 'Left'],
      dims,
      0,
      10,
      undefined,
      0,
      undefined,
      { centerAisle: true, centerColumnAisleWidthsM: [2] },
    );
    expect('error' in centered).toBe(false);
    if ('error' in centered) {
      return;
    }
    const rows = [...seatsByRow(centered.patch.seatPositionOverrides ?? {}).values()];
    const betweenSides = 50;
    const oneRoofMid = 75;
    const aisleGaps: number[] = [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const seats = rows[i] ?? [];
      if (seats.length < 4) {
        continue;
      }
      const xs = seats.map((s) => s.xPct).sort((a, b) => a - b);
      const typical = (xs[xs.length - 1] - xs[0]) / Math.max(1, xs.length - 1);
      let maxGap = 0;
      let mid = 0;
      for (let g = 1; g < xs.length; g += 1) {
        const gap = xs[g] - xs[g - 1];
        if (gap > maxGap) {
          maxGap = gap;
          mid = (xs[g - 1] + xs[g]) / 2;
        }
      }
      if (maxGap > typical * 1.8) {
        aisleGaps.push(mid);
      }
    }
    expect(aisleGaps.length).toBeGreaterThan(0);
    const gapMid = aisleGaps[0];
    expect(Math.abs(gapMid - betweenSides)).toBeLessThan(Math.abs(gapMid - oneRoofMid));
    expect(Math.abs(gapMid - betweenSides)).toBeLessThan(10);
  });

  it('center column aisle ends at the middle of three opposite sides', () => {
    const threeBack = {
      ...block(),
      id: 'blk-three-back-sides',
      customPoints: [
        { xPct: 0, yPct: 0 },
        { xPct: 100, yPct: 0 },
        { xPct: 100, yPct: 85 },
        { xPct: 85, yPct: 100 },
        { xPct: 45, yPct: 100 },
        { xPct: 0, yPct: 85 },
      ],
    };
    const centered = createArrangeByRowGridSeating(
      threeBack,
      rect,
      [20, 12, 6, 10, 8, 12],
      ['Front', 'Right', 'ChamferR', 'Back', 'ChamferL', 'Left'],
      dims,
      0,
      10,
      undefined,
      0,
      undefined,
      { centerAisle: true, centerColumnAisleWidthsM: [1.5] },
    );
    expect('error' in centered).toBe(false);
    if ('error' in centered) {
      return;
    }
    const rows = [...seatsByRow(centered.patch.seatPositionOverrides ?? {}).values()];
    const viewpointCenter = 50;
    const middleSideCenter = 65;
    const rightChamferMid = 92.5;
    const aisleSamples: { y: number; gapMid: number }[] = [];
    for (const seats of rows) {
      if (seats.length < 4) {
        continue;
      }
      const xs = seats.map((s) => s.xPct).sort((a, b) => a - b);
      const typical = (xs[xs.length - 1] - xs[0]) / Math.max(1, xs.length - 1);
      let maxGap = 0;
      let mid = 0;
      for (let g = 1; g < xs.length; g += 1) {
        const gap = xs[g] - xs[g - 1];
        if (gap > maxGap) {
          maxGap = gap;
          mid = (xs[g - 1] + xs[g]) / 2;
        }
      }
      if (maxGap > typical * 1.8) {
        const y = seats.reduce((sum, s) => sum + s.yPct, 0) / seats.length;
        aisleSamples.push({ y, gapMid: mid });
      }
    }
    expect(aisleSamples.length).toBeGreaterThan(2);
    aisleSamples.sort((a, b) => a.y - b.y);
    const back = aisleSamples[aisleSamples.length - 1];
    const expected = viewpointCenter + (middleSideCenter - viewpointCenter) * (back.y / 100);
    expect(Math.abs(back.gapMid - expected)).toBeLessThan(4);
    expect(Math.abs(back.gapMid - expected)).toBeLessThan(Math.abs(back.gapMid - rightChamferMid));
    expect(back.gapMid).toBeGreaterThan(aisleSamples[0].gapMid + 1);
  });

  it('center column aisle even opposite-side count ends between the middle two sides', () => {
    const fourBack = {
      ...block(),
      id: 'blk-four-back-sides',
      customPoints: [
        { xPct: 0, yPct: 0 },
        { xPct: 100, yPct: 0 },
        { xPct: 100, yPct: 88 },
        { xPct: 80, yPct: 100 },
        { xPct: 60, yPct: 88 },
        { xPct: 40, yPct: 100 },
        { xPct: 0, yPct: 88 },
      ],
    };
    const centered = createArrangeByRowGridSeating(
      fourBack,
      rect,
      [20, 12, 6, 8, 8, 8, 12],
      ['Front', 'Right', 'A', 'B', 'C', 'D', 'Left'],
      dims,
      0,
      10,
      undefined,
      0,
      undefined,
      { centerAisle: true, centerColumnAisleWidthsM: [1.5] },
    );
    expect('error' in centered).toBe(false);
    if ('error' in centered) {
      return;
    }
    const rows = [...seatsByRow(centered.patch.seatPositionOverrides ?? {}).values()];
    const aisleSamples: { y: number; gapMid: number }[] = [];
    for (const seats of rows) {
      if (seats.length < 4) {
        continue;
      }
      const xs = seats.map((s) => s.xPct).sort((a, b) => a - b);
      const typical = (xs[xs.length - 1] - xs[0]) / Math.max(1, xs.length - 1);
      let maxGap = 0;
      let mid = 0;
      for (let g = 1; g < xs.length; g += 1) {
        const gap = xs[g] - xs[g - 1];
        if (gap > maxGap) {
          maxGap = gap;
          mid = (xs[g - 1] + xs[g]) / 2;
        }
      }
      if (maxGap > typical * 1.8) {
        const y = seats.reduce((sum, s) => sum + s.yPct, 0) / seats.length;
        aisleSamples.push({ y, gapMid: mid });
      }
    }
    expect(aisleSamples.length).toBeGreaterThan(2);
    aisleSamples.sort((a, b) => a.y - b.y);
    const back = aisleSamples[aisleSamples.length - 1];
    const betweenMiddleTwo = 60;
    const innerCorner = 40;
    const rightZigzag = 80;
    expect(Math.abs(back.gapMid - betweenMiddleTwo)).toBeLessThan(10);
    expect(Math.abs(back.gapMid - betweenMiddleTwo)).toBeLessThan(
      Math.abs(back.gapMid - innerCorner),
    );
    expect(Math.abs(back.gapMid - betweenMiddleTwo)).toBeLessThan(
      Math.abs(back.gapMid - rightZigzag),
    );
  });

  it('fills an unshaped (L) block along each row instead of a triangular leftover', () => {
    const unshaped = {
      ...block(),
      id: 'blk-unshaped',
      customPoints: [
        { xPct: 0, yPct: 0 },
        { xPct: 45, yPct: 0 },
        { xPct: 45, yPct: 45 },
        { xPct: 100, yPct: 45 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
    };
    const result = createArrangeByRowGridSeating(
      unshaped,
      rect,
      [12, 8, 8, 12, 8, 16],
      ['A', 'B', 'C', 'D', 'E', 'F'],
      dims,
      0,
      10,
      undefined,
      90,
      undefined,
      { centerAisle: true, centerColumnAisleWidthsM: [1.5] },
    );
    expect('error' in result).toBe(false);
    if ('error' in result) {
      return;
    }
    const all = Object.values(result.patch.seatPositionOverrides ?? {});
    expect(all.length).toBeGreaterThan(8);
    const spanX =
      Math.max(...all.map((s) => s.xPct)) - Math.min(...all.map((s) => s.xPct));
    const spanY =
      Math.max(...all.map((s) => s.yPct)) - Math.min(...all.map((s) => s.yPct));
    expect(spanX).toBeGreaterThan(40);
    expect(spanY).toBeGreaterThan(25);
  });

  it('does not leave a row with only one seat', () => {
    const wedge = {
      ...block(),
      id: 'blk-wedge',
      customPoints: [
        { xPct: 48, yPct: 0 },
        { xPct: 52, yPct: 0 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
    };
    const result = createArrangeByRowGridSeating(
      wedge,
      rect,
      [8, 20, 8, 20],
      ['A', 'B', 'C', 'D'],
      dims,
      0,
      12,
      undefined,
      180,
    );
    expect('error' in result).toBe(false);
    if ('error' in result) {
      return;
    }
    const byRow = seatsByRow(result.patch.seatPositionOverrides ?? {});
    expect(byRow.size).toBeGreaterThan(0);
    for (const seats of byRow.values()) {
      expect(seats.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('center column aisle in an L block targets the opposite side, not the inner corner', () => {
    const unshaped = {
      ...block(),
      id: 'blk-l-corner',
      customPoints: [
        { xPct: 0, yPct: 0 },
        { xPct: 45, yPct: 0 },
        { xPct: 45, yPct: 45 },
        { xPct: 100, yPct: 45 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
    };
    const centered = createArrangeByRowGridSeating(
      unshaped,
      rect,
      [12, 8, 8, 12, 8, 16],
      ['A', 'B', 'C', 'D', 'E', 'F'],
      dims,
      0,
      10,
      undefined,
      0,
      undefined,
      { centerAisle: true, centerColumnAisleWidthsM: [1.5] },
    );
    expect('error' in centered).toBe(false);
    if ('error' in centered) {
      return;
    }
    const all = Object.values(centered.patch.seatPositionOverrides ?? {});
    const stem = all.filter((s) => s.yPct < 40);
    expect(stem.length).toBeGreaterThan(3);
    const xs = stem.map((s) => s.xPct).sort((a, b) => a - b);
    const maxX = xs[xs.length - 1];
    const innerCorner = 45;
    const frontMid = 22.5;
    expect(maxX).toBeLessThan(innerCorner - 1);
    const midX = (xs[0] + maxX) / 2;
    expect(Math.abs(midX - frontMid)).toBeLessThan(Math.abs(midX - innerCorner));
  });

  it('aisle leftover seats keep equal gaps without stretching into a huge void', () => {
    const centered = place({
      centerAisle: true,
      centerColumnAisleWidthsM: [2],
    });
    expect('error' in centered).toBe(false);
    if ('error' in centered) {
      return;
    }
    const alongOf = (seats: { xPct: number; yPct: number }[]) => {
      const xs = seats.map((s) => s.xPct);
      const ys = seats.map((s) => s.yPct);
      const xSpan = Math.max(...xs) - Math.min(...xs);
      const ySpan = Math.max(...ys) - Math.min(...ys);
      return ySpan >= xSpan ? ys : xs;
    };
    const byRow = seatsByRow(centered.patch.seatPositionOverrides ?? {});
    let checked = 0;
    for (const seats of byRow.values()) {
      if (seats.length < 4) {
        continue;
      }
      const alongs = alongOf(seats).sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i < alongs.length; i += 1) {
        gaps.push(alongs[i] - alongs[i - 1]);
      }
      const aisleGap = Math.max(...gaps);
      const seatGaps = gaps.filter((gap) => gap < aisleGap * 0.75);
      if (seatGaps.length < 2) {
        continue;
      }
      const minGap = Math.min(...seatGaps);
      const maxGap = Math.max(...seatGaps);
      expect(maxGap / minGap).toBeLessThan(1.4);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('row D + column 3 + center column all leave walkway gaps', () => {
    const baseline = place();
    expect('error' in baseline).toBe(false);
    if ('error' in baseline) {
      return;
    }
    const combined = place({
      aisleRowIndices: [3],
      aisleColumnIndices: [2],
      rowAisleWidthM: 2,
      columnAisleWidthM: 1.5,
      centerAisle: true,
      centerColumnAisleWidthsM: [2],
    });
    expect('error' in combined).toBe(false);
    if ('error' in combined) {
      return;
    }

    const baseRows = seatsByRow(baseline.patch.seatPositionOverrides ?? {});
    const aisledRows = seatsByRow(combined.patch.seatPositionOverrides ?? {});
    const firstBaseRow = [...baseRows.values()][0] ?? [];
    const firstAisledRow = [...aisledRows.values()][0] ?? [];
    expect(firstBaseRow.length).toBeGreaterThan(6);
    expect(firstAisledRow.length).toBeGreaterThan(4);

    const alongOf = (seats: { xPct: number; yPct: number }[]) => {
      const xs = seats.map((s) => s.xPct);
      const ys = seats.map((s) => s.yPct);
      const xSpan = Math.max(...xs) - Math.min(...xs);
      const ySpan = Math.max(...ys) - Math.min(...ys);
      return ySpan >= xSpan ? ys : xs;
    };
    const depthOf = (seats: { xPct: number; yPct: number }[]) => {
      const xs = seats.map((s) => s.xPct);
      const ys = seats.map((s) => s.yPct);
      const xSpan = Math.max(...xs) - Math.min(...xs);
      const ySpan = Math.max(...ys) - Math.min(...ys);
      const values = ySpan >= xSpan ? xs : ys;
      return values.reduce((sum, v) => sum + v, 0) / values.length;
    };

    const baseAlong = alongOf(firstBaseRow);
    const typicalAlong =
      (Math.max(...baseAlong) - Math.min(...baseAlong)) / Math.max(1, baseAlong.length - 1);
    expect(countLargeGaps(alongOf(firstAisledRow), typicalAlong)).toBeGreaterThanOrEqual(2);

    const rowOrder = (rows: Map<string, { xPct: number; yPct: number }[]>) =>
      [...rows.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, seats]) => depthOf(seats));
    const baseDepths = rowOrder(baseRows);
    const aisledDepths = rowOrder(aisledRows);
    const typicalDepth =
      (Math.max(...baseDepths) - Math.min(...baseDepths)) / Math.max(1, baseDepths.length - 1);
    expect(countLargeGaps(aisledDepths, typicalDepth)).toBeGreaterThanOrEqual(1);
  });

  it('row and column aisles with the same widthM produce the same geometric gap', () => {
    const aisleWidthM = 2;

    const rowOnly = place({
      aisleRowIndices: [3],
      rowAisleWidthM: aisleWidthM,
    });
    expect('error' in rowOnly).toBe(false);
    if ('error' in rowOnly) return;

    const colOnly = place({
      aisleColumnIndices: [5],
      columnAisleWidthM: aisleWidthM,
    });
    expect('error' in colOnly).toBe(false);
    if ('error' in colOnly) return;

    // --- measure row aisle geometric gap ---
    const rowOverrides = rowOnly.patch.seatPositionOverrides ?? {};
    const rowRows = seatsByRow(rowOverrides);
    const rowKeys = [...rowRows.keys()].sort();
    // The row aisle is at physical index 3, so seat rows D (index 3) onwards are
    // pushed. Collect average depth (the cross-row coordinate) per row label.
    const depthOfRow = (row: { xPct: number; yPct: number }[]) => {
      const xs = row.map((s) => s.xPct);
      const ys = row.map((s) => s.yPct);
      const xSpan = Math.max(...xs) - Math.min(...xs);
      const ySpan = Math.max(...ys) - Math.min(...ys);
      const vals = ySpan >= xSpan ? xs : ys;
      return vals.reduce((s, v) => s + v, 0) / vals.length;
    };
    const rowDepthValues = rowKeys.map((k) => depthOfRow(rowRows.get(k)!));
    // Find the largest center-to-center gap in the depth direction.
    let maxRowGap = 0;
    for (let i = 1; i < rowDepthValues.length; i++) {
      maxRowGap = Math.max(maxRowGap, Math.abs(rowDepthValues[i] - rowDepthValues[i - 1]));
    }

    // --- measure column aisle geometric gap ---
    const colOverrides = colOnly.patch.seatPositionOverrides ?? {};
    const colRows = seatsByRow(colOverrides);
    // Pick the first row (widest, most seats) to measure along-row gaps.
    const firstRowKey = [...colRows.keys()].sort()[0];
    const firstRowSeats = colRows.get(firstRowKey)!;
    const alongOf = (row: { xPct: number; yPct: number }[]) => {
      const xs = row.map((s) => s.xPct);
      const ys = row.map((s) => s.yPct);
      const xSpan = Math.max(...xs) - Math.min(...xs);
      const ySpan = Math.max(...ys) - Math.min(...ys);
      return ySpan >= xSpan ? ys : xs;
    };
    const alongs = alongOf(firstRowSeats).sort((a, b) => a - b);
    let maxColGap = 0;
    for (let i = 1; i < alongs.length; i++) {
      maxColGap = Math.max(maxColGap, alongs[i] - alongs[i - 1]);
    }

    // Both aisles use the same widthM. The geometric gap (in percentage coords)
    // must be proportional to the same physical metres. The block is 20m wide ×
    // 15m deep, so the ppm differs per axis. Convert gaps to metres.
    // Along axis = 20m over 800px (wPct 0–100 maps to 800px).
    // Depth axis = 15m over 600px (the other dimension).
    // But positions are in pct (0–100), so 1 pct = blockDimM / 100.
    // We need to figure which axis is "along" and which is "depth".
    // With viewpointAngleDeg=90, the stadium edge is the top edge (side 0).
    // Along = x direction (20m wide), Depth = y direction (15m deep).
    // So along 1pct = 20m/100 = 0.2m, depth 1pct = 15m/100 = 0.15m.
    // Actually positions are in element pct, mapped to the rect.
    // Let's just compare the raw gap: the aisle should add the same PHYSICAL
    // metres. We measure in pct, so we need to normalize.

    // The normal step between rows (rowGapPx in depth pct):
    const normalRowGaps: number[] = [];
    for (let i = 1; i < rowDepthValues.length; i++) {
      const g = Math.abs(rowDepthValues[i] - rowDepthValues[i - 1]);
      if (g < maxRowGap * 0.8) normalRowGaps.push(g);
    }
    const avgNormalRowGap = normalRowGaps.reduce((s, v) => s + v, 0) / normalRowGaps.length;
    // The aisle added extra = maxRowGap - avgNormalRowGap (in depth pct)
    const rowAisleExtraPct = maxRowGap - avgNormalRowGap;
    // Convert to metres: depth pct * 15m / 100
    const rowAisleMetres = (rowAisleExtraPct / 100) * rect.height * (15 / rect.height);
    // Simplifies to rowAisleExtraPct * 15 / 100... let me just use ppm.
    // Actually, let me compute ppm from the block.
    // ppm = pixels / metres. Top edge = 800px / 20m = 40 px/m.
    // Depth: 600px / 15m = 40 px/m. Same ppm — it's a square in px/m ratio!
    // So 1 pct along = rect.width/100 = 8px = 8/40 = 0.2m
    // 1 pct depth = rect.height/100 = 6px = 6/40 = 0.15m
    // Row aisle in metres = rowAisleExtraPct * 6 / 40 = rowAisleExtraPct * 0.15
    const ppm = 40; // both axes

    const normalColGaps: number[] = [];
    for (let i = 1; i < alongs.length; i++) {
      const g = alongs[i] - alongs[i - 1];
      if (g < maxColGap * 0.8) normalColGaps.push(g);
    }
    const avgNormalColGap = normalColGaps.reduce((s, v) => s + v, 0) / normalColGaps.length;
    const colAisleExtraPct = maxColGap - avgNormalColGap;

    // With viewpointAngleDeg=90, depth runs along x (width=800, 20m)
    // and along runs along y (height=600, 15m).
    const rowAisleM = (rowAisleExtraPct / 100) * rect.width / ppm;
    const colAisleM = (colAisleExtraPct / 100) * rect.height / ppm;

    // Convert seat pct positions to actual canvas pixels.
    // Element pct → canvas: x = rect.x + (xPct/100)*rect.width, y = rect.y + (yPct/100)*rect.height
    const toPx = (pct: { xPct: number; yPct: number }) => ({
      xPx: rect.x + (pct.xPct / 100) * rect.width,
      yPx: rect.y + (pct.yPct / 100) * rect.height,
    });

    // --- Row aisle: find the two rows flanking the aisle gap ---
    const rowOnlyOverridesArr = Object.entries(rowOverrides).map(([id, pos]) => ({ id, ...pos }));
    const rowOnlyByRow = seatsByRow(rowOverrides);
    const rowOnlyKeys = [...rowOnlyByRow.keys()].sort();
    // Depth values per row (pick the coordinate axis used for depth)
    const rowDepthsPx = rowOnlyKeys.map((k) => {
      const seats = rowOnlyByRow.get(k)!;
      const pxSeats = seats.map(toPx);
      // With viewpoint=90, depth = x axis
      const avgX = pxSeats.reduce((s, p) => s + p.xPx, 0) / pxSeats.length;
      return { row: k, depthPx: avgX };
    });
    // Find largest gap between consecutive rows in px
    let rowAisleGapPx = 0;
    let rowAisleBefore = '';
    let rowAisleAfter = '';
    for (let i = 1; i < rowDepthsPx.length; i++) {
      const gap = Math.abs(rowDepthsPx[i].depthPx - rowDepthsPx[i - 1].depthPx);
      if (gap > rowAisleGapPx) {
        rowAisleGapPx = gap;
        rowAisleBefore = rowDepthsPx[i - 1].row;
        rowAisleAfter = rowDepthsPx[i].row;
      }
    }
    // Normal row step in px
    const normalRowStepsPx: number[] = [];
    for (let i = 1; i < rowDepthsPx.length; i++) {
      const gap = Math.abs(rowDepthsPx[i].depthPx - rowDepthsPx[i - 1].depthPx);
      if (gap < rowAisleGapPx * 0.8) normalRowStepsPx.push(gap);
    }
    const avgNormalRowStepPx = normalRowStepsPx.reduce((s, v) => s + v, 0) / normalRowStepsPx.length;
    const rowAisleOnlyPx = rowAisleGapPx - avgNormalRowStepPx;

    // --- Column aisle: find the two seats flanking the aisle gap in the first row ---
    const colOnlyByRow = seatsByRow(colOverrides);
    const colFirstRowKey = [...colOnlyByRow.keys()].sort()[0];
    const colFirstRow = colOnlyByRow.get(colFirstRowKey)!;
    const colFirstRowPx = colFirstRow.map(toPx);
    // With viewpoint=90, along = y axis
    const colAlongsPx = colFirstRowPx.map((p) => p.yPx).sort((a, b) => a - b);
    let colAisleGapPx = 0;
    let colAisleBeforeIdx = 0;
    for (let i = 1; i < colAlongsPx.length; i++) {
      const gap = colAlongsPx[i] - colAlongsPx[i - 1];
      if (gap > colAisleGapPx) {
        colAisleGapPx = gap;
        colAisleBeforeIdx = i - 1;
      }
    }
    const normalColStepsPx: number[] = [];
    for (let i = 1; i < colAlongsPx.length; i++) {
      const gap = colAlongsPx[i] - colAlongsPx[i - 1];
      if (gap < colAisleGapPx * 0.8) normalColStepsPx.push(gap);
    }
    const avgNormalColStepPx = normalColStepsPx.reduce((s, v) => s + v, 0) / normalColStepsPx.length;
    const colAisleOnlyPx = colAisleGapPx - avgNormalColStepPx;

    // Both aisle-only gaps must equal aisleWidthM * ppm = 80px
    const expectedPx = aisleWidthM * ppm;
    expect(rowAisleOnlyPx).toBeCloseTo(expectedPx, 0);
    expect(colAisleOnlyPx).toBeCloseTo(expectedPx, 0);
    // They must be the same pixel width.
    expect(Math.abs(rowAisleOnlyPx - colAisleOnlyPx)).toBeLessThan(1);
  });

  it('non-square block: row and column aisle pixel gaps match the per-axis metre scale', () => {
    // Block drawn as 1000x500 px but physical 20m×15m → ppm differs per axis.
    const nsRect = { x: 0, y: 0, width: 1000, height: 500, cx: 500, cy: 250 };
    const nsSideLengthsM = [20, 15, 20, 15];
    // ppm_x = 1000/20 = 50, ppm_y = 500/15 = 33.33
    const nsDims = {
      physicalLengthM: 15,
      physicalWidthM: 20,
      chairWidthM: 0.45,
      chairLengthM: 0.45,
      seatGapM: 0.05,
      rowGapM: 0.05,
      borderGapM: 0,
    };
    const aisleWidthM = 2;

    function nsBlock(): CenterpieceElement {
      return {
        id: 'blk-ns',
        type: 'centerpiece',
        name: 'NS',
        code: 'NS',
        shape: 'custom',
        label: 'NS',
        curveDeg: 0,
        customPoints: [
          { xPct: 0, yPct: 0 },
          { xPct: 100, yPct: 0 },
          { xPct: 100, yPct: 100 },
          { xPct: 0, yPct: 100 },
        ],
        position: { xPct: 50, yPct: 50 },
        size: { wPct: 100, hPct: 100 },
        rotation: 0,
        style: { fillColor: '#fff', strokeColor: '#000', labelColor: '#000' },
        customSideLengthsM: nsSideLengthsM,
      };
    }

    function nsPlace(aislePlacement?: Parameters<typeof createArrangeByRowGridSeating>[10]) {
      return createArrangeByRowGridSeating(
        nsBlock(),
        nsRect,
        nsSideLengthsM,
        ['Front', 'Right', 'Back', 'Left'],
        nsDims,
        0,
        12,
        undefined,
        90,
        undefined,
        aislePlacement,
      );
    }

    const rowOnly = nsPlace({ aisleRowIndices: [3], rowAisleWidthM: aisleWidthM });
    expect('error' in rowOnly).toBe(false);
    if ('error' in rowOnly) return;

    const colOnly = nsPlace({ aisleColumnIndices: [5], columnAisleWidthM: aisleWidthM });
    expect('error' in colOnly).toBe(false);
    if ('error' in colOnly) return;

    const toPx = (pct: { xPct: number; yPct: number }) => ({
      xPx: nsRect.x + (pct.xPct / 100) * nsRect.width,
      yPx: nsRect.y + (pct.yPct / 100) * nsRect.height,
    });

    // Row aisle — depth runs along x with viewpoint=90
    const rowOv = rowOnly.patch.seatPositionOverrides ?? {};
    const rowByRow = seatsByRow(rowOv);
    const rowKeys = [...rowByRow.keys()].sort();
    const rowDepthsPx = rowKeys.map((k) => {
      const seats = rowByRow.get(k)!;
      const pxSeats = seats.map(toPx);
      return pxSeats.reduce((s, p) => s + p.xPx, 0) / pxSeats.length;
    });
    let maxRowGapPx = 0;
    for (let i = 1; i < rowDepthsPx.length; i++) {
      maxRowGapPx = Math.max(maxRowGapPx, Math.abs(rowDepthsPx[i] - rowDepthsPx[i - 1]));
    }
    const normalRowSteps: number[] = [];
    for (let i = 1; i < rowDepthsPx.length; i++) {
      const g = Math.abs(rowDepthsPx[i] - rowDepthsPx[i - 1]);
      if (g < maxRowGapPx * 0.8) normalRowSteps.push(g);
    }
    const avgNrsPx = normalRowSteps.reduce((s, v) => s + v, 0) / normalRowSteps.length;
    const rowAisleOnlyPx = maxRowGapPx - avgNrsPx;

    // Column aisle — along runs along y with viewpoint=90
    const colOv = colOnly.patch.seatPositionOverrides ?? {};
    const colByRow = seatsByRow(colOv);
    const colFirstKey = [...colByRow.keys()].sort()[0];
    const colFirstRow = colByRow.get(colFirstKey)!;
    const colPx = colFirstRow.map(toPx);
    const colAlongs = colPx.map((p) => p.yPx).sort((a, b) => a - b);
    let maxColGapPx = 0;
    for (let i = 1; i < colAlongs.length; i++) {
      maxColGapPx = Math.max(maxColGapPx, colAlongs[i] - colAlongs[i - 1]);
    }
    const normalColSteps: number[] = [];
    for (let i = 1; i < colAlongs.length; i++) {
      const g = colAlongs[i] - colAlongs[i - 1];
      if (g < maxColGapPx * 0.8) normalColSteps.push(g);
    }
    const avgNcsPx = normalColSteps.reduce((s, v) => s + v, 0) / normalColSteps.length;
    const colAisleOnlyPx = maxColGapPx - avgNcsPx;

    // Per-axis ppm: top edge (0→1) = 1000px / 20m = 50, right edge (1→2) = 500px / 15m = 33.33
    const ppmX = nsRect.width / 20;  // 50 — depth axis with viewpoint=90
    const ppmY = nsRect.height / 15; // 33.33 — along axis with viewpoint=90

    // Row aisle runs along depth (X) → should be 2m * ppmX = 100px
    // Column aisle runs along along (Y) → should be 2m * ppmY = 66.67px

    const rowAisleMetres = rowAisleOnlyPx / ppmX;
    const colAisleMetres = colAisleOnlyPx / ppmY;

    // Both must represent exactly 2m on their respective axis.
    expect(rowAisleMetres).toBeCloseTo(aisleWidthM, 0);
    expect(colAisleMetres).toBeCloseTo(aisleWidthM, 0);
  });
});

describe('drawn aisle packs seats into remaining space', () => {
  const rect = { x: 0, y: 0, width: 800, height: 600, cx: 400, cy: 300 };
  const sideLengthsM = [20, 15, 20, 15];
  const dims = {
    physicalLengthM: 15,
    physicalWidthM: 20,
    chairWidthM: 0.45,
    chairLengthM: 0.45,
    seatGapM: 0.05,
    rowGapM: 0.05,
    borderGapM: 0,
  };
  const block: CenterpieceElement = {
    id: 'blk-draw',
    type: 'centerpiece',
    name: 'TEST',
    code: 'TEST',
    shape: 'custom',
    label: 'TEST',
    curveDeg: 0,
    customPoints: [
      { xPct: 0, yPct: 0 },
      { xPct: 100, yPct: 0 },
      { xPct: 100, yPct: 100 },
      { xPct: 0, yPct: 100 },
    ],
    position: { xPct: 50, yPct: 50 },
    size: { wPct: 40, hPct: 40 },
    rotation: 0,
    style: { fillColor: '#fff', strokeColor: '#000', labelColor: '#000' },
    customSideLengthsM: sideLengthsM,
  };

  it('leaves a walkway on the drawn line and keeps seats beside it', () => {
    const baseline = createArrangeByRowGridSeating(
      block,
      rect,
      sideLengthsM,
      ['Front', 'Right', 'Back', 'Left'],
      dims,
      0,
      10,
      undefined,
      90,
    );
    expect('error' in baseline).toBe(false);
    if ('error' in baseline) {
      return;
    }
    const baseSeats = Object.values(baseline.patch.seatPositionOverrides ?? {});
    const xs = baseSeats.map((s) => s.xPct).sort((a, b) => a - b);
    const ys = baseSeats.map((s) => s.yPct).sort((a, b) => a - b);
    const midX = xs[Math.floor(xs.length / 2)];
    const midY = ys[Math.floor(ys.length / 2)];
    const cutAcrossX = xs[xs.length - 1] - xs[0] >= ys[ys.length - 1] - ys[0];
    const aisle = cutAcrossX
      ? { start: { xPct: midX, yPct: 5 }, end: { xPct: midX, yPct: 95 }, widthM: 2 }
      : { start: { xPct: 5, yPct: midY }, end: { xPct: 95, yPct: midY }, widthM: 2 };
    const drawn = createArrangeByRowGridSeating(
      block,
      rect,
      sideLengthsM,
      ['Front', 'Right', 'Back', 'Left'],
      dims,
      0,
      10,
      undefined,
      90,
      undefined,
      { drawnAisles: [aisle] },
    );
    expect('error' in drawn).toBe(false);
    if ('error' in drawn) {
      return;
    }
    const drawnSeats = Object.values(drawn.patch.seatPositionOverrides ?? {});
    expect(drawnSeats.length).toBeGreaterThan(0);
    expect(drawnSeats.length).toBeLessThan(baseSeats.length);
    const dist = (pos: { xPct: number; yPct: number }) =>
      cutAcrossX ? Math.abs(pos.xPct - midX) : Math.abs(pos.yPct - midY);
    const baseMin = Math.min(...baseSeats.map(dist));
    const drawnMin = Math.min(...drawnSeats.map(dist));
    expect(drawnMin).toBeGreaterThan(baseMin);
  });
});
