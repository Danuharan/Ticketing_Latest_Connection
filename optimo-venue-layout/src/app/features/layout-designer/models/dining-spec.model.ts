import type { DiningTableShape } from './layout-element.model';

/** Parsed dining / table specification from a measurement sheet (local or Azure OCR). */
export interface DiningTableChartSpec {
  blockName?: string;
  /** Metre lengths per block side (clockwise from top / side 1). */
  sideLengthsM: number[];
  sideLabels?: string[];
  tableCount: number;
  tableShape: DiningTableShape;
  tableWidthM: number;
  tableDepthM: number;
  chairsPerTable: number;
  chairWidthM: number;
  chairLengthM: number;
  tableGapM: number;
  /** 0-based side index for stage / VIEW POINT (optional). */
  stageSideIndex?: number;
  /** 0-based side index for exit doorway (optional). */
  exitSideIndex?: number;
  stageWidthM?: number;
  stageDepthM?: number;
  confidence: 'high' | 'medium' | 'low';
  rawText?: string;
}

export interface DiningSpecAnalysisResult {
  spec: DiningTableChartSpec | null;
  ocrTokenCount: number;
  modelUsed: string;
  processingTimeMs: number;
  parseNotes?: string[];
  error?: string;
}
