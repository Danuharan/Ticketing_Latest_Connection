import {
  DEFAULT_CHAIR_LENGTH_M,
  DEFAULT_CHAIR_WIDTH_M,
  DEFAULT_SEAT_GAP_M,
} from './layout-element.model';

/** One aisle on a block: by row, by column, geometric center, or a drawn two-point walkway. */
export type AutoFillAisleType = 'none' | 'row' | 'column' | 'center' | 'draw';

/** @deprecated Prefer `AutoFillAisleType` / `aisles[]`. Kept for older saved configs. */
export type AutoFillAislePlacementMode = AutoFillAisleType;

/** One aisle configured for Auto Fill. */
export interface AutoFillAisleSlot {
  id?: string;
  type: AutoFillAisleType;
  /** Comma-separated row letters when type is `row`, e.g. "C" or "C, E". */
  rows?: string;
  /** Comma-separated 1-based columns when type is `column`, e.g. "1" or "1, 5". */
  columns?: string;
  /** Walkway width in metres for this aisle. */
  widthM?: number;
  /**
   * For type `center`: apply along columns (across) or rows (depth).
   * Aisle stays geometrically centred on that side's measurement.
   */
  centerAxis?: 'row' | 'column';
  /** For type `draw`: first click on the block (element-local %). */
  drawStart?: { xPct: number; yPct: number };
  /** For type `draw`: second click on the block (element-local %). */
  drawEnd?: { xPct: number; yPct: number };
}

function drawPctEqual(
  a: { xPct: number; yPct: number } | undefined,
  b: { xPct: number; yPct: number } | undefined,
): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return Math.abs(a.xPct - b.xPct) < 0.05 && Math.abs(a.yPct - b.yPct) < 0.05;
}

let aisleSlotSeq = 0;

export function createDefaultAisleSlot(type: AutoFillAisleType = 'none'): AutoFillAisleSlot {
  aisleSlotSeq += 1;
  return {
    id: `aisle-${Date.now().toString(36)}-${aisleSlotSeq}`,
    type,
    rows: '',
    columns: '',
    widthM: 1,
    centerAxis: type === 'center' ? 'column' : undefined,
  };
}

/** True when two aisle lists match for UI identity and values. */
export function autoFillAislesEqual(
  a: AutoFillAisleSlot[] | undefined | null,
  b: AutoFillAisleSlot[] | undefined | null,
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) {
    return false;
  }
  return left.every((slot, index) => {
    const other = right[index];
    return (
      (slot.id ?? '') === (other.id ?? '') &&
      slot.type === other.type &&
      (slot.rows ?? '') === (other.rows ?? '') &&
      (slot.columns ?? '') === (other.columns ?? '') &&
      (slot.widthM ?? 1) === (other.widthM ?? 1) &&
      (slot.centerAxis ?? undefined) === (other.centerAxis ?? undefined) &&
      drawPctEqual(slot.drawStart, other.drawStart) &&
      drawPctEqual(slot.drawEnd, other.drawEnd)
    );
  });
}

/** True when applying `patch` would not change the current Auto Fill config. */
export function autoFillSeatingPatchIsNoop(
  current: AutoFillSeatingConfig,
  patch: Partial<AutoFillSeatingConfig>,
): boolean {
  const keys = Object.keys(patch) as (keyof AutoFillSeatingConfig)[];
  if (keys.length === 0) {
    return true;
  }
  return keys.every((key) => {
    if (key === 'aisles') {
      return autoFillAislesEqual(current.aisles, patch.aisles);
    }
    return Object.is(current[key], patch[key]);
  });
}

