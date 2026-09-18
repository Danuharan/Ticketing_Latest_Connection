import { BlockTypeId } from '../models/block-type.model';
import { buildBlockLocationPreviewSvg } from './block-location-preview';
import { resolveBlockRingIndex, resolveBlockTierLabel } from './block-tier';
import {
  CanvasConfig,
  CenterpieceElement,
  ElementPosition,
  isCustomizableBlock,
  isCustomShapeSeatingEnabled,
  LayoutElement,
} from '../models/layout-element.model';
import { getCustomShapeVisibleSeatCount } from './custom-shape-seats';
import { rectFromPositionSize } from './geometry';
import {
  GroundFocalPoint,
  inferGroundViewpointForBlock,
} from './infer-ground-viewpoint';

const LENGTH_TOLERANCE_M = 0.05;
/** Relative side-length tolerance for "similar width × length" matching (12%). */
const DIMENSION_TOLERANCE_RATIO = 0.12;
const POINT_TOLERANCE = 0.02;
const EDGE_RATIO_TOLERANCE = 0.08;
const ASPECT_RATIO_TOLERANCE = 0.1;

const NON_SEATING_BLOCK_TYPES = new Set<BlockTypeId>([
  'dining-table',
  'general-admission',
  'private-suite',
  'merchandise',
  'third-party-shop',
]);

export interface BlockShapeFingerprint {
  vertexCount: number;
  sideLengthsM: number[];
  normalizedPoints: [number, number][];
}

export interface ShapeGeometrySignature {
  vertexCount: number;
  sortedEdgeRatios: number[];
  aspectRatio: number;
}

export type ShapeMirrorMode = 'none' | 'horizontal' | 'vertical' | 'both';

export interface ShapeAlignment {
  vertexShift: number;
  mirrorMode: ShapeMirrorMode;
}

export type SimilarBlockSkipReason = 'has-seating' | 'ground-edge-shorter';

export interface SimilarBlockCandidate {
  id: string;
  label: string;
  shapeSummary: string;
  shapeFamily: string;
  tierLabel: string;
  locationPreviewSvg: string;
  hasSeating: boolean;
  selectable: boolean;
  skipReason?: SimilarBlockSkipReason;
}

export interface FindSimilarSeatingBlockOptions {
  referenceImageDataUrl?: string | null;
  focal?: GroundFocalPoint;
}

function normalizePoints(points: ElementPosition[]): [number, number][] {
  const xs = points.map((p) => p.xPct);
  const ys = points.map((p) => p.yPct);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(0.001, maxX - minX);
  const h = Math.max(0.001, maxY - minY);
  return points.map((p) => [(p.xPct - minX) / w, (p.yPct - minY) / h]);
}

function rotateArray<T>(arr: T[], steps: number): T[] {
  const n = arr.length;
  if (n === 0) {
    return arr;
  }
  const s = ((steps % n) + n) % n;
  return [...arr.slice(s), ...arr.slice(0, s)];
}

function arraysClose(a: number[], b: number[], tolerance: number): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
}

function ratiosClose(a: number[], b: number[], tolerance: number): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
}

function aspectRatiosClose(a: number, b: number, tolerance: number): boolean {
  const denom = Math.max(a, b, 0.001);
  return Math.abs(a - b) / denom <= tolerance;
}

function pointsClose(a: [number, number][], b: [number, number][], tolerance: number): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every(([x, y], i) => Math.abs(x - b[i][0]) <= tolerance && Math.abs(y - b[i][1]) <= tolerance);
}

function mirrorPointsHorizontal(points: [number, number][]): [number, number][] {
  return points.map(([x, y]) => [1 - x, y]);
}

function mirrorPointsVertical(points: [number, number][]): [number, number][] {
  return points.map(([x, y]) => [x, 1 - y]);
}

function mirrorPointsBoth(points: [number, number][]): [number, number][] {
  return points.map(([x, y]) => [1 - x, 1 - y]);
}

function applyMirrorToPoints(
  points: [number, number][],
  mode: ShapeMirrorMode,
): [number, number][] {
  switch (mode) {
    case 'horizontal':
      return mirrorPointsHorizontal(points);
    case 'vertical':
      return mirrorPointsVertical(points);
    case 'both':
      return mirrorPointsBoth(points);
    default:
      return points;
  }
}

