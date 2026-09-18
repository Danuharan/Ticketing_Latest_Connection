/**
 * Assigns Azure OCR text tokens to detected block polygons.
 *
 * Rules:
 * - A token is assigned to the nearest block that contains it in the polygon
 *   or the block bbox (white printed numbers often sit in a contour hole).
 * - A block is labelled only from tokens that sit near its centre (center-weighted),
 *   so a neighbour ring's number that bleeds over a boundary is rejected.
 * - Multi-word names (e.g. "HILL STAND 1") are composed only when letters are
 *   present; pure-numeric blocks take the single best number (no "116 117").
 * - No central token → no label (never invent or borrow names).
 * - Tiny aisle numbers are dropped using OCR glyph height when available.
 */

import { pointInPolygon } from './contour-geometry';
import type { PointPct } from './contour-geometry';
import type { DetectedBlock, DetectedStand, BlockDetectionResult } from './detect-blocks';

export interface OcrToken {
  text: string;
  xPct: number;
  yPct: number;
  /** Glyph height as a % of image height (optional — present after edge redeploy). */
  hPct?: number;
}

export interface LabeledBlock extends DetectedBlock {
  /** OCR-assigned label; empty when no text was found inside the block. */
  assignedLabel: string;
  labelFromOcr: boolean;
}

export interface CvAnalysisResult extends BlockDetectionResult {
  labeledBlocks: LabeledBlock[];
  stands: DetectedStand[];
  ocrTokenCount: number;
  labeledCount: number;
  unlabeledCount: number;
}

const STAND_MIN_LEN = 4;
const COMPOSED_LABEL_MAX_LEN = 48;
/** How far from the block centre a token may sit (fraction of half-extent). */
const CENTER_FRACTION = 0.82;
/** Small absolute margin so tokens in tiny blocks are not over-rejected (canvas %). */
const CENTER_MARGIN_PCT = 1.2;

/** Tokens that are never used as block labels (compass, gates, facilities). */
function isNoiseToken(text: string): boolean {
  const t = text.trim();
  if (!t) {
    return true;
  }
  if (/^GATE\s*\d*$/i.test(t)) {
    return true;
  }
  if (/^(NORTHERN|SOUTHERN|EASTERN|WESTERN|NORTH|SOUTH|EAST|WEST)$/i.test(t)) {
    return true;
  }
  if (/^(REPLAY|SCREEN|MEMBERS|PITCH|INTERCHANGE|BENCH|FIELD)$/i.test(t)) {
    return true;
  }
  return false;
}

/** A single OCR word/number that may be part of a block label. */
function isCompositorToken(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 24 || isNoiseToken(t)) {
    return false;
  }
  return /^[A-Za-z0-9][A-Za-z0-9.'\-/]*$/.test(t);
}

function isNumericToken(text: string): boolean {
  return /^[A-Za-z]?\d{1,4}[A-Za-z]?$/.test(text.trim());
}

function hasLetterToken(tokens: OcrToken[]): boolean {
  return tokens.some((t) => /[A-Za-z]{2,}/.test(t.text));
}

interface PolyBounds {
  cx: number;
  cy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  span: number;
}

function polygonBounds(polygon: PointPct[]): PolyBounds {
  let cx = 0;
  let cy = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of polygon) {
    cx += point.xPct;
    cy += point.yPct;
    minX = Math.min(minX, point.xPct);
    maxX = Math.max(maxX, point.xPct);
    minY = Math.min(minY, point.yPct);
    maxY = Math.max(maxY, point.yPct);
  }
  const n = polygon.length;
  return {
    cx: cx / n,
    cy: cy / n,
    minX,
    maxX,
    minY,
    maxY,
    span: Math.max(maxX - minX, maxY - minY),
  };
}

