/**
 * Distinguish large section block labels (131, B60, 12) from tiny seat/row
 * micro-numbers printed in aisles and the fine ring between tiers.
 */

import type { OcrToken } from './assign-ocr-labels';

const BLOCK_NUMBER_RE = /^[A-Za-z]?\d{2,4}[A-Za-z]?$/;
export const B_BLOCK_RE = /^B\d{1,3}$/i;
const MICRO_TIER_NUMBER_RE = /^\d{2,3}$/;

export interface MicroTierRadiusBand {
  min: number;
  max: number;
}

/** Median glyph height of B-ring block labels. */
function medianBBlockLabelHeight(tokens: OcrToken[]): number | null {
  const heights = tokens
    .filter((token) => {
      const text = token.text.trim();
      return B_BLOCK_RE.test(text) && typeof token.hPct === 'number' && token.hPct > 0;
    })
    .map((token) => token.hPct as number)
    .sort((a, b) => a - b);
  if (heights.length < 2) {
    return null;
  }
  return heights[Math.floor(heights.length / 2)];
}

/** Median glyph height of likely primary block labels (upper half of B## / ## tokens). */
export function medianPrimaryBlockLabelHeight(tokens: OcrToken[]): number | null {
  const heights = tokens
    .filter((token) => {
      const text = token.text.trim();
      if (typeof token.hPct !== 'number' || token.hPct <= 0) {
        return false;
      }
      return B_BLOCK_RE.test(text) || /^\d{2,4}$/.test(text);
    })
    .map((token) => token.hPct as number)
    .sort((a, b) => a - b);
  if (heights.length < 6) {
    return null;
  }
  const upperHalf = heights.slice(Math.floor(heights.length / 2));
  return upperHalf[Math.floor(upperHalf.length / 2)];
}

/**
 * True when an OCR token is a primary section block label — not a tiny aisle/row number.
 */
export function isPrimaryBlockLabelToken(token: OcrToken, allTokens: OcrToken[]): boolean {
  const text = token.text.trim();
  if (token.yPct > 95) {
    return false;
  }
  if (B_BLOCK_RE.test(text)) {
    return passesPrimaryHeightGate(token, allTokens);
  }
  if (!BLOCK_NUMBER_RE.test(text)) {
    return false;
  }
  if (token.hPct !== undefined && token.hPct < 0.7) {
    return false;
  }
  return passesPrimaryHeightGate(token, allTokens);
}

function passesPrimaryHeightGate(token: OcrToken, allTokens: OcrToken[]): boolean {
  const text = token.text.trim();
  if (typeof token.hPct !== 'number') {
    return false;
  }
  if (B_BLOCK_RE.test(text)) {
    const bRef = medianBBlockLabelHeight(allTokens);
    if (bRef !== null) {
      return token.hPct >= bRef * 0.55;
    }
  }
  const refHeight = medianPrimaryBlockLabelHeight(allTokens);
  if (refHeight === null) {
    return B_BLOCK_RE.test(text) || /^\d{3,4}$/.test(text);
  }
  const ratio = B_BLOCK_RE.test(text) ? 0.42 : 0.68;
  return token.hPct >= refHeight * ratio;
}

/** Radius band between the B-ring and outer tier where micro blocks sit. */
export function inferMicroTierRadiusBand(
  blocks: Array<{ cxPct: number; cyPct: number; ringIndex: number }>,
): MicroTierRadiusBand | null {
  const byRing = new Map<number, number[]>();
  for (const block of blocks) {
    const radius = Math.hypot(block.cxPct - 50, block.cyPct - 50);
    const list = byRing.get(block.ringIndex) ?? [];
    list.push(radius);
    byRing.set(block.ringIndex, list);
  }
  const innerRing = byRing.get(1);
  const outerRing = byRing.get(2);
  if (!innerRing?.length || !outerRing?.length) {
    return null;
  }
  const innerMax = Math.max(...innerRing);
  const outerMin = Math.min(...outerRing);
  if (outerMin <= innerMax) {
    return null;
  }
  return { min: innerMax * 0.9, max: outerMin * 1.1 };
}

/**
 * True for tiny numbered blocks in the fine ring between B-blocks and outer tier —
 * not aisle speckle and not full section labels.
 */
export function isMicroTierBlockLabelToken(
  token: OcrToken,
  allTokens: OcrToken[],
  radiusPct: number,
  microBand: MicroTierRadiusBand | null,
): boolean {
  if (!microBand || radiusPct < microBand.min || radiusPct > microBand.max) {
    return false;
  }
  const text = token.text.trim();
  if (!MICRO_TIER_NUMBER_RE.test(text) || B_BLOCK_RE.test(text)) {
    return false;
  }
  if (token.yPct > 95) {
    return false;
  }
  const refHeight = medianPrimaryBlockLabelHeight(allTokens);
  if (refHeight === null || typeof token.hPct !== 'number') {
    return false;
  }
  return token.hPct >= refHeight * 0.38 && token.hPct < refHeight * 0.68;
}
