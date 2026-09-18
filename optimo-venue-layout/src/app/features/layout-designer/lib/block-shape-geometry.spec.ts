import { describe, expect, it } from 'vitest';

import {
  boundsFromCircleGeometry,
  boundsFromEllipseGeometry,
  geometryFromCircleBounds,
  geometryFromCurvedLine,
  geometryFromCurvedRect,
  geometryFromEllipseBounds,
  hydrateBlockGridFromGeometry,
  hydrateCenterpieceFromGeometry,
  pathCommandsToSvgD,
  resolveBlockGridShapeDraw,
  resolveCenterpieceShapeDraw,
  syncBlockGridGeometry,
  syncCenterpieceGeometry,
} from './block-shape-geometry';
import type { BlockGridElement, CanvasConfig, CenterpieceElement } from '../models/layout-element.model';
import { createBlockGrid, createShapedCenterpiece } from '../data/element-factory';

const canvas: CanvasConfig = { width: 1000, height: 800 };

function asCenterpiece(el: ReturnType<typeof createShapedCenterpiece>): CenterpieceElement {
  expect(el.type).toBe('centerpiece');
  return el as CenterpieceElement;
}

describe('block-shape-geometry', () => {
  it('reconstructs square from position/size without geometry', () => {
    const el = asCenterpiece(
      createShapedCenterpiece('square', {
        position: { xPct: 50, yPct: 30 },
        size: { wPct: 4, hPct: 4 },
        canvas,
      }),
    );
    const resolved = resolveCenterpieceShapeDraw(el, canvas);
    expect(resolved.shapeMode).toBe('rect');
    expect(resolved.fromGeometry).toBe(false);
    expect(resolved.rect.width).toBeCloseTo(40, 5);
    expect(resolved.rect.height).toBeCloseTo(32, 5);
  });

  it('reconstructs rectangle from position/size without geometry', () => {
    const el = asCenterpiece(
      createShapedCenterpiece('rectangle', {
        position: { xPct: 50, yPct: 30 },
        size: { wPct: 8, hPct: 4 },
        canvas,
      }),
    );
    const resolved = resolveCenterpieceShapeDraw(el, canvas);
    expect(resolved.shapeMode).toBe('rect');
    expect(el.geometry).toBeUndefined();
  });

  it('circle create → sync → resolve from geometry', () => {
    const created = asCenterpiece(
      createShapedCenterpiece('circle', {
        position: { xPct: 50, yPct: 30 },
        size: { wPct: 10, hPct: 12.5 },
        canvas,
      }),
    );
    expect(created.geometry?.type).toBe('circle');
    if (created.geometry?.type !== 'circle') {
      return;
    }
    expect(created.geometry.center).toEqual({ xPct: 50, yPct: 30 });
    expect(created.geometry.radiusPct).toBeGreaterThan(0);

    const resolved = resolveCenterpieceShapeDraw(created, canvas);
    expect(resolved.shapeMode).toBe('ellipse');
    expect(resolved.fromGeometry).toBe(true);
    expect(resolved.rect.cx).toBeCloseTo(500, 5);
    expect(resolved.rect.cy).toBeCloseTo(240, 5);
    expect(resolved.rect.width).toBeCloseTo(resolved.rect.height, 5);
  });

  it('oval create → resolve from ellipse geometry radii', () => {
    const el = asCenterpiece(
      createShapedCenterpiece('oval', {
        position: { xPct: 50, yPct: 30 },
        size: { wPct: 16, hPct: 8 },
        canvas,
      }),
    );
    expect(el.geometry).toEqual({
      type: 'ellipse',
      center: { xPct: 50, yPct: 30 },
      radiusXPct: 8,
      radiusYPct: 4,
    });
    const resolved = resolveCenterpieceShapeDraw(el, canvas);
    expect(resolved.shapeMode).toBe('ellipse');
    expect(resolved.fromGeometry).toBe(true);
    expect(resolved.rect.width).toBeCloseTo(160, 5);
    expect(resolved.rect.height).toBeCloseTo(64, 5);
  });

  it('custom customPoints always draw as polygon even if shape is circle', () => {
    const el: CenterpieceElement = {
      id: 'c1',
      type: 'centerpiece',
      name: 'Block',
      shape: 'circle',
      label: 'A',
      curveDeg: 0,
      customPoints: [
        { xPct: 0, yPct: 0 },
        { xPct: 100, yPct: 0 },
        { xPct: 100, yPct: 80 },
        { xPct: 50, yPct: 100 },
        { xPct: 0, yPct: 80 },
      ],
      position: { xPct: 40, yPct: 40 },
      size: { wPct: 10, hPct: 10 },
      rotation: 0,
      style: {},
      geometry: {
        type: 'circle',
        center: { xPct: 40, yPct: 40 },
        radiusPct: 5,
      },
    };
    const resolved = resolveCenterpieceShapeDraw(el, canvas);
    expect(resolved.shapeMode).toBe('polygon');
    expect(resolved.fromGeometry).toBe(false);
    expect(resolved.pathD).toContain(',');
  });

  it('curved uses path geometry from curveDeg (existing bowed-rect algorithm)', () => {
    const el = asCenterpiece(
      createShapedCenterpiece('curved', {
        position: { xPct: 50, yPct: 50 },
        size: { wPct: 20, hPct: 10 },
        curveDeg: 30,
        canvas,
      }),
    );
    expect(el.geometry?.type).toBe('path');
    if (el.geometry?.type !== 'path') {
      return;
    }
    expect(el.geometry.commands[0]?.command).toBe('M');
    expect(el.geometry.commands.some((c) => c.command === 'Z')).toBe(true);

    const resolved = resolveCenterpieceShapeDraw(el, canvas);
    expect(resolved.shapeMode).toBe('path');
    expect(resolved.fromGeometry).toBe(true);
    expect(resolved.pathD).toMatch(/^M/);
  });

  it('legacy circle without geometry still renders as ellipse from size', () => {
    const el: CenterpieceElement = {
      id: 'legacy',
      type: 'centerpiece',
      name: 'Old',
      shape: 'circle',
      label: '',
      curveDeg: 0,
      position: { xPct: 50, yPct: 50 },
      size: { wPct: 10, hPct: 12.5 },
      rotation: 0,
      style: {},
    };
    const resolved = resolveCenterpieceShapeDraw(el, canvas);
    expect(resolved.shapeMode).toBe('ellipse');
    expect(resolved.fromGeometry).toBe(false);
  });

  it('hydrate aligns position/size from saved circle geometry', () => {
    const geometry = geometryFromCircleBounds(
      { xPct: 20, yPct: 40 },
      { wPct: 10, hPct: 12.5 },
      canvas,
    );
    const el: CenterpieceElement = {
      id: 'h1',
      type: 'centerpiece',
      name: 'H',
      shape: 'circle',
      label: '',
      curveDeg: 0,
      geometry,
      position: { xPct: 0, yPct: 0 },
      size: { wPct: 1, hPct: 1 },
      rotation: 0,
      style: {},
    };
    const hydrated = hydrateCenterpieceFromGeometry(el, canvas);
    expect(hydrated.position).toEqual(geometry.center);
    const bounds = boundsFromCircleGeometry(geometry, canvas);
    expect(hydrated.size.wPct).toBeCloseTo(bounds.size.wPct, 5);
  });

  it('sync does not strip customPoints seating outlines', () => {
    const el: CenterpieceElement = {
      id: 'seat',
      type: 'centerpiece',
      name: 'S',
      shape: 'square',
      label: '1',
      curveDeg: 0,
      blockType: 'seating',
      customPoints: [
        { xPct: 0, yPct: 0 },
        { xPct: 100, yPct: 0 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
      seatLayout: { rows: 2, seatsPerRow: 3, rowLabelStyle: 'letter' },
      position: { xPct: 50, yPct: 50 },
      size: { wPct: 8, hPct: 8 },
      rotation: 0,
      style: {},
    };
    const synced = syncCenterpieceGeometry(el, canvas);
    expect(synced.customPoints).toEqual(el.customPoints);
    expect(synced.seatLayout).toEqual(el.seatLayout);
    expect(synced.geometry).toBeUndefined();
  });

  it('pathCommandsToSvgD maps local % into pixel path', () => {
    const rect = {
      x: 100,
      y: 200,
      width: 200,
      height: 100,
      cx: 200,
      cy: 250,
    };
    const d = pathCommandsToSvgD(
      [
        { command: 'M', xPct: 0, yPct: 0 },
        { command: 'C', x1Pct: 30, y1Pct: 0, x2Pct: 70, y2Pct: 0, xPct: 100, yPct: 0 },
        { command: 'Z' },
      ],
      rect,
    );
    expect(d).toContain('M100.00 200.00');
    expect(d).toContain('C');
    expect(d.endsWith('Z')).toBe(true);
  });

  it('ellipse bounds round-trip', () => {
    const geometry = geometryFromEllipseBounds({ xPct: 40, yPct: 60 }, { wPct: 20, hPct: 10 });
    expect(boundsFromEllipseGeometry(geometry).size).toEqual({ wPct: 20, hPct: 10 });
    expect(geometryFromCurvedRect(0).commands.length).toBeGreaterThanOrEqual(5);
  });

  it('legacy block-grid without shape still draws as rounded rect', () => {
    const el: BlockGridElement = {
      id: 'g-legacy',
      type: 'block-grid',
      name: 'Block',
      code: 'B01',
      label: 'Block',
      rows: 4,
      seatsPerRow: 8,
      rowLabelStyle: 'letter',
      position: { xPct: 50, yPct: 50 },
      size: { wPct: 24, hPct: 22 },
      rotation: 0,
      style: {},
    };
    const resolved = resolveBlockGridShapeDraw(el, canvas);
    expect(resolved.shapeMode).toBe('rect');
    expect(resolved.rectRx).toBe(6);
    expect(resolved.fromGeometry).toBe(false);
    const synced = syncBlockGridGeometry(el, canvas);
    expect(synced.shape).toBeUndefined();
    expect(synced.geometry).toBeUndefined();
  });

  it('block-grid square / oval / circle / curved-line create and resolve', () => {
    const square = createBlockGrid('square', { canvas });
    expect(square.shape).toBe('square');
    expect(square.geometry).toBeUndefined();
    expect(resolveBlockGridShapeDraw(square, canvas).shapeMode).toBe('rect');

    const oval = createBlockGrid('oval', { canvas });
    expect(oval.geometry?.type).toBe('ellipse');
    expect(resolveBlockGridShapeDraw(oval, canvas).shapeMode).toBe('ellipse');

    const circle = createBlockGrid('circle', {
      canvas,
      size: { wPct: 20, hPct: 28 },
    });
    expect(circle.geometry?.type).toBe('circle');
    const circleResolved = resolveBlockGridShapeDraw(circle, canvas);
    expect(circleResolved.shapeMode).toBe('ellipse');
    expect(circleResolved.rect.width).toBeCloseTo(circleResolved.rect.height, 5);

    const curved = createBlockGrid('curved-line', { canvas });
    expect(curved.geometry?.type).toBe('path');
    expect(curved.geometry && curved.geometry.type === 'path' && curved.geometry.commands.some((c) => c.command === 'C')).toBe(
      true,
    );
    expect(curved.geometry && curved.geometry.type === 'path' && curved.geometry.commands.some((c) => c.command === 'L')).toBe(
      true,
    );
    expect(resolveBlockGridShapeDraw(curved, canvas).shapeMode).toBe('path');
    expect(geometryFromCurvedLine(28).commands[0]?.command).toBe('M');
  });

  it('hydrate block-grid circle geometry aligns position/size', () => {
    const geometry = geometryFromCircleBounds({ xPct: 40, yPct: 35 }, { wPct: 16, hPct: 20 }, canvas);
    const el: BlockGridElement = {
      id: 'g1',
      type: 'block-grid',
      name: 'Block',
      code: 'B02',
      label: 'Block',
      rows: 3,
      seatsPerRow: 5,
      rowLabelStyle: 'letter',
      shape: 'circle',
      geometry,
      position: { xPct: 0, yPct: 0 },
      size: { wPct: 1, hPct: 1 },
      rotation: 0,
      style: {},
    };
    const hydrated = hydrateBlockGridFromGeometry(el, canvas);
    expect(hydrated.position).toEqual(geometry.center);
    const bounds = boundsFromCircleGeometry(geometry, canvas);
    expect(hydrated.size.wPct).toBeCloseTo(bounds.size.wPct, 5);
    expect(hydrated.size.hPct).toBeCloseTo(bounds.size.hPct, 5);
    const resolved = resolveBlockGridShapeDraw(hydrated, canvas);
    expect(resolved.rect.width).toBeCloseTo(resolved.rect.height, 5);
  });

  it('block-grid oval/circle drag follows position even if geometry.center is stale', () => {
    const oval = createBlockGrid('oval', {
      canvas,
      position: { xPct: 30, yPct: 40 },
      size: { wPct: 20, hPct: 10 },
    });
    expect(oval.geometry?.type).toBe('ellipse');
    const movedOval: BlockGridElement = {
      ...oval,
      position: { xPct: 70, yPct: 60 },
      // Simulate pre-fix drag: position updated, geometry.center not yet synced
      geometry:
        oval.geometry?.type === 'ellipse'
          ? { ...oval.geometry, center: { xPct: 30, yPct: 40 } }
          : oval.geometry,
    };
    const ovalResolved = resolveBlockGridShapeDraw(movedOval, canvas);
    expect(ovalResolved.rect.cx).toBeCloseTo(700, 5);
    expect(ovalResolved.rect.cy).toBeCloseTo(480, 5);
    expect(ovalResolved.rect.width).toBeCloseTo(200, 5);
    expect(ovalResolved.rect.height).toBeCloseTo(80, 5);

    const circle = createBlockGrid('circle', {
      canvas,
      position: { xPct: 20, yPct: 25 },
    });
    const movedCircle: BlockGridElement = {
      ...circle,
      position: { xPct: 55, yPct: 65 },
      geometry:
        circle.geometry?.type === 'circle'
          ? { ...circle.geometry, center: { xPct: 20, yPct: 25 } }
          : circle.geometry,
    };
    const circleResolved = resolveBlockGridShapeDraw(movedCircle, canvas);
    expect(circleResolved.rect.cx).toBeCloseTo(550, 5);
    expect(circleResolved.rect.cy).toBeCloseTo(520, 5);
    expect(circleResolved.rect.width).toBeCloseTo(circleResolved.rect.height, 5);
  });
});
