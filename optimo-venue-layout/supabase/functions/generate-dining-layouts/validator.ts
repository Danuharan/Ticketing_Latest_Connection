import {
  aabbOverlap,
  circleHitsAabb,
  circleHitsRotatedRect,
  circlesSeparated,
  orientedRectsOverlap,
  pointInPolygon,
  rotatedRectAabb,
} from './geometry.ts';
import type { ForbiddenZone } from './forbidden.ts';
import type { AisleBand, DiningLayoutRules, GenerateDiningLayoutsRequest, PlacedTable, PointM } from './types.ts';

export type RejectReason =
  | 'outside-block'
  | 'table-overlap'
  | 'feature-overlap'
  | 'aisle-blocked'
  | 'occupancy'
  | 'capacity-mismatch'
  | 'reachability';

export interface ValidationResult {
  ok: boolean;
  reason?: RejectReason;
}

function isRound(table: PlacedTable): boolean {
  return table.type.shape === 'round';
}

function physicalRadius(table: PlacedTable): number {
  return Math.max(table.physicalHalfWidthM, table.physicalHalfDepthM);
}

function pairwiseGapHalf(table: PlacedTable): number {
  return Math.max(0, table.spacingHalfWidthM - table.physicalHalfWidthM);
}

export function tableHitsForbidden(
  table: PlacedTable,
  zones: ForbiddenZone[],
): boolean {
  for (const zone of zones) {
    if (isRound(table)) {
      const r = physicalRadius(table);
      if (!circleHitsAabb(table.xM, table.yM, r, zone.aabb)) {
        continue;
      }
      if (zone.polygon) {
        if (pointInPolygon({ x: table.xM, y: table.yM }, zone.polygon)) {
          return true;
        }
        continue;
      }
      return true;
    }
    const box = rotatedRectAabb(
      table.xM,
      table.yM,
      table.physicalHalfWidthM,
      table.physicalHalfDepthM,
      table.rotationDeg,
    );
    if (!aabbOverlap(box, zone.aabb)) {
      continue;
    }
    if (zone.polygon) {
      if (pointInPolygon({ x: table.xM, y: table.yM }, zone.polygon)) {
        return true;
      }
      continue;
    }
    if (
      orientedRectsOverlap(
        table.xM,
        table.yM,
        table.physicalHalfWidthM,
        table.physicalHalfDepthM,
        table.rotationDeg,
        (zone.aabb.minX + zone.aabb.maxX) / 2,
        (zone.aabb.minY + zone.aabb.maxY) / 2,
        (zone.aabb.maxX - zone.aabb.minX) / 2,
        (zone.aabb.maxY - zone.aabb.minY) / 2,
        0,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function tablesOverlap(a: PlacedTable, b: PlacedTable): boolean {
  if (isRound(a) && isRound(b)) {
    const extra = pairwiseGapHalf(a) + pairwiseGapHalf(b);
    return !circlesSeparated(
      a.xM,
      a.yM,
      physicalRadius(a),
      b.xM,
      b.yM,
      physicalRadius(b),
      extra,
    );
  }
  if (isRound(a) !== isRound(b)) {
    const round = isRound(a) ? a : b;
    const rect = isRound(a) ? b : a;
    const radius = physicalRadius(round) + pairwiseGapHalf(round) + pairwiseGapHalf(rect);
    return circleHitsRotatedRect(
      round.xM,
      round.yM,
      radius,
      rect.xM,
      rect.yM,
      rect.spacingHalfWidthM,
      rect.spacingHalfDepthM,
      rect.rotationDeg,
    );
  }
  const cheapA = rotatedRectAabb(a.xM, a.yM, a.spacingHalfWidthM, a.spacingHalfDepthM, a.rotationDeg);
  const cheapB = rotatedRectAabb(b.xM, b.yM, b.spacingHalfWidthM, b.spacingHalfDepthM, b.rotationDeg);
  if (!aabbOverlap(cheapA, cheapB)) {
    return false;
  }
  return orientedRectsOverlap(
    a.xM,
    a.yM,
    a.spacingHalfWidthM,
    a.spacingHalfDepthM,
    a.rotationDeg,
    b.xM,
    b.yM,
    b.spacingHalfWidthM,
    b.spacingHalfDepthM,
    b.rotationDeg,
  );
}

export function tableHitsAisle(table: PlacedTable, aisles: AisleBand[]): boolean {
  for (const aisle of aisles) {
    if (isRound(table)) {
      if (
        circleHitsRotatedRect(
          table.xM,
          table.yM,
          physicalRadius(table),
          aisle.xM,
          aisle.yM,
          aisle.widthM / 2,
          aisle.depthM / 2,
          aisle.rotationDeg,
        )
      ) {
        return true;
      }
      continue;
    }
    const box = rotatedRectAabb(
      table.xM,
      table.yM,
      table.physicalHalfWidthM,
      table.physicalHalfDepthM,
      table.rotationDeg,
    );
    const ab = rotatedRectAabb(
      aisle.xM,
      aisle.yM,
      aisle.widthM / 2,
      aisle.depthM / 2,
      aisle.rotationDeg,
    );
    if (aabbOverlap(box, ab)) {
      return true;
    }
  }
  return false;
}

/**
 * Coarse flood-fill reachability on a 0.35 m grid.
 * Entrance cells must reach most table neighbourhoods and an exit if present.
 */
export function checkReachability(
  polygon: PointM[],
  tables: PlacedTable[],
  zones: ForbiddenZone[],
  aisles: AisleBand[],
  req: GenerateDiningLayoutsRequest,
): boolean {
  const cell = 0.4;
  const minX = 0;
  const minY = 0;
  const maxX = req.block.widthM;
  const maxY = req.block.depthM;
  const cols = Math.max(4, Math.ceil(maxX / cell));
  const rows = Math.max(4, Math.ceil(maxY / cell));
  if (cols * rows > 2500) {
    return true;
  }

  const blocked = new Uint8Array(cols * rows);
  const idx = (c: number, r: number) => r * cols + c;
  const world = (c: number, r: number): PointM => ({
    x: minX + (c + 0.5) * cell,
    y: minY + (r + 0.5) * cell,
  });

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const p = world(c, r);
      if (!pointInPolygon(p, polygon)) {
        blocked[idx(c, r)] = 1;
        continue;
      }
      const dummy: PlacedTable = {
        xM: p.x,
        yM: p.y,
        rotationDeg: 0,
        type: tables[0]?.type ?? {
          id: 'x',
          name: 'x',
          shape: 'round',
          widthM: 0.2,
          depthM: 0.2,
          capacity: 1,
          chairWidthM: 0.4,
          chairDepthM: 0.4,
          allowed: true,
        },
        physicalHalfWidthM: cell * 0.35,
        physicalHalfDepthM: cell * 0.35,
        spacingHalfWidthM: cell * 0.35,
        spacingHalfDepthM: cell * 0.35,
      };
      const featureZones = zones.filter(
        (z) => !z.id.startsWith('entrance') && !z.id.startsWith('exit'),
      );
      if (tableHitsForbidden(dummy, featureZones)) {
        blocked[idx(c, r)] = 1;
        continue;
      }
      let hitsTable = false;
      for (const t of tables) {
        const core: PlacedTable = {
          ...t,
          physicalHalfWidthM: t.physicalHalfWidthM,
          physicalHalfDepthM: t.physicalHalfDepthM,
          spacingHalfWidthM: t.physicalHalfWidthM,
          spacingHalfDepthM: t.physicalHalfDepthM,
        };
        if (tablesOverlap(dummy, core)) {
          hitsTable = true;
          break;
        }
      }
      if (hitsTable) {
        blocked[idx(c, r)] = 1;
      }
    }
  }

  // Aisle cells are free circulation.
  for (const aisle of aisles) {
    const c0 = Math.max(0, Math.floor((aisle.xM - aisle.widthM / 2) / cell));
    const c1 = Math.min(cols - 1, Math.floor((aisle.xM + aisle.widthM / 2) / cell));
    const r0 = Math.max(0, Math.floor((aisle.yM - aisle.depthM / 2) / cell));
    const r1 = Math.min(rows - 1, Math.floor((aisle.yM + aisle.depthM / 2) / cell));
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const p = world(c, r);
        if (pointInPolygon(p, polygon)) {
          blocked[idx(c, r)] = 0;
        }
      }
    }
  }

  // Access points must be able to enter the room even when a stage sits on the same wall.
  punchAccessCorridors(blocked, cols, rows, cell, polygon, req);

  const seeds = req.accessPoints.entrances.length > 0 ? req.accessPoints.entrances : req.accessPoints.exits;
  if (seeds.length === 0) {
    return true;
  }
  const seed = seeds[0];
  const sc = Math.max(0, Math.min(cols - 1, Math.floor(seed.xM / cell)));
  const sr = Math.max(0, Math.min(rows - 1, Math.floor(seed.yM / cell)));
  blocked[idx(sc, sr)] = 0;

  const seen = new Uint8Array(cols * rows);
  const stack = [idx(sc, sr)];
  seen[idx(sc, sr)] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const c = i % cols;
    const r = Math.floor(i / cols);
    const neigh = [
      [c + 1, r],
      [c - 1, r],
      [c, r + 1],
      [c, r - 1],
    ];
    for (const [nc, nr] of neigh) {
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) {
        continue;
      }
      const ni = idx(nc, nr);
      if (seen[ni] || blocked[ni]) {
        continue;
      }
      seen[ni] = 1;
      stack.push(ni);
    }
  }

  let reachableTables = 0;
  for (const t of tables) {
    const coreR = Math.max(0.25, Math.max(t.physicalHalfWidthM, t.physicalHalfDepthM));
    const rad = Math.max(2, Math.ceil((coreR + cell * 1.5) / cell));
    const tc = Math.max(0, Math.min(cols - 1, Math.floor(t.xM / cell)));
    const tr = Math.max(0, Math.min(rows - 1, Math.floor(t.yM / cell)));
    let ok = false;
    for (let dr = -rad; dr <= rad && !ok; dr += 1) {
      for (let dc = -rad; dc <= rad; dc += 1) {
        const c = tc + dc;
        const r = tr + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows) {
          continue;
        }
        if (!seen[idx(c, r)]) {
          continue;
        }
        const p = world(c, r);
        const dist = Math.hypot(p.x - t.xM, p.y - t.yM);
        if (dist >= coreR * 0.7 && dist <= coreR + cell * 1.6) {
          ok = true;
          break;
        }
      }
    }
    if (ok) {
      reachableTables += 1;
    }
  }
  return reachableTables >= Math.ceil(tables.length * 0.7);
}

