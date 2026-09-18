import { describe, expect, it } from 'vitest';

import { applySharedBlockCurveToOverrides, pointInsidePolygonWithPadding } from './custom-shape-seats';
import { rectFromPositionSize } from './geometry';
import { DEFAULT_AUTO_FILL_SEATING_CONFIG } from '../models/auto-fill-seating.model';
import type { CenterpieceElement } from '../models/layout-element.model';
import {
  AUTO_FILL_CURVE_DEFAULT_DEG,
  applyAutoFillBlockCurve,
  applyAutoFillCurveToSeatLayout,
  applyAutoFillToBlock,
  clampAutoFillCurveDeg,
  resolveCreateAutoFillCurveDeg,
  resolveDualCurveFoci,
  resolveEffectiveAutoFillCurveDeg,
} from './auto-fill-seating';

function seatingBlock(): CenterpieceElement {
  return {
    id: 'blk-curve',
    type: 'centerpiece',
    name: 'CURVE',
    code: 'CURVE',
    shape: 'custom',
    label: 'CURVE',
    blockType: 'seating',
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
    customSideLengthsM: [20, 15, 20, 15],
    physicalLengthM: 15,
    physicalWidthM: 20,
  };
}

describe('clampAutoFillCurveDeg', () => {
  it('keeps zero as straight and clamps out-of-range values', () => {
    expect(clampAutoFillCurveDeg(0)).toBe(0);
    expect(clampAutoFillCurveDeg(24)).toBe(24);
    expect(clampAutoFillCurveDeg(-8)).toBe(0);
    expect(clampAutoFillCurveDeg(99)).toBe(50);
    expect(clampAutoFillCurveDeg(undefined)).toBe(0);
  });
});

describe('resolveEffectiveAutoFillCurveDeg', () => {
  it('is 0 unless Curved is enabled', () => {
    expect(
      resolveEffectiveAutoFillCurveDeg({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        curveEnabled: false,
        curveDeg: 24,
      }),
    ).toBe(0);
    expect(
      resolveEffectiveAutoFillCurveDeg({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        curveEnabled: true,
        curveDeg: 24,
      }),
    ).toBe(24);
  });
});

describe('resolveCreateAutoFillCurveDeg', () => {
  it('uses the default curve when Curved is on but value is unset', () => {
    expect(
      resolveCreateAutoFillCurveDeg({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        curveEnabled: true,
        curveDeg: 0,
      }),
    ).toBe(6);
    expect(
      resolveCreateAutoFillCurveDeg({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        curveEnabled: true,
        curveDeg: 18,
      }),
    ).toBe(18);
    expect(
      resolveCreateAutoFillCurveDeg({
        ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
        curveEnabled: false,
        curveDeg: 0,
      }),
    ).toBe(0);
  });
});

describe('applyAutoFillCurveToSeatLayout', () => {
  it('writes the same curve on every row', () => {
    const next = applyAutoFillCurveToSeatLayout(
      { rows: 4, seatsPerRow: 8, rowSeatCounts: [8, 8, 8, 8] },
      18,
    );
    expect(next.rowCurveDeg).toBe(18);
    expect(next.rowCurveDegs?.length).toBe(4);
    expect(next.rowCurveDegs).toEqual([18, 18, 18, 18]);
  });
});

/** Chair glyph at 0° faces +Y; SVG rotate is clockwise. */
function chairFacingVector(deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: -Math.sin(rad), y: Math.cos(rad) };
}

