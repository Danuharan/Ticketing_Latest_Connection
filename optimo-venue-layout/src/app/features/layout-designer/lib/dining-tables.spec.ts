import { describe, expect, it } from 'vitest';

import type { CenterpieceElement } from '../models/layout-element.model';
import {
  addTableAtPoint,
  computeTableGridCapacity,
  basicGeometricDiningCapacity,
  estimatedOperationalDiningCapacity,
  fitDiningTableAndChairToBlock,
  diningWizardInputMaxes,
  resolveDiningWizardPack,
  countDiningTablesThatFit,
  maxDiningChairLengthForBlock,
  maxDiningChairWidthForTable,
  maxDiningTableDimsForBlock,
  scaleChairLengthToFitTableCount,
  scaleDiningTableDimsToFitCount,
  diningFeatureEdgeStripApplies,
  getDiningFeatureSubtractions,
  MIN_DINING_CHAIR_LENGTH_M,
  MIN_DINING_CHAIR_WIDTH_M,
  MIN_DINING_TABLE_SIZE_M,
  MAX_DINING_CHAIR_WIDTH_M,
} from './dining-tables';
import { rectFromPositionSize } from './geometry';

const CANVAS = { width: 1000, height: 800 };

function diningBlock(): CenterpieceElement {
  return {
    id: 'block-16',
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
    physicalLengthM: 4,
    physicalWidthM: 4,
  } as unknown as CenterpieceElement;
}

describe('addTableAtPoint', () => {
  it('places a round table from a click inside the block', () => {
    const el = diningBlock();
    const rect = rectFromPositionSize(el.position, el.size, CANVAS);
    const canvasPct = { xPct: 50, yPct: 50 };

    const patch = addTableAtPoint(el, rect, CANVAS, canvasPct, {
      shape: 'round',
      seats: 6,
      widthM: 2.4,
      depthM: 2.4,
    });

    expect(patch.diningTables).toHaveLength(1);
    expect(patch.diningTables?.[0]?.shape).toBe('round');
    expect(patch.diningTables?.[0]?.widthM).toBe(2.4);
    expect(patch.diningTables?.[0]?.seats).toBe(6);
    expect(patch.tablePlacementMode).toBe(true);
  });

  it('still places a table when the click is outside by clamping onto the block', () => {
    const el = diningBlock();
    const rect = rectFromPositionSize(el.position, el.size, CANVAS);

    const patch = addTableAtPoint(
      el,
      rect,
      CANVAS,
      { xPct: 5, yPct: 5 },
      {
        shape: 'round',
        seats: 4,
        widthM: 1.2,
        depthM: 1.2,
      },
    );

    expect(patch.diningTables).toHaveLength(1);
  });
});

describe('computeTableGridCapacity single-table fit', () => {
  it('returns 0 when the table footprint is larger than the block', () => {
    const el = diningBlock();
    const capacity = computeTableGridCapacity(el, {
      shape: 'round',
      widthM: 6.35,
      depthM: 6.35,
      gapM: 0.6,
      chairLengthM: 0.5,
      featureClearanceM: 0.8,
    });
    expect(capacity.totalTables).toBe(0);
  });

  it('counts one table when footprint fits but footprint+gap does not tile', () => {
    const el = diningBlock();
    const capacity = computeTableGridCapacity(el, {
      shape: 'round',
      widthM: 2.8,
      depthM: 2.8,
      gapM: 0.6,
      chairLengthM: 0.4,
      featureClearanceM: 0.1,
    });
    expect(capacity.totalTables).toBeGreaterThanOrEqual(1);
  });
});

describe('maxDiningTableDimsForBlock', () => {
  it('caps diameter below the block size even when chairs are small', () => {
    const el = diningBlock();
    const max = maxDiningTableDimsForBlock(el, {
      shape: 'round',
      widthM: 18.9,
      depthM: 18.9,
      gapM: 0.6,
      chairLengthM: 0.5,
      featureClearanceM: 0.8,
    });
    expect(max.widthM).toBeLessThanOrEqual(4);
    expect(max.widthM).toBeLessThan(18.9);
  });

  it('shrinks max diameter when a free-rotated stage occupies real floor space', () => {
    const el = diningBlock();
    // 4×4 block from diningBlock helpers — place a large diagonal stage.
    el.diningStage = {
      widthM: 2.5,
      depthM: 1.2,
      xPct: 70,
      yPct: 30,
      sideEdgeId: 0,
      rotationDeg: 45,
      label: 'Stage',
    };
    const withoutStage = maxDiningTableDimsForBlock(
      { ...el, diningStage: undefined },
      {
        shape: 'round',
        widthM: 4,
        depthM: 4,
        gapM: 0.6,
        chairLengthM: 0.4,
        featureClearanceM: 0,
        wallClearanceM: 0,
      },
    );
    const withStage = maxDiningTableDimsForBlock(el, {
      shape: 'round',
      widthM: 4,
      depthM: 4,
      gapM: 0.6,
      chairLengthM: 0.4,
      featureClearanceM: 0,
      wallClearanceM: 0,
    });
    expect(withStage.widthM).toBeLessThan(withoutStage.widthM);
    expect(withStage.widthM).toBeGreaterThanOrEqual(MIN_DINING_TABLE_SIZE_M);
  });
});

