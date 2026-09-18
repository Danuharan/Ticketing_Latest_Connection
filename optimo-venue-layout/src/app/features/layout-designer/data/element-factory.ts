/**
 * Factory that turns a sidebar tool id into a fully-formed placed element.
 *
 * Mirrors the prototype's behaviour: the 7 primitive element kinds plus the
 * preset buttons (Custom Piece, Stage, Exit, Entrance, Canteen, Shop) which are
 * all Center Piece variants distinguished by shape/label/style.
 */

import { ElementTypeId } from '../models/element-type.model';
import {
  CanvasConfig,
  LayoutElement,
  SectorBlock,
  RectBlock,
  SeatSectionRow,
  RectSide,
  ElementPosition,
  ShapeId,
  BlockGridShapeId,
  BlockGridElement,
  DEFAULT_BLOCK_LENGTH_M,
  DEFAULT_BLOCK_WIDTH_M,
  DEFAULT_CHAIR_LENGTH_M,
  DEFAULT_CHAIR_WIDTH_M,
} from '../models/layout-element.model';
import { renormalizeFromCanvasPoints } from '../lib/custom-shape';
import { classifyBlockShape } from '../lib/classify-block-shape';
import {
  geometryFromCircleBounds,
  geometryFromCurvedLine,
  geometryFromCurvedRect,
  geometryFromEllipseBounds,
  syncBlockGridGeometry,
} from '../lib/block-shape-geometry';

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

function code(index: number): string {
  return `B${String(index).padStart(2, '0')}`;
}

function defaultSectorBlocks(count: number): SectorBlock[] {
  const step = 360 / count;
  return Array.from({ length: count }, (_, i) => ({
    id: uid('sector'),
    code: code(i + 1),
    startAngleDeg: -90 + step * i,
    endAngleDeg: -90 + step * (i + 1),
    rows: 4,
    seatsPerRow: 12,
  }));
}

function defaultRectBlocks(): RectBlock[] {
  const sides: RectSide[] = ['top', 'right', 'bottom', 'left'];
  return sides.map((side, i) => ({
    id: uid('rblock'),
    code: code(i + 1),
    side,
    rows: 3,
    seatsPerRow: 10,
  }));
}

function defaultSeatRows(count: number): SeatSectionRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: uid('srow'),
    seatCount: 10,
    rotationDeg: 0,
    curveDeg: 0,
    seatSpacingPct: 4,
    offsetXPct: 0,
    offsetYPct: i * 2,
  }));
}

interface PresetSpec {
  label: string;
  position: { xPct: number; yPct: number };
  size: { wPct: number; hPct: number };
  fillColor: string;
  strokeColor: string;
  labelColor: string;
}

const PRESETS: Partial<Record<ElementTypeId, PresetSpec>> = {
  stage: {
    label: 'STAGE',
    position: { xPct: 50, yPct: 12 },
    size: { wPct: 40, hPct: 12 },
    fillColor: '#0f172a',
    strokeColor: '#0f172a',
    labelColor: '#f8fafc',
  },
  exit: {
    label: 'EXIT',
    position: { xPct: 88, yPct: 50 },
    size: { wPct: 10, hPct: 8 },
    fillColor: '#dc2626',
    strokeColor: '#b91c1c',
    labelColor: '#ffffff',
  },
  entrance: {
    label: 'ENTRANCE',
    position: { xPct: 12, yPct: 50 },
    size: { wPct: 12, hPct: 8 },
    fillColor: '#16a34a',
    strokeColor: '#15803d',
    labelColor: '#ffffff',
  },
  canteen: {
    label: 'CANTEEN',
    position: { xPct: 25, yPct: 85 },
    size: { wPct: 16, hPct: 9 },
    fillColor: '#f59e0b',
    strokeColor: '#d97706',
    labelColor: '#1f2937',
  },
  shop: {
    label: 'SHOP',
    position: { xPct: 75, yPct: 85 },
    size: { wPct: 14, hPct: 9 },
    fillColor: '#7c3aed',
    strokeColor: '#6d28d9',
    labelColor: '#ffffff',
  },
};

