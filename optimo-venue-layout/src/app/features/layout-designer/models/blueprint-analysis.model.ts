/**
 * Shapes returned by the `analyze-blueprint` Supabase Edge Function.
 *
 * The edge function combines Azure Document Intelligence (OCR text + coordinates)
 * with an OpenRouter vision model (tier/ring geometry + semantics) and returns
 * this normalized result. `blueprint-to-layout.ts` converts it into the editable
 * `LayoutElement[]` used by the designer canvas.
 *
 * All positions/sizes are canvas percentages (0–100), centre of image = (50, 50),
 * so the result is resolution-independent and maps straight onto the layout model.
 */

export type BlueprintConfidence = 'low' | 'medium' | 'high';

export type BlueprintCenterpieceShape =
  | 'oval'
  | 'circle'
  | 'rectangle'
  | 'square'
  | 'hexagon'
  | 'octagon'
  | 'd-end';

export interface BlueprintPoint {
  xPct: number;
  yPct: number;
}

export interface BlueprintSize {
  wPct: number;
  hPct: number;
}

/** A single seating block / sector within a tier. */
export interface BlueprintBlock {
  /** Label exactly as shown on the chart (e.g. "1", "B41", "Director Box"). */
  name: string;
  /** Wedge start angle around the centerpiece. 0° = east, 90° = south, -90° = north. */
  startAngleDeg?: number;
  endAngleDeg?: number;
  rows: number;
  seatsPerRow: number;
}

/** A concentric ring of blocks around the centerpiece. */
export interface BlueprintTier {
  name: string;
  tierCode?: string;
  /** 0 = innermost ring around the centerpiece, increasing outward. */
  ringIndex: number;
  position: BlueprintPoint;
  size: BlueprintSize;
  /** Radial thickness of the ring band as a canvas % (typically 5–14). */
  thicknessPct: number;
  rowsPerBlock: number;
  seatsPerRow: number;
  blocks: BlueprintBlock[];
}

/** Large stand/section name placed outside the seating (NORTH BANK, EAST STAND…). */
export interface BlueprintStand {
  name: string;
  position: BlueprintPoint;
  rotationDeg: number;
  fontSize: number;
}

export interface BlueprintCenterpiece {
  name: string;
  shape: BlueprintCenterpieceShape;
  position: BlueprintPoint;
  size: BlueprintSize;
}

export interface BlueprintAnalysisMeta {
  /** Which engines contributed: e.g. "azure-ocr+openrouter". */
  modelUsed?: string;
  ocrTokenCount?: number;
  llmModel?: string;
  processingTimeMs?: number;
}

export interface BlueprintAnalysisResult {
  venueType: string;
  centerpiece: BlueprintCenterpiece;
  stands: BlueprintStand[];
  tiers: BlueprintTier[];
  confidence: BlueprintConfidence;
  notes: string;
  meta?: BlueprintAnalysisMeta;
}

/** Request payload sent from Angular to the edge function. */
export interface BlueprintAnalysisRequest {
  imageBase64: string;
  mimeType: string;
  /** When false the model skips seat-count estimation (geometry/names only). */
  includeSeats: boolean;
}
