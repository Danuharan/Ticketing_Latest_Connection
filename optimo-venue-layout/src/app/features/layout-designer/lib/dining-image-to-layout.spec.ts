import { describe, expect, it } from 'vitest';

import type { CenterpieceElement } from '../models/layout-element.model';
import { pointInPolygon } from './custom-shape-seats';
import { buildDiningLayoutFromImageDetection } from './dining-image-to-layout';
import type { DiningLayoutDetectionResult } from './detect-dining-layout';
import { polygonCanvasPointsFromBlock } from './block-viewpoint';
import { rectFromPositionSize } from './geometry';

function triangleBlock(): CenterpieceElement {
  return {
    id: 'block-1',
    shape: 'custom',
    position: { xPct: 50, yPct: 50 },
    size: { wPct: 40, hPct: 40 },
    customPoints: [
      { xPct: 50, yPct: 0 },
      { xPct: 100, yPct: 100 },
      { xPct: 0, yPct: 100 },
    ],
    blockType: 'dining-table',
  } as CenterpieceElement;
}

const detection: DiningLayoutDetectionResult = {
  width: 400,
  height: 300,
  contentBounds: { minXPct: 0, minYPct: 0, maxXPct: 100, maxYPct: 100 },
  tables: [
    { xPct: 5, yPct: 5, shape: 'round', wPct: 4, hPct: 4, seats: 0 },
    { xPct: 50, yPct: 55, shape: 'round', wPct: 4, hPct: 4, seats: 0 },
    { xPct: 95, yPct: 95, shape: 'round', wPct: 4, hPct: 4, seats: 0 },
  ],
  features: [
    { kind: 'stage', xPct: 50, yPct: 8, wPct: 40, hPct: 8 },
    { kind: 'exit', xPct: 50, yPct: 96, wPct: 10, hPct: 4 },
  ],
  aisles: [
    {
      points: [
        { xPct: 30, yPct: 20 },
        { xPct: 30, yPct: 80 },
      ],
      widthPct: 4,
      orientation: 'vertical',
    },
  ],
  structure: {
    pattern: 'grid',
    tableCount: 3,
    roundCount: 3,
    rectangularCount: 0,
    rowCount: 2,
    columnCount: 2,
    hasHeadTable: false,
    hasStage: true,
    hasExit: true,
    hasEntrance: false,
    hasFoodPrep: false,
    aisleCount: 1,
    summary: 'Detected grid layout: 3 tables, stage, exit.',
  },
  confidence: 'medium',
  notes: '',
};

