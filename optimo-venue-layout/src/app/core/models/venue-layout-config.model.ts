import { CanvasConfig, LayoutElement } from '../../features/layout-designer/models/layout-element.model';

export interface ReferenceImageConfig {
  /**
   * Display URL only (data URL while editing, or signed Storage URL after load).
   * Never persisted to Supabase layout_config when storagePath is used.
   */
  dataUrl?: string;
  /**
   * Supabase Storage object path in bucket `venue-layouts`
   * e.g. `{userId}/{templateId}/blueprint.jpg`
   */
  storagePath?: string;
  name?: string;
  /** Matches scaled block geometry so the chart aligns with detected polygons. */
  geometryScale?: number;
  opacity?: number;
  /** When false the blueprint is hidden behind the blocks (default: visible). */
  visible?: boolean;
}

/** Serialized layout document stored in Supabase layout_config JSONB. */
export interface VenueLayoutConfig {
  version: 1;
  canvas: CanvasConfig;
  elements: LayoutElement[];
  /** Uploaded seating chart shown behind detected block overlays. */
  referenceImage?: ReferenceImageConfig;
}
