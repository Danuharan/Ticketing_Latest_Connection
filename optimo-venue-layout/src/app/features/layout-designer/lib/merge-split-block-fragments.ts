/**
 * Merges adjacent same-colour block fragments that luminance segmentation split
 * (e.g. across a white printed label stripe) into one polygon.
 */

import type { PointPct } from './contour-geometry';

export interface MergeableBlockFragment {
  polygon: PointPct[];
  cxPct: number;
  cyPct: number;
  fillColor: string;
  meanRadius: number;
  pixelArea: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function parseHex(hex: string): [number, number, number] | null {
  const h = hex.replace('#', '');
  if (h.length !== 6) {
    return null;
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function colorDistance(hexA: string, hexB: string): number {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  if (!a || !b) {
    return Infinity;
  }
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

function bboxGap(a: MergeableBlockFragment, b: MergeableBlockFragment): number {
  const gapX = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
  const gapY = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
  return Math.max(gapX, gapY);
}

function bboxOverlap(a: MergeableBlockFragment, b: MergeableBlockFragment): number {
  const ix = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const iy = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  return ix * iy;
}

function refreshDerivedFields(block: MergeableBlockFragment, width: number, height: number): MergeableBlockFragment {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of block.polygon) {
    const px = (p.xPct / 100) * width;
    const py = (p.yPct / 100) * height;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return {
    ...block,
    minX,
    minY,
    maxX,
    maxY,
    cxPct: ((minX + maxX) / 2 / width) * 100,
    cyPct: ((minY + maxY) / 2 / height) * 100,
  };
}

function convexHullPoints(points: PointPct[]): PointPct[] {
  if (points.length <= 3) {
    return [...points];
  }
  const pts = [...points].sort((a, b) => a.xPct - b.xPct || a.yPct - b.yPct);
  const cross = (o: PointPct, a: PointPct, b: PointPct): number =>
    (a.xPct - o.xPct) * (b.yPct - o.yPct) - (a.yPct - o.yPct) * (b.xPct - o.xPct);
  const lower: PointPct[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: PointPct[] = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  return hull.length >= 3 ? hull : [...points];
}

function mergePair(a: MergeableBlockFragment, b: MergeableBlockFragment): MergeableBlockFragment {
  const minX = Math.min(a.minX, b.minX);
  const minY = Math.min(a.minY, b.minY);
  const maxX = Math.max(a.maxX, b.maxX);
  const maxY = Math.max(a.maxY, b.maxY);
  const polygon = convexHullPoints([...a.polygon, ...b.polygon]);
  return {
    polygon,
    cxPct: (a.cxPct + b.cxPct) / 2,
    cyPct: (a.cyPct + b.cyPct) / 2,
    fillColor: a.pixelArea >= b.pixelArea ? a.fillColor : b.fillColor,
    meanRadius: (a.meanRadius + b.meanRadius) / 2,
    pixelArea: a.pixelArea + b.pixelArea,
    minX,
    minY,
    maxX,
    maxY,
  };
}

function shouldMerge(
  a: MergeableBlockFragment,
  b: MergeableBlockFragment,
  gapPx: number,
  medianArea: number,
): boolean {
  if (colorDistance(a.fillColor, b.fillColor) >= 40) {
    return false;
  }
  const gap = bboxGap(a, b);
  const overlap = bboxOverlap(a, b);
  if (gap > gapPx && overlap <= 0) {
    return false;
  }
  // Two full-size neighbours (e.g. 131 | 132) — never merge.
  if (medianArea > 0 && a.pixelArea > medianArea * 0.55 && b.pixelArea > medianArea * 0.55) {
    return false;
  }

  const widthA = a.maxX - a.minX;
  const widthB = b.maxX - b.minX;
  const heightA = a.maxY - a.minY;
  const heightB = b.maxY - b.minY;
  const minHeight = Math.min(heightA, heightB);
  const minWidth = Math.min(widthA, widthB);

  // Micro-tier fragments (thin aisle / kuddi blocks) stay separate.
  if (minHeight < 12 || minWidth < 10) {
    return false;
  }

  const areaRatio = Math.min(a.pixelArea, b.pixelArea) / Math.max(a.pixelArea, b.pixelArea);
  const smallerArea = Math.min(a.pixelArea, b.pixelArea);
  const largerArea = Math.max(a.pixelArea, b.pixelArea);
  // Never join a micro block to a full B-ring / outer block.
  if (
    medianArea > 0 &&
    smallerArea < medianArea * 0.14 &&
    largerArea > medianArea * 0.32
  ) {
    return false;
  }

  const gapY = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
  const xSpan = Math.min(widthA, widthB);
  const xOverlap =
    xSpan > 0 ? Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) / xSpan : 0;
  const widthRatio = Math.min(widthA, widthB) / Math.max(widthA, widthB);

  // Only top/bottom label-stripe splits — never side-by-side neighbours (B54 | micro column).
  const verticalSplit =
    gapY > 0 && gapY <= gapPx && xOverlap >= 0.72 && widthRatio >= 0.68 && areaRatio >= 0.22;
  if (!verticalSplit && overlap <= 0) {
    return false;
  }

  const larger = Math.max(a.pixelArea, b.pixelArea);
  return a.pixelArea + b.pixelArea <= larger * 2.05;
}

/**
 * Iteratively merge sibling fragments from the same physical block.
 */
export function mergeSplitBlockFragments<T extends MergeableBlockFragment>(
  blocks: T[],
  options: { maxPasses?: number; gapPx?: number; width?: number; height?: number; medianArea?: number } = {},
): T[] {
  const maxPasses = options.maxPasses ?? 3;
  const gapPx = options.gapPx ?? 4;
  const width = options.width ?? 100;
  const height = options.height ?? 100;
  const medianArea = options.medianArea ?? 0;
  let current = [...blocks];

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let mergeIndices: [number, number] | null = null;
    outer: for (let i = 0; i < current.length; i += 1) {
      for (let j = i + 1; j < current.length; j += 1) {
        if (shouldMerge(current[i], current[j], gapPx, medianArea)) {
          mergeIndices = [i, j];
          break outer;
        }
      }
    }
    if (!mergeIndices) {
      break;
    }
    const [i, j] = mergeIndices;
    const combined = refreshDerivedFields(mergePair(current[i], current[j]), width, height);
    current = current.filter((_, idx) => idx !== i && idx !== j);
    current.push(combined as T);
  }

  return current;
}

/** Bbox overlap as a fraction of the smaller box area (0–1). */
export function bboxOverlapFraction(
  a: Pick<MergeableBlockFragment, 'minX' | 'minY' | 'maxX' | 'maxY'>,
  b: Pick<MergeableBlockFragment, 'minX' | 'minY' | 'maxX' | 'maxY'>,
): number {
  const ix = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const iy = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  const intersection = ix * iy;
  const areaA = Math.max(1, (a.maxX - a.minX) * (a.maxY - a.minY));
  const areaB = Math.max(1, (b.maxX - b.minX) * (b.maxY - b.minY));
  return intersection / Math.min(areaA, areaB);
}
