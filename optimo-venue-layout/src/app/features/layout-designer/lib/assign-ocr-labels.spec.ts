import { describe, expect, it } from 'vitest';

import { assignOcrToBlocks, type OcrToken } from './assign-ocr-labels';
import type { BlockDetectionResult, DetectedBlock } from './detect-blocks';

function rect(id: number, x0: number, y0: number, x1: number, y1: number): DetectedBlock {
  return {
    id,
    name: '',
    polygon: [
      { xPct: x0, yPct: y0 },
      { xPct: x1, yPct: y0 },
      { xPct: x1, yPct: y1 },
      { xPct: x0, yPct: y1 },
    ],
    cxPct: (x0 + x1) / 2,
    cyPct: (y0 + y1) / 2,
    fillColor: '#782832',
    ringIndex: 0,
    pixelArea: (x1 - x0) * (y1 - y0),
  };
}

function detection(blocks: DetectedBlock[]): BlockDetectionResult {
  return {
    width: 100,
    height: 100,
    blocks,
    pitch: null,
    stands: [],
    confidence: 'high',
    notes: '',
  };
}

function token(text: string, xPct: number, yPct: number): OcrToken {
  return { text, xPct, yPct, hPct: 2 };
}

describe('assignOcrToBlocks', () => {
  it('labels a block from a token inside its polygon', () => {
    const result = assignOcrToBlocks(detection([rect(1, 10, 10, 40, 40)]), [
      token('131', 25, 25),
    ]);
    expect(result.labeledCount).toBe(1);
    expect(result.labeledBlocks[0].assignedLabel).toBe('131');
    expect(result.ocrTokenCount).toBe(1);
  });

  it('labels a block when the number sits in a white hole outside the contour', () => {
    // C-shape: the printed "132" sits in the open centre, not inside the polygon.
    const cShape: DetectedBlock = {
      id: 1,
      name: '',
      polygon: [
        { xPct: 10, yPct: 10 },
        { xPct: 40, yPct: 10 },
        { xPct: 40, yPct: 18 },
        { xPct: 18, yPct: 18 },
        { xPct: 18, yPct: 32 },
        { xPct: 40, yPct: 32 },
        { xPct: 40, yPct: 40 },
        { xPct: 10, yPct: 40 },
      ],
      cxPct: 25,
      cyPct: 25,
      fillColor: '#782832',
      ringIndex: 0,
      pixelArea: 400,
    };
    const result = assignOcrToBlocks(detection([cShape]), [token('132', 28, 25)]);
    expect(result.labeledCount).toBe(1);
    expect(result.labeledBlocks[0].assignedLabel).toBe('132');
  });

  it('returns 0 labelled when OCR tokens are empty', () => {
    const result = assignOcrToBlocks(detection([rect(1, 10, 10, 40, 40)]), []);
    expect(result.labeledCount).toBe(0);
    expect(result.ocrTokenCount).toBe(0);
  });

  it('assigns a shared-gap token to the nearer block', () => {
    const left = rect(1, 10, 10, 40, 40);
    const right = rect(2, 42, 10, 72, 40);
    const result = assignOcrToBlocks(detection([left, right]), [token('B54', 25, 25)]);
    expect(result.labeledBlocks[0].assignedLabel).toBe('B54');
    expect(result.labeledBlocks[1].assignedLabel).toBe('');
  });
});