function punchAccessCorridors(
  blocked: Uint8Array,
  cols: number,
  rows: number,
  cell: number,
  polygon: PointM[],
  req: GenerateDiningLayoutsRequest,
): void {
  const idx = (c: number, r: number) => r * cols + c;
  const cx = req.block.widthM / 2;
  const cy = req.block.depthM / 2;
  const points = [...req.accessPoints.entrances, ...req.accessPoints.exits];
  const half = 0.45;
  for (const ap of points) {
    const dx = cx - ap.xM;
    const dy = cy - ap.yM;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const corridorLen = Math.min(len, Math.max(2.2, (ap.widthM || 1.2) + 1.2));
    const steps = Math.max(4, Math.ceil(corridorLen / (cell * 0.5)));
    for (let i = 0; i <= steps; i += 1) {
      const t = (i / steps) * corridorLen;
      const x = ap.xM + ux * t;
      const y = ap.yM + uy * t;
      const c0 = Math.max(0, Math.floor((x - half) / cell));
      const c1 = Math.min(cols - 1, Math.floor((x + half) / cell));
      const r0 = Math.max(0, Math.floor((y - half) / cell));
      const r1 = Math.min(rows - 1, Math.floor((y + half) / cell));
      for (let r = r0; r <= r1; r += 1) {
        for (let c = c0; c <= c1; c += 1) {
          const p = { x: (c + 0.5) * cell, y: (r + 0.5) * cell };
          if (pointInPolygon(p, polygon)) {
            blocked[idx(c, r)] = 0;
          }
        }
      }
    }
  }
}

