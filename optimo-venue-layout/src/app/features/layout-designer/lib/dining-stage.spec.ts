import { describe, expect, it } from 'vitest';

import type { CenterpieceElement } from '../models/layout-element.model';
import { rectFromPositionSize } from './geometry';
import {
  buildDiningEntranceRenderNode,
  buildDiningStageRenderNode,
  clampDiningAccessPointToEdge,
  createDiningAccessPointOnSide,
  createDiningStageOnSide,
  diningAccessEdgeHitThresholdPx,
  diningAccessEdgeLengthM,
  diningFeatureDisplayLabel,
  diningFeatureRotationDeg,
  diningFoodPrepIconScale,
  diningFoodPrepIconVisible,
  fitDiningFeatureDimsToBlock,
  normalizeDiningFeatureRotationDeg,
  reorientDiningStageToSide,
  resolveDiningAccessPointAtCanvasPoint,
  resolveDiningFeatureRotationDeg,
} from './dining-stage';

function rectBlock(): CenterpieceElement {
  return {
    id: 'block-rect',
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

function triangleBlock(): CenterpieceElement {
  return {
    id: 'block-tri',
    shape: 'custom',
    position: { xPct: 50, yPct: 50 },
    size: { wPct: 40, hPct: 40 },
    customPoints: [
      { xPct: 50, yPct: 0 },
      { xPct: 100, yPct: 100 },
      { xPct: 0, yPct: 100 },
    ],
    blockType: 'dining-table',
  } as unknown as CenterpieceElement;
}

describe('diningAccessEdgeHitThresholdPx', () => {
  it('keeps ~28 screen pixels at 100% zoom', () => {
    expect(diningAccessEdgeHitThresholdPx(100)).toBeCloseTo(28, 5);
  });

  it('shrinks in canvas units as zoom increases', () => {
    expect(diningAccessEdgeHitThresholdPx(800)).toBeCloseTo(3.5, 5);
  });
});

describe('resolveDiningAccessPointAtCanvasPoint edge hit-test', () => {
  const canvas = { width: 1000, height: 800 };

  it('accepts a click on a rectangular block edge', () => {
    const el = rectBlock();
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const preview = resolveDiningAccessPointAtCanvasPoint(
      el,
      rect,
      rect.x,
      rect.cy,
      'entrance',
      28,
    );
    expect(preview).not.toBeNull();
    expect(preview?.kind).toBe('entrance');
  });

  it('rejects a click in the rectangular block interior', () => {
    const el = rectBlock();
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const preview = resolveDiningAccessPointAtCanvasPoint(
      el,
      rect,
      rect.cx,
      rect.cy,
      'entrance',
      28,
    );
    expect(preview).toBeNull();
  });

  it('rejects a click outside the block', () => {
    const el = rectBlock();
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const preview = resolveDiningAccessPointAtCanvasPoint(
      el,
      rect,
      rect.x - 80,
      rect.cy,
      'exit',
      28,
    );
    expect(preview).toBeNull();
  });

  it('accepts a click on a custom polygon boundary segment', () => {
    const el = triangleBlock();
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const bottomMidX = rect.x + rect.width / 2;
    const bottomY = rect.y + rect.height;
    const preview = resolveDiningAccessPointAtCanvasPoint(
      el,
      rect,
      bottomMidX,
      bottomY,
      'shared',
      28,
    );
    expect(preview).not.toBeNull();
    expect(preview?.kind).toBe('shared');
  });

  it('rejects a click inside a custom polygon that is not on an edge', () => {
    const el = triangleBlock();
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const preview = resolveDiningAccessPointAtCanvasPoint(
      el,
      rect,
      rect.cx,
      rect.cy,
      'exit',
      28,
    );
    expect(preview).toBeNull();
  });
});

describe('clampDiningAccessPointToEdge', () => {
  const canvas = { width: 1000, height: 800 };

  it('clamps width to the edge length and keeps the opening on-edge', () => {
    const el = rectBlock();
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const edgeLen = diningAccessEdgeLengthM(el, rect, 0);
    expect(edgeLen).not.toBeNull();

    const clamped = clampDiningAccessPointToEdge(el, rect, {
      id: 'exit-1',
      kind: 'exit',
      widthM: (edgeLen ?? 1) * 3,
      depthM: 0.4,
      sideEdgeId: 0,
      xPct: 50,
      yPct: 0,
      offsetAlongEdgeM: 0,
      insetFromEdgeM: 0.2,
      label: 'Exit',
      alignment: 'edge',
    });

    expect(clamped.widthM).toBeLessThanOrEqual((edgeLen ?? 0) + 1e-6);
    const maxOff = Math.max(0, (edgeLen ?? 0) / 2 - clamped.widthM / 2);
    expect(Math.abs(clamped.offsetAlongEdgeM ?? 0)).toBeLessThanOrEqual(maxOff + 1e-6);
  });

  it('shifts an off-centre opening back onto the edge when width grows', () => {
    const el = rectBlock();
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const edgeLen = diningAccessEdgeLengthM(el, rect, 2);
    expect(edgeLen).not.toBeNull();

    const clamped = clampDiningAccessPointToEdge(el, rect, {
      id: 'exit-2',
      kind: 'exit',
      widthM: (edgeLen ?? 1) * 0.9,
      depthM: 0.4,
      sideEdgeId: 2,
      xPct: 50,
      yPct: 100,
      offsetAlongEdgeM: (edgeLen ?? 1) * 0.45,
      insetFromEdgeM: 0.2,
      label: 'Exit',
      alignment: 'edge',
    });

    const maxOff = Math.max(0, (edgeLen ?? 0) / 2 - clamped.widthM / 2);
    expect(clamped.offsetAlongEdgeM ?? 0).toBeLessThanOrEqual(maxOff + 1e-6);
    expect(clamped.offsetAlongEdgeM ?? 0).toBeGreaterThanOrEqual(-maxOff - 1e-6);
  });
});

describe('diningFeatureDisplayLabel', () => {
  it('normalises stored uppercase defaults to title case', () => {
    expect(diningFeatureDisplayLabel('STAGE', 'stage')).toBe('Stage');
    expect(diningFeatureDisplayLabel('FOOD PREP', 'food-prep')).toBe('Food Prep');
    expect(diningFeatureDisplayLabel('Food Preparation', 'food-prep')).toBe('Food Prep');
  });

  it('keeps custom labels unchanged', () => {
    expect(diningFeatureDisplayLabel('Main Stage', 'stage')).toBe('Main Stage');
  });

  it('falls back when empty', () => {
    expect(diningFeatureDisplayLabel(undefined, 'stage')).toBe('Stage');
    expect(diningFeatureDisplayLabel('  ', 'food-prep')).toBe('Food Prep');
  });
});

describe('measured-side feature scale', () => {
  const canvas = { width: 1000, height: 800 };

  function measuredRectBlock(): CenterpieceElement {
    return {
      ...rectBlock(),
      customSideLengthsM: [4, 2.32, 4, 2.32],
      physicalLengthM: 10,
      physicalWidthM: 8,
    } as CenterpieceElement;
  }

  it('draws a 1.5 m entrance as 1.5/4 of the 4 m top wall', () => {
    const el = measuredRectBlock();
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const spec = createDiningAccessPointOnSide(el, rect, 0, 'entrance', 1.5);
    expect(spec).not.toBeNull();
    const node = buildDiningEntranceRenderNode(
      { ...el, diningEntrance: spec! },
      rect,
      false,
    );
    expect(node).not.toBeNull();
    expect(node!.widthPx / rect.width).toBeCloseTo(1.5 / 4, 2);
    expect(node!.wallSegment).toBeDefined();
    const wallLen = Math.hypot(
      node!.wallSegment!.x2 - node!.wallSegment!.x1,
      node!.wallSegment!.y2 - node!.wallSegment!.y1,
    );
    expect(wallLen / rect.width).toBeCloseTo(1.5 / 4, 2);
  });

  it('draws a 3 m × 1 m stage as 3/4 of the 4 m top wall', () => {
    const el = measuredRectBlock();
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const spec = createDiningStageOnSide(el, rect, 0, { widthM: 3, depthM: 1 });
    expect(spec).not.toBeNull();
    const node = buildDiningStageRenderNode({ ...el, diningStage: spec! }, rect, false);
    expect(node).not.toBeNull();
    expect(node!.widthPx / rect.width).toBeCloseTo(3 / 4, 2);
    expect(node!.heightPx / node!.widthPx).toBeCloseTo(1 / 3, 1);
  });
});

describe('diningFoodPrepIconScale', () => {
  it('keeps the hospitality mark compact relative to the zone', () => {
    const scale = diningFoodPrepIconScale(80, 28);
    expect(scale * 14).toBeLessThanOrEqual(16);
    expect(scale * 14).toBeGreaterThanOrEqual(9);
    expect(diningFoodPrepIconVisible(80, 28)).toBe(true);
    expect(diningFoodPrepIconVisible(8, 8)).toBe(false);
  });
});

describe('fitDiningFeatureDimsToBlock', () => {
  const canvas = { width: 1000, height: 800 };

  function smallDiningBlock(): CenterpieceElement {
    return {
      ...rectBlock(),
      physicalWidthM: 2.5,
      physicalLengthM: 2,
      customSideLengthsM: [2.5, 2, 2.5, 2],
    } as unknown as CenterpieceElement;
  }

  it('shrinks a 4 m default stage to fit a smaller block edge', () => {
    const el = smallDiningBlock();
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const fitted = fitDiningFeatureDimsToBlock(
      el,
      rect,
      { widthM: 4, depthM: 1.2 },
      0,
    );
    expect(fitted.widthM).toBeLessThanOrEqual(2.5);
    expect(fitted.widthM).toBeGreaterThan(0.2);
    expect(fitted.depthM).toBeLessThanOrEqual(2);
    expect(fitted.depthM).toBeGreaterThan(0.2);
  });

  it('createDiningStageOnSide stores the fitted size, not the oversized default', () => {
    const el = smallDiningBlock();
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const stage = createDiningStageOnSide(el, rect, 0, { widthM: 4, depthM: 1.2 });
    expect(stage).not.toBeNull();
    expect(stage!.widthM).toBeLessThanOrEqual(2.5);
    expect(stage!.depthM).toBeLessThanOrEqual(2);
    const node = buildDiningStageRenderNode({ ...el, diningStage: stage! }, rect, false);
    expect(node).not.toBeNull();
    // Stage must not be wider than the block rect on canvas.
    expect(node!.widthPx).toBeLessThanOrEqual(rect.width + 1);
  });
});

describe('dining stage free rotation', () => {
  const canvas = { width: 1000, height: 800 };

  it('stores wall-edge rotation on create and uses a custom rotationDeg when set', () => {
    const el = {
      id: 'block-rot',
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
      customSideLengthsM: [8, 10, 8, 10],
    } as unknown as CenterpieceElement;
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const stage = createDiningStageOnSide(el, rect, 0, { widthM: 3, depthM: 1 });
    expect(stage).not.toBeNull();
    const edgeDeg = normalizeDiningFeatureRotationDeg(
      diningFeatureRotationDeg(el, rect, 0),
    );
    expect(stage!.rotationDeg).toBeCloseTo(edgeDeg, 1);

    const custom = { ...stage!, rotationDeg: 37 };
    expect(resolveDiningFeatureRotationDeg(el, rect, custom)).toBeCloseTo(37, 1);
    const node = buildDiningStageRenderNode({ ...el, diningStage: custom }, rect, false);
    expect(node).not.toBeNull();
    expect(node!.rotationDeg).toBeCloseTo(37, 1);
  });

  it('reorientDiningStageToSide resets rotationDeg to the new wall angle', () => {
    const el = {
      id: 'block-reorient',
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
      customSideLengthsM: [8, 10, 8, 10],
    } as unknown as CenterpieceElement;
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const stage = createDiningStageOnSide(el, rect, 0, { widthM: 3, depthM: 1 });
    expect(stage).not.toBeNull();
    const twisted = { ...stage!, rotationDeg: 55 };
    const reoriented = reorientDiningStageToSide(el, rect, twisted, 1);
    expect(reoriented).not.toBeNull();
    const side1Deg = normalizeDiningFeatureRotationDeg(
      diningFeatureRotationDeg(el, rect, 1),
    );
    expect(reoriented!.rotationDeg).toBeCloseTo(side1Deg, 1);
    expect(reoriented!.rotationDeg).not.toBeCloseTo(55, 0);
  });
});
