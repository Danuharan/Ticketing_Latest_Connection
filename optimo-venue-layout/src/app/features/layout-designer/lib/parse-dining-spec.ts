/**
 * Client-side dining / table spec parser (mirrors seating spec rules).
 */

import type { DiningTableShape } from '../models/layout-element.model';
import type { DiningTableChartSpec } from '../models/dining-spec.model';
import type { OcrTokenLike } from './parse-seating-spec';

const DEFAULT_TABLE_W = 1.5;
const DEFAULT_TABLE_D = 1.5;
const DEFAULT_CHAIR_W = 0.45;
const DEFAULT_CHAIR_L = 0.5;
const DEFAULT_TABLE_GAP = 0.8;
const DEFAULT_TABLE_COUNT = 12;
const DEFAULT_CHAIRS_PER_TABLE = 8;

function parseMetreValue(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:m|metre|meters?|metres?)?/i);
  if (!m) {
    return null;
  }
  const v = Number(m[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function parsePairMetres(text: string): { w: number; l: number } | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:m)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:m)?/i);
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

function parseSideIndex(line: string): number | undefined {
  const side = line.match(/side\s*(\d+)/i);
  if (side) {
    return Math.max(0, Number(side[1]) - 1);
  }
  if (/top/i.test(line)) {
    return 0;
  }
  if (/bottom/i.test(line)) {
    return 2;
  }
  if (/left/i.test(line)) {
    return 3;
  }
  if (/right/i.test(line)) {
    return 1;
  }
  return undefined;
}

function tokensToLines(tokens: OcrTokenLike[]): string[] {
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

export function parseDiningSpecFromText(lines: string[]): {
  spec: DiningTableChartSpec | null;
  notes: string[];
} {
  const notes: string[] = [];
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

  let tableCount = DEFAULT_TABLE_COUNT;
  let tableShape: DiningTableShape = 'round';
  let tableWidthM = DEFAULT_TABLE_W;
  let tableDepthM = DEFAULT_TABLE_D;
  let chairsPerTable = DEFAULT_CHAIRS_PER_TABLE;
  let chairWidthM = DEFAULT_CHAIR_W;
  let chairLengthM = DEFAULT_CHAIR_L;
  let tableGapM = DEFAULT_TABLE_GAP;
  let blockName: string | undefined;
  let stageSideIndex: number | undefined;
  let exitSideIndex: number | undefined;
  let stageWidthM: number | undefined;
  let stageDepthM: number | undefined;

  const countMatch =
    lower.match(/table\s*count\s*[:=\-]?\s*(\d+)/) ??
    lower.match(/tables?\s*[:=\-]?\s*(\d+)/) ??
    lower.match(/(\d+)\s*tables?/);
  if (countMatch) {
    tableCount = Math.max(1, Math.round(Number(countMatch[1])));
  }

  const chairsMatch =
    lower.match(/chairs?\s*per\s*table\s*[:=\-]?\s*(\d+)/) ??
    lower.match(/seats?\s*per\s*table\s*[:=\-]?\s*(\d+)/) ??
    lower.match(/(\d+)\s*chairs?\s*per\s*table/);
  if (chairsMatch) {
    chairsPerTable = Math.max(1, Math.round(Number(chairsMatch[1])));
  }

  for (const line of lines) {
    const ll = line.toLowerCase();
    if (/block\s*name|block\s*:/i.test(line) && !blockName) {
      const name = line
        .replace(/block\s*name\s*[:=\-]?\s*/i, '')
        .replace(/block\s*[:=\-]\s*/i, '')
        .trim();
      if (name) {
        blockName = name;
      }
    }
    if (/table\s*shape/i.test(ll)) {
      if (/rect|banquet|square/i.test(ll)) {
        tableShape = 'rectangular';
      } else if (/round|circle/i.test(ll)) {
        tableShape = 'round';
      }
    }
    if (/table\s*size|table\s*dimension/i.test(ll)) {
      const pair = parsePairMetres(line);
      if (pair) {
        tableWidthM = pair.w;
        tableDepthM = pair.l;
      } else {
        const v = parseMetreValue(line);
        if (v != null) {
          tableWidthM = v;
          tableDepthM = v;
        }
      }
    }
    if (/chair\s*size/i.test(ll)) {
      const pair = parsePairMetres(line);
      if (pair) {
        chairWidthM = pair.w;
        chairLengthM = pair.l;
      }
    }
    if (/table\s*gap|gap\s*between\s*tables/i.test(ll)) {
      const v = parseMetreValue(line);
      if (v != null) {
        tableGapM = v;
      }
    }
    if (/stage/i.test(ll) && /side|view\s*point|viewpoint/i.test(ll)) {
      const idx = parseSideIndex(line);
      if (idx != null) {
        stageSideIndex = idx;
      }
    } else if (/^stage\s*[:=\-]/i.test(line.trim()) || /stage\s*location/i.test(ll)) {
      const idx = parseSideIndex(line);
      if (idx != null) {
        stageSideIndex = idx;
      }
    }
    if (/exit/i.test(ll) && /side|door|location/i.test(ll)) {
      const idx = parseSideIndex(line);
      if (idx != null) {
        exitSideIndex = idx;
      }
    }
    if (/stage\s*size/i.test(ll)) {
      const pair = parsePairMetres(line);
      if (pair) {
        stageWidthM = pair.w;
        stageDepthM = pair.l;
      }
    }
    if (/view\s*point|viewpoint/i.test(ll) && stageSideIndex == null) {
      const idx = parseSideIndex(line);
      if (idx != null) {
        stageSideIndex = idx;
      }
    }
  }

  const foundSideCount = sideLengthsM.length;
  const hasTableInfo =
    Boolean(countMatch) ||
    /table\s*size/i.test(lower) ||
    /table\s*shape/i.test(lower) ||
    Boolean(chairsMatch);
  const hasSides = foundSideCount >= 3;

  if (!hasTableInfo && !hasSides) {
    return { spec: null, notes: ['Could not parse dining table spec from text.'] };
  }

  if (sideLengthsM.length < 3) {
    notes.push('Fewer than 3 side lengths found — using defaults for missing sides.');
    while (sideLengthsM.length < 4) {
      sideLengthsM.push(8);
      sideLabels.push(`Side ${sideLengthsM.length}`);
    }
  }

  let confidence: DiningTableChartSpec['confidence'] = 'low';
  if (hasTableInfo && hasSides && (countMatch || chairsMatch)) {
    confidence = 'high';
  } else if (hasTableInfo || hasSides) {
    confidence = 'medium';
  }

  return {
    spec: {
      blockName,
      sideLengthsM,
      sideLabels,
      tableCount,
      tableShape,
      tableWidthM,
      tableDepthM,
      chairsPerTable,
      chairWidthM,
      chairLengthM,
      tableGapM,
      stageSideIndex,
      exitSideIndex,
      stageWidthM,
      stageDepthM,
      confidence,
      rawText: fullText.slice(0, 4000),
    },
    notes,
  };
}

export function parseDiningSpecFromOcrTokens(tokens: OcrTokenLike[]): {
  spec: DiningTableChartSpec | null;
  notes: string[];
} {
  return parseDiningSpecFromText(tokensToLines(tokens));
}

export function parseDiningSpecFromRawText(text: string): {
  spec: DiningTableChartSpec | null;
  notes: string[];
} {
  return parseDiningSpecFromText(
    text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
  );
}