describe('scaleDiningTableDimsToFitCount', () => {
  it('shrinks an oversized diameter so at least one table fits', () => {
    const el = diningBlock();
    const fitted = scaleDiningTableDimsToFitCount(el, {
      shape: 'round',
      widthM: 6.35,
      depthM: 6.35,
      gapM: 0.6,
      chairLengthM: 0.5,
      featureClearanceM: 0.8,
      minCount: 1,
    });
    expect(fitted.maxFillCount).toBeGreaterThanOrEqual(1);
    expect(fitted.widthM).toBeLessThan(6.35);
    expect(fitted.widthM).toBeLessThanOrEqual(4);
  });
});

describe('scaleChairLengthToFitTableCount', () => {
  it('shrinks chair depth when chairs alone make zero tables fit', () => {
    const el = diningBlock();
    const fitted = scaleChairLengthToFitTableCount(el, {
      shape: 'round',
      widthM: 2.0,
      depthM: 2.0,
      gapM: 0.6,
      chairLengthM: 4,
      featureClearanceM: 0.8,
      minCount: 1,
    });
    expect(fitted.maxFillCount).toBeGreaterThanOrEqual(1);
    expect(fitted.chairLengthM).toBeLessThan(4);
  });
});

describe('fitDiningTableAndChairToBlock', () => {
  const base = {
    shape: 'round' as const,
    gapM: 0.6,
    featureClearanceM: 0.8,
    template: 'grid' as const,
  };

  it('clamps huge chair width/depth instead of leaving them unbounded', () => {
    const el = diningBlock();
    const fitted = fitDiningTableAndChairToBlock(el, {
      ...base,
      widthM: 0.45,
      depthM: 0.45,
      chairLengthM: 11.45,
      chairWidthM: 15.05,
      prefer: 'chair',
    });

    expect(fitted.chairLengthM).toBeLessThanOrEqual(4);
    expect(fitted.chairLengthM).toBeGreaterThanOrEqual(MIN_DINING_CHAIR_LENGTH_M);
    expect(fitted.chairWidthM).toBeLessThanOrEqual(MAX_DINING_CHAIR_WIDTH_M);
    expect(fitted.chairWidthM).toBeLessThanOrEqual(fitted.widthM);
    expect(fitted.widthM).toBeGreaterThanOrEqual(MIN_DINING_TABLE_SIZE_M);
    expect(
      computeTableGridCapacity(el, {
        ...base,
        widthM: fitted.widthM,
        depthM: fitted.depthM,
        chairLengthM: fitted.chairLengthM,
      }).totalTables,
    ).toBeGreaterThanOrEqual(1);
  });

  it('shrinks table diameter when chair depth grows and space is gone', () => {
    const el = diningBlock();
    const fitted = fitDiningTableAndChairToBlock(el, {
      ...base,
      widthM: 2.4,
      depthM: 2.4,
      chairLengthM: 2.0,
      chairWidthM: 0.45,
      prefer: 'chair',
    });

    expect(fitted.chairLengthM).toBeCloseTo(2.0, 2);
    expect(fitted.widthM).toBeLessThan(2.4);
    expect(fitted.widthM).toBeGreaterThanOrEqual(MIN_DINING_TABLE_SIZE_M);
  });

  it('shrinks chair depth when table diameter grows and space is gone', () => {
    const el = diningBlock();
    const fitted = fitDiningTableAndChairToBlock(el, {
      ...base,
      widthM: 3.2,
      depthM: 3.2,
      chairLengthM: 1.5,
      chairWidthM: 0.45,
      prefer: 'table',
    });

    expect(fitted.widthM).toBeGreaterThanOrEqual(2.8);
    expect(fitted.widthM).toBeLessThanOrEqual(3.2);
    expect(fitted.chairLengthM).toBeLessThan(1.5);
    expect(fitted.chairLengthM).toBeGreaterThanOrEqual(MIN_DINING_CHAIR_LENGTH_M);
  });

  it('keeps chair width within practical min and the table size', () => {
    expect(maxDiningChairWidthForTable(1.2)).toBeLessThanOrEqual(MAX_DINING_CHAIR_WIDTH_M);
    expect(maxDiningChairWidthForTable(0.5)).toBeGreaterThanOrEqual(MIN_DINING_CHAIR_WIDTH_M);

    const el = diningBlock();
    const maxChair = maxDiningChairLengthForBlock(el, {
      ...base,
      widthM: MIN_DINING_TABLE_SIZE_M,
      depthM: MIN_DINING_TABLE_SIZE_M,
      chairLengthM: 0.5,
    });
    expect(maxChair).toBeLessThan(4);
    expect(maxChair).toBeGreaterThan(MIN_DINING_CHAIR_LENGTH_M);
  });
});

