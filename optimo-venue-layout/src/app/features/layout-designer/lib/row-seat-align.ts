import { rectFromPositionSize } from './geometry';
import { polygonCanvasPointsFromBlock } from './block-viewpoint';
import {
  CanvasConfig,
  CenterpieceElement,
  LayoutElement,
  isCustomizableBlock,
} from '../models/layout-element.model';

export type RowSeatAlign = 'left' | 'center' | 'right';

export interface AdjacentBlockRef {
  id: string;
  polygon: { x: number; y: number }[];
  /** Canvas-space seat centres. Empty when the neighbour has not been filled yet. */
  seats: { x: number; y: number }[];
}

interface AlongFrame {
  origin: { x: number; y: number };
  ux: number;
  uy: number;
  perpX: number;
  perpY: number;
}

function projectAlong(frame: AlongFrame, point: { x: number; y: number }): number {
  return (point.x - frame.origin.x) * frame.ux + (point.y - frame.origin.y) * frame.uy;
}

function projectDepth(frame: AlongFrame, point: { x: number; y: number }): number {
  return (point.x - frame.origin.x) * frame.perpX + (point.y - frame.origin.y) * frame.perpY;
}

function centroid(points: { x: number; y: number }[]): { x: number; y: number } | null {
  if (points.length === 0) {
    return null;
  }
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function extents(
  points: { x: number; y: number }[],
  frame: AlongFrame,
): { minAlong: number; maxAlong: number; minDepth: number; maxDepth: number } | null {
  if (points.length === 0) {
    return null;
  }
  let minAlong = Number.POSITIVE_INFINITY;
  let maxAlong = Number.NEGATIVE_INFINITY;
  let minDepth = Number.POSITIVE_INFINITY;
  let maxDepth = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const along = projectAlong(frame, point);
    const depth = projectDepth(frame, point);
    minAlong = Math.min(minAlong, along);
    maxAlong = Math.max(maxAlong, along);
    minDepth = Math.min(minDepth, depth);
    maxDepth = Math.max(maxDepth, depth);
  }
  return { minAlong, maxAlong, minDepth, maxDepth };
}

function intervalGap(aMin: number, aMax: number, bMin: number, bMax: number): number {
  if (aMax < bMin) {
    return bMin - aMax;
  }
  if (bMax < aMin) {
    return aMin - bMax;
  }
  return 0;
}

/** True when `other` sits beside this block along the row (not a ring in front/behind). */
export function isLateralAdjacentBlock(
  polygon: { x: number; y: number }[],
  other: { x: number; y: number }[],
  frame: AlongFrame,
): boolean {
  const self = extents(polygon, frame);
  const neighbor = extents(other, frame);
  if (!self || !neighbor) {
    return false;
  }
  const alongSpan = Math.max(1, self.maxAlong - self.minAlong);
  const depthSpan = Math.max(1, self.maxDepth - self.minDepth);
  const alongGap = intervalGap(self.minAlong, self.maxAlong, neighbor.minAlong, neighbor.maxAlong);
  const depthOverlap =
    Math.min(self.maxDepth, neighbor.maxDepth) - Math.max(self.minDepth, neighbor.minDepth);
  if (alongGap > Math.max(28, alongSpan * 0.4)) {
    return false;
  }
  if (depthOverlap < depthSpan * 0.25) {
    return false;
  }
  return true;
}

function neighborAlongSide(
  thisCenterAlong: number,
  neighbor: AdjacentBlockRef,
  frame: AlongFrame,
): 'left' | 'right' | null {
  const loc = centroid(neighbor.seats.length > 0 ? neighbor.seats : neighbor.polygon);
  if (!loc) {
    return null;
  }
  const along = projectAlong(frame, loc);
  if (Math.abs(along - thisCenterAlong) < 1) {
    return null;
  }
  return along < thisCenterAlong ? 'left' : 'right';
}

/**
 * When leftover seats pack to an outer / side edge, pick left vs right from
 * neighbouring blocks. End blocks hug the far side (away from the neighbour);
 * blocks with neighbours on both sides stay centred.
 */
export function resolveRowSeatAlignFromAdjacent(
  polygon: { x: number; y: number }[],
  frame: AlongFrame,
  adjacent: AdjacentBlockRef[],
): RowSeatAlign {
  const self = extents(polygon, frame);
  if (!self) {
    return 'center';
  }
  const thisCenterAlong = (self.minAlong + self.maxAlong) / 2;
  let hasLeft = false;
  let hasRight = false;
  for (const neighbor of adjacent) {
    if (!isLateralAdjacentBlock(polygon, neighbor.polygon, frame)) {
      continue;
    }
    const side = neighborAlongSide(thisCenterAlong, neighbor, frame);
    if (side === 'left') {
      hasLeft = true;
    } else if (side === 'right') {
      hasRight = true;
    }
  }
  if (hasLeft && hasRight) {
    return 'center';
  }
  if (hasLeft) {
    return 'right';
  }
  if (hasRight) {
    return 'left';
  }
  return 'center';
}

function canvasSeatsFromElement(el: CenterpieceElement, canvas: CanvasConfig): { x: number; y: number }[] {
  const rect = rectFromPositionSize(el.position, el.size, canvas);
  const overrides = el.autoFillStraightSeatPositions ?? el.seatPositionOverrides ?? {};
  return Object.values(overrides).map((position) => ({
    x: rect.x + (position.xPct / 100) * rect.width,
    y: rect.y + (position.yPct / 100) * rect.height,
  }));
}

/** Nearby seating blocks, including unfilled ones, for outer/side alignment. */
export function collectAdjacentBlocks(
  element: CenterpieceElement,
  allElements: LayoutElement[],
  canvas: CanvasConfig,
): AdjacentBlockRef[] {
  const adjacent: AdjacentBlockRef[] = [];
  for (const item of allElements) {
    if (item.id === element.id || !isCustomizableBlock(item)) {
      continue;
    }
    if (item.blockType === 'dining-table' || item.blockType === 'general-admission') {
      continue;
    }
    const rect = rectFromPositionSize(item.position, item.size, canvas);
    const polygon = polygonCanvasPointsFromBlock(item.customPoints ?? [], rect);
    if (polygon.length < 3) {
      continue;
    }
    adjacent.push({
      id: item.id,
      polygon,
      seats: canvasSeatsFromElement(item, canvas),
    });
  }
  return adjacent;
}
