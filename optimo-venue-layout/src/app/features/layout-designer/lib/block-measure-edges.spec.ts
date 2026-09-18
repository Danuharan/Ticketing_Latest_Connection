import { describe, expect, it } from 'vitest';

import {
  buildBlockMeasureEdges,
  stadiumLogicalEdgeFromView,
  stadiumLogicalEdgesFacingDirection,
  stadiumLogicalEdgesFromView,
  resolveViewpointLogicalEdges,
  uniqueLogicalEdgesById,
  viewpointAisleStartPoint,
} from './block-measure-edges';

describe('stadiumLogicalEdgesFromView', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const cx = 50;
  const cy = 50;

  it('selects the single side that faces the viewpoint', () => {
    const edges = stadiumLogicalEdgesFromView(square, cx, cy, 0);
    expect(edges).toHaveLength(1);
    expect(edges[0].midY).toBeLessThan(cy);
  });

  it('does not apply a second viewpoint to an unrelated perpendicular side', () => {
    const edges = stadiumLogicalEdgesFromView(square, cx, cy, 45);
    expect(edges).toHaveLength(1);
    expect(stadiumLogicalEdgeFromView(square, cx, cy, 45)?.id).toBe(edges[0].id);
  });

  it('keeps a single side when the viewpoint is only slightly off centre', () => {
    const edges = stadiumLogicalEdgesFromView(square, cx, cy, 8);
    expect(edges).toHaveLength(1);
    expect(stadiumLogicalEdgeFromView(square, cx, cy, 8)?.id).toBe(edges[0].id);
  });

  it('picks one facing side when the other corner side is a different face', () => {
    const both = stadiumLogicalEdgesFromView(square, cx, cy, 45);
    const one = stadiumLogicalEdgeFromView(square, cx, cy, 45);
    expect(both).toHaveLength(1);
    expect(one).toBeTruthy();
    expect(both[0].id).toBe(one!.id);
  });

  it('marks both roof sides when they face the ground at the front', () => {
    const house = [
      { x: 0, y: 40 },
      { x: 50, y: 0 },
      { x: 100, y: 40 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const edges = stadiumLogicalEdgesFacingDirection(house, 50, 50, 0);
    expect(edges).toHaveLength(2);
    const midsY = edges.map((edge) => edge.midY);
    expect(midsY.every((y) => y < 50)).toBe(true);
    expect(edges.every((edge) => Math.abs(edge.x1 - edge.x2) > 1)).toBe(true);
  });

  it('does not mark a steep side-facing roof as a second viewpoint', () => {
    const chevron = [
      { x: 0, y: 70 },
      { x: 50, y: 0 },
      { x: 100, y: 70 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const edges = stadiumLogicalEdgesFacingDirection(chevron, 50, 50, 0);
    expect(edges).toHaveLength(1);
    expect(edges[0].midY).toBeLessThan(50);
  });

  it('marks both segments of a continuous bent front', () => {
    const bentFront = [
      { x: 0, y: 12 },
      { x: 50, y: 0 },
      { x: 100, y: 12 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const edges = stadiumLogicalEdgesFacingDirection(bentFront, 50, 50, 0);
    expect(edges).toHaveLength(2);
    expect(edges.every((edge) => edge.midY < 20)).toBe(true);
  });

  it('marks every contiguous front segment that faces the ground', () => {
    const steppedFront = [
      { x: 0, y: 24 },
      { x: 33, y: 8 },
      { x: 66, y: 8 },
      { x: 100, y: 24 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const edges = stadiumLogicalEdgesFacingDirection(steppedFront, 50, 50, 0);
    expect(edges).toHaveLength(3);
    expect(edges.every((edge) => edge.midY < 25)).toBe(true);
  });

  it('applies one viewpoint when two front segments merge into the same measured side', () => {
    const almostStraight = [
      { x: 0, y: 2 },
      { x: 50, y: 0 },
      { x: 100, y: 2 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const measuredFronts = buildBlockMeasureEdges(almostStraight).filter((edge) => edge.midY < 20);
    expect(measuredFronts).toHaveLength(1);
    const edges = stadiumLogicalEdgesFacingDirection(almostStraight, 50, 50, 0);
    expect(edges).toHaveLength(1);
    expect(edges[0].id).toBe(measuredFronts[0].id);
    const start = viewpointAisleStartPoint(almostStraight, 50, 50, 0, measuredFronts[0].sourceIndices);
    expect(start?.fromCorner).toBe(false);
    expect(start?.point.x).toBeCloseTo(measuredFronts[0].midX, 5);
    expect(start?.point.y).toBeCloseTo(measuredFronts[0].midY, 5);
  });

  it('keeps both viewpoints on separate measured sides of a continuous front', () => {
    const house = [
      { x: 0, y: 40 },
      { x: 50, y: 0 },
      { x: 100, y: 40 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const measuredFronts = buildBlockMeasureEdges(house).filter((edge) => edge.midY < 50);
    expect(measuredFronts).toHaveLength(2);
    const edges = stadiumLogicalEdgesFacingDirection(house, 50, 50, 0);
    expect(uniqueLogicalEdgesById(edges)).toHaveLength(2);
    expect(edges.map((edge) => edge.id).sort()).toEqual(measuredFronts.map((edge) => edge.id).sort());
  });

  it('does not mark laterals or the back as viewpoints', () => {
    const edges = stadiumLogicalEdgesFacingDirection(square, cx, cy, 0);
    expect(edges).toHaveLength(1);
    expect(edges[0].midY).toBeLessThan(cy);
    expect(edges[0].midX).toBeCloseTo(cx, 5);
  });

  it('does not mark an unrelated perpendicular face when the viewpoint is toward a corner', () => {
    const edges = stadiumLogicalEdgesFacingDirection(square, cx, cy, 45);
    expect(edges).toHaveLength(1);
  });

  it('does not mark left/right slants of a stadium trapezoid', () => {
    const trap = [
      { x: 20, y: 0 },
      { x: 80, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const edges = stadiumLogicalEdgesFacingDirection(trap, 50, 50, 0);
    expect(edges).toHaveLength(1);
    expect(edges[0].midY).toBeLessThan(20);
    expect(edges[0].midX).toBeCloseTo(50, 5);
  });

  it('does not set a viewpoint on a side wall at a different angle from the front', () => {
    const hex = [
      { x: 20, y: 0 },
      { x: 80, y: 0 },
      { x: 100, y: 30 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 30 },
    ];
    const edges = stadiumLogicalEdgesFacingDirection(hex, 50, 50, 0);
    expect(edges).toHaveLength(1);
    expect(edges[0].midY).toBeLessThan(10);
    expect(Math.abs(edges[0].x2 - edges[0].x1)).toBeGreaterThan(40);
  });

  it('does not mark chamfered left/right corners as viewpoints', () => {
    const chamfered = [
      { x: 20, y: 0 },
      { x: 80, y: 0 },
      { x: 100, y: 20 },
      { x: 100, y: 80 },
      { x: 80, y: 100 },
      { x: 20, y: 100 },
      { x: 0, y: 80 },
      { x: 0, y: 20 },
    ];
    const edges = stadiumLogicalEdgesFacingDirection(chamfered, 50, 50, 0);
    expect(edges).toHaveLength(1);
    expect(edges[0].midY).toBeLessThan(10);
    expect(Math.abs(edges[0].x2 - edges[0].x1)).toBeGreaterThan(40);
  });
});

describe('viewpointAisleStartPoint', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const cx = 50;
  const cy = 50;

  it('starts at the facing side midpoint for a single-side viewpoint', () => {
    const start = viewpointAisleStartPoint(square, cx, cy, 0);
    expect(start?.fromCorner).toBe(false);
    expect(start?.point.x).toBeCloseTo(50, 5);
    expect(start?.point.y).toBeCloseTo(0, 5);
  });

  it('starts at the facing side midpoint when the other corner side is unrelated', () => {
    const start = viewpointAisleStartPoint(square, cx, cy, 45);
    expect(start?.fromCorner).toBe(false);
  });

  it('starts at the house peak when both roof sides are viewpoints', () => {
    const house = [
      { x: 0, y: 40 },
      { x: 50, y: 0 },
      { x: 100, y: 40 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const start = viewpointAisleStartPoint(house, 50, 50, 0);
    expect(start?.fromCorner).toBe(true);
    expect(start?.point.x).toBeCloseTo(50, 5);
    expect(start?.point.y).toBeCloseTo(0, 5);
  });

  it('starts at the shared vertex when stored dual viewpoint indices are set', () => {
    const house = [
      { x: 0, y: 40 },
      { x: 50, y: 0 },
      { x: 100, y: 40 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const start = viewpointAisleStartPoint(house, 50, 50, 0, [0, 1]);
    expect(start?.fromCorner).toBe(true);
    expect(start?.point.x).toBeCloseTo(50, 5);
    expect(start?.point.y).toBeCloseTo(0, 5);
  });
});

describe('resolveViewpointLogicalEdges', () => {
  it('marks both ground-facing fronts even when the marker is not on a corner', () => {
    const house = [
      { x: 0, y: 40 },
      { x: 50, y: 0 },
      { x: 100, y: 40 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const resolved = resolveViewpointLogicalEdges(house, 50, 50, 0);
    expect(resolved).toHaveLength(2);
    expect(resolved.every((edge) => edge.midY < 50)).toBe(true);
  });

  it('keeps a single side when only one face points at the viewpoint', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(resolveViewpointLogicalEdges(square, 50, 50, 0)).toHaveLength(1);
    expect(resolveViewpointLogicalEdges(square, 50, 50, 8)).toHaveLength(1);
    expect(resolveViewpointLogicalEdges(square, 50, 50, 45)).toHaveLength(1);
    expect(resolveViewpointLogicalEdges(square, 50, 50, 90)).toHaveLength(1);
    expect(resolveViewpointLogicalEdges(square, 50, 50, 180)).toHaveLength(1);
  });

  it('ignores trapezoid left and right slants', () => {
    const trap = [
      { x: 20, y: 0 },
      { x: 80, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const edges = resolveViewpointLogicalEdges(trap, 50, 50, 0);
    expect(edges).toHaveLength(1);
    expect(edges[0].midX).toBeCloseTo(50, 5);
    expect(edges[0].midY).toBeLessThan(20);
  });
});
