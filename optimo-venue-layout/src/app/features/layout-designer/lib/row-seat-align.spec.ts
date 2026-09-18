import { describe, expect, it } from 'vitest';

import {
  collectAdjacentBlocks,
  isLateralAdjacentBlock,
  resolveRowSeatAlignFromAdjacent,
  type AdjacentBlockRef,
} from './row-seat-align';
import { createArrangeByRowGridSeating } from './drag-seats';
import type { CenterpieceElement } from '../models/layout-element.model';
import type { PhysicalDimsInput } from './custom-shape-seats';

const FRAME = {
  origin: { x: 0, y: 0 },
  ux: 1,
  uy: 0,
  perpX: 0,
  perpY: 1,
  edgeLength: 100,
};

const SELF = [
  { x: 100, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 80 },
  { x: 100, y: 80 },
];

function neighbor(id: string, x0: number, x1: number, seatsX?: number[]): AdjacentBlockRef {
  return {
    id,
    polygon: [
      { x: x0, y: 0 },
      { x: x1, y: 0 },
      { x: x1, y: 80 },
      { x: x0, y: 80 },
    ],
    seats: (seatsX ?? []).map((x) => ({ x, y: 40 })),
  };
}

describe('resolveRowSeatAlignFromAdjacent', () => {
  it('packs toward the outer side when the only neighbour sits on the right', () => {
    expect(
      resolveRowSeatAlignFromAdjacent(SELF, FRAME, [neighbor('right', 208, 308, [220, 240])]),
    ).toBe('left');
  });

  it('packs toward the outer side when the only neighbour sits on the left', () => {
    expect(
      resolveRowSeatAlignFromAdjacent(SELF, FRAME, [neighbor('left', 0, 92, [20, 40])]),
    ).toBe('right');
  });

  it('stays centred when neighbours sit on both sides', () => {
    expect(
      resolveRowSeatAlignFromAdjacent(SELF, FRAME, [
        neighbor('left', 0, 92, [40]),
        neighbor('right', 208, 308, [220]),
      ]),
    ).toBe('center');
  });

  it('stays centred when there is no lateral neighbour', () => {
    expect(resolveRowSeatAlignFromAdjacent(SELF, FRAME, [])).toBe('center');
  });

  it('ignores a block stacked behind this one (next ring)', () => {
    const behind: AdjacentBlockRef = {
      id: 'behind',
      polygon: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 180 },
        { x: 100, y: 180 },
      ],
      seats: [{ x: 150, y: 140 }],
    };
    expect(isLateralAdjacentBlock(SELF, behind.polygon, FRAME)).toBe(false);
    expect(resolveRowSeatAlignFromAdjacent(SELF, FRAME, [behind])).toBe('center');
  });

  it('uses neighbour seat positions, not only the block outline, for relative side', () => {
    // Outline straddles both sides, but seats sit only to the right of this block.
    const straddling: AdjacentBlockRef = {
      id: 'wide',
      polygon: [
        { x: 40, y: 0 },
        { x: 320, y: 0 },
        { x: 320, y: 80 },
        { x: 40, y: 80 },
      ],
      seats: [
        { x: 230, y: 30 },
        { x: 250, y: 30 },
        { x: 270, y: 30 },
      ],
    };
    expect(resolveRowSeatAlignFromAdjacent(SELF, FRAME, [straddling])).toBe('left');
  });
});

describe('collectAdjacentBlocks', () => {
  it('includes nearby seating blocks and their seat positions', () => {
    const canvas = { width: 1000, height: 700 };
    const self: CenterpieceElement = {
      id: 'a',
      type: 'centerpiece',
      name: 'A',
      shape: 'custom',
      label: 'A',
      curveDeg: 0,
      customPoints: [
        { xPct: 0, yPct: 0 },
        { xPct: 100, yPct: 0 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
      position: { xPct: 30, yPct: 50 },
      size: { wPct: 10, hPct: 10 },
      rotation: 0,
      style: { fillColor: '#fff', strokeColor: '#000', labelColor: '#000' },
    };
    const neighborEl: CenterpieceElement = {
      ...self,
      id: 'b',
      name: 'B',
      label: 'B',
      position: { xPct: 41, yPct: 50 },
      seatPositionOverrides: {
        A1: { xPct: 20, yPct: 50 },
        A2: { xPct: 40, yPct: 50 },
      },
    };
    const found = collectAdjacentBlocks(self, [self, neighborEl], canvas);
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe('b');
    expect(found[0].seats).toHaveLength(2);
  });
});

describe('createArrangeByRowGridSeating adjacent alignment', () => {
  const dims: PhysicalDimsInput = {
    physicalLengthM: 12,
    physicalWidthM: 16,
    chairWidthM: 0.5,
    chairLengthM: 0.5,
    seatGapM: 0.1,
    rowGapM: 0.15,
    borderGapM: 0.2,
  };

  function trapezoid(id: string, xPct: number): CenterpieceElement {
    return {
      id,
      type: 'centerpiece',
      name: id,
      shape: 'custom',
      label: id,
      curveDeg: 0,
      customPoints: [
        { xPct: 15, yPct: 0 },
        { xPct: 85, yPct: 0 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
      position: { xPct, yPct: 50 },
      size: { wPct: 18, hPct: 16 },
      rotation: 0,
      style: { fillColor: '#fff', strokeColor: '#000', labelColor: '#000' },
    };
  }

  it('packs leftover seats toward the outer edge away from a right-hand neighbour', () => {
    const block = trapezoid('end-left', 30);
    const rect = { x: 100, y: 200, width: 180, height: 160, cx: 190, cy: 280 };
    const neighborPoly = [
      { x: 290, y: 200 },
      { x: 470, y: 200 },
      { x: 470, y: 360 },
      { x: 290, y: 360 },
    ];
    const result = createArrangeByRowGridSeating(
      block,
      rect,
      [16, 12, 16, 12],
      ['A', 'B', 'C', 'D'],
      dims,
      0,
      4,
      8,
      0,
      { stadiumEdgeLengthM: 16, stadiumEdgeLengthPx: 180, depthLengthM: 12, exactPitchPlacement: true },
      undefined,
      {
        adjacentBlocks: [
          {
            id: 'mid',
            polygon: neighborPoly,
            seats: [
              { x: 310, y: 240 },
              { x: 330, y: 240 },
            ],
          },
        ],
      },
    );
    expect('error' in result).toBe(false);
    if ('error' in result) {
      return;
    }
    expect(result.patch.seatLayout?.seatAlign).toBe('left');
    const seats = Object.values(result.patch.seatPositionOverrides ?? {});
    expect(seats.length).toBeGreaterThan(0);
    const xs = seats.map((s) => s.xPct);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    expect(mid).toBeLessThan(50);
  });
});
