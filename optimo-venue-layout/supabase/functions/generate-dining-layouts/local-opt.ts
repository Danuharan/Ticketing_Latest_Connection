import { makePlacedTable } from './rules.ts';
import type { OccupiedFootprint, PlacedTable } from './types.ts';
import type { GenerateDiningLayoutsRequest } from './types.ts';
import type { ForbiddenZone } from './forbidden.ts';
import { tablesOverlap, tableHitsAisle, tableHitsForbidden } from './validator.ts';

const NUDGES = [0.2, 0.1, 0.05] as const;
const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export interface LocalOptStats {
  improvementMoves: number;
  repair12: number;
  repair23: number;
  inserts: number;
}

function cloneTable(table: PlacedTable, xM: number, yM: number, rotationDeg = table.rotationDeg): PlacedTable {
  return {
    ...table,
    xM: Math.round(xM * 1000) / 1000,
    yM: Math.round(yM * 1000) / 1000,
    rotationDeg: table.type.shape === 'round' ? 0 : rotationDeg,
  };
}

function validSet(
  tables: PlacedTable[],
  req: GenerateDiningLayoutsRequest,
  zones: ForbiddenZone[],
  insideFn: (t: PlacedTable) => boolean,
): boolean {
  for (let i = 0; i < tables.length; i += 1) {
    const t = tables[i]!;
    if (!insideFn(t) || tableHitsForbidden(t, zones) || tableHitsAisle(t, [])) {
      return false;
    }
    for (let j = i + 1; j < tables.length; j += 1) {
      if (tablesOverlap(t, tables[j]!)) {
        return false;
      }
    }
  }
  return tables.length > 0;
}

function spacingScore(tables: PlacedTable[]): number {
  if (tables.length < 2) {
    return 0;
  }
  let min = Infinity;
  for (let i = 0; i < tables.length; i += 1) {
    for (let j = i + 1; j < tables.length; j += 1) {
      min = Math.min(min, Math.hypot(tables[i]!.xM - tables[j]!.xM, tables[i]!.yM - tables[j]!.yM));
    }
  }
  return min;
}

/** Hill-climb table centres (and 0/90 rotation for rectangles). Iteration-capped for determinism. */
export function hillClimbLayout(
  tables: PlacedTable[],
  req: GenerateDiningLayoutsRequest,
  zones: ForbiddenZone[],
  insideFn: (t: PlacedTable) => boolean,
  deadline: number,
  stats?: LocalOptStats,
  maxPasses = 2,
): PlacedTable[] {
  const next = tables.map((t) => ({ ...t }));
  for (let pass = 0; pass < maxPasses && Date.now() < deadline; pass += 1) {
    let moved = false;
    for (let i = 0; i < next.length; i += 1) {
      if (Date.now() > deadline) {
        break;
      }
      const current = next[i]!;
      const rotations =
        current.type.shape === 'round' ? [0] : [current.rotationDeg, 0, 90].filter((v, idx, arr) => arr.indexOf(v) === idx);
      let best = current;
      let bestSpread = spacingScore(next);
      for (const step of NUDGES) {
        for (const [dx, dy] of DIRS) {
          for (const rot of rotations) {
            const trial = cloneTable(current, current.xM + dx * step, current.yM + dy * step, rot);
            const candidate = next.map((t, idx) => (idx === i ? trial : t));
            if (!validSet(candidate, req, zones, insideFn)) {
              continue;
            }
            const spread = spacingScore(candidate);
            if (spread > bestSpread + 1e-6) {
              best = trial;
              bestSpread = spread;
            }
          }
        }
      }
      if (best !== current) {
        next[i] = best;
        moved = true;
        stats && (stats.improvementMoves += 1);
      }
    }
    if (!moved) {
      break;
    }
  }
  return next;
}

function tryInsert(
  tables: PlacedTable[],
  probe: PlacedTable,
  req: GenerateDiningLayoutsRequest,
  zones: ForbiddenZone[],
  insideFn: (t: PlacedTable) => boolean,
): PlacedTable[] | null {
  const next = [...tables, probe];
  return validSet(next, req, zones, insideFn) ? next : null;
}

