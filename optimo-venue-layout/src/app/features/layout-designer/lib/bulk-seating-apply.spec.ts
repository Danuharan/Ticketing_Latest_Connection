import { describe, expect, it } from 'vitest';

import { buildBlockLocationPreviewSvg } from './block-location-preview';
import {
  blocksHaveSameShapeAndMeasurements,
  blocksHaveSameShapeGeometry,
  blocksHaveSimilarDimensions,
  findShapeAlignmentBetweenBlocks,
  findSimilarSeatingBlockCandidates,
  shapeFamilyLabel,
  shapeGeometrySignature,
  sideLengthsMatchWithRotation,
} from './block-shape-match';
import { regenerateSeatingOnTarget } from './bulk-seating-regenerate';
import { resolveBlockRingIndex } from './block-tier';
import { cvToLayoutElements } from './cv-to-layout';
import {
  inferGroundViewpointForBlock,
  resolveGroundFocalPoint,
} from './infer-ground-viewpoint';
import { stadiumLogicalEdgeFromView } from './block-measure-edges';
import { remapSeatingSnapshotForTarget } from './remap-seating-snapshot';
import {
  CanvasConfig,
  CenterpieceElement,
  DEFAULT_CANVAS,
  ElementPosition,
  LayoutElement,
} from '../models/layout-element.model';

const CANVAS: CanvasConfig = { ...DEFAULT_CANVAS };

const STRAIGHT_BLOCK_POINTS: ElementPosition[] = [
  { xPct: 0, yPct: 0 },
  { xPct: 100, yPct: 0 },
  { xPct: 100, yPct: 35 },
  { xPct: 0, yPct: 35 },
];

const WEDGE_POINTS: ElementPosition[] = [
  { xPct: 0, yPct: 20 },
  { xPct: 100, yPct: 0 },
  { xPct: 100, yPct: 100 },
  { xPct: 0, yPct: 80 },
];

const WEDGE_MIRRORED_POINTS: ElementPosition[] = [
  { xPct: 0, yPct: 0 },
  { xPct: 100, yPct: 20 },
  { xPct: 100, yPct: 80 },
  { xPct: 0, yPct: 100 },
];

function makeBlock(
  id: string,
  label: string,
  position: { xPct: number; yPct: number },
  overrides: Partial<CenterpieceElement> = {},
): CenterpieceElement {
  return {
    id,
    type: 'centerpiece',
    name: label,
    label,
    shape: 'custom',
    curveDeg: 0,
    position,
    size: { wPct: 10, hPct: 8 },
    rotation: 0,
    style: { fillColor: '#ccc', strokeColor: '#000', labelColor: '#000' },
    customPoints: STRAIGHT_BLOCK_POINTS,
    ringIndex: 0,
    tierLabel: 'Inner Tier',
    ...overrides,
  };
}

function makeSeatingBlock(
  id: string,
  label: string,
  position: { xPct: number; yPct: number },
  overrides: Partial<CenterpieceElement> = {},
): CenterpieceElement {
  return makeBlock(id, label, position, {
    customSideLengthsM: [10, 8, 10, 8],
    blockType: 'seating',
    ...overrides,
  });
}

describe('resolveGroundFocalPoint', () => {
  it('prefers pitch over stage and canvas centre', () => {
    const elements: LayoutElement[] = [
      {
        id: 'cv-pitch-1',
        type: 'centerpiece',
        name: 'Pitch',
        label: 'Pitch',
        shape: 'oval',
        curveDeg: 0,
        position: { xPct: 50, yPct: 50 },
        size: { wPct: 20, hPct: 15 },
        rotation: 0,
        style: { fillColor: '#0f0', strokeColor: '#000', labelColor: '#000' },
      },
      {
        id: 'stage-1',
        type: 'centerpiece',
        name: 'STAGE',
        label: 'STAGE',
        shape: 'rectangle',
        curveDeg: 0,
        position: { xPct: 50, yPct: 80 },
        size: { wPct: 12, hPct: 4 },
        rotation: 0,
        style: { fillColor: '#333', strokeColor: '#000', labelColor: '#fff' },
      },
    ];

    const focal = resolveGroundFocalPoint(elements, CANVAS);
    expect(focal.source).toBe('pitch');
    expect(focal.label).toBe('Pitch');
  });
});

