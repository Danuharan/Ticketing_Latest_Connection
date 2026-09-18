import type { CanvasConfig, CenterpieceElement, LayoutElement } from '../models/layout-element.model';
import { hasTracedBlockOutline } from '../models/layout-element.model';
import { rectFromPositionSize } from './geometry';
import { viewpointAngleFromCanvasPoint } from './block-viewpoint';

const GROUND_NAME_RE = /\b(pitch|ground|field|oval|stage)\b/i;

function isGroundCenterpiece(el: CenterpieceElement): boolean {
  return el.type === 'centerpiece' && !hasTracedBlockOutline(el);
}

/** Pitch / playing-field centerpiece — linked from rings, detected by name, or largest standard shape. */
export function findStadiumGroundCenterpiece(
  elements: LayoutElement[],
): CenterpieceElement | null {
  const centerpieces = elements.filter(
    (el): el is CenterpieceElement =>
      el.type === 'centerpiece' && isGroundCenterpiece(el) && el.visible !== false,
  );
  if (centerpieces.length === 0) {
    return null;
  }

  const linkedIds = new Set<string>();
  for (const el of elements) {
    if (el.type === 'layer-ring' && el.centerpieceId) {
      linkedIds.add(el.centerpieceId);
    }
  }

  const linked = centerpieces.filter((cp) => linkedIds.has(cp.id));
  if (linked.length === 1) {
    return linked[0];
  }
  if (linked.length > 1) {
    return linked.find((cp) => cp.shape === 'oval') ?? linked[0];
  }

  const named = centerpieces.find(
    (cp) =>
      cp.id.includes('pitch') ||
      GROUND_NAME_RE.test(cp.name ?? '') ||
      GROUND_NAME_RE.test(cp.label ?? ''),
  );
  if (named) {
    return named;
  }

  return (
    centerpieces.find((cp) => cp.shape === 'oval') ??
    centerpieces.find((cp) => cp.shape === 'rectangle' || cp.shape === 'square') ??
    centerpieces[0]
  );
}

export function groundCenterCanvasPoint(
  ground: CenterpieceElement,
  canvas: CanvasConfig,
): { x: number; y: number } {
  const rect = rectFromPositionSize(ground.position, ground.size, canvas);
  return { x: rect.cx, y: rect.cy };
}

/** Viewpoint angle (0° = above block) from a seating block toward the playing field centre. */
export function resolveViewpointAngleTowardGround(
  element: CenterpieceElement,
  ground: CenterpieceElement | null,
  canvas: CanvasConfig,
): number | null {
  if (!ground || ground.id === element.id) {
    return null;
  }
  const blockRect = rectFromPositionSize(element.position, element.size, canvas);
  const groundCenter = groundCenterCanvasPoint(ground, canvas);
  return viewpointAngleFromCanvasPoint(
    blockRect.cx,
    blockRect.cy,
    groundCenter.x,
    groundCenter.y,
  );
}
