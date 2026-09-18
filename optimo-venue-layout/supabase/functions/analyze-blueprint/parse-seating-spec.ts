/**
 * Parse a structured seating-chart spec sheet from Azure OCR tokens.
 * Expects labels like "Side 1: 5.0 m", "Rows: 4", "Seat gap: 0.10 m", etc.
 */

import type { OcrToken } from './azure-ocr.ts';

export interface SeatingChartSpec {
  blockName?: string;
  sideLengthsM: number[];
  sideLabels?: string[];
  rowCount: number;
  seatsPerRow: number;
  chairWidthM: number;
  chairLengthM: number;
  seatGapM: number;
  rowGapM: number;
  viewpointSideIndex?: number;
  confidence: 'high' | 'medium' | 'low';
  rawText?: string;
}

const DEFAULT_CHAIR_W = 0.45;
const DEFAULT_CHAIR_L = 0.5;
const DEFAULT_SEAT_GAP = 0.061;
const DEFAULT_ROW_GAP = 0.061;

function parseMetreValue(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:m|metre|meters?|metres?)?/i);
  if (!m) {
    return null;
  }
  const v = Number(m[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function parsePairMetres(text: string): { w: number; l: number } | null {
  const m = text.match(
    /(\d+(?:\.\d+)?)\s*(?:m)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:m)?/i,
  );
  if (!m) {
    return null;
  }
  const w = Number(m[1]);
  const l = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(l)) {
    return null;
  }
  return { w, l };
}

function tokensToLines(tokens: OcrToken[]): string[] {
  if (!tokens.length) {
    return [];
  }
  const sorted = [...tokens].sort((a, b) => a.yPct - b.yPct || a.xPct - b.xPct);
  const lines: string[] = [];
  let current = '';
  let lastY = sorted[0].yPct;
  for (const t of sorted) {
    if (Math.abs(t.yPct - lastY) > 2.5 && current.trim()) {
      lines.push(current.trim());
      current = t.text;
    } else {
      current = current ? `${current} ${t.text}` : t.text;
    }
    lastY = t.yPct;
  }
  if (current.trim()) {
    lines.push(current.trim());
  }
  return lines;
}

export function parseSeatingSpecFromOcr(tokens: OcrToken[]): {
  spec: SeatingChartSpec | null;
  notes: string[];
} {
  const notes: string[] = [];
  const lines = tokensToLines(tokens);
  const fullText = lines.join('\n');
  const lower = fullText.toLowerCase();

  const sideLengthsM: number[] = [];
  const sideLabels: string[] = [];

  for (const line of lines) {
    const sideMatch = line.match(/side\s*(\d+)\s*[:=\-]?\s*(.+)/i);
    if (sideMatch) {
      const len = parseMetreValue(sideMatch[2]);
      if (len != null) {
        sideLengthsM.push(len);
        sideLabels.push(`Side ${sideMatch[1]}`);
      }
      continue;
    }
    const namedSide = line.match(/(top|bottom|left|right)\s*[:=\-]?\s*(.+)/i);
    if (namedSide) {
      const len = parseMetreValue(namedSide[2]);
      if (len != null) {
        sideLengthsM.push(len);
        sideLabels.push(namedSide[1]);
      }
    }
  }

  let rowCount = 4;
  let seatsPerRow = 8;
  let chairWidthM = DEFAULT_CHAIR_W;
  let chairLengthM = DEFAULT_CHAIR_L;
  let seatGapM = DEFAULT_SEAT_GAP;
  let rowGapM = DEFAULT_ROW_GAP;
  let blockName: string | undefined;
  let viewpointSideIndex: number | undefined;

  const rowsMatch =
    lower.match(/rows?\s*[:=\-]?\s*(\d+)/) ??
    lower.match(/(\d+)\s*rows?/);
  if (rowsMatch) {
    rowCount = Math.max(1, Math.round(Number(rowsMatch[1])));
  }

  const seatsMatch =
    lower.match(/seats?\s*per\s*row\s*[:=\-]?\s*(\d+)/) ??
    lower.match(/seats?\s*\/\s*row\s*[:=\-]?\s*(\d+)/) ??
    lower.match(/(\d+)\s*seats?\s*per\s*row/);
  if (seatsMatch) {
    seatsPerRow = Math.max(1, Math.round(Number(seatsMatch[1])));
  }

  for (const line of lines) {
    const ll = line.toLowerCase();
    if (/block\s*name|block\s*:/i.test(line) && !blockName) {
      const name = line.replace(/block\s*name\s*[:=\-]?\s*/i, '').replace(/block\s*[:=\-]\s*/i, '').trim();
      if (name) {
        blockName = name;
      }
    }
    if (/chair|seat\s*size/i.test(ll)) {
      const pair = parsePairMetres(line);
      if (pair) {
        chairWidthM = pair.w;
        chairLengthM = pair.l;
      }
    }
    if (/seat\s*gap|gap\s*between\s*seats/i.test(ll)) {
      const v = parseMetreValue(line);
      if (v != null) {
        seatGapM = v;
      }
    }
    if (/row\s*gap|gap\s*between\s*rows/i.test(ll)) {
      const v = parseMetreValue(line);
      if (v != null) {
        rowGapM = v;
      }
    }
    if (/view\s*point|viewpoint|audience|front/i.test(ll)) {
      const side = line.match(/side\s*(\d+)/i);
      if (side) {
        viewpointSideIndex = Math.max(0, Number(side[1]) - 1);
      } else if (/top/i.test(ll)) {
        viewpointSideIndex = 0;
      }
    }
  }

  if (sideLengthsM.length < 3) {
    notes.push('Fewer than 3 side lengths found — using defaults for missing sides.');
    while (sideLengthsM.length < 4) {
      sideLengthsM.push(5);
      sideLabels.push(`Side ${sideLengthsM.length}`);
    }
  }

  let confidence: SeatingChartSpec['confidence'] = 'low';
  const hasRows = Boolean(rowsMatch);
  const hasSeats = Boolean(seatsMatch);
  const hasSides = sideLengthsM.length >= 3;
  if (hasRows && hasSeats && hasSides) {
    confidence = 'high';
  } else if ((hasRows && hasSeats) || hasSides) {
    confidence = 'medium';
  }

  if (!hasRows && !hasSeats && !hasSides) {
    return { spec: null, notes: ['Could not parse seating spec from OCR text.'] };
  }

  return {
    spec: {
      blockName,
      sideLengthsM,
      sideLabels,
      rowCount,
      seatsPerRow,
      chairWidthM,
      chairLengthM,
      seatGapM,
      rowGapM,
      viewpointSideIndex,
      confidence,
      rawText: fullText.slice(0, 4000),
    },
    notes,
  };
}