describe('buildDiningLayoutFromImageDetection', () => {
  it('keeps tables and features inside the block polygon', () => {
    const element = triangleBlock();
    const canvas = { width: 1000, height: 800 };
    const rect = rectFromPositionSize(element.position, element.size, canvas);
    const polygon = polygonCanvasPointsFromBlock(element.customPoints ?? [], rect);

    const patch = buildDiningLayoutFromImageDetection(element, rect, detection, {
      seats: 6,
      widthM: 1.2,
      depthM: 0.8,
      referenceImageDataUrl: 'data:image/png;base64,abc',
    });

    expect(patch.diningTables?.length).toBeGreaterThan(0);
    for (const table of patch.diningTables ?? []) {
      const point = {
        x: rect.x + (table.xPct / 100) * rect.width,
        y: rect.y + (table.yPct / 100) * rect.height,
      };
      expect(pointInPolygon(point, polygon)).toBe(true);
    }

    const positions = (patch.diningTables ?? []).map((table) => `${table.xPct.toFixed(1)},${table.yPct.toFixed(1)}`);
    expect(new Set(positions).size).toBe(positions.length);

    const roundTable = patch.diningTables?.find((t) => t.shape === 'round');
    expect(roundTable).toBeDefined();

    for (const feature of [patch.diningStage, patch.diningExit]) {
      if (!feature) {
        continue;
      }
      const point = {
        x: rect.x + (feature.xPct / 100) * rect.width,
        y: rect.y + (feature.yPct / 100) * rect.height,
      };
      expect(pointInPolygon(point, polygon)).toBe(true);
    }
  });

  it('places tables in the same relative arrangement as the reference (no tilt)', () => {
    const element = {
      id: 'block-rect',
      shape: 'rectangle',
      position: { xPct: 50, yPct: 50 },
      size: { wPct: 40, hPct: 50 },
      blockType: 'dining-table',
      physicalWidthM: 10,
      physicalLengthM: 10,
    } as CenterpieceElement;
    const canvas = { width: 1000, height: 800 };
    const rect = rectFromPositionSize(element.position, element.size, canvas);

    const patch = buildDiningLayoutFromImageDetection(element, rect, detection, {
      seats: 8,
      widthM: 1.2,
      depthM: 0.8,
    });

    expect(patch.diningTables?.length).toBe(3);
    expect(patch.diningTables?.every((t) => t.rotationDeg === 0)).toBe(true);
    expect(patch.diningTables?.[0]?.yPct).toBeCloseTo(5, 0);
    expect(patch.diningTables?.[1]?.xPct).toBeCloseTo(50, 0);
    expect(patch.diningTables?.[1]?.yPct).toBeCloseTo(55, 0);
    expect(patch.diningTables?.[2]?.xPct).toBeCloseTo(95, 0);
    expect(patch.diningServiceRoutes?.length).toBe(1);
    expect(patch.diningServiceRoutes?.[0]?.points.length).toBeGreaterThanOrEqual(2);
  });

  it('preserves reference proportions — small image objects stay small, wide stay wide', () => {
    const element = {
      id: 'block-rect',
      shape: 'rectangle',
      position: { xPct: 50, yPct: 50 },
      size: { wPct: 50, hPct: 50 },
      blockType: 'dining-table',
      physicalWidthM: 20,
      physicalLengthM: 20,
    } as CenterpieceElement;
    const canvas = { width: 1000, height: 800 };
    const rect = rectFromPositionSize(element.position, element.size, canvas);

    const sizedDetection: DiningLayoutDetectionResult = {
      ...detection,
      tables: [
        { xPct: 50, yPct: 20, shape: 'rectangular', wPct: 40, hPct: 8, seats: 6, role: 'head', suppressedChairEdges: [1, 2, 3], seatsByEdge: [6, 0, 0, 0] },
        { xPct: 30, yPct: 55, shape: 'round', wPct: 6, hPct: 6, seats: 8 },
        { xPct: 70, yPct: 55, shape: 'round', wPct: 6, hPct: 6, seats: 8 },
      ],
      features: [
        { kind: 'stage', xPct: 50, yPct: 6, wPct: 50, hPct: 6 },
        { kind: 'exit', xPct: 92, yPct: 50, wPct: 5, hPct: 8, label: 'EXIT' },
      ],
    };

    const patch = buildDiningLayoutFromImageDetection(element, rect, sizedDetection, {
      seats: 12,
      // Intentionally large wizard defaults — must NOT inflate small detections / seat counts.
      widthM: 5,
      depthM: 4,
      stageWidthM: 12,
      stageDepthM: 3,
    });

    const head = patch.diningTables?.find((t) => t.shape === 'rectangular');
    const round = patch.diningTables?.find((t) => t.shape === 'round');
    expect(head).toBeDefined();
    expect(round).toBeDefined();

    expect(head!.widthM).toBeCloseTo(8, 0);
    expect(head!.depthM!).toBeCloseTo(1.6, 0);
    expect(round!.widthM).toBeCloseTo(1.2, 0);
    expect(round!.widthM).toBeLessThan(2);

    // Exact small-dot counts — never draft seats (12)
    expect(head!.seats).toBe(6);
    expect(round!.seats).toBe(8);
    expect(patch.diningTables?.every((t) => t.seats <= 8)).toBe(true);
    expect(head!.suppressedChairEdges).toEqual([1, 2, 3]);
    expect(head!.seatsByEdge).toEqual([6, 0, 0, 0]);

    expect(patch.diningStage?.widthM).toBeCloseTo(10, 0);
    expect(patch.diningStage?.depthM).toBeCloseTo(1.2, 0);
    expect(patch.diningExit?.widthM).toBeLessThan(3);
    expect(patch.diningExit?.label).toBe('Exit');
  });
});