/** Bounding-box centre (more stable than vertex average for label placement). */
function boxCenter(bounds: PolyBounds): { x: number; y: number } {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

/** A token is "central" when it sits near the block centre, not on a boundary. */
function isCentralToken(token: OcrToken, bounds: PolyBounds): boolean {
  const c = boxCenter(bounds);
  const hx = Math.max(0.5, (bounds.maxX - bounds.minX) / 2);
  const hy = Math.max(0.5, (bounds.maxY - bounds.minY) / 2);
  const okX = Math.abs(token.xPct - c.x) <= hx * CENTER_FRACTION + CENTER_MARGIN_PCT;
  const okY = Math.abs(token.yPct - c.y) <= hy * CENTER_FRACTION + CENTER_MARGIN_PCT;
  return okX && okY;
}

/** White printed numbers often sit in a hole the luminance contour does not fill. */
function tokenHitsBlock(token: OcrToken, polygon: PointPct[], bounds: PolyBounds): boolean {
  if (pointInPolygon(token.xPct, token.yPct, polygon)) {
    return true;
  }
  const pad = Math.max(0.35, bounds.span * 0.05);
  return (
    token.xPct >= bounds.minX - pad &&
    token.xPct <= bounds.maxX + pad &&
    token.yPct >= bounds.minY - pad &&
    token.yPct <= bounds.maxY + pad
  );
}

function isTokenClaimedByOtherBlock(
  token: OcrToken,
  claimedCentroids: PointPct[],
  claimRadiusPct: number,
): boolean {
  for (const centroid of claimedCentroids) {
    if (Math.hypot(token.xPct - centroid.xPct, token.yPct - centroid.yPct) <= claimRadiusPct) {
      return true;
    }
  }
  return false;
}

/** Drop tiny glyphs (aisle/entry numbers) using median OCR glyph height. */
function filterTinyGlyphs(tokens: OcrToken[]): OcrToken[] {
  const heights = tokens
    .map((t) => t.hPct)
    .filter((h): h is number => typeof h === 'number' && h > 0);
  if (heights.length < 6) {
    return tokens;
  }
  const sorted = [...heights].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const minHeight = median * 0.55;
  return tokens.filter((t) => typeof t.hPct !== 'number' || t.hPct >= minHeight);
}

function estimateLineThreshold(tokens: OcrToken[]): number {
  if (tokens.length < 2) {
    return 2.5;
  }
  const ys = [...tokens.map((t) => t.yPct)].sort((a, b) => a - b);
  let minGap = Infinity;
  for (let i = 1; i < ys.length; i += 1) {
    const gap = ys[i] - ys[i - 1];
    if (gap > 0.35) {
      minGap = Math.min(minGap, gap);
    }
  }
  return minGap < Infinity ? minGap * 0.42 : 2.5;
}

/** Join OCR tokens into one label (supports stacked lines like HILL / STAND / 1). */
export function composeLabelFromTokens(tokens: OcrToken[]): string | null {
  const usable = tokens
    .map((t) => ({ ...t, text: t.text.trim() }))
    .filter((t) => isCompositorToken(t.text));
  if (usable.length === 0) {
    return null;
  }
  if (usable.length === 1) {
    return usable[0].text;
  }

  const sorted = [...usable].sort((a, b) => a.yPct - b.yPct || a.xPct - b.xPct);
  const lineThreshold = Math.max(1.2, estimateLineThreshold(sorted));
  const lines: OcrToken[][] = [];

  for (const token of sorted) {
    let placed = false;
    for (const line of lines) {
      const avgY = line.reduce((s, t) => s + t.yPct, 0) / line.length;
      if (Math.abs(token.yPct - avgY) <= lineThreshold) {
        line.push(token);
        placed = true;
        break;
      }
    }
    if (!placed) {
      lines.push([token]);
    }
  }

  lines.sort((a, b) => {
    const ay = a.reduce((s, t) => s + t.yPct, 0) / a.length;
    const by = b.reduce((s, t) => s + t.yPct, 0) / b.length;
    return ay - by;
  });

  const parts: string[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.xPct - b.xPct);
    for (const token of line) {
      if (!parts.includes(token.text)) {
        parts.push(token.text);
      }
    }
  }

  const composed = parts.join(' ').trim();
  if (!composed || composed.length > COMPOSED_LABEL_MAX_LEN) {
    return null;
  }
  return composed;
}

/** Pure-numeric blocks: pick the single best number (closest to centre, largest). */
function pickBestNumeric(tokens: OcrToken[], bounds: PolyBounds): string | null {
  const c = boxCenter(bounds);
  let best: string | null = null;
  let bestDist = Infinity;
  let bestHeight = -1;
  for (const token of tokens) {
    if (!isNumericToken(token.text)) {
      continue;
    }
    const dist = Math.hypot(token.xPct - c.x, token.yPct - c.y);
    const height = token.hPct ?? 0;
    if (dist < bestDist - 0.4 || (Math.abs(dist - bestDist) <= 0.4 && height > bestHeight)) {
      bestDist = dist;
      bestHeight = height;
      best = token.text.trim();
    }
  }
  return best;
}

/** Resolve a block label from the tokens that fall inside its polygon. */
function labelFromInsideTokens(tokens: OcrToken[], bounds: PolyBounds): string | null {
  const central = tokens.filter((t) => isCompositorToken(t.text) && isCentralToken(t, bounds));
  if (central.length === 0) {
    return null;
  }
  if (hasLetterToken(central)) {
    return composeLabelFromTokens(central);
  }
  return pickBestNumeric(central, bounds);
}

