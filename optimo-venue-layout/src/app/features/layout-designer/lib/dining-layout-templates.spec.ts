import { describe, expect, it } from 'vitest';

import type { CenterpieceElement } from '../models/layout-element.model';
import { rectFromPositionSize } from './geometry';
import {
  applyGeneratedDiningLayoutPatch,
  diningFeaturesPatchFromDraft,
  type DiningLayoutDraftInputs,
  type DiningLayoutTemplateDescriptor,
} from './dining-layout-templates';

function rectBlock(): CenterpieceElement {
  return {
    id: 'block-17',
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
    physicalLengthM: 10,
    physicalWidthM: 8,
  } as unknown as CenterpieceElement;
}

function draft(overrides: Partial<DiningLayoutDraftInputs> = {}): DiningLayoutDraftInputs {
  return {
    shape: 'round',
    tableWidthM: 1.2,
    tableDepthM: 1.2,
    tableGapM: 0.6,
    seats: 6,
    chairWidthM: 0.45,
    chairLengthM: 0.5,
    hasStage: true,
    stageWidthM: 4,
    stageDepthM: 1.2,
    hasFoodPrep: true,
    foodPrepWidthM: 2,
    foodPrepDepthM: 2,
    hasExit: true,
    tableCount: 10,
    hasServiceRoute: false,
    serviceRouteWidthM: 1.2,
    serviceRouteClearanceM: 0.6,
    ...overrides,
  };
}

describe('diningFeaturesPatchFromDraft', () => {
  const canvas = { width: 1000, height: 800 };

  it('creates stage and food prep when the wizard checkboxes are on', () => {
    const el = rectBlock();
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const patch = diningFeaturesPatchFromDraft(el, rect, draft());
    expect(patch.diningStage).toBeTruthy();
    expect(patch.diningStage?.widthM).toBe(4);
    expect(patch.diningFoodPrepare).toBeTruthy();
    expect(patch.diningFoodPrepare?.widthM).toBe(2);
  });

  it('shrinks stage defaults when the block is smaller than 4 m', () => {
    const el = rectBlock();
    el.physicalWidthM = 2.5;
    el.physicalLengthM = 2;
    el.customSideLengthsM = [2.5, 2, 2.5, 2];
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const patch = diningFeaturesPatchFromDraft(el, rect, draft());
    expect(patch.diningStage).toBeTruthy();
    expect(patch.diningStage!.widthM).toBeLessThanOrEqual(2.5);
    expect(patch.diningStage!.depthM).toBeLessThanOrEqual(2);
  });

  it('keeps a user-moved stage on its canvas position', () => {
    const el = rectBlock();
    el.diningStage = {
      widthM: 4,
      depthM: 1.2,
      xPct: 30,
      yPct: 55,
      sideEdgeId: 2,
      insetFromEdgeM: 2.4,
      offsetAlongEdgeM: -1,
      label: 'Stage',
    };
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const patch = diningFeaturesPatchFromDraft(el, rect, draft());
    expect(patch.diningStage?.xPct).toBeCloseTo(30, 0);
    expect(patch.diningStage?.yPct).toBeCloseTo(55, 0);
  });

  it('ignores generated stage geometry when the user already placed a stage', () => {
    const el = rectBlock();
    el.diningStage = {
      widthM: 4,
      depthM: 1.2,
      xPct: 50,
      yPct: 92,
      sideEdgeId: 2,
      insetFromEdgeM: 0.6,
      offsetAlongEdgeM: 0,
      label: 'Stage',
    };
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const patch = diningFeaturesPatchFromDraft(el, rect, draft(), {
      stage: { xPct: 10, yPct: 10, widthM: 3, depthM: 1, sideEdgeId: 0 },
    });
    expect(patch.diningStage?.xPct).toBeCloseTo(50, 0);
    expect(patch.diningStage?.yPct).toBeCloseTo(92, 0);
  });

  it('ignores generated food prep geometry when the user already placed food prep', () => {
    const el = rectBlock();
    el.diningFoodPrepare = {
      widthM: 2,
      depthM: 2,
      xPct: 88,
      yPct: 40,
      sideEdgeId: 1,
      insetFromEdgeM: 1,
      offsetAlongEdgeM: 0,
      label: 'Food Prep',
    };
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const patch = diningFeaturesPatchFromDraft(el, rect, draft(), {
      foodPrepare: { xPct: 12, yPct: 12, widthM: 2, depthM: 2, sideEdgeId: 3 },
    });
    expect(patch.diningFoodPrepare?.xPct).toBeCloseTo(88, 0);
    expect(patch.diningFoodPrepare?.yPct).toBeCloseTo(40, 0);
  });

  it('clears stage when the checkbox is off', () => {
    const el = rectBlock();
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const patch = diningFeaturesPatchFromDraft(el, rect, draft({ hasStage: false, hasFoodPrep: false }));
    expect(patch.diningStage).toBeUndefined();
    expect(patch.diningFoodPrepare).toBeUndefined();
  });
});