/** Normalize aisle list for UI / resolve (dynamic length; empty = no aisles). */
export function normalizeAutoFillAisles(
  aisles: AutoFillAisleSlot[] | undefined | null,
  legacy?: {
    aislePlacementMode?: AutoFillAisleType;
    aisleRows?: string;
    aisleColumns?: string;
    aisleWidthM?: number;
  },
): AutoFillAisleSlot[] {
  const width =
    legacy?.aisleWidthM != null && Number.isFinite(legacy.aisleWidthM)
      ? Math.max(0, legacy.aisleWidthM)
      : 1;
  if (aisles) {
    return aisles.map((slot, index) => {
      // Keep `none` as unselected — do not default to row before the user chooses.
      const type: AutoFillAisleType =
        slot.type === 'row' ||
        slot.type === 'column' ||
        slot.type === 'center' ||
        slot.type === 'draw' ||
        slot.type === 'none'
          ? slot.type
          : 'none';
      return {
        ...slot,
        id: slot.id || `aisle-${index}`,
        type,
        rows: slot.rows ?? '',
        columns: slot.columns ?? '',
        widthM: slot.widthM ?? width,
        centerAxis:
          type === 'center'
            ? slot.centerAxis === 'row' || slot.centerAxis === 'column'
              ? slot.centerAxis
              : 'column'
            : undefined,
        drawStart: type === 'draw' ? slot.drawStart : undefined,
        drawEnd: type === 'draw' ? slot.drawEnd : undefined,
      };
    });
  }
  const mode = legacy?.aislePlacementMode ?? 'none';
  if (mode === 'none') {
    return [];
  }
  return [
    {
      type: mode,
      rows: legacy?.aisleRows ?? '',
      columns: legacy?.aisleColumns ?? '',
      widthM: width,
    },
  ];
}

/** Shared seating configuration applied to every block during Auto Fill. */
export interface AutoFillSeatingConfig {
  chairLengthM: number;
  chairWidthM: number;
  seatGapM: number;
  rowGapM: number;
  /** Usable-area inset from the block boundary (metres). */
  borderGapM: number;
  /**
   * When true, Auto Fill / Create seats use `curveDeg`. When false, seats stay straight.
   */
  curveEnabled?: boolean;
  /**
   * Row bow amount. 0 = straight rows; higher values curve seats more
   * (same units as `seatLayout.rowCurveDegs`). Used only when `curveEnabled` is true.
   */
  curveDeg?: number;
  /**
   * Aisles on the block. Click + in the UI to add more; each may be row, column, or center.
   */
  aisles?: AutoFillAisleSlot[];
  /** @deprecated Migrated into `aisles[0]`. */
  aislePlacementMode?: AutoFillAisleType;
  /** @deprecated Migrated into `aisles[0].rows`. */
  aisleRows?: string;
  /** @deprecated Migrated into `aisles[0].columns`. */
  aisleColumns?: string;
  /** @deprecated Migrated into each aisle slot `widthM`. */
  aisleWidthM?: number;
  /** When true, reference side edits apply the same per-side delta to shift-selected blocks. */
  applyBlockMeasurementScale?: boolean;
  /** Reference block used for shared side-length configuration. */
  referenceBlockId?: string | null;
  /** Default side lengths on the reference block when it was captured. */
  referenceBaselineSideLengthsM?: number[];
  /** User-configured side lengths on the reference block. */
  referenceSideLengthsM?: number[];
  /** Geometric default side lengths per block when scaling was first applied. */
  blockMeasurementBaselines?: Record<string, number[]>;
}

export const DEFAULT_AUTO_FILL_SEATING_CONFIG: AutoFillSeatingConfig = {
  chairLengthM: DEFAULT_CHAIR_LENGTH_M,
  chairWidthM: DEFAULT_CHAIR_WIDTH_M,
  seatGapM: DEFAULT_SEAT_GAP_M,
  rowGapM: DEFAULT_SEAT_GAP_M,
  borderGapM: 0,
  curveEnabled: false,
  curveDeg: 0,
  aisles: [],
  aislePlacementMode: 'none',
  aisleRows: '',
  aisleColumns: '',
  aisleWidthM: 1,
};

export interface AutoFillBlockResult {
  elementId: string;
  elementName: string;
  success: boolean;
  seatCount?: number;
  error?: string;
}

export interface AutoFillBatchResult {
  results: AutoFillBlockResult[];
  totalSeats: number;
  successCount: number;
  failureCount: number;
}
