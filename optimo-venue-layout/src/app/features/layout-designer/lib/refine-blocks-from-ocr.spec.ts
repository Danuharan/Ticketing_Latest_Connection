import { describe, expect, it } from 'vitest';

import { type CvAnalysisResult, type OcrToken } from './assign-ocr-labels';
import { detectBlocksFromImageData, type AnalysisImageData } from './detect-blocks';
import {
  findUncoveredBlockTokens,
  isBlockNumberToken,
  isTokenSatisfied,
  normalizeBlockLabel,
  refineBlocksFromOcr,
} from './refine-blocks-from-ocr';
import { pointInPolygon } from './contour-geometry';

const MAROON: [number, number, number] = [120, 40, 50];
const WHITE: [number, number, number] = [255, 255, 255];
const NAVY: [number, number, number] = [15, 23, 42];

function makeRaster(width: number, height: number): AnalysisImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = NAVY[0];
    data[i + 1] = NAVY[1];
    data[i + 2] = NAVY[2];
    data[i + 3] = 255;
  }
  return { data, width, height };
}

function fillRect(
  raster: AnalysisImageData,
  x: number,
  y: number,
  w: number,
  h: number,
  [r, g, b]: [number, number, number],
): void {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      const i = (yy * raster.width + xx) * 4;
      raster.data[i] = r;
      raster.data[i + 1] = g;
      raster.data[i + 2] = b;
      raster.data[i + 3] = 255;
    }
  }
}

/** Three same-colour blocks on the bottom outer ring, separated by 1px white borders. */
function makeTripleBlockRaster(): AnalysisImageData {
  const raster = makeRaster(400, 400);
  fillRect(raster, 40, 320, 90, 60, MAROON);
  fillRect(raster, 131, 320, 90, 60, MAROON);
  fillRect(raster, 222, 320, 90, 60, MAROON);
  fillRect(raster, 130, 320, 1, 60, WHITE);
  fillRect(raster, 221, 320, 1, 60, WHITE);
  return raster;
}

const TOKENS_131_132_133: OcrToken[] = [
  { text: '131', xPct: 21.25, yPct: 87.5, hPct: 2.4 },
  { text: '132', xPct: 44, yPct: 87.5, hPct: 2.4 },
  { text: '133', xPct: 66.75, yPct: 87.5, hPct: 2.4 },
  { text: '116', xPct: 50, yPct: 20, hPct: 2.3 },
  { text: '120', xPct: 70, yPct: 40, hPct: 2.3 },
  { text: 'B60', xPct: 44, yPct: 60, hPct: 2.1 },
];

function token(text: string, xPct: number, yPct: number, hPct = 1.5): OcrToken {
  return { text, xPct, yPct, hPct };
}

function emptyCvResult(raster: AnalysisImageData): CvAnalysisResult {
  return {
    width: raster.width,
    height: raster.height,
    blocks: [],
    pitch: null,
    stands: [],
    confidence: 'medium',
    notes: '',
    labeledBlocks: [],
    labeledCount: 0,
    unlabeledCount: 0,
    ocrTokenCount: 0,
  };
}

describe('isBlockNumberToken', () => {
  it('accepts large section labels and rejects tiny aisle micro-numbers', () => {
    expect(isBlockNumberToken(token('131', 50, 50, 2.4), TOKENS_131_132_133)).toBe(true);
    expect(isBlockNumberToken(token('133', 50, 50, 2.4), TOKENS_131_132_133)).toBe(true);
    expect(isBlockNumberToken(token('B60', 50, 50, 2.1), TOKENS_131_132_133)).toBe(true);
    expect(isBlockNumberToken(token('B80', 50, 50, 1.05), TOKENS_131_132_133)).toBe(true);
    expect(isBlockNumberToken(token('42', 50, 50, 0.45), TOKENS_131_132_133)).toBe(false);
    expect(isBlockNumberToken(token('72', 50, 50, 0.5), TOKENS_131_132_133)).toBe(false);
    expect(isBlockNumberToken(token('7', 50, 50, 2.0), TOKENS_131_132_133)).toBe(false);
    expect(isBlockNumberToken(token('131', 50, 96, 2.4), TOKENS_131_132_133)).toBe(false);
  });
});

describe('findUncoveredBlockTokens', () => {
  it('returns tokens whose label is not covered by a matching block polygon', () => {
    const blocks = [
      {
        id: 1,
        name: '132',
        assignedLabel: '132',
        labelFromOcr: true,
        polygon: [
          { xPct: 36, yPct: 78 },
          { xPct: 52, yPct: 78 },
          { xPct: 52, yPct: 93 },
          { xPct: 36, yPct: 93 },
        ],
        cxPct: 44,
        cyPct: 87.5,
        fillColor: '#782832',
        ringIndex: 0,
        pixelArea: 1000,
      },
    ];
    const uncovered = findUncoveredBlockTokens(
      [
        token('131', 18.75, 87.5, 2.4),
        token('132', 44, 87.5, 2.4),
        token('133', 66.75, 87.5, 2.4),
      ],
      blocks,
    );
    expect(uncovered.map((t) => t.text)).toEqual(['131', '133']);
    expect(isTokenSatisfied(token('132', 44, 87.5), blocks)).toBe(true);
    expect(normalizeBlockLabel('Block 131')).toBe('block131');
  });
});