function insertProbes(
  tables: PlacedTable[],
  req: GenerateDiningLayoutsRequest,
  footprint: OccupiedFootprint,
  type: PlacedTable['type'],
  zones: ForbiddenZone[],
  insideFn: (t: PlacedTable) => boolean,
  deadline: number,
): PlacedTable[] {
  const pitchX = footprint.spacingHalfWidthM * 2;
  const pitchY = footprint.spacingHalfDepthM * 2;
  const hexY = type.shape === 'round' ? pitchY * 0.8660254037844386 : pitchY;
  const probes: { x: number; y: number }[] = [];
  for (const t of tables) {
    for (const [dx, dy] of [
      [pitchX, 0],
      [-pitchX, 0],
      [0, hexY],
      [0, -hexY],
      [pitchX / 2, hexY],
      [-pitchX / 2, hexY],
      [pitchX / 2, -hexY],
      [-pitchX / 2, -hexY],
    ] as [number, number][]) {
      probes.push({ x: t.xM + dx, y: t.yM + dy });
    }
  }
  let best = tables;
  for (const p of probes.slice(0, 32)) {
    if (Date.now() > deadline) {
      break;
    }
    const probe = makePlacedTable(type, footprint, p.x, p.y, type.shape === 'round' ? 0 : 0);
    probe.xM = Math.round(p.x * 1000) / 1000;
    probe.yM = Math.round(p.y * 1000) / 1000;
    const inserted = tryInsert(best, probe, req, zones, insideFn);
    if (inserted && inserted.length > best.length) {
      best = inserted;
    }
  }
  return best;
}

/**
 * Compact toward the room centre, then try to insert extra tables.
 * 1→2 and 2→3 repairs: drop k tables and try to place k+1.
 */
export function compactAndInsert(
  tables: PlacedTable[],
  req: GenerateDiningLayoutsRequest,
  footprint: OccupiedFootprint,
  type: PlacedTable['type'],
  zones: ForbiddenZone[],
  insideFn: (t: PlacedTable) => boolean,
  deadline: number,
): { tables: PlacedTable[]; stats: LocalOptStats } {
  const stats: LocalOptStats = { improvementMoves: 0, repair12: 0, repair23: 0, inserts: 0 };
  let best = hillClimbLayout(tables, req, zones, insideFn, deadline, stats);
  const cx = req.block.widthM / 2;
  const cy = req.block.depthM / 2;
  for (let i = 0; i < best.length && Date.now() < deadline; i += 1) {
    const t = best[i]!;
    const toward = cloneTable(
      t,
      t.xM + Math.sign(cx - t.xM) * 0.05,
      t.yM + Math.sign(cy - t.yM) * 0.05,
    );
    const trial = best.map((row, idx) => (idx === i ? toward : row));
    if (validSet(trial, req, zones, insideFn)) {
      best = trial;
      stats.improvementMoves += 1;
    }
  }

  const grown = insertProbes(best, req, footprint, type, zones, insideFn, deadline);
  if (grown.length > best.length) {
    stats.inserts += grown.length - best.length;
    best = grown;
  }

  const tryRepair = (drop: number, want: number): boolean => {
    if (best.length <= drop || Date.now() > deadline) {
      return false;
    }
    for (let start = 0; start < Math.min(best.length, 4) && Date.now() < deadline; start += 1) {
      const reduced = best.filter((_, i) => i < start || i >= start + drop);
      const rebuilt = insertProbes(reduced, req, footprint, type, zones, insideFn, deadline);
      const twice = rebuilt.length > reduced.length ? insertProbes(rebuilt, req, footprint, type, zones, insideFn, deadline) : rebuilt;
      if (twice.length >= want && twice.length > best.length) {
        best = twice;
        return true;
      }
    }
    return false;
  };

  if (tryRepair(1, best.length + 1)) {
    stats.repair12 += 1;
  }
  if (tryRepair(2, best.length + 1)) {
    stats.repair23 += 1;
  }

  best = hillClimbLayout(best, req, zones, insideFn, deadline, stats);
  return { tables: best, stats };
}