export function validateLayout(
  polygon: PointM[],
  tables: PlacedTable[],
  zones: ForbiddenZone[],
  aisles: AisleBand[],
  req: GenerateDiningLayoutsRequest,
  rules: DiningLayoutRules,
  insideFn: (t: PlacedTable) => boolean,
  opts?: { requireTargetCount?: boolean },
): ValidationResult {
  const requireExact = opts?.requireTargetCount !== false;
  const targetCount = req.target.tableCount;
  if (tables.length === 0) {
    return { ok: false, reason: 'capacity-mismatch' };
  }
  if (requireExact && targetCount != null && tables.length !== targetCount) {
    return { ok: false, reason: 'capacity-mismatch' };
  }
  const targetCap = req.target.targetCapacity;
  const seats = tables.reduce((s, t) => s + t.type.capacity, 0);
  if (targetCap != null && targetCount == null && seats < targetCap) {
    return { ok: false, reason: 'capacity-mismatch' };
  }
  const maxOcc = req.target.maximumOccupancy ?? rules.maximumOccupancy;
  if (maxOcc != null && seats > maxOcc) {
    return { ok: false, reason: 'occupancy' };
  }

  for (let i = 0; i < tables.length; i += 1) {
    const t = tables[i];
    if (!insideFn(t)) {
      return { ok: false, reason: 'outside-block' };
    }
    if (tableHitsForbidden(t, zones)) {
      return { ok: false, reason: 'feature-overlap' };
    }
    if (tableHitsAisle(t, aisles)) {
      return { ok: false, reason: 'aisle-blocked' };
    }
    for (let j = i + 1; j < tables.length; j += 1) {
      if (tablesOverlap(t, tables[j])) {
        return { ok: false, reason: 'table-overlap' };
      }
    }
  }

  if (!checkReachability(polygon, tables, zones, aisles, req)) {
    return { ok: false, reason: 'reachability' };
  }
  return { ok: true };
}