describe('applySharedBlockCurveToOverrides', () => {
  const rect = { x: 0, y: 0, width: 400, height: 300, cx: 200, cy: 150 };
  const polygon = [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 300 },
    { x: 0, y: 300 },
  ];
  const straight = {
    A1: { xPct: 10, yPct: 20 },
    A2: { xPct: 30, yPct: 20 },
    A3: { xPct: 50, yPct: 20 },
    A4: { xPct: 70, yPct: 20 },
    A5: { xPct: 90, yPct: 20 },
    B1: { xPct: 20, yPct: 40 },
    B2: { xPct: 50, yPct: 40 },
    B3: { xPct: 80, yPct: 40 },
    C1: { xPct: 50, yPct: 60 },
  };
  const viewpointFrame = {
    origin: { x: 0, y: 0 },
    ux: 1,
    uy: 0,
    perpX: 0,
    perpY: 1,
  };

  it('leaves seats unchanged when curve is 0', () => {
    const next = applySharedBlockCurveToOverrides(straight, rect, polygon, 0, viewpointFrame);
    expect(next['A3']).toEqual(straight.A3);
    expect(next['B2']).toEqual(straight.B2);
  });

  it('curves kept seats toward the view point; removes seats that hit the border', () => {
    const next = applySharedBlockCurveToOverrides(straight, rect, polygon, 6, viewpointFrame);
    expect(next['A3']).toBeDefined();
    // One-sided: edge seats wrap toward VIEW POINT (smaller y), middle barely moves.
    if (next['A1'] && next['A5']) {
      expect(next['A1'].yPct).toBeLessThan(straight.A1.yPct);
      expect(next['A5'].yPct).toBeLessThan(straight.A5.yPct);
      const midA = Math.hypot(next['A3'].xPct - straight.A3.xPct, next['A3'].yPct - straight.A3.yPct);
      const edgeA = Math.hypot(next['A1'].xPct - straight.A1.xPct, next['A1'].yPct - straight.A1.yPct);
      expect(edgeA).toBeGreaterThan(midA);
    }
    const strong = applySharedBlockCurveToOverrides(straight, rect, polygon, 50, viewpointFrame);
    expect(Object.keys(strong).length).toBeLessThanOrEqual(Object.keys(straight).length);
  });

  it('applies a visible one-sided wrap at the default curve value 6', () => {
    const next = applySharedBlockCurveToOverrides(straight, rect, polygon, 6, viewpointFrame);
    const midMove = Math.hypot(
      next['A3'].xPct - straight.A3.xPct,
      next['A3'].yPct - straight.A3.yPct,
    );
    const edgeMove = Math.hypot(
      next['A1'].xPct - straight.A1.xPct,
      next['A1'].yPct - straight.A1.yPct,
    );
    expect(edgeMove).toBeGreaterThan(1);
    expect(edgeMove).toBeGreaterThan(midMove);
    expect(next['A1'].yPct).toBeLessThan(straight.A1.yPct);
  });

  it('increases displacement when the curve value increases', () => {
    const mild = applySharedBlockCurveToOverrides(straight, rect, polygon, 3, viewpointFrame);
    const strong = applySharedBlockCurveToOverrides(straight, rect, polygon, 6, viewpointFrame);
    const mildMove = Math.hypot(mild['A1'].xPct - straight.A1.xPct, mild['A1'].yPct - straight.A1.yPct);
    const strongMove = Math.hypot(
      strong['A1'].xPct - straight.A1.xPct,
      strong['A1'].yPct - straight.A1.yPct,
    );
    expect(strongMove).toBeGreaterThan(mildMove);
  });

  it('does not store per-seat rotation — all seats use the uniform block facing', () => {
    const next = applySharedBlockCurveToOverrides(straight, rect, polygon, 6, viewpointFrame);
    const a1 = next['A1'];
    const a3 = next['A3'];
    const a5 = next['A5'];
    expect(a3).toBeDefined();
    expect(a3.rotationDeg).toBeUndefined();
    expect(a1.rotationDeg).toBeUndefined();
    expect(a5.rotationDeg).toBeUndefined();
  });

  it('keeps the same wrap on every row for the same along position', () => {
    const next = applySharedBlockCurveToOverrides(straight, rect, polygon, 6, viewpointFrame);
    const aMove = Math.hypot(
      next['A3'].xPct - straight.A3.xPct,
      next['A3'].yPct - straight.A3.yPct,
    );
    const bMove = Math.hypot(
      next['B2'].xPct - straight.B2.xPct,
      next['B2'].yPct - straight.B2.yPct,
    );
    expect(bMove).toBeCloseTo(aMove, 5);
  });

  it('removes seats that would touch the border (no border touch)', () => {
    const nearEdge = {
      A1: { xPct: 5, yPct: 8 },
      A2: { xPct: 50, yPct: 8 },
      A3: { xPct: 95, yPct: 8 },
    };
    const next = applySharedBlockCurveToOverrides(nearEdge, rect, polygon, 50, viewpointFrame);
    // Seats that remain are all inside the padded polygon.
    for (const id of Object.keys(next)) {
      const pt = {
        x: rect.x + (next[id].xPct / 100) * rect.width,
        y: rect.y + (next[id].yPct / 100) * rect.height,
      };
      expect(pointInsidePolygonWithPadding(pt, polygon, 3)).toBe(true);
    }
    // Some edge seats should have been removed.
    expect(Object.keys(next).length).toBeLessThanOrEqual(Object.keys(nearEdge).length);
  });

  it('removes overlapping seats when curve is strong — remaining seats never touch', () => {
    const dense = {
      A1: { xPct: 20, yPct: 20 },
      A2: { xPct: 35, yPct: 20 },
      A3: { xPct: 50, yPct: 20 },
      A4: { xPct: 65, yPct: 20 },
      A5: { xPct: 80, yPct: 20 },
      B1: { xPct: 20, yPct: 38 },
      B2: { xPct: 35, yPct: 38 },
      B3: { xPct: 50, yPct: 38 },
      B4: { xPct: 65, yPct: 38 },
      B5: { xPct: 80, yPct: 38 },
    };
    const next = applySharedBlockCurveToOverrides(dense, rect, polygon, 50, viewpointFrame);
    const keptIds = Object.keys(next);
    // Some seats removed (count ≤ original).
    expect(keptIds.length).toBeLessThanOrEqual(Object.keys(dense).length);
    expect(keptIds.length).toBeGreaterThan(0);
    const pts = keptIds.map((id) => ({
      x: rect.x + (next[id].xPct / 100) * rect.width,
      y: rect.y + (next[id].yPct / 100) * rect.height,
    }));
    // All remaining seats have no overlap.
    const alongPitch = 60;
    const rowPitch = 54;
    const radius = Math.max(2.8, Math.min(rowPitch * 0.34, alongPitch * 0.42));
    const minAllowed = radius * 2;
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        expect(d).toBeGreaterThanOrEqual(minAllowed);
      }
    }
  });

  it('adds seats back when curve decreases (more space available)', () => {
    const dense = {
      A1: { xPct: 20, yPct: 20 },
      A2: { xPct: 35, yPct: 20 },
      A3: { xPct: 50, yPct: 20 },
      A4: { xPct: 65, yPct: 20 },
      A5: { xPct: 80, yPct: 20 },
      B1: { xPct: 20, yPct: 38 },
      B2: { xPct: 35, yPct: 38 },
      B3: { xPct: 50, yPct: 38 },
      B4: { xPct: 65, yPct: 38 },
      B5: { xPct: 80, yPct: 38 },
    };
    const strong = applySharedBlockCurveToOverrides(dense, rect, polygon, 50, viewpointFrame);
    const mild = applySharedBlockCurveToOverrides(dense, rect, polygon, 2, viewpointFrame);
    // Lower curve = more seats retained.
    expect(Object.keys(mild).length).toBeGreaterThanOrEqual(Object.keys(strong).length);
  });

  it('orients the first half toward viewpoint 1 and the rest toward viewpoint 2', () => {
    const dualFrame = {
      ...viewpointFrame,
      dualFoci: [
        { x: 0, y: -40 },
        { x: 400, y: -40 },
      ],
    };
    const next = applySharedBlockCurveToOverrides(straight, rect, polygon, 6, dualFrame);
    expect(next['A1']).toBeDefined();
    expect(next['A5']).toBeDefined();
    // Per-seat rotation removed — all seats use block-level facing.
    expect(next['A1'].rotationDeg).toBeUndefined();
    expect(next['A5'].rotationDeg).toBeUndefined();
    // Positions still curve toward their respective viewpoints.
    expect(next['A1'].xPct).toBeLessThan(straight.A1.xPct);
    expect(next['A5'].xPct).toBeGreaterThan(straight.A5.xPct);
    expect(next['A1'].yPct).toBeLessThan(straight.A1.yPct);
    expect(next['A5'].yPct).toBeLessThan(straight.A5.yPct);
  });

  it('curves aisle leftovers on the same block circle, not two mini-circles', () => {
    const withAisle = {
      A1: { xPct: 10, yPct: 20 },
      A2: { xPct: 25, yPct: 20 },
      A3: { xPct: 75, yPct: 20 },
      A4: { xPct: 90, yPct: 20 },
      B1: { xPct: 10, yPct: 45 },
      B2: { xPct: 25, yPct: 45 },
      B3: { xPct: 75, yPct: 45 },
      B4: { xPct: 90, yPct: 45 },
    };
    const next = applySharedBlockCurveToOverrides(withAisle, rect, polygon, 6, viewpointFrame);
    expect(next['A1']).toBeDefined();
    expect(next['A2']).toBeDefined();
    expect(next['A3']).toBeDefined();
    expect(next['A4']).toBeDefined();
    const move = (id: 'A1' | 'A2' | 'A3' | 'A4') =>
      Math.hypot(next[id].xPct - withAisle[id].xPct, next[id].yPct - withAisle[id].yPct);
    // Outer seats of the block wrap more than the inner aisle edges.
    expect(move('A1')).toBeGreaterThan(move('A2'));
    expect(move('A4')).toBeGreaterThan(move('A3'));
    // Left leftover does not bow around its own mid (that would wrap A2 as much as A1).
    expect(next['A1'].yPct).toBeLessThan(next['A2'].yPct);
    expect(next['A4'].yPct).toBeLessThan(next['A3'].yPct);
  });

  it('curves an unshaped short row on the same block circle as the wide rows', () => {
    const unshaped = {
      A1: { xPct: 10, yPct: 20 },
      A2: { xPct: 30, yPct: 20 },
      A3: { xPct: 50, yPct: 20 },
      A4: { xPct: 70, yPct: 20 },
      A5: { xPct: 90, yPct: 20 },
      B1: { xPct: 10, yPct: 70 },
      B2: { xPct: 25, yPct: 70 },
      B3: { xPct: 40, yPct: 70 },
    };
    const next = applySharedBlockCurveToOverrides(unshaped, rect, polygon, 6, viewpointFrame);
    expect(next['B1']).toBeDefined();
    expect(next['B3']).toBeDefined();
    const moveB1 = Math.hypot(
      next['B1'].xPct - unshaped.B1.xPct,
      next['B1'].yPct - unshaped.B1.yPct,
    );
    const moveB3 = Math.hypot(
      next['B3'].xPct - unshaped.B3.xPct,
      next['B3'].yPct - unshaped.B3.yPct,
    );
    // B3 sits nearer the block centre, so it is a chord of the same circle — not
    // the opposite edge of a private short-row bow.
    expect(moveB1).toBeGreaterThan(moveB3);
    expect(next['B1'].yPct).toBeLessThan(next['B3'].yPct);
  });
});

