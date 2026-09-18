/** Parsed seating specification from a blueprint / chart image (Azure OCR). */
export interface SeatingChartSpec {
  blockName?: string;
  /** Metre lengths per block side (clockwise from top / side 1). */
  sideLengthsM: number[];
  sideLabels?: string[];
  rowCount: number;
  seatsPerRow: number;
  chairWidthM: number;
  chairLengthM: number;
  seatGapM: number;
  rowGapM: number;
  /** 0-based side index facing the audience / VIEW POINT (optional). */
  viewpointSideIndex?: number;
  confidence: 'high' | 'medium' | 'low';
  rawText?: string;
}

export interface SeatingSpecAnalysisResult {
  spec: SeatingChartSpec | null;
  ocrTokenCount: number;
  modelUsed: string;
  processingTimeMs: number;
  parseNotes?: string[];
  error?: string;
}

export interface SeatingSpecAnalysisRequest {
  imageBase64: string;
  mimeType: string;
  seatingSpecOnly: true;
}