describe('inferGroundViewpointForBlock', () => {
  it('faces the block toward the pitch focal point', () => {
    const block = makeSeatingBlock('b1', 'B101', { xPct: 50, yPct: 20 });
    const focal = { x: CANVAS.width / 2, y: CANVAS.height / 2, source: 'pitch' as const, label: 'Pitch' };
    const result = inferGroundViewpointForBlock(block, focal, CANVAS);
    expect(result.blockViewpointAngleDeg).toBeGreaterThan(150);
    expect(result.blockViewpointAngleDeg).toBeLessThan(210);
    expect(result.dragSeatsStadiumSideIndices).toBeUndefined();
  });

  it('sets both VIEW POINTs when two front sides face the pitch', () => {
    const house = makeSeatingBlock('h1', 'H1', { xPct: 50, yPct: 80 }, {
      customPoints: [
        { xPct: 0, yPct: 40 },
        { xPct: 50, yPct: 0 },
        { xPct: 100, yPct: 40 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
      customSideLengthsM: [12, 12, 15, 20, 15],
    });
    const pitchAbove = { x: CANVAS.width / 2, y: 20, source: 'pitch' as const, label: 'Pitch' };
    const result = inferGroundViewpointForBlock(house, pitchAbove, CANVAS);
    expect(result.dragSeatsStadiumSideIndices).toHaveLength(2);
    const rect = {
      x: (house.position.xPct / 100) * CANVAS.width - ((house.size.wPct / 100) * CANVAS.width) / 2,
      y: (house.position.yPct / 100) * CANVAS.height - ((house.size.hPct / 100) * CANVAS.height) / 2,
      width: (house.size.wPct / 100) * CANVAS.width,
      height: (house.size.hPct / 100) * CANVAS.height,
    };
    const polygon = (house.customPoints ?? []).map((p) => ({
      x: rect.x + (p.xPct / 100) * rect.width,
      y: rect.y + (p.yPct / 100) * rect.height,
    }));
    expect(result.dragSeatsStadiumSideIndex).toBe(
      stadiumLogicalEdgeFromView(
        polygon,
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        result.blockViewpointAngleDeg,
      )?.index,
    );
  });
});

describe('blocksHaveSameShapeGeometry', () => {
  it('matches rectangles with rotated vertices and no measurements on target', () => {
    const source = makeSeatingBlock('16', '16', { xPct: 50, yPct: 15 });
    const target = makeBlock('17', '17', { xPct: 52, yPct: 15 }, {
      customPoints: [
        { xPct: 100, yPct: 0 },
        { xPct: 100, yPct: 35 },
        { xPct: 0, yPct: 35 },
        { xPct: 0, yPct: 0 },
      ],
    });
    expect(blocksHaveSameShapeGeometry(source, target)).toBe(true);
  });

  it('matches corner wedges including mirrored variants', () => {
    const source = makeSeatingBlock('29', '29', { xPct: 70, yPct: 70 }, {
      customPoints: WEDGE_POINTS,
    });
    const target = makeBlock('28', '28', { xPct: 72, yPct: 70 }, {
      customPoints: WEDGE_MIRRORED_POINTS,
    });
    expect(blocksHaveSameShapeGeometry(source, target)).toBe(true);
  });

  it('does not match rectangle with wedge', () => {
    const rectangle = makeSeatingBlock('16', '16', { xPct: 50, yPct: 15 });
    const wedge = makeSeatingBlock('29', '29', { xPct: 70, yPct: 70 }, {
      customPoints: WEDGE_POINTS,
    });
    expect(blocksHaveSameShapeGeometry(rectangle, wedge)).toBe(false);
  });

  it('labels straight blocks and corner wedges differently', () => {
    expect(shapeFamilyLabel(STRAIGHT_BLOCK_POINTS)).toContain('straight block');
    expect(shapeFamilyLabel(WEDGE_POINTS)).toContain('corner wedge');
  });
});

describe('blocksHaveSameShapeAndMeasurements', () => {
  it('matches identical blocks with cyclic vertex order', () => {
    const a = makeSeatingBlock('a', 'B101', { xPct: 20, yPct: 20 });
    const b = makeSeatingBlock('b', 'B102', { xPct: 30, yPct: 20 }, {
      customPoints: [
        { xPct: 100, yPct: 0 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
        { xPct: 0, yPct: 0 },
      ],
      customSideLengthsM: [8, 10, 8, 10],
    });
    expect(blocksHaveSameShapeAndMeasurements(a, b)).toBe(true);
  });

  it('rejects blocks with different side lengths', () => {
    const a = makeSeatingBlock('a', 'B101', { xPct: 20, yPct: 20 });
    const b = makeSeatingBlock('b', 'B102', { xPct: 30, yPct: 20 }, {
      customSideLengthsM: [12, 8, 10, 8],
    });
    expect(blocksHaveSameShapeAndMeasurements(a, b)).toBe(false);
  });

  it('matches side lengths with cyclic rotation', () => {
    expect(sideLengthsMatchWithRotation([10, 8, 10, 8], [8, 10, 8, 10]).match).toBe(true);
  });
});

describe('blocksHaveSimilarDimensions', () => {
  it('matches rectangles with the same width and length', () => {
    const source = makeSeatingBlock('16', '16', { xPct: 50, yPct: 15 });
    const target = makeBlock('17', '17', { xPct: 52, yPct: 15 });
    expect(blocksHaveSimilarDimensions(source, target, CANVAS)).toBe(true);
  });

  it('matches empty targets within 12% canvas size difference', () => {
    const source = makeSeatingBlock('16', '16', { xPct: 50, yPct: 15 }, {
      size: { wPct: 10, hPct: 8 },
    });
    const slightlySmaller = makeBlock('17', '17', { xPct: 52, yPct: 15 }, {
      size: { wPct: 9, hPct: 7.2 },
    });
    expect(blocksHaveSimilarDimensions(source, slightlySmaller, CANVAS)).toBe(true);
  });

  it('matches similar wedges even when target has extra CV vertices', () => {
    const source = makeSeatingBlock('5', '5', { xPct: 70, yPct: 70 }, {
      customPoints: WEDGE_POINTS,
      customSideLengthsM: [10, 12, 10, 8],
      size: { wPct: 10, hPct: 8 },
    });
    // Same outline with a mid-edge vertex (CV contour noise).
    const extraVertices: ElementPosition[] = [
      { xPct: 0, yPct: 20 },
      { xPct: 50, yPct: 10 },
      { xPct: 100, yPct: 0 },
      { xPct: 100, yPct: 100 },
      { xPct: 0, yPct: 80 },
    ];
    const target = makeBlock('28', '28', { xPct: 72, yPct: 70 }, {
      customPoints: extraVertices,
      size: { wPct: 10, hPct: 8 },
    });
    expect(blocksHaveSimilarDimensions(source, target, CANVAS)).toBe(true);
  });

  it('rejects rectangles with different width and length', () => {
    const source = makeSeatingBlock('16', '16', { xPct: 50, yPct: 15 });
    const target = makeSeatingBlock('big', 'BIG', { xPct: 52, yPct: 15 }, {
      customSideLengthsM: [16, 12, 16, 12],
      size: { wPct: 16, hPct: 12 },
    });
    expect(blocksHaveSimilarDimensions(source, target, CANVAS)).toBe(false);
  });

  it('matches mirrored wedges with the same measurements', () => {
    const source = makeSeatingBlock('29', '29', { xPct: 70, yPct: 70 }, {
      customPoints: WEDGE_POINTS,
      customSideLengthsM: [10, 12, 10, 8],
    });
    const target = makeBlock('28', '28', { xPct: 72, yPct: 70 }, {
      customPoints: WEDGE_MIRRORED_POINTS,
      customSideLengthsM: [10, 8, 10, 12],
    });
    expect(blocksHaveSimilarDimensions(source, target, CANVAS)).toBe(true);
  });
});

describe('findShapeAlignmentBetweenBlocks', () => {
  it('finds mirror alignment for opposite corner wedges', () => {
    const source = makeSeatingBlock('29', '29', { xPct: 70, yPct: 70 }, {
      customPoints: WEDGE_POINTS,
      customSideLengthsM: [10, 12, 10, 8],
    });
    const target = makeBlock('28', '28', { xPct: 72, yPct: 70 }, {
      customPoints: WEDGE_MIRRORED_POINTS,
      customSideLengthsM: [10, 8, 10, 12],
    });
    const alignment = findShapeAlignmentBetweenBlocks(source, target);
    expect(alignment).not.toBeNull();
    expect(alignment?.mirrorMode).not.toBe('none');
  });
});

describe('findSimilarSeatingBlockCandidates', () => {
  it('includes empty wedges with matching dimensions even without blockType', () => {
    const source = makeSeatingBlock('src', '29', { xPct: 70, yPct: 70 }, {
      ringIndex: 0,
      customPoints: WEDGE_POINTS,
      customSideLengthsM: [10, 12, 10, 8],
    });
    // Same canvas silhouette / grounding edge — mirror apply is handled later on regenerate.
    const emptyWedge = makeBlock('w28', '28', { xPct: 75, yPct: 70 }, {
      ringIndex: 0,
      customPoints: WEDGE_POINTS,
      size: { wPct: 10, hPct: 8 },
    });
    const rectangle = makeBlock('r16', '16', { xPct: 50, yPct: 15 }, { ringIndex: 0 });
    const candidates = findSimilarSeatingBlockCandidates(
      source.id,
      [source, emptyWedge, rectangle],
      CANVAS,
    );
    expect(candidates.map((c) => c.label)).toEqual(['28']);
    expect(candidates[0]?.selectable).toBe(true);
    expect(candidates[0]?.shapeFamily).toContain('corner wedge');
  });

  it('does not suggest rectangles with different dimensions', () => {
    const source = makeSeatingBlock('src', '15', { xPct: 50, yPct: 15 });
    const differentSize = makeSeatingBlock('big', 'BIG', { xPct: 55, yPct: 15 }, {
      customSideLengthsM: [16, 12, 16, 12],
    });
    const candidates = findSimilarSeatingBlockCandidates(
      source.id,
      [source, differentSize],
      CANVAS,
    );
    expect(candidates).toHaveLength(0);
  });

  it('returns empty blocks and skips ones that already have seating', () => {
    const source = makeSeatingBlock('src', 'B101', { xPct: 20, yPct: 20 });
    const empty = makeBlock('empty', 'B102', { xPct: 30, yPct: 20 });
    const seated = makeSeatingBlock('seated', 'B103', { xPct: 40, yPct: 20 }, {
      seatLayout: { rows: 2, seatsPerRow: 4, rowSeatCounts: [4, 4], rowLabelStyle: 'letter' },
      rows: 2,
      seatsPerRow: 4,
      seatPositionOverrides: {
        A1: { xPct: 20, yPct: 20 },
        A2: { xPct: 40, yPct: 20 },
        A3: { xPct: 60, yPct: 20 },
        A4: { xPct: 80, yPct: 20 },
        B1: { xPct: 20, yPct: 60 },
        B2: { xPct: 40, yPct: 60 },
        B3: { xPct: 60, yPct: 60 },
        B4: { xPct: 80, yPct: 60 },
      },
    });
    const candidates = findSimilarSeatingBlockCandidates(
      source.id,
      [source, empty, seated],
      CANVAS,
    );
    expect(candidates).toHaveLength(2);
    expect(candidates.find((c) => c.id === 'empty')?.selectable).toBe(true);
    expect(candidates.find((c) => c.id === 'seated')?.selectable).toBe(false);
  });

  it('suggests only blocks in the same tier', () => {
    const source = makeSeatingBlock('src', '15', { xPct: 50, yPct: 15 }, { ringIndex: 0 });
    const sameTier = makeBlock('t0', '17', { xPct: 55, yPct: 15 }, { ringIndex: 0 });
    const otherTier = makeBlock('t1', '115', { xPct: 50, yPct: 8 }, {
      ringIndex: 1,
      tierLabel: 'Outer Tier',
    });
    const candidates = findSimilarSeatingBlockCandidates(
      source.id,
      [source, sameTier, otherTier],
      CANVAS,
    );
    expect(candidates.map((c) => c.label)).toEqual(['17']);
  });

  it('suggests same-tier neighbors with matching size', () => {
    const pitch = {
      id: 'cv-pitch-1',
      type: 'centerpiece' as const,
      name: 'Pitch',
      label: 'Pitch',
      shape: 'oval' as const,
      curveDeg: 0,
      position: { xPct: 50, yPct: 50 },
      size: { wPct: 20, hPct: 15 },
      rotation: 0,
      style: { fillColor: '#0f0', strokeColor: '#000', labelColor: '#000' },
    };
    const focal = { x: CANVAS.width / 2, y: CANVAS.height / 2, source: 'pitch' as const, label: 'Pitch' };
    const wedge = makeSeatingBlock('5', '5', { xPct: 40, yPct: 70 }, {
      ringIndex: 0,
      customPoints: WEDGE_POINTS,
      customSideLengthsM: [10, 12, 10, 8],
      size: { wPct: 10, hPct: 8 },
    });
    const neighbor = makeBlock('4', '4', { xPct: 50, yPct: 70 }, {
      ringIndex: 0,
      customPoints: WEDGE_POINTS,
      size: { wPct: 10, hPct: 8 },
    });
    const candidates = findSimilarSeatingBlockCandidates(
      wedge.id,
      [pitch, wedge, neighbor],
      CANVAS,
      { focal },
    );
    expect(candidates.map((c) => c.label)).toEqual(['4']);
    expect(candidates[0]?.selectable).toBe(true);
  });

  it('excludes blocks whose ground-facing edge differs beyond 12%', () => {
    const pitch = {
      id: 'cv-pitch-1',
      type: 'centerpiece' as const,
      name: 'Pitch',
      label: 'Pitch',
      shape: 'oval' as const,
      curveDeg: 0,
      position: { xPct: 50, yPct: 50 },
      size: { wPct: 20, hPct: 15 },
      rotation: 0,
      style: { fillColor: '#0f0', strokeColor: '#000', labelColor: '#000' },
    };
    const source = makeSeatingBlock('src', '5', { xPct: 50, yPct: 70 }, {
      ringIndex: 0,
      customPoints: WEDGE_POINTS,
      customSideLengthsM: [10, 12, 10, 8],
      size: { wPct: 10, hPct: 8 },
    });
    const focal = { x: CANVAS.width / 2, y: CANVAS.height / 2, source: 'pitch' as const, label: 'Pitch' };
    // Narrower block → shorter ground-facing edge on canvas (like 11 / 22).
    const shorterGround = makeBlock('11', '11', { xPct: 52, yPct: 70 }, {
      ringIndex: 0,
      customPoints: WEDGE_POINTS,
      size: { wPct: 6, hPct: 8 },
    });
    const candidates = findSimilarSeatingBlockCandidates(
      source.id,
      [pitch, source, shorterGround],
      CANVAS,
      { focal },
    );
    expect(candidates).toHaveLength(0);
  });

  it('includes location preview svg for each candidate', () => {
    const source = makeSeatingBlock('src', '15', { xPct: 50, yPct: 15 });
    const target = makeBlock('t0', '17', { xPct: 55, yPct: 15 });
    const candidates = findSimilarSeatingBlockCandidates(
      source.id,
      [source, target],
      CANVAS,
      { referenceImageDataUrl: 'data:image/png;base64,abc' },
    );
    expect(candidates[0]?.locationPreviewSvg).toContain('viewBox');
    expect(candidates[0]?.locationPreviewSvg).toContain('data-highlight="true"');
    expect(candidates[0]?.locationPreviewSvg).toContain('data:image/png;base64,abc');
  });
});

describe('buildBlockLocationPreviewSvg', () => {
  it('renders zoomed highlight path and block label for the requested block', () => {
    const block = makeBlock('b1', '15', { xPct: 50, yPct: 15 });
    const svg = buildBlockLocationPreviewSvg({
      elements: [block],
      canvas: CANVAS,
      highlightBlockId: 'b1',
    });
    expect(svg).toContain('viewBox="');
    expect(svg).toContain('data-highlight="true"');
    expect(svg).toContain('>15<');
  });
});

describe('resolveBlockRingIndex', () => {
  it('uses persisted ringIndex when present', () => {
    const block = makeBlock('b1', '15', { xPct: 50, yPct: 15 }, { ringIndex: 2 });
    expect(resolveBlockRingIndex(block, [block], CANVAS)).toBe(2);
  });
});

describe('cvToLayoutElements', () => {
  it('persists ringIndex and tierLabel on imported blocks', () => {
    const { elements } = cvToLayoutElements(
      {
        width: 100,
        height: 100,
        blocks: [],
        labeledBlocks: [
          {
            id: 1,
            name: '',
            polygon: [
              { xPct: 10, yPct: 10 },
              { xPct: 20, yPct: 10 },
              { xPct: 20, yPct: 20 },
              { xPct: 10, yPct: 20 },
            ],
            cxPct: 15,
            cyPct: 15,
            fillColor: '#ff0000',
            ringIndex: 0,
            pixelArea: 100,
            assignedLabel: '15',
            labelFromOcr: true,
          },
        ],
        pitch: null,
        stands: [],
        confidence: 'high',
        notes: '',
        ocrTokenCount: 0,
        labeledCount: 1,
        unlabeledCount: 0,
      },
      { tierEdits: { 0: { name: 'Inner Tier', tierCode: 'T1' } } },
    );
    const block = elements.find((el) => 'label' in el && el.label === '15');
    expect(block && 'ringIndex' in block && block.ringIndex).toBe(0);
    expect(block && 'tierLabel' in block && block.tierLabel).toBe('Inner Tier');
  });
});

describe('shapeGeometrySignature', () => {
  it('produces stable sorted edge ratios for congruent rectangles', () => {
    const a = shapeGeometrySignature(STRAIGHT_BLOCK_POINTS);
    const b = shapeGeometrySignature([
      { xPct: 100, yPct: 0 },
      { xPct: 100, yPct: 35 },
      { xPct: 0, yPct: 35 },
      { xPct: 0, yPct: 0 },
    ]);
    expect(a?.sortedEdgeRatios).toEqual(b?.sortedEdgeRatios);
  });
});

describe('regenerateSeatingOnTarget', () => {
  it('rebuilds seating on a mirrored wedge using the manual placement flow', () => {
    const source = makeSeatingBlock('src', '5', { xPct: 70, yPct: 70 }, {
      customPoints: WEDGE_POINTS,
      customSideLengthsM: [10, 12, 10, 8],
      dragSeatsMode: true,
      dragSeatsStadiumSideIndex: 1,
      seatLayout: {
        rows: 4,
        seatsPerRow: 6,
        rowSeatCounts: [6, 6, 6, 6],
        rowLabelStyle: 'letter',
      },
      seatPositionOverrides: {
        A1: { xPct: 20, yPct: 20 },
        A2: { xPct: 40, yPct: 20 },
      },
    });
    const target = makeBlock('tgt', '28', { xPct: 72, yPct: 70 }, {
      customPoints: WEDGE_MIRRORED_POINTS,
      size: { wPct: 10, hPct: 8 },
    });
    const snapshot = {
      customSideLengthsM: [10, 12, 10, 8],
      physicalLengthM: 10,
      physicalWidthM: 8,
      chairLengthM: 0.45,
      chairWidthM: 0.45,
      seatGapM: 0.1,
      rowGapM: 0.1,
      dragSeatsMode: true,
      dragSeatsStadiumSideIndex: 1,
      seatLayout: source.seatLayout,
      seatPositionOverrides: source.seatPositionOverrides,
    };
    const focal = { x: CANVAS.width / 2, y: CANVAS.height / 2, source: 'canvas-center' as const, label: 'Centre' };
    const patch = regenerateSeatingOnTarget({
      source,
      target,
      snapshot,
      canvas: CANVAS,
      focal,
    });
    expect(patch).not.toBeNull();
    expect(patch?.code).toBe('28');
    expect(patch?.interactiveSeatingLocked).toBe(true);
    expect(patch?.dragSeatsMode).toBeUndefined();
    expect(Object.keys(patch?.seatPositionOverrides ?? {}).length).toBeGreaterThan(0);
    expect(patch?.seatFacingDeg).toBeDefined();
  });
});

describe('remapSeatingSnapshotForTarget', () => {
  it('remaps seat ids from source block code to target block code', () => {
    const source = makeSeatingBlock('src', 'B101', { xPct: 20, yPct: 20 }, { code: 'B101' });
    const target = makeSeatingBlock('tgt', 'B102', { xPct: 30, yPct: 20 }, { code: 'B102' });
    const remapped = remapSeatingSnapshotForTarget({
      snapshot: {
        code: 'B101',
        seatPositionOverrides: {
          'B101-A1': { xPct: 25, yPct: 30 },
        },
        seatLayout: {
          rows: 1,
          seatsPerRow: 1,
          rowSeatCounts: [1],
          rowLabelStyle: 'letter',
          hiddenSeatIds: ['B101-A1'],
        },
      },
      source,
      target,
      canvas: CANVAS,
      sourceSideIndex: 0,
      targetSideIndex: 0,
    });
    expect(remapped.code).toBe('B102');
    expect(remapped.seatPositionOverrides?.['B102-A1']).toBeDefined();
    expect(remapped.seatLayout?.hiddenSeatIds).toEqual(['B102-A1']);
    expect(remapped.blockViewpointAngleDeg).toBeUndefined();
  });
});