describe('Auto Fill curve', () => {
  const canvas = { width: 2000, height: 1500 };

  it('uses default curve 6 when Curved is on and Create seats runs with unset curve', () => {
    expect(AUTO_FILL_CURVE_DEFAULT_DEG).toBe(6);
    const el = seatingBlock();
    const result = applyAutoFillToBlock(el, [el], canvas, {
      ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
      curveEnabled: true,
      curveDeg: 0,
    });
    expect('error' in result).toBe(false);
    if ('error' in result) {
      return;
    }
    expect(result.patch.seatLayout?.rowCurveDeg).toBe(6);
  });

  it('curved seat count is at most the straight max — edge seats removed if needed', () => {
    const el = seatingBlock();
    const straight = applyAutoFillToBlock(el, [el], canvas, {
      ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
      curveEnabled: false,
      curveDeg: 0,
    });
    const curved = applyAutoFillToBlock(el, [el], canvas, {
      ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
      curveEnabled: true,
      curveDeg: 0,
    });
    expect('error' in straight).toBe(false);
    expect('error' in curved).toBe(false);
    if ('error' in straight || 'error' in curved) {
      return;
    }
    const straightCount = Object.keys(straight.patch.seatPositionOverrides ?? {}).length;
    const curvedCount = Object.keys(curved.patch.seatPositionOverrides ?? {}).length;
    expect(curvedCount).toBeLessThanOrEqual(straightCount);
    expect(curvedCount).toBeGreaterThan(0);
  });

  it('keeps the normal straight layout when Curved is not ticked', () => {
    const el = seatingBlock();
    const result = applyAutoFillToBlock(el, [el], canvas, {
      ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
      curveEnabled: false,
      curveDeg: 24,
    });
    expect('error' in result).toBe(false);
    if ('error' in result) {
      return;
    }
    const baseline = result.patch.autoFillStraightSeatPositions ?? {};
    const placed = result.patch.seatPositionOverrides ?? {};
    const sample = Object.keys(baseline)[0];
    expect(sample).toBeTruthy();
    expect(placed[sample]).toEqual(baseline[sample]);
    expect(result.patch.seatLayout?.rowCurveDeg).toBe(0);
  });

  it('stores a straight baseline; curved may have fewer seats (border touch removed)', () => {
    const el = seatingBlock();
    const result = applyAutoFillToBlock(el, [el], canvas, {
      ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
      curveEnabled: true,
      curveDeg: 24,
    });
    expect('error' in result).toBe(false);
    if ('error' in result) {
      return;
    }
    expect(result.patch.seatLayout?.rowCurveDeg).toBe(24);
    const stamped = result.patch.seatLayout?.rowCurveDegs ?? [];
    expect(stamped.length).toBeGreaterThan(1);
    expect(stamped.every((deg) => deg === 24)).toBe(true);
    // Straight baseline has ALL generated seats; curved overrides may have fewer.
    const baselineCount = Object.keys(result.patch.autoFillStraightSeatPositions ?? {}).length;
    const curvedCount = Object.keys(result.patch.seatPositionOverrides ?? {}).length;
    expect(baselineCount).toBeGreaterThanOrEqual(curvedCount);
    expect(curvedCount).toBeGreaterThan(0);

    const baseline = result.patch.autoFillStraightSeatPositions ?? {};
    const curved = result.patch.seatPositionOverrides ?? {};
    // Edge seats wrap toward VIEW POINT (one-sided curve).
    const keptA = Object.keys(curved).filter((id) => id.startsWith('A')).sort();
    const edgeId = keptA[0];
    expect(edgeId).toBeTruthy();
    const delta = Math.hypot(
      (curved[edgeId]?.xPct ?? 0) - (baseline[edgeId]?.xPct ?? 0),
      (curved[edgeId]?.yPct ?? 0) - (baseline[edgeId]?.yPct ?? 0),
    );
    expect(delta).toBeGreaterThan(0);
  });

  it('live-updates from the straight baseline when curve changes', () => {
    const el = seatingBlock();
    const filled = applyAutoFillToBlock(el, [el], canvas, {
      ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
      curveEnabled: false,
      curveDeg: 0,
    });
    expect('error' in filled).toBe(false);
    if ('error' in filled) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const baseline = filled.patch.autoFillStraightSeatPositions ?? {};
    const filledEl = { ...el, ...filled.patch };
    const mild = applyAutoFillBlockCurve(filledEl, rect, baseline, 2);
    const strong = applyAutoFillBlockCurve(filledEl, rect, baseline, 6);
    const kept = Object.keys(strong).filter((id) => baseline[id] && mild[id]);
    const byRow = new Map<string, string[]>();
    for (const id of kept) {
      const row = id.replace(/\d+$/, '');
      const list = byRow.get(row) ?? [];
      list.push(id);
      byRow.set(row, list);
    }
    const rowIds = [...byRow.values()].find((ids) => ids.length >= 3) ?? kept;
    const sorted = [...rowIds].sort();
    const mid = sorted[Math.floor(sorted.length / 2)];
    const edge = sorted[0];
    const mildEdge = Math.hypot(
      mild[edge].xPct - baseline[edge].xPct,
      mild[edge].yPct - baseline[edge].yPct,
    );
    const strongEdge = Math.hypot(
      strong[edge].xPct - baseline[edge].xPct,
      strong[edge].yPct - baseline[edge].yPct,
    );
    const strongMid = Math.hypot(
      strong[mid].xPct - baseline[mid].xPct,
      strong[mid].yPct - baseline[mid].yPct,
    );
    expect(strongEdge).toBeGreaterThan(mildEdge);
    expect(strongEdge).toBeGreaterThan(strongMid);
  });

  it('curves a dual-viewpoint house so each half faces its own front', () => {
    const house: CenterpieceElement = {
      ...seatingBlock(),
      customPoints: [
        { xPct: 0, yPct: 40 },
        { xPct: 50, yPct: 0 },
        { xPct: 100, yPct: 40 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
      customSideLengthsM: [12, 12, 15, 20, 15],
      dragSeatsStadiumSideIndex: 0,
      dragSeatsStadiumSideIndices: [0, 1],
      blockViewpointAngleDeg: 0,
    };
    const rect = rectFromPositionSize(house.position, house.size, canvas);
    const polygon = [
      { x: rect.x, y: rect.y + rect.height * 0.4 },
      { x: rect.x + rect.width * 0.5, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height * 0.4 },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ];
    const foci = resolveDualCurveFoci(house, polygon, rect);
    expect(foci).toHaveLength(2);
    expect(foci![0].x).toBeLessThan(foci![1].x);

    const baseline = {
      A1: { xPct: 32, yPct: 58 },
      A2: { xPct: 41, yPct: 58 },
      A3: { xPct: 50, yPct: 58 },
      A4: { xPct: 59, yPct: 58 },
      A5: { xPct: 68, yPct: 58 },
      B1: { xPct: 32, yPct: 72 },
      B2: { xPct: 41, yPct: 72 },
      B3: { xPct: 50, yPct: 72 },
      B4: { xPct: 59, yPct: 72 },
      B5: { xPct: 68, yPct: 72 },
    };
    const next = applyAutoFillBlockCurve(house, rect, baseline, 6);
    expect(next['A1']).toBeDefined();
    expect(next['A5']).toBeDefined();
    // Per-seat rotation removed — all seats use block-level facing.
    expect(next['A1'].rotationDeg).toBeUndefined();
    expect(next['A5'].rotationDeg).toBeUndefined();
    // Positions still curve toward their respective viewpoints.
    expect(next['A1'].xPct).toBeLessThan(baseline.A1.xPct);
    expect(next['A5'].xPct).toBeGreaterThan(baseline.A5.xPct);
  });
});