describe('resolveDiningWizardPack', () => {
  const venueBlock = (): CenterpieceElement =>
    ({
      ...diningBlock(),
      physicalLengthM: 10,
      physicalWidthM: 8,
    }) as CenterpieceElement;

  const packBase = {
    shape: 'round' as const,
    gapM: 0.6,
    featureClearanceM: 0.8,
    template: 'grid' as const,
    chairWidthM: 0.45,
  };

  it('drops table count when diameter grows, before shrinking chairs', () => {
    const packed = resolveDiningWizardPack(venueBlock(), {
      ...packBase,
      widthM: 6.1,
      depthM: 6.1,
      chairLengthM: 0.5,
      tableCount: 6,
      prefer: 'table',
    });

    expect(packed.tableCount).toBeLessThanOrEqual(6);
    expect(packed.maxTableCount).toBeLessThanOrEqual(packed.tableCount);
    expect(packed.widthM).toBeLessThanOrEqual(6.1);
  });

  it('reports real pack capacity at the geometric 1-table diameter (not forced)', () => {
    const el = venueBlock();
    const one = maxDiningTableDimsForBlock(el, {
      ...packBase,
      widthM: 1.2,
      depthM: 1.2,
      chairLengthM: 0.5,
    });
    const fit = countDiningTablesThatFit(el, {
      ...packBase,
      widthM: one.widthM,
      depthM: one.widthM,
      chairLengthM: 0.5,
    });
    expect(fit).toBeGreaterThanOrEqual(1);
  });

  it('drops a leftover count of 5 when diameter is already at the 1-table max', () => {
    const el = venueBlock();
    const one = maxDiningTableDimsForBlock(el, {
      ...packBase,
      widthM: 1.2,
      depthM: 1.2,
      chairLengthM: 0.5,
    });
    const maxFill = countDiningTablesThatFit(el, {
      ...packBase,
      widthM: one.widthM,
      depthM: one.widthM,
      chairLengthM: 0.5,
    });
    const packed = resolveDiningWizardPack(el, {
      ...packBase,
      widthM: one.widthM,
      depthM: one.widthM,
      chairLengthM: 0.5,
      tableCount: 5,
      prefer: 'table',
    });
    expect(packed.tableCount).toBeLessThanOrEqual(maxFill);
    expect(packed.maxTableCount).toBe(maxFill);
  });

  it('does not allow a 1-table min-chair diameter while several tables are still requested', () => {
    const el = venueBlock();
    const atCurrentChairs = diningWizardInputMaxes(el, {
      ...packBase,
      widthM: 1.2,
      depthM: 1.2,
      chairLengthM: 0.5,
      tableCount: 6,
    });
    const atMinChairs = diningWizardInputMaxes(el, {
      ...packBase,
      widthM: 1.2,
      depthM: 1.2,
      chairLengthM: 0.5,
      tableCount: 1,
    });

    expect(atCurrentChairs.maxWidthM).toBeLessThan(atMinChairs.maxWidthM);
    expect(atCurrentChairs.maxTableCount).toBeGreaterThan(1);
  });

  it('after 1 table, growing diameter shrinks chair depth and then hard-stops at min chairs', () => {
    const first = resolveDiningWizardPack(venueBlock(), {
      ...packBase,
      widthM: 7.55,
      depthM: 7.55,
      chairLengthM: 0.5,
      tableCount: 1,
      prefer: 'table',
    });

    expect(first.tableCount).toBe(1);
    // 8×10 room − 0.4 m wall clearance each side leaves ≤ 7.2 m for tabletop+chairs.
    expect(first.widthM).toBeGreaterThan(6);
    expect(first.widthM).toBeLessThanOrEqual(7.2);
    expect(first.chairLengthM).toBeLessThan(0.5);
    expect(first.chairLengthM).toBeGreaterThanOrEqual(MIN_DINING_CHAIR_LENGTH_M);

    const again = resolveDiningWizardPack(venueBlock(), {
      ...packBase,
      widthM: 18.9,
      depthM: 18.9,
      chairLengthM: first.chairLengthM,
      tableCount: 1,
      prefer: 'table',
    });

    expect(again.chairLengthM).toBeLessThanOrEqual(0.4);
    expect(again.chairLengthM).toBeGreaterThanOrEqual(MIN_DINING_CHAIR_LENGTH_M);
    expect(again.widthM).toBeLessThanOrEqual(7.2);
    expect(again.maxTableCount).toBeGreaterThanOrEqual(1);
  });

  it('does not advertise a diameter larger than one table can fit with wall clearance', () => {
    const room = {
      id: 'block-16',
      type: 'centerpiece',
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
      physicalWidthM: 5.7,
      physicalLengthM: 8.55,
    } as unknown as CenterpieceElement;

    const limits = diningWizardInputMaxes(room, {
      shape: 'round',
      widthM: 0.8,
      depthM: 0.8,
      gapM: 0.6,
      chairLengthM: 0.4,
      featureClearanceM: 0.8,
      template: 'grid',
      tableCount: 1,
    });

    // Without wall clearance this used to show Max 5.3 m and leave Continue broken.
    expect(limits.maxWidthM).toBeLessThan(5.3);
    expect(limits.maxWidthM).toBeLessThanOrEqual(4.55);
    expect(
      countDiningTablesThatFit(room, {
        shape: 'round',
        widthM: limits.maxWidthM,
        depthM: limits.maxWidthM,
        gapM: 0.6,
        chairLengthM: MIN_DINING_CHAIR_LENGTH_M,
        featureClearanceM: 0.8,
        template: 'grid',
      }),
    ).toBeGreaterThanOrEqual(1);
    expect(
      countDiningTablesThatFit(room, {
        shape: 'round',
        widthM: 5.3,
        depthM: 5.3,
        gapM: 0.6,
        chairLengthM: 0.4,
        featureClearanceM: 0.8,
        template: 'grid',
      }),
    ).toBe(0);

    const packed = resolveDiningWizardPack(room, {
      shape: 'round',
      widthM: 5.3,
      depthM: 5.3,
      gapM: 0.6,
      chairLengthM: 0.4,
      chairWidthM: 0.4,
      featureClearanceM: 0.8,
      template: 'grid',
      tableCount: 1,
      prefer: 'table',
    });
    expect(packed.widthM).toBeLessThanOrEqual(limits.maxWidthM);
    expect(packed.maxTableCount).toBeGreaterThanOrEqual(1);
  });

  it('after 1 table, growing chair depth shrinks diameter and then hard-stops at min table', () => {
    const packed = resolveDiningWizardPack(venueBlock(), {
      ...packBase,
      widthM: 2.4,
      depthM: 2.4,
      chairLengthM: 11.45,
      chairWidthM: 15.05,
      tableCount: 1,
      prefer: 'chair',
    });

    expect(packed.tableCount).toBe(1);
    expect(packed.widthM).toBeLessThan(2.4);
    expect(packed.widthM).toBeGreaterThanOrEqual(MIN_DINING_TABLE_SIZE_M);
    expect(packed.chairLengthM).toBeLessThan(11.45);
    expect(packed.chairWidthM).toBeLessThanOrEqual(MAX_DINING_CHAIR_WIDTH_M);
    expect(packed.maxTableCount).toBeGreaterThanOrEqual(1);
  });
});

