/**
 * Clamps and fills the raw model JSON into a safe, predictable shape that matches
 * the Angular `BlueprintAnalysisResult` model. Never throws on missing fields.
 */

const SHAPES = [
  'oval',
  'circle',
  'rectangle',
  'square',
  'hexagon',
  'octagon',
  'd-end',
];
const MAX_BLOCKS_PER_TIER = 80;
const MAX_TIERS = 10;

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function str(value: unknown, fallback: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return s || fallback;
}

function point(value: unknown, fx: number, fy: number) {
  const v = (value ?? {}) as { xPct?: unknown; yPct?: unknown };
  return {
    xPct: clamp(num(v.xPct, fx), 0, 100),
    yPct: clamp(num(v.yPct, fy), 0, 100),
  };
}

function size(value: unknown, fw: number, fh: number) {
  const v = (value ?? {}) as { wPct?: unknown; hPct?: unknown };
  return {
    wPct: clamp(num(v.wPct, fw), 1, 100),
    hPct: clamp(num(v.hPct, fh), 1, 100),
  };
}

export function normalizeResult(raw: unknown, includeSeats: boolean) {
  const r = (raw ?? {}) as Record<string, unknown>;
  const cp = (r.centerpiece ?? {}) as Record<string, unknown>;
  const shape = str(cp.shape, 'oval');

  const centerpiece = {
    name: str(cp.name, 'Ground'),
    shape: SHAPES.includes(shape) ? shape : 'oval',
    position: point(cp.position, 50, 50),
    size: size(cp.size, 30, 22),
  };

  const standsRaw = Array.isArray(r.stands) ? r.stands : [];
  const stands = standsRaw.slice(0, 24).map((s) => {
    const v = (s ?? {}) as Record<string, unknown>;
    return {
      name: str(v.name, 'Stand'),
      position: point(v.position, 50, 50),
      rotationDeg: num(v.rotationDeg, 0),
      fontSize: clamp(num(v.fontSize, 12), 6, 48),
    };
  });

  const tiersRaw = Array.isArray(r.tiers) ? r.tiers : [];
  const tiers = tiersRaw.slice(0, MAX_TIERS).map((t, i) => {
    const v = (t ?? {}) as Record<string, unknown>;
    const blocksRaw = Array.isArray(v.blocks) ? v.blocks : [];
    const blocks = blocksRaw.slice(0, MAX_BLOCKS_PER_TIER).map((b, bi) => {
      const bv = (b ?? {}) as Record<string, unknown>;
      return {
        name: str(bv.name, String(bi + 1)),
        startAngleDeg: bv.startAngleDeg === undefined ? undefined : num(bv.startAngleDeg, 0),
        endAngleDeg: bv.endAngleDeg === undefined ? undefined : num(bv.endAngleDeg, 0),
        rows: includeSeats ? clamp(Math.round(num(bv.rows, 0)), 0, 80) : 0,
        seatsPerRow: includeSeats ? clamp(Math.round(num(bv.seatsPerRow, 0)), 0, 200) : 0,
      };
    });

    return {
      name: str(v.name, `Tier ${i + 1}`),
      tierCode: typeof v.tierCode === 'string' ? v.tierCode.trim() || undefined : undefined,
      ringIndex: clamp(Math.round(num(v.ringIndex, i)), 0, MAX_TIERS),
      position: point(v.position, 50, 50),
      size: size(v.size, 60 + i * 6, 52 + i * 6),
      thicknessPct: clamp(num(v.thicknessPct, 8), 2, 30),
      rowsPerBlock: includeSeats ? clamp(Math.round(num(v.rowsPerBlock, 0)), 0, 80) : 0,
      seatsPerRow: includeSeats ? clamp(Math.round(num(v.seatsPerRow, 0)), 0, 200) : 0,
      blocks,
    };
  });

  const confidence = ['low', 'medium', 'high'].includes(String(r.confidence))
    ? (r.confidence as string)
    : 'medium';

  return {
    venueType: str(r.venueType, 'unknown'),
    centerpiece,
    stands,
    tiers,
    confidence,
    notes: str(r.notes, ''),
  };
}