describe('applyGeneratedDiningLayoutPatch', () => {
  const canvas = { width: 1000, height: 800 };

  it('keeps generated table positions and places the selected stage', () => {
    const el = rectBlock();
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const tmpl: DiningLayoutTemplateDescriptor = {
      id: 'gen-regular-grid-1-0',
      name: 'Regular Grid',
      icon: '▦',
      description: '6 tables',
      tableCount: 6,
      totalSeats: 36,
      template: 'grid',
      stageSide: null,
      foodPrepareSide: null,
      exitSide: null,
      serviceRouteVertical: false,
      previewSvg: '<svg></svg>',
      source: 'generated',
      family: 'regular-grid',
      score: 70,
      generatedTables: [
        {
          id: 't-1',
          label: '1',
          xPct: 30,
          yPct: 40,
          shape: 'round',
          seats: 6,
          widthM: 1.2,
          rotationDeg: 0,
        },
      ],
    };
    const patch = applyGeneratedDiningLayoutPatch(el, rect, draft(), tmpl);
    expect(patch?.diningTables?.[0].xPct).toBe(30);
    expect(patch?.diningTables?.[0].widthM).toBe(1.2);
    expect(patch?.diningStage).toBeTruthy();
    expect(patch?.diningFoodPrepare).toBeTruthy();
  });

  it('keeps anchored stage and food prep when generated layout returns different feature positions', () => {
    const el = rectBlock();
    el.diningStage = {
      widthM: 4,
      depthM: 1.2,
      xPct: 50,
      yPct: 92,
      sideEdgeId: 2,
      insetFromEdgeM: 0.6,
      offsetAlongEdgeM: 0,
      label: 'Stage',
    };
    el.diningFoodPrepare = {
      widthM: 2,
      depthM: 2,
      xPct: 88,
      yPct: 40,
      sideEdgeId: 1,
      insetFromEdgeM: 1,
      offsetAlongEdgeM: 0,
      label: 'Food Prep',
    };
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const tmpl: DiningLayoutTemplateDescriptor = {
      id: 'gen-stage-facing-1-0',
      name: 'Stage Facing',
      icon: '▲',
      description: '6 tables',
      tableCount: 6,
      totalSeats: 36,
      template: 'grid',
      stageSide: null,
      foodPrepareSide: null,
      exitSide: null,
      serviceRouteVertical: false,
      previewSvg: '<svg></svg>',
      source: 'generated',
      family: 'stage-facing',
      score: 70,
      generatedTables: [
        {
          id: 't-1',
          label: '1',
          xPct: 25,
          yPct: 35,
          shape: 'round',
          seats: 6,
          widthM: 1.2,
          rotationDeg: 0,
        },
      ],
      generatedStage: { xPct: 12, yPct: 8, widthM: 3, depthM: 1, sideEdgeId: 0 },
      generatedFoodPrepare: { xPct: 15, yPct: 85, widthM: 2, depthM: 2, sideEdgeId: 2 },
    };
    const patch = applyGeneratedDiningLayoutPatch(el, rect, draft(), tmpl);
    expect(patch?.diningStage?.xPct).toBeCloseTo(50, 0);
    expect(patch?.diningStage?.yPct).toBeCloseTo(92, 0);
    expect(patch?.diningFoodPrepare?.xPct).toBeCloseTo(88, 0);
    expect(patch?.diningFoodPrepare?.yPct).toBeCloseTo(40, 0);
  });
});
