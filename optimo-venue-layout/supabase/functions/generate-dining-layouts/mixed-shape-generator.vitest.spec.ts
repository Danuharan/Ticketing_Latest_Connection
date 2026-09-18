import { describe, expect, it } from 'vitest';

import { generateDiningLayouts, resolveMixQuota } from './candidate-generator';
import { tablesOverlap } from './validator';
import type { GenerateDiningLayoutsRequest } from './types';

function mixedRequest(roundCount: number, rectCount: number): GenerateDiningLayoutsRequest {
  return {
    block: {
      id: 'b-mixed',
      polygon: [
        { x: 0, y: 0 },
        { x: 16, y: 0 },
        { x: 16, y: 12 },
        { x: 0, y: 12 },
      ],
      widthM: 16,
      depthM: 12,
    },
    accessPoints: { entrances: [], exits: [], emergencyExits: [] },
    features: {},
    tableCatalogue: [
      {
        id: 'wizard-mix-round',
        name: 'Round table',
        shape: 'round',
        widthM: 1.2,
        depthM: 1.2,
        capacity: 6,
        chairWidthM: 0.45,
        chairDepthM: 0.5,
        allowed: true,
      },
      {
        id: 'wizard-mix-rectangular',
        name: 'Rectangular table',
        shape: 'rectangular',
        widthM: 1.7,
        depthM: 0.8,
        capacity: 4,
        chairWidthM: 0.45,
        chairDepthM: 0.5,
        allowed: true,
      },
    ],
    target: {
      tableCount: roundCount + rectCount,
      targetCapacity: roundCount * 6 + rectCount * 4,
      mix: [
        { catalogueId: 'wizard-mix-round', count: roundCount },
        { catalogueId: 'wizard-mix-rectangular', count: rectCount },
      ],
    },
    rules: {
      minimumTableToTableClearanceM: 0.6,
      minimumChairToChairClearanceM: 0.2,
      wallClearanceM: 0.4,
      guestAisleWidthM: 0.9,
      mainGuestAisleWidthM: 1.2,
      waiterAisleWidthM: 0.8,
      serviceRouteClearanceM: 0.6,
      entranceClearanceM: 1.0,
      exitClearanceM: 1.0,
      stageClearanceM: 0.8,
      foodPrepClearanceM: 0.8,
      obstacleClearanceM: 0.4,
      maximumOccupancy: null,
    },
    generation: { suggestionCount: 2, seed: 7, timeBudgetMs: 3000 },
    stageFacingAngleDeg: 90,
  };
}

function countShapes(layout: { tables: { catalogueId: string }[] }): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of layout.tables) {
    counts[table.catalogueId] = (counts[table.catalogueId] ?? 0) + 1;
  }
  return counts;
}

describe('resolveMixQuota', () => {
  it('returns null when no mix is requested', () => {
    const req = mixedRequest(3, 3);
    req.target.mix = undefined;
    expect(resolveMixQuota(req)).toBeNull();
  });

  it('drops zero-count lanes and sums the rest', () => {
    const req = mixedRequest(4, 0);
    const quota = resolveMixQuota(req)!;
    expect(quota.total).toBe(4);
    expect(quota.byCatalogue.get('wizard-mix-rectangular')).toBeUndefined();
  });
});

describe('mixed-shape dining generation', () => {
  it.each([
    [3, 3],
    [5, 2],
    [2, 6],
  ])('places exactly %s round and %s rectangular tables', (roundCount, rectCount) => {
    const result = generateDiningLayouts(mixedRequest(roundCount, rectCount));
    expect(result.layouts.length).toBeGreaterThan(0);
    for (const layout of result.layouts) {
      expect(layout.tableCount).toBe(roundCount + rectCount);
      expect(countShapes(layout)).toEqual({
        'wizard-mix-round': roundCount,
        'wizard-mix-rectangular': rectCount,
      });
    }
  });

  it('keeps each table at its own catalogue geometry', () => {
    const result = generateDiningLayouts(mixedRequest(3, 3));
    const layout = result.layouts[0]!;
    for (const table of layout.tables) {
      if (table.catalogueId === 'wizard-mix-round') {
        expect(table.shape).toBe('round');
        expect(table.widthM).toBeCloseTo(1.2);
        expect(table.seats).toBe(6);
      } else {
        expect(table.shape).toBe('rectangular');
        expect(table.widthM).toBeCloseTo(1.7);
        expect(table.depthM).toBeCloseTo(0.8);
        expect(table.seats).toBe(4);
      }
    }
    expect(layout.capacity).toBe(3 * 6 + 3 * 4);
  });

  it('leaves no overlap between differently shaped tables', () => {
    const result = generateDiningLayouts(mixedRequest(4, 4));
    const layout = result.layouts[0]!;
    const placed = layout.tables.map((table) => {
      const round = table.shape === 'round';
      const chairReach = 0.25;
      const halfW = table.widthM / 2 + chairReach;
      const halfD = (round ? table.widthM : table.depthM ?? table.widthM) / 2 + chairReach;
      return {
        xM: (table.xPct / 100) * 16,
        yM: (table.yPct / 100) * 12,
        rotationDeg: table.rotationDeg,
        type: { shape: table.shape } as never,
        physicalHalfWidthM: halfW,
        physicalHalfDepthM: halfD,
        spacingHalfWidthM: halfW,
        spacingHalfDepthM: halfD,
      };
    });
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(tablesOverlap(placed[i]!, placed[j]!)).toBe(false);
      }
    }
  });

  it('still honours a single-shape request with no mix', () => {
    const req = mixedRequest(6, 0);
    req.target.mix = undefined;
    req.target.tableCount = 6;
    req.tableCatalogue[1]!.allowed = false;
    const result = generateDiningLayouts(req);
    expect(result.layouts.length).toBeGreaterThan(0);
    expect(result.layouts.every((layout) => layout.tableCount === 6)).toBe(true);
    expect(
      result.layouts.every((layout) =>
        layout.tables.every((table) => table.catalogueId === 'wizard-mix-round'),
      ),
    ).toBe(true);
  });
});