export function polygonEdgeLengths(points: ElementPosition[]): number[] {
  const lengths: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    lengths.push(Math.hypot(b.xPct - a.xPct, b.yPct - a.yPct));
  }
  return lengths;
}

function polygonEdgeLengthsPx(block: CenterpieceElement, canvas: CanvasConfig): number[] {
  const rect = rectFromPositionSize(block.position, block.size, canvas);
  const points = block.customPoints ?? [];
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const ax = rect.x + (point.xPct / 100) * rect.width;
    const ay = rect.y + (point.yPct / 100) * rect.height;
    const bx = rect.x + (next.xPct / 100) * rect.width;
    const by = rect.y + (next.yPct / 100) * rect.height;
    return Math.hypot(bx - ax, by - ay);
  });
}

function lengthToleranceFor(valueM: number): number {
  return Math.max(LENGTH_TOLERANCE_M, valueM * DIMENSION_TOLERANCE_RATIO);
}

function valuesCloseRelative(a: number, b: number): boolean {
  const denom = Math.max(a, b, 0.001);
  return Math.abs(a - b) / denom <= DIMENSION_TOLERANCE_RATIO;
}

export type CoarseShapeClass = 'square' | 'straight' | 'wedge' | 'other';

/**
 * Coarse shape class — ignores exact vertex count so CV polygons with extra
 * contour points still group with clean 4-sided siblings.
 */
export function coarseShapeClass(points: ElementPosition[]): CoarseShapeClass {
  const sig = shapeGeometrySignature(points);
  if (!sig) {
    return 'other';
  }
  const spread =
    sig.sortedEdgeRatios[sig.sortedEdgeRatios.length - 1] - sig.sortedEdgeRatios[0];
  const maxRatio = sig.sortedEdgeRatios[sig.sortedEdgeRatios.length - 1];
  const shortEdgeCount = sig.sortedEdgeRatios.filter((ratio) => ratio < maxRatio * 0.75).length;
  const longEdgeCount = sig.sortedEdgeRatios.length - shortEdgeCount;
  if (spread < 0.12 && sig.aspectRatio > 0.9 && sig.aspectRatio < 1.1) {
    return 'square';
  }
  // Two long + two short sides → rectangular seating strip (any depth).
  if (shortEdgeCount === 2 && longEdgeCount === 2) {
    return 'straight';
  }
  // Uneven edges / trapezoid / curve wedge.
  if (spread >= 0.12 || shortEdgeCount !== longEdgeCount) {
    return 'wedge';
  }
  return 'other';
}

export interface BlockFootprintM {
  longM: number;
  shortM: number;
}