describe('recording block capacity (5.9 m × 8.14 m)', () => {
  const recordingBlock = (): CenterpieceElement =>
    ({
      id: 'block-recording',
      type: 'centerpiece',
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
      physicalWidthM: 5.9,
      physicalLengthM: 8.14,
    }) as unknown as CenterpieceElement;

  const packBase = {
    shape: 'round' as const,
    gapM: 0.6,
    chairLengthM: 0.5,
    featureClearanceM: 0.8,
    template: 'grid' as const,
  };

  const capacityAt = (diameterM: number): number =>
    countDiningTablesThatFit(recordingBlock(), {
      ...packBase,
      widthM: diameterM,
      depthM: diameterM,
    });

  it('matches the browser recording capacity curve and is monotonic', () => {
    const at08 = capacityAt(0.8);
    const at15 = capacityAt(1.5);
    const at20 = capacityAt(2.0);
    const at305 = capacityAt(3.05);
    const at54 = capacityAt(5.4);

    // Wall clearance (0.4 m each side) reduces usable room vs a raw lattice.
    expect(at08).toBeGreaterThanOrEqual(4);
    expect(at15).toBeGreaterThanOrEqual(1);
    expect(at15).toBeLessThanOrEqual(at08);
    expect(at20).toBeGreaterThanOrEqual(1);
    expect(at20).toBeLessThanOrEqual(at15);
    expect(at305).toBeGreaterThanOrEqual(1);
    expect(at54).toBe(0);

    const samples = [0.8, 1.5, 2.0, 3.05, 5.4];
    const caps = samples.map(capacityAt);
    for (let i = 1; i < caps.length; i += 1) {
      expect(caps[i]).toBeLessThanOrEqual(caps[i - 1]!);
    }
  });
});