/** Best OCR label strictly inside a polygon (reference-image % coordinates). */
export function findOcrLabelForPolygon(
  polygon: PointPct[],
  ocrTokens: OcrToken[],
  options: { claimedCentroids?: PointPct[] } = {},
): string | null {
  if (polygon.length < 3 || ocrTokens.length === 0) {
    return null;
  }
  const tokens = filterTinyGlyphs(ocrTokens);
  const bounds = polygonBounds(polygon);
  const claimed = options.claimedCentroids ?? [];
  const claimRadius = Math.max(1, bounds.span * 0.1);

  const inside = tokens.filter(
    (t) =>
      isCompositorToken(t.text) &&
      !isTokenClaimedByOtherBlock(t, claimed, claimRadius) &&
      tokenHitsBlock(t, polygon, bounds),
  );
  return labelFromInsideTokens(inside, bounds);
}

/** Resolve a block label from a traced polygon (click position no longer needed). */
export function findOcrLabelForTracedBlock(
  imagePolygon: PointPct[],
  _clickRefPct: PointPct | null,
  ocrTokens: OcrToken[],
  options: { claimedCentroids?: PointPct[] } = {},
): string | null {
  return findOcrLabelForPolygon(imagePolygon, ocrTokens, options);
}

function isLikelyStandLabel(text: string): boolean {
  const t = text.trim();
  return t.length >= STAND_MIN_LEN && /[A-Za-z]{3,}/.test(t);
}

export function assignOcrToBlocks(
  detection: BlockDetectionResult,
  ocrTokens: OcrToken[],
): CvAnalysisResult {
  const tokens = filterTinyGlyphs(ocrTokens);
  const labeledBlocks: LabeledBlock[] = detection.blocks.map((block) => ({
    ...block,
    assignedLabel: '',
    labelFromOcr: false,
  }));

  const bounds = labeledBlocks.map((b) => polygonBounds(b.polygon));

  // Step 1 — assign each token to the single containing block (nearest on overlap).
  const tokensByBlock: OcrToken[][] = labeledBlocks.map(() => []);
  for (const token of tokens) {
    if (!isCompositorToken(token.text)) {
      continue;
    }
    let bestBlock = -1;
    let bestDist = Infinity;
    for (let bi = 0; bi < labeledBlocks.length; bi += 1) {
      if (!tokenHitsBlock(token, labeledBlocks[bi].polygon, bounds[bi])) {
        continue;
      }
      const c = boxCenter(bounds[bi]);
      const dist = Math.hypot(token.xPct - c.x, token.yPct - c.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestBlock = bi;
      }
    }
    if (bestBlock >= 0) {
      tokensByBlock[bestBlock].push(token);
    }
  }

  // Step 2 — label each block from its own central tokens.
  for (let bi = 0; bi < labeledBlocks.length; bi += 1) {
    const label = labelFromInsideTokens(tokensByBlock[bi], bounds[bi]);
    if (!label) {
      continue;
    }
    labeledBlocks[bi] = {
      ...labeledBlocks[bi],
      assignedLabel: label,
      labelFromOcr: true,
    };
  }

  // Stand labels — long text tokens outside every block.
  const stands: DetectedStand[] = [];
  for (const token of tokens) {
    if (!isLikelyStandLabel(token.text)) {
      continue;
    }
    const insideBlock = labeledBlocks.some((b) =>
      pointInPolygon(token.xPct, token.yPct, b.polygon),
    );
    if (!insideBlock) {
      stands.push({ name: token.text.trim(), xPct: token.xPct, yPct: token.yPct });
    }
  }

  const labeledCount = labeledBlocks.filter((b) => b.labelFromOcr).length;
  return {
    ...detection,
    labeledBlocks,
    stands: stands.length > 0 ? stands : detection.stands,
    ocrTokenCount: ocrTokens.length,
    labeledCount,
    unlabeledCount: labeledBlocks.length - labeledCount,
  };
}

export function summarizeCvResult(result: CvAnalysisResult): {
  tierCount: number;
  blockCount: number;
  labeledCount: number;
  standCount: number;
} {
  const ringIndices = new Set(result.labeledBlocks.map((b) => b.ringIndex));
  return {
    tierCount: ringIndices.size,
    blockCount: result.labeledBlocks.length,
    labeledCount: result.labeledCount,
    standCount: result.stands.length,
  };
}