/** Builds a placed element for the given tool id. Returns null for unknown ids. */
export function createElement(toolId: ElementTypeId): LayoutElement | null {
  const center = { xPct: 50, yPct: 50 };

  switch (toolId) {
    case 'center-piece': {
      const size = { wPct: 36, hPct: 26 };
      return {
        id: uid('center'),
        type: 'centerpiece',
        name: 'Center Piece',
        shape: 'oval',
        label: 'Ground',
        curveDeg: 0,
        geometry: geometryFromEllipseBounds(center, size),
        position: center,
        size,
        rotation: 0,
        style: { fillColor: '#dbeafe', strokeColor: '#93c5fd', labelColor: '#1e3a8a' },
      };
    }

    case 'custom-piece':
      return {
        id: uid('custom'),
        type: 'centerpiece',
        name: 'Custom Piece',
        shape: 'custom',
        label: '',
        curveDeg: 0,
        customPoints: [],
        physicalLengthM: DEFAULT_BLOCK_LENGTH_M,
        physicalWidthM: DEFAULT_BLOCK_WIDTH_M,
        chairLengthM: DEFAULT_CHAIR_LENGTH_M,
        chairWidthM: DEFAULT_CHAIR_WIDTH_M,
        position: { xPct: 50, yPct: 50 },
        size: { wPct: 1, hPct: 1 },
        rotation: 0,
        style: { fillColor: '#bfdbfe', strokeColor: '#60a5fa', labelColor: '#1e3a8a' },
      };

    case 'layer-ring':
      return {
        id: uid('ring'),
        type: 'layer-ring',
        name: 'Layer Ring',
        label: 'Ring',
        thicknessPct: 9,
        gapPct: 1,
        centerpieceId: '',
        rowLabelStyle: 'letter',
        blocks: defaultSectorBlocks(8),
        position: center,
        size: { wPct: 64, hPct: 56 },
        rotation: 0,
        style: { fillColor: '#f3e8ff', strokeColor: '#d8b4fe', labelColor: '#6b21a8' },
      };

    case 'layer-rect':
      return {
        id: uid('rect'),
        type: 'layer-rect',
        name: 'Layer Rect',
        label: 'Stand',
        rowLabelStyle: 'letter',
        blocks: defaultRectBlocks(),
        position: center,
        size: { wPct: 64, hPct: 48 },
        rotation: 0,
        style: { fillColor: '#ede9fe', strokeColor: '#c4b5fd', labelColor: '#5b21b6' },
      };

    case 'block-grid':
      return createBlockGrid('square');

    case 'seat-section':
      return {
        id: uid('section'),
        type: 'seat-section',
        name: 'Hall Section',
        label: 'Section',
        rowGapPct: 8,
        rowLabelStyle: 'letter',
        showRowLabels: true,
        rows: defaultSeatRows(6),
        position: center,
        size: { wPct: 30, hPct: 36 },
        rotation: 0,
        style: { fillColor: '#f8fafc', strokeColor: '#94a3b8', labelColor: '#0f172a' },
      };

    case 'aisle':
      return {
        id: uid('aisle'),
        type: 'aisle',
        name: 'Aisle',
        orientation: 'vertical',
        position: { xPct: 50, yPct: 60 },
        size: { wPct: 4, hPct: 28 },
        rotation: 0,
        style: { fillColor: '#e2e8f0', strokeColor: '#94a3b8' },
      };

    case 'label':
      return {
        id: uid('label'),
        type: 'label',
        name: 'Label',
        text: 'Label',
        fontSize: 18,
        fontWeight: 'bold',
        textAlign: 'center',
        position: { xPct: 50, yPct: 10 },
        size: { wPct: 20, hPct: 6 },
        rotation: 0,
        style: { labelColor: '#0f172a' },
      };

    case 'stage':
    case 'exit':
    case 'entrance':
    case 'canteen':
    case 'shop': {
      const preset = PRESETS[toolId]!;
      return {
        id: uid(toolId),
        type: 'centerpiece',
        name: preset.label,
        shape: 'rectangle',
        label: preset.label,
        curveDeg: 0,
        position: preset.position,
        size: preset.size,
        rotation: 0,
        style: {
          fillColor: preset.fillColor,
          strokeColor: preset.strokeColor,
          labelColor: preset.labelColor,
        },
      };
    }

    default:
      return null;
  }
}

const DEFAULT_GEOMETRY_CANVAS: CanvasConfig = { width: 1000, height: 1000 };

/**
 * Creates a Block Grid with an outline shape (Focus area → Parts).
 * Square preserves the historic rectangular defaults; other shapes attach geometry.
 */
export function createBlockGrid(
  shape: BlockGridShapeId = 'square',
  options?: {
    position?: ElementPosition;
    size?: { wPct: number; hPct: number };
    canvas?: CanvasConfig;
    code?: string;
    label?: string;
    rows?: number;
    seatsPerRow?: number;
  },
): BlockGridElement {
  const position = options?.position ?? { xPct: 50, yPct: 50 };
  const canvas = options?.canvas ?? DEFAULT_GEOMETRY_CANVAS;
  const size =
    options?.size ??
    (shape === 'circle'
      ? { wPct: 20, hPct: 20 }
      : shape === 'oval'
        ? { wPct: 28, hPct: 18 }
        : shape === 'curved-line'
          ? { wPct: 26, hPct: 18 }
          : { wPct: 24, hPct: 22 });

  const base: BlockGridElement = {
    id: uid('grid'),
    type: 'block-grid',
    name: 'Block',
    code: options?.code ?? 'B01',
    label: options?.label ?? 'Block',
    rows: options?.rows ?? 6,
    seatsPerRow: options?.seatsPerRow ?? 10,
    rowLabelStyle: 'letter',
    shape,
    position,
    size,
    rotation: 0,
    style: { fillColor: '#e0f2fe', strokeColor: '#7dd3fc', labelColor: '#0c4a6e' },
  };

  if (shape === 'circle') {
    return syncBlockGridGeometry(
      { ...base, geometry: geometryFromCircleBounds(position, size, canvas) },
      canvas,
    );
  }
  if (shape === 'oval') {
    return syncBlockGridGeometry(
      { ...base, geometry: geometryFromEllipseBounds(position, size) },
      canvas,
    );
  }
  if (shape === 'curved-line') {
    return syncBlockGridGeometry(
      { ...base, curveDeg: 28, geometry: geometryFromCurvedLine(28) },
      canvas,
    );
  }
  return base;
}

