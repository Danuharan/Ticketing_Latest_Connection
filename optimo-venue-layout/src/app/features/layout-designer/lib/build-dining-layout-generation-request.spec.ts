import { describe, expect, it } from 'vitest';

import type { CenterpieceElement } from '../models/layout-element.model';
import { buildDiningLayoutGenerationRequest } from './build-dining-layout-generation-request';
import { rectFromPositionSize } from './geometry';

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

describe('buildDiningLayoutGenerationRequest', () => {
  it('synthesizes stage geometry when the checkbox is on but the element has no stage yet', () => {
    const el = rectBlock();
    const rect = rectFromPositionSize(el.position, el.size, { width: 1000, height: 800 });
    const req = buildDiningLayoutGenerationRequest({
      element: el,
      rect,
      draft: {
        shape: 'round',
        tableWidthM: 1.2,
        tableDepthM: 1.2,
        tableGapM: 0.6,
        seats: 6,
        chairWidthM: 0.45,
        chairLengthM: 0.5,
        tableCount: 10,
        hasStage: true,
        hasFoodPrep: true,
        stageWidthM: 4,
        stageDepthM: 1.2,
        stageSide: 0,
        foodPrepWidthM: 2,
        foodPrepDepthM: 2,
        foodPrepSide: 2,
      },
      seed: 1,
      excludeFingerprints: [],
      categories: [],
      selectedCategoryId: '',
    });
    expect(req.features.stage).toBeTruthy();
    expect(req.features.stage?.widthM).toBe(4);
    expect(req.features.foodPrep).toBeTruthy();
    expect(req.features.foodPrep?.widthM).toBe(2);
    expect(req.target.tableCount).toBe(10);
  });

  it('sends exact anchored stage and food prep geometry from the placed element', () => {
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
    const rect = rectFromPositionSize(el.position, el.size, { width: 1000, height: 800 });
    const req = buildDiningLayoutGenerationRequest({
      element: el,
      rect,
      draft: {
        shape: 'round',
        tableWidthM: 1.2,
        tableDepthM: 1.2,
        tableGapM: 0.6,
        seats: 6,
        chairWidthM: 0.45,
        chairLengthM: 0.5,
        tableCount: 8,
        hasStage: true,
        hasFoodPrep: true,
        stageWidthM: 4,
        stageDepthM: 1.2,
        stageSide: 0,
        foodPrepWidthM: 2,
        foodPrepDepthM: 2,
        foodPrepSide: 2,
      },
      seed: 1,
      excludeFingerprints: [],
      categories: [],
      selectedCategoryId: '',
    });
    expect(req.features.stage?.xM).toBeCloseTo(4, 2);
    expect(req.features.stage?.yM).toBeCloseTo(9.2, 2);
    expect(req.features.stage?.widthM).toBe(4);
    expect(req.features.foodPrep?.xM).toBeCloseTo(7.04, 2);
    expect(req.features.foodPrep?.yM).toBeCloseTo(4, 2);
    expect(req.features.foodPrep?.widthM).toBe(2);
  });

  it('omits selected tableCount from capacity-mode requests', () => {
    const el = rectBlock();
    const rect = rectFromPositionSize(el.position, el.size, { width: 1000, height: 800 });
    const req = buildDiningLayoutGenerationRequest({
      element: el,
      rect,
      draft: {
        shape: 'round',
        tableWidthM: 0.6,
        tableDepthM: 0.6,
        tableGapM: 0.6,
        seats: 4,
        chairWidthM: 0.4,
        chairLengthM: 0.5,
        tableCount: 3,
        hasStage: true,
        hasFoodPrep: false,
        stageWidthM: 4,
        stageDepthM: 1.2,
        stageSide: 0,
      },
      seed: 1,
      excludeFingerprints: [],
      categories: [],
      selectedCategoryId: '',
      mode: 'capacity',
    });
    expect(req.generation.mode).toBe('capacity');
    expect(req.target.tableCount).toBeUndefined();
    expect(req.target.targetCapacity).toBeUndefined();
  });

  it('sends the entered table gap instead of silently flooring to 0.6', () => {
    const el = rectBlock();
    const rect = rectFromPositionSize(el.position, el.size, { width: 1000, height: 800 });
    const req = buildDiningLayoutGenerationRequest({
      element: el,
      rect,
      draft: {
        shape: 'round',
        tableWidthM: 0.6,
        tableDepthM: 0.6,
        tableGapM: 0.4,
        seats: 3,
        chairWidthM: 0.45,
        chairLengthM: 0.5,
        tableCount: 4,
        hasStage: false,
        hasFoodPrep: false,
      },
      seed: 1,
      excludeFingerprints: [],
      categories: [],
      selectedCategoryId: '',
    });
    expect(req.rules.minimumTableToTableClearanceM).toBeCloseTo(0.4, 5);
  });

  it('forwards the stored free stage rotationDeg (not only the wall angle)', () => {
    const el = {
      ...rectBlock(),
      diningStage: {
        sideEdgeId: 2,
        widthM: 4,
        depthM: 1.2,
        xPct: 70,
        yPct: 85,
        offsetAlongEdgeM: 0,
        insetFromEdgeM: 0.6,
        rotationDeg: 45,
        label: 'Stage',
        alignment: 'edge' as const,
      },
    } as unknown as CenterpieceElement;
    const rect = rectFromPositionSize(el.position, el.size, { width: 1000, height: 800 });
    const req = buildDiningLayoutGenerationRequest({
      element: el,
      rect,
      draft: {
        shape: 'round',
        tableWidthM: 0.6,
        tableDepthM: 0.6,
        tableGapM: 0.6,
        seats: 4,
        chairWidthM: 0.45,
        chairLengthM: 0.5,
        tableCount: 8,
        hasStage: true,
        hasFoodPrep: false,
        stageWidthM: 4,
        stageDepthM: 1.2,
        stageSide: 2,
      },
      seed: 1,
      excludeFingerprints: [],
      categories: [],
      selectedCategoryId: '',
      mode: 'capacity',
    });
    expect(req.features.stage?.rotationDeg).toBeCloseTo(45, 1);
  });

  it('forwards editable keep-out clearances into generator rules', () => {
    const el = rectBlock();
    const rect = rectFromPositionSize(el.position, el.size, { width: 1000, height: 800 });
    const req = buildDiningLayoutGenerationRequest({
      element: el,
      rect,
      draft: {
        shape: 'round',
        tableWidthM: 0.6,
        tableDepthM: 0.6,
        tableGapM: 0.6,
        seats: 3,
        chairWidthM: 0.45,
        chairLengthM: 0.5,
        tableCount: 6,
        hasStage: true,
        hasFoodPrep: true,
        stageWidthM: 4,
        stageDepthM: 1.2,
        stageClearanceM: 0.3,
        foodPrepClearanceM: 0.25,
        accessClearanceM: 0.5,
        serviceRouteClearanceM: 0.4,
        wallClearanceM: 0.2,
      },
      seed: 1,
      excludeFingerprints: [],
      categories: [],
      selectedCategoryId: '',
      mode: 'capacity',
    });
    expect(req.rules.stageClearanceM).toBe(0.3);
    expect(req.rules.foodPrepClearanceM).toBe(0.25);
    expect(req.rules.entranceClearanceM).toBe(0.5);
    expect(req.rules.exitClearanceM).toBe(0.5);
    expect(req.rules.serviceRouteClearanceM).toBe(0.4);
    expect(req.rules.wallClearanceM).toBe(0.2);
    expect(req.rules.minimumTableToTableClearanceM).toBe(0.6);
  });
});
