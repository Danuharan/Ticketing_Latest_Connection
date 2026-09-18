import {
  CanvasPoint2,
  polygonCanvasPointsFromBlock,
  stadiumSideIndexFromViewDirection,
  stadiumLogicalEdgeFromView,
  viewpointAngleFromCanvasPoint,
} from './block-viewpoint';
import { rectFromPositionSize } from './geometry';
import { resolveViewpointLogicalEdges } from './block-measure-edges';
import {
  CanvasConfig,
  CenterpieceElement,
  LayoutElement,
  hasTracedBlockOutline,
} from '../models/layout-element.model';

export type GroundFocalSource = 'pitch' | 'stage' | 'centerpiece' | 'canvas-center';

export interface GroundFocalPoint {
  x: number;
  y: number;
  source: GroundFocalSource;
  label: string;
}

const PITCH_LABELS = new Set(['PITCH', 'GROUND', 'FIELD']);
const STAGE_LABEL = 'STAGE';

const GROUND_SHAPES = new Set([
  'rectangle',
  'oval',
  'circle',
  'hexagon',
  'octagon',
  'd-end',
  'curved',
  'curved-rect',
]);

function elementArea(el: CenterpieceElement): number {
  return (el.size?.wPct ?? 0) * (el.size?.hPct ?? 0);
}

function elementCentreCanvas(el: CenterpieceElement, canvas: CanvasConfig): CanvasPoint2 {
  return {
    x: (el.position.xPct / 100) * canvas.width,
    y: (el.position.yPct / 100) * canvas.height,
  };
}

function isPitchElement(el: LayoutElement): boolean {
  if (el.type !== 'centerpiece') {
    return false;
  }
  if (el.id.includes('cv-pitch-')) {
    return true;
  }
  const label = (el.label ?? el.name ?? '').trim().toUpperCase();
  return PITCH_LABELS.has(label);
}

function isStageElement(el: LayoutElement): boolean {
  if (el.type !== 'centerpiece') {
    return false;
  }
  return (el.label ?? '').trim().toUpperCase() === STAGE_LABEL;
}

function isGroundCenterpiece(el: CenterpieceElement): boolean {
  if (hasTracedBlockOutline(el)) {
    return false;
  }
  return GROUND_SHAPES.has(el.shape ?? '');
}

/** Resolve the focal point that seating blocks should face (pitch, stage, or canvas centre). */
export function resolveGroundFocalPoint(
  elements: LayoutElement[],
  canvas: CanvasConfig,
): GroundFocalPoint {
  const pitch = elements.find(isPitchElement);
  if (pitch?.type === 'centerpiece') {
    const centre = elementCentreCanvas(pitch, canvas);
    return {
      x: centre.x,
      y: centre.y,
      source: 'pitch',
      label: pitch.label?.trim() || 'Pitch',
    };
  }

  const stage = elements.find(isStageElement);
  if (stage?.type === 'centerpiece') {
    const centre = elementCentreCanvas(stage, canvas);
    return { x: centre.x, y: centre.y, source: 'stage', label: 'Stage' };
  }

  const centerpieces = elements.filter(
    (el): el is CenterpieceElement => el.type === 'centerpiece' && isGroundCenterpiece(el),
  );
  if (centerpieces.length > 0) {
    const largest = centerpieces.reduce((best, el) =>
      elementArea(el) > elementArea(best) ? el : best,
    );
    const centre = elementCentreCanvas(largest, canvas);
    return {
      x: centre.x,
      y: centre.y,
      source: 'centerpiece',
      label: largest.label?.trim() || 'Ground',
    };
  }

  return {
    x: canvas.width / 2,
    y: canvas.height / 2,
    source: 'canvas-center',
    label: 'Centre',
  };
}

export interface GroundViewpointResult {
  blockViewpointAngleDeg: number;
  dragSeatsStadiumSideIndex: number;
  dragSeatsStadiumSideIndices?: number[];
}

/** Infer VIEW POINT angle and stadium side index so the block faces the ground focal point. */
export function inferGroundViewpointForBlock(
  block: CenterpieceElement,
  focal: GroundFocalPoint | CanvasPoint2,
  canvas: CanvasConfig,
): GroundViewpointResult {
  const rect = rectFromPositionSize(block.position, block.size, canvas);
  const polygon = polygonCanvasPointsFromBlock(block.customPoints ?? [], rect);
  const cx = rect.cx;
  const cy = rect.cy;
  const fx = focal.x;
  const fy = focal.y;
  const angle = viewpointAngleFromCanvasPoint(cx, cy, fx, fy);
  const sides = resolveViewpointLogicalEdges(polygon, cx, cy, angle);
  const bestFromView = stadiumLogicalEdgeFromView(polygon, cx, cy, angle);
  const primarySide =
    bestFromView && sides.some((s) => s.id === bestFromView.id) ? bestFromView : sides[0] ?? null;
  const sideIndex = primarySide?.index ?? stadiumSideIndexFromViewDirection(polygon, cx, cy, angle);
  return {
    blockViewpointAngleDeg: Math.round(angle),
    dragSeatsStadiumSideIndex: sideIndex,
    dragSeatsStadiumSideIndices: sides.length > 1 ? sides.map((edge) => edge.index) : undefined,
  };
}
