import { resolveGroundFocalPoint } from './infer-ground-viewpoint';
import {
  CanvasConfig,
  CenterpieceElement,
  isCustomizableBlock,
  LayoutElement,
} from '../models/layout-element.model';

const DEFAULT_TIER_NAMES = ['Inner Tier', 'Thin Tier', 'B Tier', 'Outer Tier', 'Tier 5', 'Tier 6'];

function blockCentroidCanvasPct(block: CenterpieceElement): { xPct: number; yPct: number } {
  return { xPct: block.position.xPct, yPct: block.position.yPct };
}

function inferRingIndexFromDistance(
  block: CenterpieceElement,
  elements: LayoutElement[],
  canvas: CanvasConfig,
): number {
  const focal = resolveGroundFocalPoint(elements, canvas);
  const focalXPct = (focal.x / canvas.width) * 100;
  const focalYPct = (focal.y / canvas.height) * 100;
  const centroid = blockCentroidCanvasPct(block);
  const dist = Math.hypot(centroid.xPct - focalXPct, centroid.yPct - focalYPct);

  const ringDistances = new Map<number, number[]>();
  for (const el of elements) {
    if (!isCustomizableBlock(el) || el.id === block.id) {
      continue;
    }
    if (typeof el.ringIndex !== 'number') {
      continue;
    }
    const c = blockCentroidCanvasPct(el);
    const d = Math.hypot(c.xPct - focalXPct, c.yPct - focalYPct);
    const list = ringDistances.get(el.ringIndex) ?? [];
    list.push(d);
    ringDistances.set(el.ringIndex, list);
  }

  if (ringDistances.size === 0) {
    return 0;
  }

  let bestRing = 0;
  let bestDiff = Infinity;
  for (const [ringIndex, dists] of ringDistances) {
    const meanDist = dists.reduce((sum, value) => sum + value, 0) / dists.length;
    const diff = Math.abs(dist - meanDist);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestRing = ringIndex;
    }
  }
  return bestRing;
}

/** Resolve seating ring for tier-scoped bulk apply (persisted or inferred). */
export function resolveBlockRingIndex(
  block: CenterpieceElement,
  elements: LayoutElement[],
  canvas: CanvasConfig,
): number {
  if (typeof block.ringIndex === 'number') {
    return block.ringIndex;
  }
  return inferRingIndexFromDistance(block, elements, canvas);
}

export function resolveBlockTierLabel(
  block: CenterpieceElement,
  elements: LayoutElement[],
  canvas: CanvasConfig,
): string {
  if (block.tierLabel?.trim()) {
    return block.tierLabel.trim();
  }
  const ringIndex = resolveBlockRingIndex(block, elements, canvas);
  return DEFAULT_TIER_NAMES[ringIndex] ?? `Tier ${ringIndex + 1}`;
}
