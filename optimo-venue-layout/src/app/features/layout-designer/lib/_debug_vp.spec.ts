import { describe, expect, it } from 'vitest';
import { computeImportSeatingPlan } from './import-seating';
import { polygonCanvasPointsFromBlock, viewpointAngleFromCanvasPoint } from './block-viewpoint';
import { stadiumLogicalEdgesFacingDirection, stadiumLogicalEdgeFromView, stadiumLogicalEdgesFromView } from './block-measure-edges';

function makeBlock(overrides: any = {}) {
  return {
    id: 'blk-1',
    type: 'centerpiece' as const,
    name: 'N3401',
    shape: 'custom' as const,
    label: 'N3401',
    curveDeg: 0,
    customPoints: [
      { xPct: 0, yPct: 40 },
      { xPct: 50, yPct: 0 },
      { xPct: 100, yPct: 40 },
      { xPct: 100, yPct: 100 },
      { xPct: 0, yPct: 100 },
    ],
    position: { xPct: 50, yPct: 20 },
    size: { wPct: 20, hPct: 15 },
    rotation: 0,
    style: { fillColor: '#fff', strokeColor: '#000', labelColor: '#000' },
    ...overrides,
  };
}

const RECT = { x: 400, y: 87.5, width: 200, height: 105, cx: 500, cy: 140 };

describe('debug viewpoint', () => {
  it('house shape error check', () => {
    const polygon = polygonCanvasPointsFromBlock(makeBlock().customPoints!, RECT);
    const angle = viewpointAngleFromCanvasPoint(500, 140, 500, 20);
    console.log('angle:', angle);
    const facing = stadiumLogicalEdgesFacingDirection(polygon, 500, 140, angle);
    console.log('facingSides:', facing.map(e => ({ id: e.id, index: e.index, len: Math.round(e.lengthPx), midX: Math.round(e.midX), midY: Math.round(e.midY) })));
    const best = stadiumLogicalEdgeFromView(polygon, 500, 140, angle);
    console.log('bestFromView:', best ? { id: best.id, index: best.index, len: Math.round(best.lengthPx) } : null);
    const fromView = stadiumLogicalEdgesFromView(polygon, 500, 140, angle);
    console.log('fromView:', fromView.map(e => ({ id: e.id, index: e.index, len: Math.round(e.lengthPx) })));

    const plan = computeImportSeatingPlan(makeBlock(), RECT, {
      blockCode: 'N3401',
      rows: 4,
      seatsPerRow: 6,
      lineNumber: 2,
    }, { x: 500, y: 20 });
    if ('error' in plan) {
      console.log('ERROR:', plan.error);
    } else {
      console.log('OK:', { angle: plan.viewpointAngleDeg, sides: plan.patch.dragSeatsStadiumSideIndices, sideIndex: plan.patch.dragSeatsStadiumSideIndex });
    }
    expect('error' in plan ? plan.error : 'no error').toBe('no error');
  });
});
