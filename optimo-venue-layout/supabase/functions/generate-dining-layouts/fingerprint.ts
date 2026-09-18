import type { AisleBand, DiningLayoutFamily, GenerateDiningLayoutsRequest, PlacedTable } from './types.ts';
import { classifyStageRegion, regionOccupancyKey, STAGE_REGIONS } from './stage-regions.ts';

/** Diversity selection thresholds. Tune here only. */
export const DIVERSITY_CONFIG = {
  minDistance: 0.32,
  relaxedDistance: 0.2,
  positionWeight: 0.55,
  regionWeight: 0.35,
  aisleWeight: 0.1,
} as const;

function quantize(n: number, step: number): number {
  return Math.round(n / step) * step;
}

function geometryParts(
  tables: PlacedTable[],
  aisles: AisleBand[],
  stageSide: number | null | undefined,
  req?: GenerateDiningLayoutsRequest,
): { sideKey: string; regionKey: string; aisleKey: string; cells: string[] } {
  const step = 0.45;
  const cells = tables
    .map((t) => {
      const x = quantize(t.xM, step);
      const y = quantize(t.yM, step);
      const rot = Math.round(t.rotationDeg / 15) * 15;
      return `${t.type.id}:${x.toFixed(2)},${y.toFixed(2)}@${rot}`;
    })
    .sort();
  const aisleKey = aisles
    .map((a) => `${a.kind}:${quantize(a.xM, 0.5)}:${quantize(a.widthM, 0.25)}`)
    .sort()
    .join(',');
  return {
    sideKey: stageSide == null ? 'x' : String(stageSide),
    regionKey: req ? regionOccupancyKey(tables, req) : 'x',
    aisleKey,
    cells,
  };
}

/** Family-independent identity: same geometry is the same design. */
export function geometryFingerprint(
  tables: PlacedTable[],
  aisles: AisleBand[],
  stageSide?: number | null,
  req?: GenerateDiningLayoutsRequest,
): string {
  const parts = geometryParts(tables, aisles, stageSide, req);
  return `s${parts.sideKey}|n${tables.length}|R${parts.regionKey}|${parts.aisleKey}|${parts.cells.join(';')}`;
}

/**
 * Display fingerprint includes strategy/family as metadata only.
 * Dedup must use geometryFingerprint / isNearDuplicate, not family labels.
 */
export function fingerprintLayout(
  family: DiningLayoutFamily,
  tables: PlacedTable[],
  aisles: AisleBand[],
  stageSide?: number | null,
  req?: GenerateDiningLayoutsRequest,
): string {
  return `${family}:${geometryFingerprint(tables, aisles, stageSide, req)}`;
}

export function geometryKeyFromFingerprint(fp: string): string {
  const idx = fp.indexOf(':s');
  if (idx >= 0) {
    return fp.slice(idx + 1);
  }
  return fp;
}

export function isNearDuplicate(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const ga = geometryKeyFromFingerprint(a);
  const gb = geometryKeyFromFingerprint(b);
  if (ga === gb) {
    return true;
  }
  const pa = ga.split('|');
  const pb = gb.split('|');
  if (pa[1] !== pb[1]) {
    return false;
  }
  const regionA = parseRegion(pa);
  const regionB = parseRegion(pb);
  if (regionA && regionB && regionA !== regionB) {
    return false;
  }
  const cellsA = parseCells(cellPart(pa));
  const cellsB = parseCells(cellPart(pb));
  if (cellsA.length === 0 || cellsB.length === 0 || cellsA.length !== cellsB.length) {
    return false;
  }
  const used = new Set<number>();
  let matched = 0;
  for (const ca of cellsA) {
    let best = -1;
    let bestDist = 0.55;
    for (let i = 0; i < cellsB.length; i += 1) {
      if (used.has(i)) {
        continue;
      }
      const cb = cellsB[i];
      if (ca.id !== cb.id) {
        continue;
      }
      const dist = Math.hypot(ca.x - cb.x, ca.y - cb.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    if (best >= 0) {
      used.add(best);
      matched += 1;
    }
  }
  return matched / cellsA.length >= 0.78;
}

export function layoutDistance(
  tablesA: { xM: number; yM: number }[],
  tablesB: { xM: number; yM: number }[],
  req: GenerateDiningLayoutsRequest,
  aisleA = '',
  aisleB = '',
): number {
  const diag = Math.max(1, Math.hypot(req.block.widthM, req.block.depthM));
  const used = new Set<number>();
  let posSum = 0;
  const n = Math.max(tablesA.length, tablesB.length, 1);
  for (const a of tablesA) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < tablesB.length; i += 1) {
      if (used.has(i)) {
        continue;
      }
      const dist = Math.hypot(a.xM - tablesB[i]!.xM, a.yM - tablesB[i]!.yM);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    if (best >= 0) {
      used.add(best);
      posSum += bestDist;
    } else {
      posSum += diag * 0.35;
    }
  }
  posSum += Math.abs(tablesA.length - tablesB.length) * diag * 0.35;
  const position = Math.min(1, posSum / (n * diag * 0.35));

  const countsA: Record<string, number> = {};
  const countsB: Record<string, number> = {};
  for (const region of STAGE_REGIONS) {
    countsA[region] = 0;
    countsB[region] = 0;
  }
  for (const t of tablesA) {
    countsA[classifyStageRegion(t.xM, t.yM, req)] += 1;
  }
  for (const t of tablesB) {
    countsB[classifyStageRegion(t.xM, t.yM, req)] += 1;
  }
  let regionL1 = 0;
  for (const region of STAGE_REGIONS) {
    regionL1 += Math.abs((countsA[region] ?? 0) - (countsB[region] ?? 0));
  }
  const region = Math.min(1, regionL1 / (2 * n));
  const aisle = aisleA === aisleB ? 0 : 1;
  return (
    DIVERSITY_CONFIG.positionWeight * position +
    DIVERSITY_CONFIG.regionWeight * region +
    DIVERSITY_CONFIG.aisleWeight * aisle
  );
}

function parseRegion(parts: string[]): string | null {
  const raw = parts[2] ?? '';
  return raw.startsWith('R') ? raw : null;
}

function cellPart(parts: string[]): string {
  if ((parts[2] ?? '').startsWith('R')) {
    return parts[4] ?? '';
  }
  return parts[3] ?? '';
}

function parseCells(raw: string): { id: string; x: number; y: number }[] {
  return raw
    .split(';')
    .filter(Boolean)
    .map((cell) => {
      const [id, rest] = cell.split(':');
      const [xy] = (rest ?? '').split('@');
      const [x, y] = (xy ?? '').split(',').map(Number);
      return { id, x: x || 0, y: y || 0 };
    });
}
