/**
 * OCR-guided recovery for seating blocks that CV segmentation merged or skipped.
 * Runs after assignOcrToBlocks() and adds polygons traced at uncovered OCR tokens.
 */

import { pointInPolygon } from './contour-geometry';
import type { PointPct } from './contour-geometry';
import type { CvAnalysisResult, LabeledBlock, OcrToken } from './assign-ocr-labels';
import type { AnalysisImageData, DetectedBlock } from './detect-blocks';
import { floodFillAtPoint } from './flood-fill';
import {
  B_BLOCK_RE,
  inferMicroTierRadiusBand,
  isMicroTierBlockLabelToken,
  isPrimaryBlockLabelToken,
} from './primary-block-label-tokens';

/** Case/punctuation-insensitive label key (matches blueprint audit). */
export function normalizeBlockLabel(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Whether an OCR token looks like a primary section block label. */
export function isBlockNumberToken(token: OcrToken, allTokens: OcrToken[] = []): boolean {
  return isPrimaryBlockLabelToken(token, allTokens.length > 0 ? allTokens : [token]);
}

function blockLabel(block: LabeledBlock): string {
  return block.labelFromOcr ? block.assignedLabel : block.name;
}

function blockCoveringToken(token: OcrToken, blocks: LabeledBlock[]): LabeledBlock | null {
  for (const block of blocks) {
    if (pointInPolygon(token.xPct, token.yPct, block.polygon)) {
      return block;
    }
  }
  return null;
}

/** True when a block polygon already covers this token with the matching label. */
export function isTokenSatisfied(token: OcrToken, blocks: LabeledBlock[]): boolean {
  const covering = blockCoveringToken(token, blocks);
  if (!covering) {
    return false;
  }
  return normalizeBlockLabel(blockLabel(covering)) === normalizeBlockLabel(token.text);
}

type RecoveryTokenKind = 'primary' | 'micro';

function isRecoveryToken(
  token: OcrToken,
  allTokens: OcrToken[],
  microBand: ReturnType<typeof inferMicroTierRadiusBand>,
  kind: RecoveryTokenKind,
): boolean {
  if (kind === 'primary') {
    return isPrimaryBlockLabelToken(token, allTokens);
  }
  const radiusPct = Math.hypot(token.xPct - 50, token.yPct - 50);
  return isMicroTierBlockLabelToken(token, allTokens, radiusPct, microBand);
}

/** OCR block-number tokens not yet covered by a correctly labelled polygon. */
export function findUncoveredBlockTokens(
  tokens: OcrToken[],
  blocks: LabeledBlock[],
  kind: RecoveryTokenKind = 'primary',
): OcrToken[] {
  const microBand = kind === 'micro' ? inferMicroTierRadiusBand(blocks) : null;
  const seen = new Set<string>();
  const uncovered: OcrToken[] = [];
  for (const token of tokens) {
    if (!isRecoveryToken(token, tokens, microBand, kind)) {
      continue;
    }
    const key = normalizeBlockLabel(token.text);
    if (seen.has(key) || isTokenSatisfied(token, blocks)) {
      continue;
    }
    seen.add(key);
    uncovered.push(token);
  }
  return uncovered;
}

function polygonPixelBounds(
  polygon: PointPct[],
  width: number,
  height: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    const px = (p.xPct / 100) * width;
    const py = (p.yPct / 100) * height;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return { minX, minY, maxX, maxY };
}

function passesBlockSanityChecks(
  pixelArea: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  width: number,
  height: number,
  allowThin = false,
): boolean {
  const totalPixels = width * height;
  const minArea = allowThin ? Math.max(18, totalPixels * 0.000012) : Math.max(35, totalPixels * 0.000025);
  const maxArea = totalPixels * 0.08;
  if (pixelArea < minArea || pixelArea > maxArea) {
    return false;
  }
  const boxW = maxX - minX;
  const boxH = maxY - minY;
  if (boxW < (allowThin ? 2 : 3) || boxH < (allowThin ? 2 : 3)) {
    return false;
  }
  const shortSide = Math.max(1, Math.min(boxW, boxH));
  const aspect = Math.max(boxW, boxH) / shortSide;
  return !(aspect > 45 || (aspect > 18 && shortSide < (allowThin ? 2 : 3)));
}

function medianBlockPixelArea(blocks: LabeledBlock[]): number {
  if (blocks.length === 0) {
    return 0;
  }
  const areas = blocks.map((b) => b.pixelArea).sort((a, b) => a - b);
  return areas[Math.floor(areas.length / 2)];
}

function medianBlockPixelAreaForRing(blocks: LabeledBlock[], ringIndex: number): number {
  const ringBlocks = blocks.filter((block) => block.ringIndex === ringIndex);
  return medianBlockPixelArea(ringBlocks.length > 0 ? ringBlocks : blocks);
}

function medianBlockBBoxPx(
  blocks: LabeledBlock[],
  width: number,
  height: number,
  excludeBlock: LabeledBlock | null = null,
  preferRing: number | null = null,
): { w: number; h: number } {
  const widths: number[] = [];
  const heights: number[] = [];
  const ringBlocks =
    preferRing === null ? blocks : blocks.filter((block) => block.ringIndex === preferRing);
  const source = ringBlocks.length >= 2 ? ringBlocks : blocks;
  for (const block of source) {
    if (excludeBlock && block.id === excludeBlock.id) {
      continue;
    }
    const bounds = polygonPixelBounds(block.polygon, width, height);
    widths.push(bounds.maxX - bounds.minX);
    heights.push(bounds.maxY - bounds.minY);
  }
  const median = (values: number[], fallback: number): number => {
    if (values.length === 0) {
      return fallback;
    }
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const capW = width * 0.16;
  const capH = height * 0.16;
  return {
    w: Math.max(8, Math.min(median(widths, width * 0.12), capW)),
    h: Math.max(8, Math.min(median(heights, height * 0.12), capH)),
  };
}

function inferRingIndex(cxPct: number, cyPct: number, blocks: LabeledBlock[]): number {
  if (blocks.length === 0) {
    return 0;
  }
  const radius = Math.hypot(cxPct - 50, cyPct - 50);
  const ringMeans = new Map<number, number[]>();
  for (const block of blocks) {
    const r = Math.hypot(block.cxPct - 50, block.cyPct - 50);
    const list = ringMeans.get(block.ringIndex) ?? [];
    list.push(r);
    ringMeans.set(block.ringIndex, list);
  }
  let bestRing = 0;
  let bestDist = Infinity;
  for (const [ring, radii] of ringMeans) {
    const mean = radii.reduce((sum, value) => sum + value, 0) / radii.length;
    const dist = Math.abs(radius - mean);
    if (dist < bestDist) {
      bestDist = dist;
      bestRing = ring;
    }
  }
  return bestRing;
}

function recoverBlocksFromTokens(
  labeledBlocks: LabeledBlock[],
  tokens: OcrToken[],
  image: AnalysisImageData,
  tolerance: number,
  kind: RecoveryTokenKind,
): { labeledBlocks: LabeledBlock[]; added: LabeledBlock[] } {
  const { data, width, height } = image;
  const uncovered = findUncoveredBlockTokens(tokens, labeledBlocks, kind);
  if (uncovered.length === 0) {
    return { labeledBlocks, added: [] };
  }

  const medianArea = medianBlockPixelArea(labeledBlocks);
  let nextId = labeledBlocks.reduce((max, block) => Math.max(max, block.id), 0) + 1;
  const added: LabeledBlock[] = [];
  let currentBlocks = [...labeledBlocks];

  for (const token of uncovered) {
    const label = token.text.trim();
    const key = normalizeBlockLabel(label);
    const px = Math.round((token.xPct / 100) * width);
    const py = Math.round((token.yPct / 100) * height);
    const covering = blockCoveringToken(token, currentBlocks);
    const inferredRing = inferRingIndex(token.xPct, token.yPct, currentBlocks);
    const isBBlock = B_BLOCK_RE.test(label);
    const isMicro = kind === 'micro';
    const medianBox = medianBlockBBoxPx(
      currentBlocks,
      width,
      height,
      covering,
      isBBlock || isMicro ? inferredRing : null,
    );
    const targetRect = {
      x: Math.max(0, px - medianBox.w / 2),
      y: Math.max(0, py - medianBox.h / 2),
      width: medianBox.w,
      height: medianBox.h,
    };
    const ff = floodFillAtPoint(data, width, height, px, py, tolerance, { targetRect });
    if (!ff || ff.polygon.length < 3) {
      continue;
    }

    const bounds = polygonPixelBounds(ff.polygon, width, height);
    const cxPct = ((bounds.minX + bounds.maxX) / 2 / width) * 100;
    const cyPct = ((bounds.minY + bounds.maxY) / 2 / height) * 100;

    if (
      !passesBlockSanityChecks(
        ff.pixelArea,
        bounds.minX,
        bounds.minY,
        bounds.maxX,
        bounds.maxY,
        width,
        height,
        isMicro,
      )
    ) {
      continue;
    }

    if (covering && normalizeBlockLabel(blockLabel(covering)) === key) {
      continue;
    }

    const ringMedian = medianBlockPixelAreaForRing(currentBlocks, inferredRing);
    const areaBaseline =
      covering && normalizeBlockLabel(blockLabel(covering)) !== key
        ? medianBlockPixelArea(currentBlocks.filter((block) => block.id !== covering.id)) ||
          ff.pixelArea
        : ringMedian || medianArea;
    const minRatio = isMicro ? 0.18 : isBBlock ? 0.22 : 0.35;
    const maxRatio = isMicro ? 3.5 : 2.5;
    if (areaBaseline > 0) {
      if (ff.pixelArea < areaBaseline * minRatio) {
        continue;
      }
      if (ff.pixelArea > areaBaseline * maxRatio && covering) {
        continue;
      }
    }
    if (
      currentBlocks.some((block) => {
        if (normalizeBlockLabel(blockLabel(block)) !== key) {
          return false;
        }
        return pointInPolygon(cxPct, cyPct, block.polygon);
      })
    ) {
      continue;
    }

    const newBlock: LabeledBlock = {
      id: nextId,
      name: label,
      polygon: ff.polygon,
      cxPct,
      cyPct,
      fillColor: ff.fillColor,
      ringIndex: inferredRing,
      pixelArea: ff.pixelArea,
      assignedLabel: label,
      labelFromOcr: true,
    };
    nextId += 1;
    added.push(newBlock);
    currentBlocks = [...currentBlocks, newBlock];
  }

  return { labeledBlocks: currentBlocks, added };
}

/**
 * Trace missing blocks at uncovered OCR token positions and merge into the CV result.
 */
export function refineBlocksFromOcr(
  merged: CvAnalysisResult,
  ocrTokens: OcrToken[],
  image: AnalysisImageData,
  tolerance: number,
): CvAnalysisResult {
  let labeledBlocks = [...merged.labeledBlocks];

  const primary = recoverBlocksFromTokens(labeledBlocks, ocrTokens, image, tolerance, 'primary');
  labeledBlocks = primary.labeledBlocks;

  const micro = recoverBlocksFromTokens(labeledBlocks, ocrTokens, image, tolerance, 'micro');
  labeledBlocks = micro.labeledBlocks;

  const added = [...primary.added, ...micro.added];
  if (added.length === 0) {
    return merged;
  }

  const detectedAdded: DetectedBlock[] = added.map(({ assignedLabel, labelFromOcr, ...block }) => block);
  const labeledCount = labeledBlocks.filter((block) => block.labelFromOcr).length;
  const parts: string[] = [];
  if (primary.added.length > 0) {
    parts.push(`${primary.added.length} section block(s)`);
  }
  if (micro.added.length > 0) {
    parts.push(`${micro.added.length} micro-tier block(s)`);
  }
  return {
    ...merged,
    blocks: [...merged.blocks, ...detectedAdded],
    labeledBlocks,
    labeledCount,
    unlabeledCount: labeledBlocks.length - labeledCount,
    notes: `${merged.notes} OCR recovery added ${parts.join(' and ')}.`,
  };
}