describe('centre stage 2D capacity', () => {
  const opts = {
    shape: 'round' as const,
    widthM: 1.2,
    depthM: 1.2,
    gapM: 0.6,
    chairLengthM: 0.5,
    featureClearanceM: 0.8,
    template: 'grid' as const,
  };

  function room(): CenterpieceElement {
    return {
      ...diningBlock(),
      physicalLengthM: 12,
      physicalWidthM: 16,
    } as unknown as CenterpieceElement;
  }

  it('treats a centre stage as a blocked rectangle without zeroing the room', () => {
    const empty = room();
    const withStage = {
      ...empty,
      diningStage: {
        sideEdgeId: 0,
        alignment: 'center',
        xPct: 50,
        yPct: 50,
        widthM: 4,
        depthM: 1.5,
        label: 'Stage',
      },
    } as unknown as CenterpieceElement;
    const basic = basicGeometricDiningCapacity(empty, opts);
    const operationalEmpty = estimatedOperationalDiningCapacity(empty, opts);
    const operationalStage = estimatedOperationalDiningCapacity(withStage, opts);
    expect(basic).toBe(operationalEmpty);
    expect(operationalStage).toBeGreaterThan(0);
    expect(operationalStage).toBeLessThan(basic);
  });
});

describe('free-rotated stage capacity', () => {
  const opts = {
    shape: 'round' as const,
    widthM: 0.6,
    depthM: 0.6,
    gapM: 0.6,
    chairLengthM: 0.5,
    featureClearanceM: 0.8,
    template: 'grid' as const,
  };

  function room(): CenterpieceElement {
    return {
      ...diningBlock(),
      physicalWidthM: 5.8,
      physicalLengthM: 9.33,
    } as unknown as CenterpieceElement;
  }

  it('does not apply a full-wall strip when the stage is angled away from the wall', () => {
    const el = {
      ...room(),
      diningStage: {
        sideEdgeId: 2,
        alignment: 'edge',
        xPct: 75,
        yPct: 90,
        widthM: 4,
        depthM: 1.2,
        rotationDeg: 45,
        label: 'Stage',
      },
    } as unknown as CenterpieceElement;
    expect(diningFeatureEdgeStripApplies(el, el.diningStage!)).toBe(false);
    const subs = getDiningFeatureSubtractions(el, 0.8);
    expect(subs.bottomSubtract).toBe(0);
  });

  it('does not under-count when a free-rotated stage no longer wipes the whole wall', () => {
    const base = room();
    const angled = {
      ...base,
      diningStage: {
        sideEdgeId: 2,
        alignment: 'edge',
        xPct: 75,
        yPct: 90,
        widthM: 4,
        depthM: 1.2,
        rotationDeg: 45,
        label: 'Stage',
      },
    } as unknown as CenterpieceElement;
    // Old bug: strip always applied for edge stages → capacity collapsed.
    expect(diningFeatureEdgeStripApplies(angled, angled.diningStage!)).toBe(false);
    expect(getDiningFeatureSubtractions(angled, 0.8).bottomSubtract).toBe(0);
    expect(countDiningTablesThatFit(angled, opts)).toBeGreaterThan(3);
  });
});