/** Average metres-per-pixel from configured side lengths vs canvas edge lengths. */
export function averageMetresPerPx(
  block: CenterpieceElement,
  lengthsM: number[],
  canvas: CanvasConfig,
): number | null {
  const edgesPx = polygonEdgeLengthsPx(block, canvas);
  if (edgesPx.length < 3 || lengthsM.length < 3) {
    return null;
  }

  // Prefer perimeter scale — works even when length count ≠ vertex count.
  const perimeterPx = edgesPx.reduce((sum, px) => sum + px, 0);
  const perimeterM = lengthsM.reduce((sum, m) => sum + m, 0);
  if (perimeterPx > 0.001 && perimeterM > 0) {
    return perimeterM / perimeterPx;
  }

  const n = Math.min(edgesPx.length, lengthsM.length);
  let sum = 0;
  let count = 0;
  for (let index = 0; index < n; index += 1) {
    if (edgesPx[index] > 0.001 && lengthsM[index] > 0) {
      sum += lengthsM[index] / edgesPx[index];
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

/** Polygon area in canvas pixels (shoelace). */
function polygonAreaPx(block: CenterpieceElement, canvas: CanvasConfig): number {
  const rect = rectFromPositionSize(block.position, block.size, canvas);
  const points = block.customPoints ?? [];
  if (points.length < 3) {
    return 0;
  }
  const canvasPoints = points.map((point) => ({
    x: rect.x + (point.xPct / 100) * rect.width,
    y: rect.y + (point.yPct / 100) * rect.height,
  }));
  let area = 0;
  for (let index = 0; index < canvasPoints.length; index += 1) {
    const a = canvasPoints[index];
    const b = canvasPoints[(index + 1) % canvasPoints.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

/**
 * Rotation-invariant footprint from max edge + area.
 * AABB matching fails on curved stands because rotated blocks inflate their box.
 */
export function blockFootprintM(
  block: CenterpieceElement,
  canvas: CanvasConfig,
  metresPerPx: number,
): BlockFootprintM {
  const edgesPx = polygonEdgeLengthsPx(block, canvas);
  const maxEdgePx = Math.max(...edgesPx, 0.001);
  const longM = maxEdgePx * metresPerPx;
  const areaM2 = polygonAreaPx(block, canvas) * metresPerPx * metresPerPx;
  const shortM = Math.max(0.001, areaM2 / longM);
  return {
    longM: Math.max(longM, shortM),
    shortM: Math.min(longM, shortM),
  };
}

export function footprintsMatchWithinTolerance(a: BlockFootprintM, b: BlockFootprintM): boolean {
  return valuesCloseRelative(a.longM, b.longM) && valuesCloseRelative(a.shortM, b.shortM);
}

function sideLengthsClose(
  source: number[],
  target: number[],
  toleranceFor: (valueM: number) => number = lengthToleranceFor,
): boolean {
  if (source.length !== target.length) {
    return false;
  }
  return source.every(
    (value, index) => Math.abs(value - target[index]) <= toleranceFor(value),
  );
}

export function shapeGeometrySignature(points: ElementPosition[]): ShapeGeometrySignature | null {
  if (points.length < 3) {
    return null;
  }
  const xs = points.map((p) => p.xPct);
  const ys = points.map((p) => p.yPct);
  const w = Math.max(0.001, Math.max(...xs) - Math.min(...xs));
  const h = Math.max(0.001, Math.max(...ys) - Math.min(...ys));
  const edgeLengths = polygonEdgeLengths(points);
  const maxEdge = Math.max(...edgeLengths, 0.001);
  const sortedEdgeRatios = edgeLengths.map((length) => length / maxEdge).sort((a, b) => a - b);
  return {
    vertexCount: points.length,
    sortedEdgeRatios,
    aspectRatio: Math.max(w, h) / Math.min(w, h),
  };
}

export function shapeGeometrySignaturesMatch(
  a: ShapeGeometrySignature,
  b: ShapeGeometrySignature,
): boolean {
  if (a.vertexCount !== b.vertexCount) {
    return false;
  }
  if (!ratiosClose(a.sortedEdgeRatios, b.sortedEdgeRatios, EDGE_RATIO_TOLERANCE)) {
    return false;
  }
  return aspectRatiosClose(a.aspectRatio, b.aspectRatio, ASPECT_RATIO_TOLERANCE);
}

export function blocksHaveSameShapeGeometry(
  source: CenterpieceElement,
  target: CenterpieceElement,
): boolean {
  const srcSig = shapeGeometrySignature(source.customPoints ?? []);
  const tgtSig = shapeGeometrySignature(target.customPoints ?? []);
  if (!srcSig || !tgtSig) {
    return false;
  }
  return shapeGeometrySignaturesMatch(srcSig, tgtSig);
}

export function shapeFamilyLabel(points: ElementPosition[]): string {
  const sig = shapeGeometrySignature(points);
  if (!sig) {
    return 'Unknown shape';
  }
  const spread =
    sig.sortedEdgeRatios[sig.sortedEdgeRatios.length - 1] - sig.sortedEdgeRatios[0];
  const maxRatio = sig.sortedEdgeRatios[sig.sortedEdgeRatios.length - 1];
  const shortEdgeCount = sig.sortedEdgeRatios.filter((ratio) => ratio < maxRatio * 0.75).length;
  const longEdgeCount = sig.sortedEdgeRatios.length - shortEdgeCount;
  const isSquareish = spread < 0.12 && sig.aspectRatio > 0.9 && sig.aspectRatio < 1.1;
  if (sig.vertexCount === 4 && isSquareish) {
    return `${sig.vertexCount}-sided · square`;
  }
  if (sig.vertexCount === 4 && shortEdgeCount === 2 && longEdgeCount === 2) {
    return `${sig.vertexCount}-sided · straight block`;
  }
  if (sig.vertexCount === 4) {
    return `${sig.vertexCount}-sided · corner wedge`;
  }
  return `${sig.vertexCount}-sided block`;
}

export function isSeatingCandidateBlock(el: CenterpieceElement): boolean {
  if (!isCustomizableBlock(el)) {
    return false;
  }
  if (el.blockType && NON_SEATING_BLOCK_TYPES.has(el.blockType)) {
    return false;
  }
  return true;
}

export function fingerprintBlock(el: CenterpieceElement): BlockShapeFingerprint | null {
  const points = el.customPoints ?? [];
  if (points.length < 3) {
    return null;
  }
  return {
    vertexCount: points.length,
    sideLengthsM: [...(el.customSideLengthsM ?? [])],
    normalizedPoints: normalizePoints(points),
  };
}

export function findBestShapeAlignment(
  sourcePoints: [number, number][],
  targetPoints: [number, number][],
): ShapeAlignment | null {
  const exact = findExactShapeAlignment(sourcePoints, targetPoints);
  if (exact) {
    return exact;
  }
  return findBestApproximateShapeAlignment(sourcePoints, targetPoints);
}

function findExactShapeAlignment(
  sourcePoints: [number, number][],
  targetPoints: [number, number][],
): ShapeAlignment | null {
  const n = sourcePoints.length;
  if (targetPoints.length !== n || n < 3) {
    return null;
  }

  const mirrorModes: ShapeMirrorMode[] = ['none', 'horizontal', 'vertical', 'both'];
  for (const mirrorMode of mirrorModes) {
    const mirrored = applyMirrorToPoints(targetPoints, mirrorMode);
    for (let shift = 0; shift < n; shift += 1) {
      const rotated = rotateArray(mirrored, shift);
      if (pointsClose(sourcePoints, rotated, POINT_TOLERANCE)) {
        return { vertexShift: shift, mirrorMode };
      }
    }
  }

  return null;
}

function findBestApproximateShapeAlignment(
  sourcePoints: [number, number][],
  targetPoints: [number, number][],
): ShapeAlignment | null {
  const n = sourcePoints.length;
  if (targetPoints.length !== n || n < 3) {
    return null;
  }

  let best: { alignment: ShapeAlignment; score: number } | null = null;
  const mirrorModes: ShapeMirrorMode[] = ['none', 'horizontal', 'vertical', 'both'];
  for (const mirrorMode of mirrorModes) {
    const mirrored = applyMirrorToPoints(targetPoints, mirrorMode);
    for (let shift = 0; shift < n; shift += 1) {
      const rotated = rotateArray(mirrored, shift);
      let score = 0;
      for (let index = 0; index < n; index += 1) {
        score += Math.hypot(
          sourcePoints[index][0] - rotated[index][0],
          sourcePoints[index][1] - rotated[index][1],
        );
      }
      if (!best || score < best.score) {
        best = { alignment: { vertexShift: shift, mirrorMode }, score };
      }
    }
  }

  return best?.alignment ?? null;
}

export function findShapeAlignmentBetweenBlocks(
  source: CenterpieceElement,
  target: CenterpieceElement,
): ShapeAlignment | null {
  const srcFp = fingerprintBlock(source);
  const tgtFp = fingerprintBlock(target);
  if (!srcFp || !tgtFp) {
    return null;
  }

  return findBestShapeAlignment(srcFp.normalizedPoints, tgtFp.normalizedPoints);
}

export function sideLengthsMatchWithRotation(
  source: number[],
  target: number[],
  tolerance = LENGTH_TOLERANCE_M,
): { match: boolean; shift: number } {
  const n = source.length;
  if (target.length !== n || n === 0) {
    return { match: false, shift: 0 };
  }
  for (let shift = 0; shift < n; shift += 1) {
    const rotated = rotateArray(target, shift);
    if (sideLengthsClose(source, rotated, () => tolerance)) {
      return { match: true, shift };
    }
  }
  return { match: false, shift: 0 };
}

/** Side lengths match within the similar-block relative tolerance (12%). */
export function sideLengthsMatchWithRelativeTolerance(
  source: number[],
  target: number[],
): { match: boolean; shift: number } {
  const n = source.length;
  if (target.length !== n || n === 0) {
    return { match: false, shift: 0 };
  }
  for (let shift = 0; shift < n; shift += 1) {
    const rotated = rotateArray(target, shift);
    if (sideLengthsClose(source, rotated, lengthToleranceFor)) {
      return { match: true, shift };
    }
  }
  return { match: false, shift: 0 };
}

/** Resolve configured side lengths in metres for a block. */
export function resolveSourceSideLengthsM(block: CenterpieceElement): number[] | null {
  const points = block.customPoints ?? [];
  const vertexCount = points.length;
  if (vertexCount < 3) {
    return null;
  }

  const configured = block.customSideLengthsM ?? [];
  if (configured.length === vertexCount && configured.every((length) => length > 0)) {
    return [...configured];
  }
  // Logical / partial measurements still usable for metres-per-pixel scale.
  if (configured.length >= 3 && configured.every((length) => length > 0)) {
    return [...configured];
  }

  const lengthM = block.physicalLengthM;
  const widthM = block.physicalWidthM;
  if (lengthM != null && lengthM > 0 && widthM != null && widthM > 0 && vertexCount === 4) {
    const edgePx = polygonEdgeLengths(points);
    const maxPx = Math.max(...edgePx, 0.001);
    const longM = Math.max(lengthM, widthM);
    const shortM = Math.min(lengthM, widthM);
    return edgePx.map((px) => (px >= maxPx * 0.99 ? longM : shortM));
  }

  return null;
}

/** Estimate target side lengths from a reference block that already has measurements. */
export function estimateSideLengthsFromReference(
  reference: CenterpieceElement,
  referenceLengths: number[],
  target: CenterpieceElement,
  canvas: CanvasConfig,
): number[] | null {
  const ppm = averageMetresPerPx(reference, referenceLengths, canvas);
  if (ppm == null || ppm <= 0) {
    return null;
  }
  const tgtEdgesPx = polygonEdgeLengthsPx(target, canvas);
  if (tgtEdgesPx.length < 3) {
    return null;
  }
  // Vertex count may differ (CV contours). Scale every target edge with source ppm.
  return tgtEdgesPx.map((px) => px * ppm);
}

/** Same shape family with every side matching except the ground-facing side may be shorter. */
export function isGroundEdgeShorterVariant(
  source: CenterpieceElement,
  target: CenterpieceElement,
  elements: LayoutElement[],
  canvas: CanvasConfig,
  focal: GroundFocalPoint,
): boolean {
  if (shapeFamilyLabel(source.customPoints ?? []) !== shapeFamilyLabel(target.customPoints ?? [])) {
    return false;
  }

  const sourceLengths = resolveSourceSideLengthsM(source);
  if (!sourceLengths) {
    return false;
  }
  const targetLengths =
    resolveSourceSideLengthsM(target) ??
    estimateSideLengthsFromReference(source, sourceLengths, target, canvas);
  if (!targetLengths || targetLengths.length !== sourceLengths.length) {
    return false;
  }

  const sourceGroundIndex = inferGroundViewpointForBlock(source, focal, canvas).dragSeatsStadiumSideIndex;
  const n = sourceLengths.length;
  for (let shift = 0; shift < n; shift += 1) {
    const rotatedTarget = rotateArray(targetLengths, shift);
    const sourceGround = sourceLengths[sourceGroundIndex];
    const targetGround = rotatedTarget[sourceGroundIndex];
    if (sourceGround == null || targetGround == null) {
      continue;
    }
    if (targetGround + lengthToleranceFor(sourceGround) >= sourceGround) {
      continue;
    }
    const nonGroundMatch = sourceLengths.every((value, index) => {
      if (index === sourceGroundIndex) {
        return true;
      }
      return Math.abs(value - rotatedTarget[index]) <= lengthToleranceFor(value);
    });
    if (nonGroundMatch) {
      return true;
    }
  }

  return false;
}

/** Whether two blocks share close width × length (bounding footprint within 12%). */
export function blocksHaveSimilarDimensions(
  source: CenterpieceElement,
  target: CenterpieceElement,
  canvas: CanvasConfig,
): boolean {
  const sourceLengths = resolveSourceSideLengthsM(source);
  if (!sourceLengths) {
    return false;
  }

  const metresPerPx = averageMetresPerPx(source, sourceLengths, canvas);
  if (metresPerPx == null || metresPerPx <= 0) {
    // Fallback: same vertex count edge match (legacy path).
    const targetLengths =
      resolveSourceSideLengthsM(target) ??
      estimateSideLengthsFromReference(source, sourceLengths, target, canvas);
    if (!targetLengths || targetLengths.length !== sourceLengths.length) {
      return false;
    }
    return sideLengthsMatchWithRelativeTolerance(sourceLengths, targetLengths).match;
  }

  const sourceFp = blockFootprintM(source, canvas, metresPerPx);
  const targetOwn = resolveSourceSideLengthsM(target);
  if (targetOwn) {
    const targetPpm = averageMetresPerPx(target, targetOwn, canvas);
    if (targetPpm != null && targetPpm > 0) {
      const targetFp = blockFootprintM(target, canvas, targetPpm);
      if (footprintsMatchWithinTolerance(sourceFp, targetFp)) {
        return true;
      }
    }
    // Both blocks have measurements — do not fall back to canvas-size estimate.
    if (
      targetOwn.length === sourceLengths.length &&
      sideLengthsMatchWithRelativeTolerance(sourceLengths, targetOwn).match
    ) {
      return true;
    }
    return false;
  }

  // Empty CV targets: scale their canvas AABB using the source metres-per-pixel.
  const targetFp = blockFootprintM(target, canvas, metresPerPx);
  return footprintsMatchWithinTolerance(sourceFp, targetFp);
}

function blocksShareSimilarShapeFamily(
  source: CenterpieceElement,
  target: CenterpieceElement,
): boolean {
  const sourceClass = coarseShapeClass(source.customPoints ?? []);
  const targetClass = coarseShapeClass(target.customPoints ?? []);
  if (sourceClass === targetClass) {
    return true;
  }
  // Transition blocks (4, 29) may classify as straight while pure corner
  // blocks (5, 28) classify as wedge — still allow that pair.
  const seatingStrip = new Set<CoarseShapeClass>(['wedge', 'straight', 'other']);
  if (seatingStrip.has(sourceClass) && seatingStrip.has(targetClass)) {
    return true;
  }
  if (shapeFamilyLabel(source.customPoints ?? []) === shapeFamilyLabel(target.customPoints ?? [])) {
    return true;
  }
  return blocksHaveSameShapeGeometry(source, target);
}

/** Ground-facing (viewpoint) edge lengths within ±12%. */
export function groundFacingEdgesWithinTolerance(
  source: CenterpieceElement,
  target: CenterpieceElement,
  elements: LayoutElement[],
  canvas: CanvasConfig,
  focal: GroundFocalPoint,
): boolean {
  const sourceLengths = resolveSourceSideLengthsM(source);
  const ppm = sourceLengths ? averageMetresPerPx(source, sourceLengths, canvas) : null;
  if (ppm == null || ppm <= 0) {
    return false;
  }
  // Compare both edges under the same metres-per-pixel so empty CV targets
  // are not mixed with configured side lengths.
  const sourceEdgePx = groundFacingEdgePx(source, canvas, focal);
  const targetEdgePx = groundFacingEdgePx(target, canvas, focal);
  if (sourceEdgePx == null || targetEdgePx == null) {
    return false;
  }
  return valuesCloseRelative(sourceEdgePx * ppm, targetEdgePx * ppm);
}

/** Front/back taper ratio within ±12% (reduces false matches to outer curved blocks). */
export function taperRatiosWithinTolerance(
  source: CenterpieceElement,
  target: CenterpieceElement,
  elements: LayoutElement[],
  canvas: CanvasConfig,
  focal: GroundFocalPoint,
): boolean {
  const sourceLengths = resolveSourceSideLengthsM(source);
  const ppm = sourceLengths ? averageMetresPerPx(source, sourceLengths, canvas) : null;
  if (ppm == null || ppm <= 0) {
    return true;
  }

  const sourceFrontPx = groundFacingEdgePx(source, canvas, focal);
  const targetFrontPx = groundFacingEdgePx(target, canvas, focal);
  const sourceBackPx = oppositeEdgePx(source, canvas, focal);
  const targetBackPx = oppositeEdgePx(target, canvas, focal);
  if (
    sourceFrontPx == null ||
    targetFrontPx == null ||
    sourceBackPx == null ||
    targetBackPx == null ||
    sourceBackPx <= 0 ||
    targetBackPx <= 0
  ) {
    return true;
  }

  const sourceTaper = sourceFrontPx / sourceBackPx;
  const targetTaper = targetFrontPx / targetBackPx;
  return valuesCloseRelative(sourceTaper, targetTaper);
}

function groundFacingEdgePx(
  block: CenterpieceElement,
  canvas: CanvasConfig,
  focal: GroundFocalPoint,
): number | null {
  const viewpoint = inferGroundViewpointForBlock(block, focal, canvas);
  const edgesPx = polygonEdgeLengthsPx(block, canvas);
  if (edgesPx.length < 3) {
    return null;
  }
  const edgeIndex = Math.max(
    0,
    Math.min(edgesPx.length - 1, viewpoint.dragSeatsStadiumSideIndex),
  );
  return edgesPx[edgeIndex];
}

function oppositeEdgePx(
  block: CenterpieceElement,
  canvas: CanvasConfig,
  focal: GroundFocalPoint,
): number | null {
  const viewpoint = inferGroundViewpointForBlock(block, focal, canvas);
  const edgesPx = polygonEdgeLengthsPx(block, canvas);
  if (edgesPx.length < 3) {
    return null;
  }
  const groundIndex = Math.max(
    0,
    Math.min(edgesPx.length - 1, viewpoint.dragSeatsStadiumSideIndex),
  );
  const oppositeIndex = (groundIndex + Math.floor(edgesPx.length / 2)) % edgesPx.length;
  return edgesPx[oppositeIndex];
}

export function blocksAreSimilarSeatingCandidates(
  source: CenterpieceElement,
  target: CenterpieceElement,
  canvas: CanvasConfig,
  focal?: GroundFocalPoint,
  elements: LayoutElement[] = [],
): boolean {
  if (!isSeatingCandidateBlock(target)) {
    return false;
  }
  if (!blocksShareSimilarShapeFamily(source, target)) {
    return false;
  }
  if (!blocksHaveSimilarDimensions(source, target, canvas)) {
    return false;
  }
  // Ground-facing edge may be shorter (11 / 22) — those stay candidates but are
  // marked non-selectable later. Do not hard-require ±12% front length / taper
  // here: rotated neighbors on a curve often differ more than 12% while still
  // being the correct "same shape / same size" family.
  if (!focal) {
    return true;
  }
  return !isGroundFacingEdgeTooShort(source, target, elements, canvas, focal);
}

/** Ground-facing edge length in metres for a block (works across different vertex counts). */
export function groundFacingEdgeLengthM(
  block: CenterpieceElement,
  elements: LayoutElement[],
  canvas: CanvasConfig,
  focal: GroundFocalPoint,
  metresPerPx?: number | null,
): number | null {
  const viewpoint = inferGroundViewpointForBlock(block, focal, canvas);
  const edgesPx = polygonEdgeLengthsPx(block, canvas);
  if (edgesPx.length < 3) {
    return null;
  }
  const edgeIndex = Math.max(
    0,
    Math.min(edgesPx.length - 1, viewpoint.dragSeatsStadiumSideIndex),
  );
  const sideLengths = resolveSourceSideLengthsM(block);
  if (sideLengths && sideLengths.length === edgesPx.length) {
    return sideLengths[edgeIndex];
  }
  const edgePx = edgesPx[edgeIndex];
  if (metresPerPx != null && metresPerPx > 0) {
    return edgePx * metresPerPx;
  }
  const ppm = sideLengths ? averageMetresPerPx(block, sideLengths, canvas) : null;
  if (ppm == null || ppm <= 0) {
    return null;
  }
  return edgePx * ppm;
}

export function isGroundFacingEdgeTooShort(
  source: CenterpieceElement,
  target: CenterpieceElement,
  elements: LayoutElement[],
  canvas: CanvasConfig,
  focal: GroundFocalPoint,
): boolean {
  const sourceLengths = resolveSourceSideLengthsM(source);
  const ppm = sourceLengths ? averageMetresPerPx(source, sourceLengths, canvas) : null;
  if (ppm == null || ppm <= 0) {
    return false;
  }
  const sourceEdgePx = groundFacingEdgePx(source, canvas, focal);
  const targetEdgePx = groundFacingEdgePx(target, canvas, focal);
  if (sourceEdgePx == null || targetEdgePx == null) {
    return false;
  }
  const sourceEdge = sourceEdgePx * ppm;
  const targetEdge = targetEdgePx * ppm;
  return targetEdge + lengthToleranceFor(sourceEdge) < sourceEdge;
}

/** Strict matcher — kept for tests and optional future strict tier. */
export function blocksHaveSameShapeAndMeasurements(
  source: CenterpieceElement,
  target: CenterpieceElement,
): boolean {
  const srcFp = fingerprintBlock(source);
  const tgtFp = fingerprintBlock(target);
  if (!srcFp || !tgtFp) {
    return false;
  }
  if (srcFp.vertexCount !== tgtFp.vertexCount) {
    return false;
  }

  const srcLengths = srcFp.sideLengthsM;
  const tgtLengths = tgtFp.sideLengthsM;
  if (srcLengths.length !== srcFp.vertexCount || tgtLengths.length !== tgtFp.vertexCount) {
    return false;
  }
  if (!srcLengths.every((l) => l > 0) || !tgtLengths.every((l) => l > 0)) {
    return false;
  }

  if (!sideLengthsMatchWithRotation(srcLengths, tgtLengths).match) {
    return false;
  }

  return findBestShapeAlignment(srcFp.normalizedPoints, tgtFp.normalizedPoints) != null;
}

export function shapeSummaryForBlock(el: CenterpieceElement): string {
  const n = el.customPoints?.length ?? 0;
  const lengths = el.customSideLengthsM ?? [];
  if (lengths.length >= 2) {
    const sorted = [...lengths].sort((a, b) => b - a);
    return `${n} sides · ${sorted[0].toFixed(1)}m × ${sorted[1].toFixed(1)}m`;
  }
  const sig = shapeGeometrySignature(el.customPoints ?? []);
  if (sig) {
    const maxRatio = sig.sortedEdgeRatios[sig.sortedEdgeRatios.length - 1];
    const minRatio = sig.sortedEdgeRatios[0];
    return `${n} sides · geometry ${(minRatio * 100).toFixed(0)}–${(maxRatio * 100).toFixed(0)}%`;
  }
  return `${n} sides`;
}

export function blockHasExistingSeating(el: CenterpieceElement, canvas: CanvasConfig): boolean {
  if (!isCustomShapeSeatingEnabled(el)) {
    return false;
  }
  const rect = rectFromPositionSize(el.position, el.size, canvas);
  return getCustomShapeVisibleSeatCount(el, rect) > 0;
}

export function findSimilarSeatingBlockCandidates(
  sourceId: string,
  elements: LayoutElement[],
  canvas: CanvasConfig,
  options: FindSimilarSeatingBlockOptions = {},
): SimilarBlockCandidate[] {
  const source = elements.find((el) => el.id === sourceId);
  if (!source || !isCustomizableBlock(source) || source.blockType !== 'seating') {
    return [];
  }

  const sourceFamily = shapeFamilyLabel(source.customPoints ?? []);
  const sourceRingIndex = resolveBlockRingIndex(source, elements, canvas);
  const focal =
    options.focal ??
    ({
      x: canvas.width / 2,
      y: canvas.height / 2,
      source: 'canvas-center',
      label: 'Centre',
    } satisfies GroundFocalPoint);
  const candidates: SimilarBlockCandidate[] = [];
  for (const item of elements) {
    if (item.id === sourceId) {
      continue;
    }
    if (!isCustomizableBlock(item)) {
      continue;
    }
    if (resolveBlockRingIndex(item, elements, canvas) !== sourceRingIndex) {
      continue;
    }
    if (!blocksAreSimilarSeatingCandidates(source, item, canvas, focal, elements)) {
      continue;
    }

    const hasSeating = blockHasExistingSeating(item, canvas);
    const skipReason: SimilarBlockSkipReason | undefined = hasSeating
      ? 'has-seating'
      : undefined;
    const label = item.label?.trim() || item.name?.trim() || item.id;
    const tierLabel = resolveBlockTierLabel(item, elements, canvas);
    candidates.push({
      id: item.id,
      label,
      shapeSummary: shapeSummaryForBlock(item),
      shapeFamily: sourceFamily,
      tierLabel,
      locationPreviewSvg: buildBlockLocationPreviewSvg({
        elements,
        canvas,
        highlightBlockId: item.id,
        referenceImageDataUrl: options.referenceImageDataUrl,
      }),
      hasSeating,
      selectable: !skipReason,
      skipReason,
    });
  }

  return candidates.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}