/**
 * Creates a non-traced centerpiece for a named primitive shape, with optional
 * `geometry` for circle / oval / curved so JSON is self-describing on save.
 */
export function createShapedCenterpiece(
  shape: ShapeId,
  options?: {
    position?: ElementPosition;
    size?: { wPct: number; hPct: number };
    label?: string;
    curveDeg?: number;
    canvas?: CanvasConfig;
  },
): LayoutElement {
  const position = options?.position ?? { xPct: 50, yPct: 50 };
  const size =
    options?.size ??
    (shape === 'circle'
      ? { wPct: 12, hPct: 12 }
      : shape === 'square'
        ? { wPct: 10, hPct: 10 }
        : shape === 'rectangle' || shape === 'curved'
          ? { wPct: 16, hPct: 8 }
          : { wPct: 14, hPct: 10 });
  const canvas = options?.canvas ?? DEFAULT_GEOMETRY_CANVAS;
  const curveDeg = options?.curveDeg ?? (shape === 'curved' ? 24 : 0);

  const base = {
    id: uid(shape),
    type: 'centerpiece' as const,
    name: options?.label ?? shape.charAt(0).toUpperCase() + shape.slice(1),
    shape,
    label: options?.label ?? '',
    curveDeg,
    position,
    size,
    rotation: 0,
    style: { fillColor: '#bfdbfe', strokeColor: '#60a5fa', labelColor: '#1e3a8a' },
  };

  if (shape === 'circle') {
    return { ...base, geometry: geometryFromCircleBounds(position, size, canvas) };
  }
  if (shape === 'oval') {
    return { ...base, geometry: geometryFromEllipseBounds(position, size) };
  }
  if (shape === 'curved') {
    return { ...base, geometry: geometryFromCurvedRect(curveDeg) };
  }
  return base;
}

/** Builds a finished custom-piece element from canvas-% click points. */
export function createCustomPieceFromPoints(points: ElementPosition[]): LayoutElement | null {
  const normalized = renormalizeFromCanvasPoints(points);
  if (!normalized) {
    return null;
  }
  return {
    id: uid('custom'),
    type: 'centerpiece',
    name: 'Custom Piece',
    shape: classifyBlockShape(normalized.customPoints),
    label: '',
    curveDeg: 0,
    customPoints: normalized.customPoints,
    physicalLengthM: DEFAULT_BLOCK_LENGTH_M,
    physicalWidthM: DEFAULT_BLOCK_WIDTH_M,
    chairLengthM: DEFAULT_CHAIR_LENGTH_M,
    chairWidthM: DEFAULT_CHAIR_WIDTH_M,
    position: normalized.position,
    size: normalized.size,
    rotation: 0,
    style: { fillColor: '#bfdbfe', strokeColor: '#60a5fa', labelColor: '#1e3a8a' },
  };
}

/**
 * Builds a finished parking-area element from canvas-% click points. `edgeBowAmounts`
 * (bow ratio per edge, same order as `points`) carries over any curves the user already
 * bowed while drawing — defaults to all-straight when omitted.
 */
export function createParkingAreaFromPoints(
  points: ElementPosition[],
  edgeBowAmounts?: number[],
): LayoutElement | null {
  const normalized = renormalizeFromCanvasPoints(points);
  if (!normalized) {
    return null;
  }
  return {
    id: uid('parking'),
    type: 'centerpiece',
    name: 'Parking Area',
    shape: 'custom',
    label: '',
    curveDeg: 0,
    blockType: 'parking',
    customPoints: normalized.customPoints,
    edgeBowAmounts: edgeBowAmounts ?? normalized.customPoints.map(() => 0),
    physicalLengthM: DEFAULT_BLOCK_LENGTH_M,
    physicalWidthM: DEFAULT_BLOCK_WIDTH_M,
    position: normalized.position,
    size: normalized.size,
    rotation: 0,
    style: { fillColor: '#9ca3af', strokeColor: '#facc15', labelColor: '#1f2937' },
  };
}