describe('refineBlocksFromOcr', () => {
  it('adds missing blocks when CV merged neighbours but OCR numbers are present', () => {
    const raster = makeTripleBlockRaster();
    const merged: CvAnalysisResult = {
      ...emptyCvResult(raster),
      blocks: [],
      labeledBlocks: [
        {
          id: 1,
          name: '132',
          assignedLabel: '132',
          labelFromOcr: true,
          polygon: [
            { xPct: 36, yPct: 78 },
            { xPct: 52, yPct: 78 },
            { xPct: 52, yPct: 93 },
            { xPct: 36, yPct: 93 },
          ],
          cxPct: 44,
          cyPct: 87.5,
          fillColor: '#782832',
          ringIndex: 2,
          pixelArea: 5400,
        },
      ],
      labeledCount: 1,
      ocrTokenCount: 3,
    };

    const refined = refineBlocksFromOcr(merged, TOKENS_131_132_133, raster, 48);
    const labels = refined.labeledBlocks.map((b) => b.assignedLabel).sort();
    expect(labels).toContain('131');
    expect(labels).toContain('133');
    expect(refined.labeledBlocks.length).toBeGreaterThan(merged.labeledBlocks.length);
  });

  it('is a no-op when every OCR block number is already covered', () => {
    const raster = makeTripleBlockRaster();
    const detection = detectBlocksFromImageData(raster, 48);
    const merged: CvAnalysisResult = {
      ...detection,
      labeledBlocks: [
        {
          id: 1,
          name: '131',
          assignedLabel: '131',
          labelFromOcr: true,
          polygon: [
            { xPct: 12, yPct: 78 },
            { xPct: 30, yPct: 78 },
            { xPct: 30, yPct: 93 },
            { xPct: 12, yPct: 93 },
          ],
          cxPct: 21.25,
          cyPct: 87.5,
          fillColor: '#782832',
          ringIndex: 2,
          pixelArea: 5400,
        },
        {
          id: 2,
          name: '132',
          assignedLabel: '132',
          labelFromOcr: true,
          polygon: [
            { xPct: 36, yPct: 78 },
            { xPct: 52, yPct: 78 },
            { xPct: 52, yPct: 93 },
            { xPct: 36, yPct: 93 },
          ],
          cxPct: 44,
          cyPct: 87.5,
          fillColor: '#782832',
          ringIndex: 2,
          pixelArea: 5400,
        },
        {
          id: 3,
          name: '133',
          assignedLabel: '133',
          labelFromOcr: true,
          polygon: [
            { xPct: 60, yPct: 78 },
            { xPct: 76, yPct: 78 },
            { xPct: 76, yPct: 93 },
            { xPct: 60, yPct: 93 },
          ],
          cxPct: 66.75,
          cyPct: 87.5,
          fillColor: '#782832',
          ringIndex: 2,
          pixelArea: 5400,
        },
      ],
      labeledCount: 3,
      unlabeledCount: 0,
      ocrTokenCount: 3,
    };
    const refined = refineBlocksFromOcr(merged, TOKENS_131_132_133, raster, 48);
    expect(refined.labeledBlocks.length).toBe(merged.labeledBlocks.length);
    expect(refined.notes).toBe(merged.notes);
  });

  it('recovers a block when its OCR token sits inside a wrongly labelled neighbour', () => {
    const raster = makeTripleBlockRaster();
    const merged: CvAnalysisResult = {
      ...emptyCvResult(raster),
      labeledBlocks: [
        {
          id: 1,
          name: '999',
          assignedLabel: '999',
          labelFromOcr: true,
          polygon: [
            { xPct: 10, yPct: 78 },
            { xPct: 70, yPct: 78 },
            { xPct: 70, yPct: 93 },
            { xPct: 10, yPct: 93 },
          ],
          cxPct: 40,
          cyPct: 87.5,
          fillColor: '#782832',
          ringIndex: 2,
          pixelArea: 16000,
        },
      ],
      labeledCount: 1,
      ocrTokenCount: 1,
    };

    const refined = refineBlocksFromOcr(merged, [token('131', 21.25, 87.5, 2.4)], raster, 48);
    const recovered = refined.labeledBlocks.find((b) => b.assignedLabel === '131');
    expect(recovered).toBeDefined();
    expect(pointInPolygon(21.25, 87.5, recovered!.polygon)).toBe(true);
  });
});

describe('detectBlocksFromImageData fragment filter', () => {
  it('drops tiny gap fragments while keeping full-size blocks', () => {
    const raster = makeTripleBlockRaster();
    const detection = detectBlocksFromImageData(raster, 48);
    expect(detection.blocks.length).toBeGreaterThanOrEqual(2);
  });
});
