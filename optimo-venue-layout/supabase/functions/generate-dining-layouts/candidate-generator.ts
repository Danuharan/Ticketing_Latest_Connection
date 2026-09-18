import { circleInsidePolygon, rectInsidePolygon } from './geometry.ts';
import { buildForbiddenZones } from './forbidden.ts';
import { DIVERSITY_CONFIG, fingerprintLayout, isNearDuplicate, layoutDistance } from './fingerprint.ts';
import { eligibleFamilies } from './layout-families.ts';
import { createRng, hashSeed, shuffleInPlace } from './rng.ts';
import { allowedTableTypes, makePlacedTable, occupiedFootprint } from './rules.ts';
import { maximumIndependentSet } from './maximum-set.ts';
import { compactAndInsert, hillClimbLayout } from './local-opt.ts';
import { overallScore, scoreLayout } from './scoring.ts';
import {
  audienceRegion,
  classifyStageRegion,
  oppositeRegion,
  splitSideRegions,
  STAGE_REGIONS,
  type StageRegion,
} from './stage-regions.ts';
import type {
  DiningGenerationDebug,
  DiningLayoutFamily,
  GenerateDiningLayoutsRequest,
  GeneratedDiningLayout,
  GeneratedTable,
  OccupiedFootprint,
  PlacedFeature,
  PlacedTable,
  RectFeatureInput,
} from './types.ts';
import { FAMILY_DISPLAY } from './types.ts';
import { checkReachability, tableHitsAisle, tableHitsForbidden, tablesOverlap, validateLayout } from './validator.ts';
import { buildCandidateDebugSvg, buildPreviewSvg } from './preview-svg.ts';

export const GENERATOR_VERSION = '2026-08-25-preview-rot-v1';

function toPlacedFeature(
  feat: (RectFeatureInput & { sideEdgeId?: number }) | undefined,
  widthM: number,
  depthM: number,
): PlacedFeature | undefined {
  if (!feat) {
    return undefined;
  }
  return {
    ...feat,
    xPct: (feat.xM / Math.max(widthM, 0.001)) * 100,
    yPct: (feat.yM / Math.max(depthM, 0.001)) * 100,
  };
}

function nearestSide(xM: number, yM: number, w: number, d: number): number {
  const dist = [yM, w - xM, d - yM, xM];
  let side = 0;
  let best = dist[0];
  for (let i = 1; i < 4; i += 1) {
    if (dist[i] < best) {
      best = dist[i];
      side = i;
    }
  }
  return side;
}

function toGeneratedTables(
  placed: PlacedTable[],
  widthM: number,
  depthM: number,
  facingDeg: number,
): GeneratedTable[] {
  return placed.map((t, i) => ({
    id: `t-${i + 1}`,
    label: String(i + 1),
    xPct: (t.xM / widthM) * 100,
    yPct: (t.yM / depthM) * 100,
    shape: t.type.shape,
    seats: t.type.capacity,
    widthM: t.type.widthM,
    depthM: t.type.shape === 'rectangular' ? t.type.depthM : undefined,
    rotationDeg: t.type.shape === 'round' ? facingDeg : t.rotationDeg,
    catalogueId: t.type.id,
  }));
}

type PlacementRejectKey =
  | 'boundary'
  | 'stage'
  | 'foodPrep'
  | 'entrance'
  | 'exit'
  | 'aisle'
  | 'collision'
  | 'other';

interface SearchStats {
  attempts: number;
  rejectedBoundary: number;
  rejectedStage: number;
  rejectedFoodPrep: number;
  rejectedEntrance: number;
  rejectedExit: number;
  rejectedAisle: number;
  rejectedCollision: number;
  rejectedReachability: number;
  addedByBackfill: number;
  exactSearchStates: number;
  funnelBeforeStatic: number;
  funnelAfterWall: number;
  funnelAfterStage: number;
  funnelAfterAccess: number;
}

const EMPTY_STATS = (): SearchStats => ({
  attempts: 0,
  rejectedBoundary: 0,
  rejectedStage: 0,
  rejectedFoodPrep: 0,
  rejectedEntrance: 0,
  rejectedExit: 0,
  rejectedAisle: 0,
  rejectedCollision: 0,
  rejectedReachability: 0,
  addedByBackfill: 0,
  exactSearchStates: 0,
  funnelBeforeStatic: 0,
  funnelAfterWall: 0,
  funnelAfterStage: 0,
  funnelAfterAccess: 0,
});

function buildInsideFn(
  polygon: GenerateDiningLayoutsRequest['block']['polygon'],
  rules: GenerateDiningLayoutsRequest['rules'],
) {
  return (t: PlacedTable) =>
    t.type.shape === 'round'
      ? circleInsidePolygon(
          t.xM,
          t.yM,
          Math.max(t.physicalHalfWidthM, t.physicalHalfDepthM),
          polygon,
          rules.wallClearanceM,
        )
      : rectInsidePolygon(
          t.xM,
          t.yM,
          t.physicalHalfWidthM,
          t.physicalHalfDepthM,
          t.rotationDeg,
          polygon,
          rules.wallClearanceM,
        );
}

function classifyZoneReject(table: PlacedTable, zones: ReturnType<typeof buildForbiddenZones>): PlacementRejectKey | null {
  for (const zone of zones) {
    if (!tableHitsForbidden(table, [zone])) {
      continue;
    }
    if (zone.id === 'stage') {
      return 'stage';
    }
    if (zone.id === 'food-prep') {
      return 'foodPrep';
    }
    if (zone.id.startsWith('entrance:')) {
      return 'entrance';
    }
    if (zone.id.startsWith('exit:')) {
      return 'exit';
    }
    return 'other';
  }
  return null;
}

function bumpPlacementReject(stats: SearchStats, key: PlacementRejectKey): void {
  if (key === 'boundary') {
    stats.rejectedBoundary += 1;
  } else if (key === 'stage') {
    stats.rejectedStage += 1;
  } else if (key === 'foodPrep') {
    stats.rejectedFoodPrep += 1;
  } else if (key === 'entrance') {
    stats.rejectedEntrance += 1;
  } else if (key === 'exit') {
    stats.rejectedExit += 1;
  } else if (key === 'aisle') {
    stats.rejectedAisle += 1;
  } else if (key === 'collision') {
    stats.rejectedCollision += 1;
  }
}

function classifyPlacement(
  table: PlacedTable,
  placed: PlacedTable[],
  zones: ReturnType<typeof buildForbiddenZones>,
  aisles: import('./types.ts').AisleBand[],
  insideFn: (t: PlacedTable) => boolean,
): PlacementRejectKey | null {
  if (!insideFn(table)) {
    return 'boundary';
  }
  const zoneReason = classifyZoneReject(table, zones);
  if (zoneReason) {
    return zoneReason;
  }
  if (tableHitsAisle(table, aisles)) {
    return 'aisle';
  }
  for (const existing of placed) {
    if (tablesOverlap(table, existing)) {
      return 'collision';
    }
  }
  return null;
}

function tryPushCandidate(
  table: PlacedTable,
  seen: Set<string>,
  out: PlacedTable[],
  stats: SearchStats | undefined,
  zones: ReturnType<typeof buildForbiddenZones>,
  aisles: import('./types.ts').AisleBand[],
  insideFn: (t: PlacedTable) => boolean,
): void {
  const key = `${table.xM.toFixed(2)}:${table.yM.toFixed(2)}:${table.rotationDeg}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  if (stats) {
    stats.attempts += 1;
    stats.funnelBeforeStatic += 1;
  }
  if (!insideFn(table)) {
    if (stats) {
      bumpPlacementReject(stats, 'boundary');
    }
    return;
  }
  if (stats) {
    stats.funnelAfterWall += 1;
  }
  const zoneReason = classifyZoneReject(table, zones);
  if (zoneReason === 'stage') {
    if (stats) {
      bumpPlacementReject(stats, 'stage');
    }
    return;
  }
  if (stats) {
    stats.funnelAfterStage += 1;
  }
  if (zoneReason === 'entrance' || zoneReason === 'exit') {
    if (stats) {
      bumpPlacementReject(stats, zoneReason);
    }
    return;
  }
  if (stats) {
    stats.funnelAfterAccess += 1;
  }
  if (zoneReason) {
    if (stats) {
      bumpPlacementReject(stats, zoneReason);
    }
    return;
  }
  if (tableHitsAisle(table, aisles)) {
    if (stats) {
      bumpPlacementReject(stats, 'aisle');
    }
    return;
  }
  out.push(table);
}

export function enumerateValidTablePositions(
  req: GenerateDiningLayoutsRequest,
  footprint: ReturnType<typeof occupiedFootprint>,
  facingDeg: number,
  insideFn: (t: PlacedTable) => boolean,
  zones: ReturnType<typeof buildForbiddenZones>,
  aisles: import('./types.ts').AisleBand[],
  type: GenerateDiningLayoutsRequest['tableCatalogue'][number],
  stats: SearchStats | undefined,
  maxCandidates: number,
  deadline?: number,
): PlacedTable[] {
  const pitchX = Math.max(0.2, footprint.spacingHalfWidthM * 2);
  const pitchY = Math.max(0.2, footprint.spacingHalfDepthM * 2);
  const hexPitchY = type.shape === 'round' ? pitchY * 0.8660254037844386 : pitchY;
  const w = req.block.widthM;
  const d = req.block.depthM;
  const phases = [0, 0.2, 0.4, 0.6, 0.8];
  const out: PlacedTable[] = [];
  const seen = new Set<string>();
  const rotations =
    type.shape === 'round'
      ? [0]
      : facingDeg % 180 !== 0 && facingDeg % 180 !== 90
        ? [0, 90, facingDeg]
        : [0, 90];
  const make = (x: number, y: number, rotationDeg: number): PlacedTable => {
    const table = makePlacedTable(type, footprint, x, y, rotationDeg);
    table.xM = Math.round(x * 1000) / 1000;
    table.yM = Math.round(y * 1000) / 1000;
    return table;
  };

  const expired = () => deadline != null && Date.now() > deadline;

  rotationLoop: for (const rotationDeg of rotations) {
    if (expired()) {
      break;
    }
    const sample = make(0, 0, rotationDeg);
    const wallW = sample.physicalHalfWidthM;
    const wallD = sample.physicalHalfDepthM;
    const xMin = wallW + req.rules.wallClearanceM;
    const yMin = wallD + req.rules.wallClearanceM;
    const xMax = w - wallW - req.rules.wallClearanceM;
    const yMax = d - wallD - req.rules.wallClearanceM;

    for (const px of phases) {
      if (expired()) {
        break rotationLoop;
      }
      for (const py of phases) {
        if (expired()) {
          break rotationLoop;
        }
        for (let y = yMin + py * pitchY; y <= yMax + 1e-6; y += pitchY) {
          if (expired()) {
            break rotationLoop;
          }
          for (let x = xMin + px * pitchX; x <= xMax + 1e-6; x += pitchX) {
            tryPushCandidate(make(x, y, rotationDeg), seen, out, stats, zones, aisles, insideFn);
          }
        }
      }
    }

    if (type.shape === 'round') {
      const hexPhases = [0, 0.5];
      for (const px of hexPhases) {
        if (expired()) {
          break rotationLoop;
        }
        for (const py of hexPhases) {
          if (expired()) {
            break rotationLoop;
          }
          let row = 0;
          for (let y = yMin + py * hexPitchY; y <= yMax + 1e-6; y += hexPitchY) {
            if (expired()) {
              break rotationLoop;
            }
            const stagger = (row % 2 === 1 ? pitchX / 2 : 0) + px * pitchX;
            for (let x = xMin + stagger; x <= xMax + 1e-6; x += pitchX) {
              tryPushCandidate(make(x, y, rotationDeg), seen, out, stats, zones, aisles, insideFn);
            }
            row += 1;
          }
        }
      }
    }

    for (const zone of zones) {
      if (expired()) {
        break rotationLoop;
      }
      const pad = 0.02;
      const rings = [
        { x0: zone.aabb.minX - wallW - pad, x1: zone.aabb.maxX + wallW + pad, y: zone.aabb.minY - wallD - pad },
        { x0: zone.aabb.minX - wallW - pad, x1: zone.aabb.maxX + wallW + pad, y: zone.aabb.maxY + wallD + pad },
      ];
      const cols = [
        { y0: zone.aabb.minY - wallD - pad, y1: zone.aabb.maxY + wallD + pad, x: zone.aabb.minX - wallW - pad },
        { y0: zone.aabb.minY - wallD - pad, y1: zone.aabb.maxY + wallD + pad, x: zone.aabb.maxX + wallW + pad },
      ];
      for (const ring of rings) {
        for (let t = 0; t <= 12; t += 1) {
          const x = ring.x0 + ((t + 0.5) / 13) * (ring.x1 - ring.x0);
          tryPushCandidate(make(x, ring.y, rotationDeg), seen, out, stats, zones, aisles, insideFn);
        }
      }
      for (const col of cols) {
        for (let t = 0; t <= 12; t += 1) {
          const y = col.y0 + ((t + 0.5) / 13) * (col.y1 - col.y0);
          tryPushCandidate(make(col.x, y, rotationDeg), seen, out, stats, zones, aisles, insideFn);
        }
      }
    }

    const rng = createRng(hashSeed(req.generation.seed, `rand-cand-${rotationDeg}`));
    for (let i = 0; i < 36; i += 1) {
      if (expired()) {
        break rotationLoop;
      }
      const x = xMin + rng() * Math.max(0.01, xMax - xMin);
      const y = yMin + rng() * Math.max(0.01, yMax - yMin);
      tryPushCandidate(make(x, y, rotationDeg), seen, out, stats, zones, aisles, insideFn);
    }

    const deltas = [-0.2, -0.1, -0.05, 0.05, 0.1, 0.2];
    const localSeeds = out.slice(0, Math.min(16, out.length));
    for (const seed of localSeeds) {
      if (expired()) {
        break rotationLoop;
      }
      for (const dx of deltas) {
        for (const dy of deltas) {
          tryPushCandidate(
            make(seed.xM + dx, seed.yM + dy, rotationDeg),
            seen,
            out,
            stats,
            zones,
            aisles,
            insideFn,
          );
        }
      }
    }
  }

  return spatiallySampleByRegion(out, req, maxCandidates);
}

function spatiallySampleByRegion(
  pool: PlacedTable[],
  req: GenerateDiningLayoutsRequest,
  max: number,
): PlacedTable[] {
  if (pool.length <= max) {
    return pool;
  }
  const buckets = new Map<StageRegion, PlacedTable[]>();
  for (const region of STAGE_REGIONS) {
    buckets.set(region, []);
  }
  for (const table of pool) {
    const region = classifyStageRegion(table.xM, table.yM, req);
    buckets.get(region)!.push(table);
  }
  const perRegion = Math.max(8, Math.floor(max / STAGE_REGIONS.length));
  const picked: PlacedTable[] = [];
  const leftover: PlacedTable[] = [];
  for (const region of STAGE_REGIONS) {
    const bucket = buckets.get(region) ?? [];
    const take = Math.min(perRegion, bucket.length);
    const stride = take === 0 ? 1 : bucket.length / take;
    const used = new Set<number>();
    for (let i = 0; i < take; i += 1) {
      const index = Math.min(bucket.length - 1, Math.floor(i * stride));
      if (used.has(index)) {
        continue;
      }
      used.add(index);
      picked.push(bucket[index]!);
    }
    bucket.forEach((table, index) => {
      if (!used.has(index)) {
        leftover.push(table);
      }
    });
  }
  let li = 0;
  while (picked.length < max && li < leftover.length) {
    picked.push(leftover[li]!);
    li += 1;
  }
  return picked;
}

function conflictEdgeCount(conflicts: Set<number>[]): number {
  return Math.round(conflicts.reduce((sum, set) => sum + set.size, 0) / 2);
}

function buildConflictSets(candidates: PlacedTable[], deadline?: number): Set<number>[] {
  const conflicts = candidates.map(() => new Set<number>());
  for (let i = 0; i < candidates.length; i += 1) {
    if (deadline != null && Date.now() > deadline) {
      break;
    }
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (tablesOverlap(candidates[i]!, candidates[j]!)) {
        conflicts[i]!.add(j);
        conflicts[j]!.add(i);
      }
    }
  }
  return conflicts;
}

function canAdd(index: number, chosen: number[], conflicts: Set<number>[]): boolean {
  for (const existing of chosen) {
    if (conflicts[existing]!.has(index) || conflicts[index]!.has(existing)) {
      return false;
    }
  }
  return true;
}

/** Per-catalogue table quota for a mixed-shape request. */
export interface MixQuota {
  byCatalogue: Map<string, number>;
  total: number;
}

export function resolveMixQuota(req: GenerateDiningLayoutsRequest): MixQuota | null {
  const mix = req.target?.mix;
  if (!mix?.length) {
    return null;
  }
  const byCatalogue = new Map<string, number>();
  let total = 0;
  for (const lane of mix) {
    const count = Math.max(0, Math.round(lane.count ?? 0));
    if (count <= 0) {
      continue;
    }
    byCatalogue.set(lane.catalogueId, (byCatalogue.get(lane.catalogueId) ?? 0) + count);
    total += count;
  }
  return total > 0 ? { byCatalogue, total } : null;
}

/** Counts the tables of each catalogue id in a placed set. */
export function countByCatalogue(tables: readonly PlacedTable[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const table of tables) {
    counts.set(table.type.id, (counts.get(table.type.id) ?? 0) + 1);
  }
  return counts;
}

export function matchesMixQuota(tables: readonly PlacedTable[], quota: MixQuota): boolean {
  if (tables.length !== quota.total) {
    return false;
  }
  const counts = countByCatalogue(tables);
  for (const [id, wanted] of quota.byCatalogue) {
    if ((counts.get(id) ?? 0) !== wanted) {
      return false;
    }
  }
  return true;
}

/**
 * Fills against a per-catalogue quota instead of one flat target.
 *
 * Each catalogue keeps its own preference queue and the lane furthest from its
 * quota goes next, so shapes interleave across the room rather than one shape
 * claiming every good position before the other gets a turn.
 */
function greedyFillQuota(
  chosen: number[],
  pool: PlacedTable[],
  conflicts: Set<number>[],
  prefer: number[],
  quota: MixQuota,
): number[] {
  const next = [...chosen];
  const inSet = new Set(next);
  const placed = countByCatalogue(next.map((index) => pool[index]!));
  const queues = new Map<string, number[]>();
  const cursor = new Map<string, number>();
  for (const id of quota.byCatalogue.keys()) {
    queues.set(id, []);
    cursor.set(id, 0);
  }
  const preferred = new Set(prefer);
  const order = [...prefer, ...pool.map((_, i) => i).filter((i) => !preferred.has(i))];
  for (const index of order) {
    if (inSet.has(index)) {
      continue;
    }
    queues.get(pool[index]!.type.id)?.push(index);
  }

  while (next.length < quota.total) {
    let bestId: string | null = null;
    let bestDeficit = -1;
    for (const [id, cap] of quota.byCatalogue) {
      if ((placed.get(id) ?? 0) >= cap) {
        continue;
      }
      const queue = queues.get(id)!;
      if ((cursor.get(id) ?? 0) >= queue.length) {
        continue;
      }
      const deficit = (cap - (placed.get(id) ?? 0)) / cap;
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestId = id;
      }
    }
    if (!bestId) {
      break;
    }
    const queue = queues.get(bestId)!;
    let at = cursor.get(bestId)!;
    while (at < queue.length) {
      const index = queue[at]!;
      at += 1;
      if (inSet.has(index)) {
        continue;
      }
      if (canAdd(index, next, conflicts)) {
        next.push(index);
        inSet.add(index);
        placed.set(bestId, (placed.get(bestId) ?? 0) + 1);
        break;
      }
    }
    cursor.set(bestId, at);
  }
  return next;
}

function greedyFill(
  chosen: number[],
  pool: PlacedTable[],
  conflicts: Set<number>[],
  target: number,
  prefer: number[],
  quota?: MixQuota | null,
): number[] {
  if (quota) {
    return greedyFillQuota(chosen, pool, conflicts, prefer, quota);
  }
  const next = [...chosen];
  const order = [...prefer, ...pool.map((_, i) => i).filter((i) => !prefer.includes(i))];
  for (const index of order) {
    if (next.length >= target) {
      break;
    }
    if (next.includes(index)) {
      continue;
    }
    if (canAdd(index, next, conflicts)) {
      next.push(index);
    }
  }
  return next;
}

function regionRoundRobinOrder(pool: PlacedTable[], req: GenerateDiningLayoutsRequest): number[] {
  const buckets = new Map<StageRegion, number[]>();
  for (const region of STAGE_REGIONS) {
    buckets.set(region, []);
  }
  pool.forEach((table, index) => {
    buckets.get(classifyStageRegion(table.xM, table.yM, req))!.push(index);
  });
  const origin = req.features.stage
    ? { x: req.features.stage.xM, y: req.features.stage.yM }
    : { x: req.block.widthM / 2, y: req.block.depthM / 2 };
  for (const region of STAGE_REGIONS) {
    buckets.get(region)!.sort((a, b) => {
      const da = Math.hypot(pool[a]!.xM - origin.x, pool[a]!.yM - origin.y);
      const db = Math.hypot(pool[b]!.xM - origin.x, pool[b]!.yM - origin.y);
      return da - db;
    });
  }
  const order: number[] = [];
  let k = 0;
  let added = true;
  while (added) {
    added = false;
    for (const region of STAGE_REGIONS) {
      const bucket = buckets.get(region)!;
      if (k < bucket.length) {
        order.push(bucket[k]!);
        added = true;
      }
    }
    k += 1;
  }
  return order;
}

function rankByStrategy(
  family: DiningLayoutFamily,
  pool: PlacedTable[],
  req: GenerateDiningLayoutsRequest,
): number[] {
  const indices = pool.map((_, i) => i);
  const origin = req.features.stage
    ? { x: req.features.stage.xM, y: req.features.stage.yM }
    : { x: req.block.widthM / 2, y: req.block.depthM / 2 };
  const dist = (i: number) => Math.hypot(pool[i]!.xM - origin.x, pool[i]!.yM - origin.y);
  const wall = (i: number) =>
    Math.min(pool[i]!.xM, pool[i]!.yM, req.block.widthM - pool[i]!.xM, req.block.depthM - pool[i]!.yM);
  const regionOf = (i: number) => classifyStageRegion(pool[i]!.xM, pool[i]!.yM, req);
  const prefer = (wanted: StageRegion[]) => {
    const want = new Set(wanted);
    return [...indices].sort((a, b) => {
      const aw = want.has(regionOf(a)) ? 0 : 1;
      const bw = want.has(regionOf(b)) ? 0 : 1;
      if (aw !== bw) {
        return aw - bw;
      }
      return dist(a) - dist(b);
    });
  };

  switch (family) {
    case 'balanced-around-stage':
    case 'mixed-table':
      return regionRoundRobinOrder(pool, req);
    case 'stage-facing':
      return prefer([audienceRegion(req), ...cornerNeighbors(audienceRegion(req))]);
    case 'split-sides':
      return prefer(splitSideRegions(req));
    case 'perimeter':
      return [...indices].sort((a, b) => wall(a) - wall(b) || dist(b) - dist(a));
    case 'staggered':
    case 'regular-grid':
      return [...indices].sort((a, b) => pool[a]!.yM - pool[b]!.yM || pool[a]!.xM - pool[b]!.xM);
    case 'service-zone-balanced': {
      const food = req.features.foodPrep;
      if (!food) {
        return regionRoundRobinOrder(pool, req);
      }
      return [...indices].sort((a, b) => {
        const da = Math.hypot(pool[a]!.xM - food.xM, pool[a]!.yM - food.yM);
        const db = Math.hypot(pool[b]!.xM - food.xM, pool[b]!.yM - food.yM);
        return Math.abs(da - 3.2) - Math.abs(db - 3.2);
      });
    }
    case 'central-aisle':
    case 'twin-aisle':
      return prefer(splitSideRegions(req));
    case 'clustered':
      return prefer([audienceRegion(req), oppositeRegion(audienceRegion(req))]);
    case 'banquet-open-centre':
      return [...indices].sort((a, b) => dist(b) - dist(a));
    default:
      return regionRoundRobinOrder(pool, req);
  }
}

function cornerNeighbors(region: StageRegion): StageRegion[] {
  if (region === 'TOP') {
    return ['TOP_LEFT', 'TOP_RIGHT'];
  }
  if (region === 'BOTTOM') {
    return ['BOTTOM_LEFT', 'BOTTOM_RIGHT'];
  }
  if (region === 'LEFT') {
    return ['TOP_LEFT', 'BOTTOM_LEFT'];
  }
  if (region === 'RIGHT') {
    return ['TOP_RIGHT', 'BOTTOM_RIGHT'];
  }
  return [region];
}

function localImproveMax(
  chosen: number[],
  pool: PlacedTable[],
  conflicts: Set<number>[],
  deadline: number,
): number[] {
  let best = [...chosen];
  for (let iter = 0; iter < 48 && Date.now() < deadline; iter += 1) {
    const removeCount = iter % 3 === 2 ? 2 : 1;
    if (best.length <= removeCount) {
      continue;
    }
    const drop = new Set<number>();
    for (let k = 0; k < removeCount; k += 1) {
      drop.add((iter + k * 5) % best.length);
    }
    const reduced = best.filter((_, i) => !drop.has(i));
    const start = (iter * 11) % Math.max(1, pool.length);
    const prefer: number[] = [];
    for (let k = 0; k < pool.length; k += 1) {
      prefer.push((start + k) % pool.length);
    }
    const repaired = greedyFill(reduced, pool, conflicts, pool.length, prefer);
    if (repaired.length > best.length) {
      best = repaired;
    }
  }
  return best;
}

function localRepairExact(
  chosen: number[],
  pool: PlacedTable[],
  conflicts: Set<number>[],
  target: number,
  maxIters: number,
  deadline: number,
  quota?: MixQuota | null,
): number[] {
  let best = greedyFill(chosen, pool, conflicts, target, chosen, quota);
  if (best.length >= target) {
    return best.slice(0, target);
  }
  for (let iter = 0; iter < maxIters && Date.now() < deadline; iter += 1) {
    if (best.length >= target) {
      return best.slice(0, target);
    }
    const removeAt = best.length === 0 ? -1 : iter % best.length;
    const reduced = removeAt >= 0 ? best.filter((_, i) => i !== removeAt) : [];
    const start = (iter * 7) % Math.max(1, pool.length);
    const prefer: number[] = [];
    for (let k = 0; k < pool.length; k += 1) {
      prefer.push((start + k) % pool.length);
    }
    const repaired = greedyFill(reduced, pool, conflicts, target, prefer, quota);
    if (repaired.length > best.length) {
      best = repaired;
    }
    if (repaired.length >= target) {
      return repaired.slice(0, target);
    }
  }
  return best;
}

function selectExactIndices(
  pool: PlacedTable[],
  conflicts: Set<number>[],
  prefer: number[],
  target: number,
  deadline: number,
): number[] | null {
  const greedy = greedyFill([], pool, conflicts, target, prefer);
  if (greedy.length === target) {
    return greedy;
  }
  const repaired = localRepairExact(greedy, pool, conflicts, target, 48, deadline);
  return repaired.length === target ? repaired : null;
}

function subsetWitness(witness: number[], prefer: number[], target: number): number[] {
  if (witness.length <= target) {
    return [...witness];
  }
  const ranked = prefer.filter((index) => witness.includes(index));
  const rest = witness.filter((index) => !ranked.includes(index));
  return [...ranked, ...rest].slice(0, target);
}

export interface OperationalCapacityResult {
  maximumTableCount: number;
  validatedFeasibleTableCount: number;
  provenMaximumTableCount: number | null;
  maximumProven: boolean;
  basicGeometricUpperBound: number;
  witnessLayout: GeneratedDiningLayout | null;
  witnessTables: PlacedTable[];
  witnessIndices: number[];
  pool: PlacedTable[];
  conflicts: Set<number>[];
  candidateCount: number;
  improvementMoves: number;
  repair12: number;
  repair23: number;
  searchStates: number;
  candidateGenerationMs: number;
  conflictBuildMs: number;
}

export function basicGeometricUpperBound(
  req: GenerateDiningLayoutsRequest,
  footprint: OccupiedFootprint,
): number {
  const pitchX = Math.max(0.01, footprint.spacingHalfWidthM * 2);
  const pitchY = Math.max(0.01, footprint.spacingHalfDepthM * 2);
  const insetX = footprint.physicalHalfWidthM + req.rules.wallClearanceM;
  const insetY = footprint.physicalHalfDepthM + req.rules.wallClearanceM;
  const usableW = req.block.widthM - 2 * insetX;
  const usableD = req.block.depthM - 2 * insetY;
  if (usableW < -1e-9 || usableD < -1e-9) {
    return 0;
  }
  const cols = 1 + Math.floor((Math.max(0, usableW) + 1e-9) / pitchX);
  const rows = 1 + Math.floor((Math.max(0, usableD) + 1e-9) / pitchY);
  const lattice = Math.max(0, cols * rows);
  const area = Math.floor((req.block.widthM * req.block.depthM) / (pitchX * pitchY));
  let hex = 0;
  if (req.tableCatalogue[0]?.shape === 'round') {
    const rowPitch = pitchY * 0.8660254037844386;
    const hexRows = 1 + Math.floor((Math.max(0, usableD) + 1e-9) / rowPitch);
    const evenCols = 1 + Math.floor((Math.max(0, usableW) + 1e-9) / pitchX);
    const oddCols = 1 + Math.floor((Math.max(0, usableW - pitchX / 2) + 1e-9) / pitchX);
    hex = Math.ceil(hexRows / 2) * evenCols + Math.floor(hexRows / 2) * oddCols;
  }
  return Math.max(0, Math.min(Math.max(lattice, hex, area), 80));
}

function validateTables(
  req: GenerateDiningLayoutsRequest,
  tables: PlacedTable[],
  zones: ReturnType<typeof buildForbiddenZones>,
  insideFn: (t: PlacedTable) => boolean,
  stats?: SearchStats,
): boolean {
  if (tables.length === 0) {
    return false;
  }
  const check = validateLayout(
    req.block.polygon,
    tables,
    zones,
    [],
    { ...req, target: { ...req.target, tableCount: undefined, targetCapacity: undefined } },
    req.rules,
    insideFn,
    { requireTargetCount: false },
  );
  if (!check.ok) {
    return false;
  }
  if (!checkReachability(req.block.polygon, tables, zones, [], req)) {
    if (stats) {
      stats.rejectedReachability += 1;
    }
    return false;
  }
  return true;
}

function materializeLayout(
  req: GenerateDiningLayoutsRequest,
  family: DiningLayoutFamily,
  tables: PlacedTable[],
  seed: number,
  facingDeg: number,
): GeneratedDiningLayout {
  const genTables = toGeneratedTables(tables, req.block.widthM, req.block.depthM, facingDeg);
  const metrics = scoreLayout(tables, [], req);
  const stageSide = req.features.stage
    ? nearestSide(req.features.stage.xM, req.features.stage.yM, req.block.widthM, req.block.depthM)
    : null;
  return {
    id: `gen-${family}-${seed}-${genTables.length}`,
    name: FAMILY_DISPLAY[family]?.name ?? family,
    family,
    fingerprint: fingerprintLayout(family, tables, [], stageSide, req),
    previewSvg: buildPreviewSvg(req, genTables, []),
    seed,
    stage: toPlacedFeature(req.features.stage, req.block.widthM, req.block.depthM),
    foodPrep: toPlacedFeature(req.features.foodPrep, req.block.widthM, req.block.depthM),
    score: overallScore(metrics),
    capacity: genTables.reduce((s, t) => s + t.seats, 0),
    tableCount: genTables.length,
    metrics,
    tables: genTables,
    aisles: [],
  };
}

export function computeOperationalCapacity(
  req: GenerateDiningLayoutsRequest,
  stats?: SearchStats,
  deadline = Date.now() + 1400,
): OperationalCapacityResult {
  const graph = prepareCandidateGraph(req, stats, 800, deadline);
  const geometric = graph.footprint ? basicGeometricUpperBound(req, graph.footprint) : 0;
  const empty: OperationalCapacityResult = {
    maximumTableCount: 0,
    validatedFeasibleTableCount: 0,
    provenMaximumTableCount: graph.pool.length === 0 && !graph.truncated ? 0 : null,
    maximumProven: graph.pool.length === 0 && !graph.truncated,
    basicGeometricUpperBound: geometric,
    witnessLayout: null,
    witnessTables: [],
    witnessIndices: [],
    pool: graph.pool,
    conflicts: graph.conflicts,
    candidateCount: graph.pool.length,
    improvementMoves: 0,
    repair12: 0,
    repair23: 0,
    searchStates: 0,
    candidateGenerationMs: graph.candidateGenerationMs,
    conflictBuildMs: graph.conflictBuildMs,
  };
  if (!graph.primary || graph.pool.length === 0) {
    return empty;
  }
  const { pool, conflicts, zones, insideFn, facing } = graph;
  const degreeOrder = pool
    .map((_, i) => i)
    .sort((a, b) => (conflicts[a]?.size ?? 0) - (conflicts[b]?.size ?? 0));
  const rng = createRng(hashSeed(req.generation.seed, 'capacity-order'));
  const orderings = [
    regionRoundRobinOrder(pool, req),
    degreeOrder,
    rankByStrategy('staggered', pool, req),
    rankByStrategy('perimeter', pool, req),
    rankByStrategy('stage-facing', pool, req),
    rankByStrategy('balanced-around-stage', pool, req),
    rankCompact(pool, req),
    rankOpenCirculation(pool, req),
    shuffleInPlace(pool.map((_, i) => i), rng),
  ];
  let bestValid: number[] = [];
  let rounds = 0;
  while (Date.now() < deadline && rounds < 3) {
    rounds += 1;
    let grew = false;
    for (const order of orderings) {
      if (Date.now() > deadline) {
        break;
      }
      const packed = greedyFill(bestValid, pool, conflicts, pool.length, order);
      const improved = localImproveMax(packed, pool, conflicts, deadline);
      if (improved.length <= bestValid.length) {
        continue;
      }
      for (let n = improved.length; n > bestValid.length; n -= 1) {
        const indices = improved.slice(0, n);
        const trialTables = indices.map((index) => pool[index]!);
        if (validateTables(req, trialTables, zones, insideFn, stats)) {
          bestValid = indices;
          grew = true;
          break;
        }
      }
    }
    if (!grew) {
      break;
    }
  }
  const certified = maximumIndependentSet(conflicts, bestValid, deadline);
  let proven = certified.proven && !graph.truncated;
  let certifiedValid = bestValid;
  if (certified.best.length > bestValid.length) {
    const tables = certified.best.map((index) => pool[index]!);
    if (validateTables(req, tables, zones, insideFn, stats)) {
      certifiedValid = certified.best;
    } else {
      proven = false;
      for (let n = certified.best.length - 1; n > bestValid.length; n -= 1) {
        const subset = certified.best.slice(0, n);
        const subsetTables = subset.map((index) => pool[index]!);
        if (validateTables(req, subsetTables, zones, insideFn, stats)) {
          certifiedValid = subset;
          break;
        }
      }
    }
  } else if (certified.best.length === bestValid.length && bestValid.length > 0) {
    certifiedValid = bestValid;
  }
  if (certifiedValid.length === 0) {
    return empty;
  }
  const tables = certifiedValid.map((index) => pool[index]!);
  if (!validateTables(req, tables, zones, insideFn, stats)) {
    return empty;
  }
  const family: DiningLayoutFamily = req.features.stage ? 'balanced-around-stage' : 'regular-grid';
  let witnessTables = tables;
  let localStats = { improvementMoves: 0, repair12: 0, repair23: 0, inserts: 0 };
  if (graph.footprint && graph.primary && Date.now() + 250 < deadline) {
    const grown = compactAndInsert(witnessTables, req, graph.footprint, graph.primary, zones, insideFn, deadline);
    if (grown.tables.length > witnessTables.length && validateTables(req, grown.tables, zones, insideFn, stats)) {
      witnessTables = grown.tables;
      proven = false;
    }
    localStats = grown.stats;
  }
  const feasible = witnessTables.length;
  const maximumProven =
    proven &&
    !graph.truncated &&
    feasible === certified.best.length &&
    feasible === certifiedValid.length;
  return {
    maximumTableCount: feasible,
    validatedFeasibleTableCount: feasible,
    provenMaximumTableCount: maximumProven ? feasible : null,
    maximumProven,
    basicGeometricUpperBound: geometric,
    witnessLayout: materializeLayout(req, family, witnessTables, req.generation.seed, facing),
    witnessTables,
    witnessIndices: certifiedValid,
    pool,
    conflicts,
    candidateCount: pool.length,
    improvementMoves: localStats.improvementMoves,
    repair12: localStats.repair12,
    repair23: localStats.repair23,
    searchStates: certified.searchStates,
    candidateGenerationMs: graph.candidateGenerationMs,
    conflictBuildMs: graph.conflictBuildMs,
  };
}

function prepareCandidateGraph(
  req: GenerateDiningLayoutsRequest,
  stats: SearchStats | undefined,
  maxCandidates: number,
  deadline?: number,
) {
  const emptyPool: PlacedTable[] = [];
  const types = allowedTableTypes(req.tableCatalogue);
  const primary = types[0];
  const zones = buildForbiddenZones(req, req.rules);
  const footprint = primary ? occupiedFootprint(primary, req.rules) : null;
  const insideFn = buildInsideFn(req.block.polygon, req.rules);
  const facing = req.stageFacingAngleDeg ?? 0;
  if (!primary || !footprint) {
    return {
      primary,
      zones,
      footprint,
      insideFn,
      facing,
      pool: emptyPool,
      conflicts: [] as Set<number>[],
      candidateGenerationMs: 0,
      conflictBuildMs: 0,
      truncated: false,
    };
  }
  // Only a mixed-shape request enumerates more than one type; a single-shape
  // request keeps the original primary-only pool so its results never shift.
  const quota = resolveMixQuota(req);
  const poolTypes =
    quota && types.length > 1
      ? types.filter((type) => (quota.byCatalogue.get(type.id) ?? 0) > 0)
      : [primary];
  const activeTypes = poolTypes.length > 0 ? poolTypes : [primary];
  const quotaTotal = quota?.total ?? 0;
  const tCand = Date.now();
  const pool: PlacedTable[] = [];
  for (const type of activeTypes) {
    const share =
      quota && quotaTotal > 0 ? (quota.byCatalogue.get(type.id) ?? 0) / quotaTotal : 1;
    const budget =
      activeTypes.length === 1
        ? maxCandidates
        : Math.max(160, Math.round(maxCandidates * Math.max(share, 1 / activeTypes.length)));
    pool.push(
      ...enumerateValidTablePositions(
        req,
        occupiedFootprint(type, req.rules),
        facing,
        insideFn,
        zones,
        [],
        type,
        stats,
        budget,
        deadline,
      ),
    );
  }
  const truncatedEnum = deadline != null && Date.now() > deadline;
  const tConf = Date.now();
  const conflicts = pool.length > 0 ? buildConflictSets(pool, deadline) : [];
  return {
    primary,
    zones,
    footprint,
    insideFn,
    facing,
    pool,
    conflicts,
    candidateGenerationMs: tConf - tCand,
    conflictBuildMs: Date.now() - tConf,
    truncated: truncatedEnum || (deadline != null && Date.now() > deadline),
  };
}

function greedyFillRegionMix(
  pool: PlacedTable[],
  conflicts: Set<number>[],
  target: number,
  mix: Partial<Record<StageRegion, number>>,
  prefer: number[],
  req: GenerateDiningLayoutsRequest,
  tableQuota?: MixQuota | null,
): number[] {
  const chosen: number[] = [];
  const filled: Record<string, number> = {};
  for (const region of STAGE_REGIONS) {
    filled[region] = 0;
  }
  const placed = new Map<string, number>();
  const regionOf = (index: number) => classifyStageRegion(pool[index]!.xM, pool[index]!.yM, req);
  for (const [region, regionQuota] of Object.entries(mix) as [StageRegion, number][]) {
    if (!regionQuota) {
      continue;
    }
    for (const index of prefer) {
      if (chosen.length >= target || (filled[region] ?? 0) >= regionQuota) {
        break;
      }
      if (regionOf(index) !== region) {
        continue;
      }
      const catalogueId = pool[index]!.type.id;
      if (tableQuota) {
        const cap = tableQuota.byCatalogue.get(catalogueId) ?? 0;
        if ((placed.get(catalogueId) ?? 0) >= cap) {
          continue;
        }
      }
      if (canAdd(index, chosen, conflicts)) {
        chosen.push(index);
        filled[region] = (filled[region] ?? 0) + 1;
        placed.set(catalogueId, (placed.get(catalogueId) ?? 0) + 1);
      }
    }
  }
  return greedyFill(chosen, pool, conflicts, target, prefer, tableQuota);
}

function splitParts(n: number, parts: number): number[] {
  const base = Math.floor(n / parts);
  const rem = n % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rem ? 1 : 0));
}

function suggestionRegionMixes(
  target: number,
  req: GenerateDiningLayoutsRequest,
): { name: string; family: DiningLayoutFamily; mix: Partial<Record<StageRegion, number>> }[] {
  const [c0, c1, c2, c3] = splitParts(target, 4);
  const [h0, h1] = splitParts(target, 2);
  const front = audienceRegion(req);
  const back = oppositeRegion(front);
  const sides = splitSideRegions(req);
  return [
    { name: 'balanced', family: 'balanced-around-stage', mix: { TOP: c0, BOTTOM: c1, LEFT: c2, RIGHT: c3 } },
    { name: 'stage-facing', family: 'stage-facing', mix: { [front]: h0, [back]: Math.max(0, h1 - 1), [sides[0]!]: 1 } },
    { name: 'split-sides', family: 'split-sides', mix: { [sides[0]!]: h0, [sides[1]!]: h1 } },
    { name: 'top-bottom', family: 'staggered', mix: { TOP: h0, BOTTOM: h1 } },
    { name: 'perimeter', family: 'perimeter', mix: { TOP_LEFT: c0, TOP_RIGHT: c1, BOTTOM_LEFT: c2, BOTTOM_RIGHT: c3 } },
    { name: 'service', family: 'service-zone-balanced', mix: { LEFT: c0, RIGHT: c1, BOTTOM: c2, TOP: c3 } },
  ];
}

function rankCompact(pool: PlacedTable[], req: GenerateDiningLayoutsRequest): number[] {
  const cx = req.block.widthM / 2;
  const cy = req.block.depthM / 2;
  return pool.map((_, i) => i).sort((a, b) => {
    const da = Math.hypot(pool[a]!.xM - cx, pool[a]!.yM - cy);
    const db = Math.hypot(pool[b]!.xM - cx, pool[b]!.yM - cy);
    return da - db;
  });
}

function rankOpenCirculation(pool: PlacedTable[], req: GenerateDiningLayoutsRequest): number[] {
  return rankCompact(pool, req).reverse();
}

function rankSymmetric(pool: PlacedTable[], req: GenerateDiningLayoutsRequest): number[] {
  const cx = req.block.widthM / 2;
  return pool.map((_, i) => i).sort((a, b) => {
    const ax = Math.abs(pool[a]!.xM - cx);
    const bx = Math.abs(pool[b]!.xM - cx);
    if (ax !== bx) {
      return ax - bx;
    }
    return pool[a]!.yM - pool[b]!.yM;
  });
}

interface ExactSolution {
  indices: number[];
  family: DiningLayoutFamily;
  strategy: string;
}

function searchExactSolutions(opts: {
  pool: PlacedTable[];
  conflicts: Set<number>[];
  target: number;
  maxSolutions: number;
  req: GenerateDiningLayoutsRequest;
  seed: number;
  deadline: number;
  witnessIndices: number[];
  quota?: MixQuota | null;
}): { solutions: ExactSolution[]; strategiesAttempted: string[] } {
  const { pool, conflicts, target, maxSolutions, req, seed, deadline, witnessIndices } = opts;
  const quota = opts.quota ?? null;
  const solutions: ExactSolution[] = [];
  const seen = new Set<string>();
  const strategiesAttempted: string[] = [];

  const tryAdd = (indices: number[], family: DiningLayoutFamily, strategy: string): void => {
    if (indices.length !== target || solutions.length >= maxSolutions) {
      return;
    }
    if (quota && !matchesMixQuota(indices.map((index) => pool[index]!), quota)) {
      return;
    }
    const key = [...indices].sort((a, b) => a - b).join(',');
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    solutions.push({ indices, family, strategy });
  };

  const families = eligibleFamilies(req);
  if (witnessIndices.length >= target) {
    for (const family of families.slice(0, 4)) {
      tryAdd(subsetWitness(witnessIndices, rankByStrategy(family, pool, req), target), family, `witness:${family}`);
    }
  }

  for (const family of families) {
    if (Date.now() > deadline || solutions.length >= maxSolutions) {
      break;
    }
    strategiesAttempted.push(family);
    const prefer = rankByStrategy(family, pool, req);
    tryAdd(greedyFill([], pool, conflicts, target, prefer, quota), family, family);
    tryAdd(greedyFill([], pool, conflicts, target, [...prefer].reverse(), quota), family, `${family}:reverse`);
    const rng = createRng(hashSeed(seed, family));
    tryAdd(
      greedyFill([], pool, conflicts, target, shuffleInPlace([...prefer], rng), quota),
      family,
      `${family}:seeded`,
    );
    const repaired = localRepairExact(
      greedyFill([], pool, conflicts, target, prefer, quota),
      pool,
      conflicts,
      target,
      20,
      deadline,
      quota,
    );
    tryAdd(repaired, family, `${family}:repair`);
  }

  for (const mix of suggestionRegionMixes(target, req)) {
    if (Date.now() > deadline || solutions.length >= maxSolutions) {
      break;
    }
    strategiesAttempted.push(mix.name);
    const prefer = rankByStrategy(mix.family, pool, req);
    tryAdd(
      greedyFillRegionMix(pool, conflicts, target, mix.mix, prefer, req, quota),
      mix.family,
      `mix:${mix.name}`,
    );
    const rng = createRng(hashSeed(seed, mix.name));
    tryAdd(
      greedyFillRegionMix(pool, conflicts, target, mix.mix, shuffleInPlace([...prefer], rng), req, quota),
      mix.family,
      `mix:${mix.name}:seeded`,
    );
  }

  const extraRanks: { name: string; family: DiningLayoutFamily; order: number[] }[] = [
    { name: 'compact', family: 'clustered', order: rankCompact(pool, req) },
    { name: 'open-circulation', family: req.features.stage ? 'regular-grid' : 'banquet-open-centre', order: rankOpenCirculation(pool, req) },
    { name: 'symmetric', family: 'balanced-around-stage', order: rankSymmetric(pool, req) },
  ];
  for (const extra of extraRanks) {
    if (Date.now() > deadline || solutions.length >= maxSolutions) {
      break;
    }
    strategiesAttempted.push(extra.name);
    tryAdd(greedyFill([], pool, conflicts, target, extra.order, quota), extra.family, extra.name);
  }

  let randomPass = 0;
  const randomRng = createRng(hashSeed(seed, 'random-exact'));
  while (solutions.length < maxSolutions && Date.now() < deadline && randomPass < 8) {
    randomPass += 1;
    const order = shuffleInPlace(pool.map((_, i) => i), randomRng);
    tryAdd(greedyFill([], pool, conflicts, target, order, quota), 'mixed-table', `random:${randomPass}`);
  }

  return { solutions, strategiesAttempted };
}

export function generateDiningLayouts(req: GenerateDiningLayoutsRequest): {
  generatorVersion: string;
  layouts: GeneratedDiningLayout[];
  candidateCount: number;
  validCount: number;
  durationMs: number;
  rejectionReasons: Record<string, number>;
  exactCandidateCount: number;
  requestedTableCount?: number;
  bestPartialCount: number;
  operationalMaxTableCount: number;
  validatedFeasibleTableCount: number;
  provenMaximumTableCount: number | null;
  maximumProven: boolean;
  basicGeometricUpperBound: number;
  feasible: boolean | 'unknown';
  witnessLayout: GeneratedDiningLayout | null;
  failureKind: import('./types.ts').DiningGenerationFailureKind;
  generationDebug: DiningGenerationDebug;
} {
  const started = Date.now();
  const timeBudget = Math.min(3200, req.generation.timeBudgetMs ?? 2800);
  const want = Math.max(1, Math.min(6, req.generation.suggestionCount ?? 6));
  const exclude = req.generation.excludeFingerprints ?? [];
  const facing = req.stageFacingAngleDeg ?? 0;
  const mode = req.generation.mode ?? 'generate';
  const requested = mode === 'capacity' ? undefined : req.target.tableCount;
  const debugStats = EMPTY_STATS();
  const rejectionReasons: Record<string, number> = {};
  const bump = (k: string) => {
    rejectionReasons[k] = (rejectionReasons[k] ?? 0) + 1;
  };
  const suggestionDebug = {
    requestedSuggestions: want,
    rawExactSolutions: 0,
    validExactSolutions: 0,
    excludedByHistory: 0,
    removedNearDuplicates: 0,
    finalSuggestions: 0,
    strategiesAttempted: [] as string[],
  };

  const primaryType = req.tableCatalogue[0];
  const primaryFootprint = primaryType ? occupiedFootprint(primaryType, req.rules) : null;
  const geometric = primaryFootprint ? basicGeometricUpperBound(req, primaryFootprint) : 0;
  const stageZone = req.features.stage
    ? buildForbiddenZones(req, req.rules).find((z) => z.id === 'stage')
    : undefined;

  const timings = {
    candidateGenerationMs: 0,
    conflictBuildMs: 0,
    capacitySearchMs: 0,
    exactSearchMs: 0,
    localOptimisationMs: 0,
  };

  const capacityDeadline = started + timeBudget;
  const tCapacity = Date.now();
  const capacity =
    mode === 'capacity'
      ? computeOperationalCapacity(req, debugStats, capacityDeadline)
      : null;
  if (capacity) {
    timings.capacitySearchMs = Date.now() - tCapacity;
    timings.candidateGenerationMs = capacity.candidateGenerationMs;
    timings.conflictBuildMs = capacity.conflictBuildMs;
  }
  const graph =
    mode === 'capacity'
      ? {
          pool: capacity!.pool,
          conflicts: capacity!.conflicts,
          zones: buildForbiddenZones(req, req.rules),
          insideFn: buildInsideFn(req.block.polygon, req.rules),
          facing,
          candidateGenerationMs: capacity!.candidateGenerationMs,
          conflictBuildMs: capacity!.conflictBuildMs,
        }
      : prepareCandidateGraph(req, debugStats, 800, capacityDeadline);
  if (!capacity) {
    timings.candidateGenerationMs = graph.candidateGenerationMs;
    timings.conflictBuildMs = graph.conflictBuildMs;
  }

  const validatedFeasible = capacity?.validatedFeasibleTableCount ?? 0;
  const maximumProven = capacity?.maximumProven ?? false;
  const provenMaximum = capacity?.provenMaximumTableCount ?? null;
  const operationalMax = validatedFeasible;

  const physicalExplanation = {
    tabletopDiameterM: primaryType?.widthM ?? 0,
    chairOccupiedDiameterM: (primaryFootprint?.physicalHalfWidthM ?? 0) * 2,
    requiredPitchM: (primaryFootprint?.spacingHalfWidthM ?? 0) * 2,
    roomWidthM: req.block.widthM,
    roomDepthM: req.block.depthM,
    wallClearanceM: req.rules.wallClearanceM,
    stageClearanceM: req.rules.stageClearanceM,
  };

  const debugBase = (exactCandidates: number, durationMs: number, bestPartialCount: number): DiningGenerationDebug => ({
    requestedTableCount: requested ?? 0,
    operationalMaxEstimate: operationalMax,
    witnessTableCount: capacity?.witnessLayout?.tables.length ?? 0,
    witnessValidated: Boolean(
      capacity?.witnessLayout && capacity.validatedFeasibleTableCount === capacity.witnessLayout.tables.length,
    ),
    attempts: debugStats.attempts,
    exactCandidates,
    bestPartialCount,
    requestSnapshot: {
      block: {
        widthM: req.block.widthM,
        depthM: req.block.depthM,
        polygonPointCount: req.block.polygon.length,
      },
      table: {
        shape: req.tableCatalogue[0]?.shape ?? 'round',
        widthM: req.tableCatalogue[0]?.widthM ?? 0,
        depthM: req.tableCatalogue[0]?.depthM ?? 0,
        chairWidthM: req.tableCatalogue[0]?.chairWidthM ?? 0,
        chairDepthM: req.tableCatalogue[0]?.chairDepthM ?? 0,
        clearanceM: req.rules.minimumTableToTableClearanceM,
      },
      features: {
        stage: req.features.stage,
        foodPrep: req.features.foodPrep,
        entranceCount: req.accessPoints.entrances.length,
        exitCount: req.accessPoints.exits.length + (req.accessPoints.emergencyExits?.length ?? 0),
      },
      seed: req.generation.seed,
    },
    rejectionCounts: {
      boundary: debugStats.rejectedBoundary,
      stage: debugStats.rejectedStage,
      foodPrep: debugStats.rejectedFoodPrep,
      entrance: debugStats.rejectedEntrance,
      exit: debugStats.rejectedExit,
      aisle: debugStats.rejectedAisle,
      collision: debugStats.rejectedCollision,
      reachability: debugStats.rejectedReachability,
    },
    durationMs,
    requestedSuggestions: suggestionDebug.requestedSuggestions,
    rawExactSolutions: suggestionDebug.rawExactSolutions,
    validExactSolutions: suggestionDebug.validExactSolutions,
    excludedByHistory: suggestionDebug.excludedByHistory,
    removedNearDuplicates: suggestionDebug.removedNearDuplicates,
    finalSuggestions: suggestionDebug.finalSuggestions,
    strategiesAttempted: suggestionDebug.strategiesAttempted,
    candidatePool: {
      rawAttempts: debugStats.attempts,
      individuallyValid: graph.pool.length,
      byRegion: regionCounts(graph.pool, req),
      physicalHalfWidthM: primaryFootprint?.physicalHalfWidthM ?? 0,
      physicalHalfDepthM: primaryFootprint?.physicalHalfDepthM ?? 0,
      pairwiseHalfWidthM: primaryFootprint?.spacingHalfWidthM ?? 0,
      pairwiseHalfDepthM: primaryFootprint?.spacingHalfDepthM ?? 0,
      debugSvg: buildCandidateDebugSvg(req, graph.pool, capacity?.witnessTables),
    },
    capacityDebug: {
      room: { widthM: req.block.widthM, depthM: req.block.depthM },
      table: {
        diameterM: primaryType?.shape === 'round' ? primaryType.widthM : primaryType?.widthM ?? 0,
        physicalHalfWidthM: primaryFootprint?.physicalHalfWidthM ?? 0,
        physicalHalfDepthM: primaryFootprint?.physicalHalfDepthM ?? 0,
        pairwiseHalfWidthM: primaryFootprint?.spacingHalfWidthM ?? 0,
        pairwiseHalfDepthM: primaryFootprint?.spacingHalfDepthM ?? 0,
        tableGapM: req.rules.minimumTableToTableClearanceM,
      },
      stage: req.features.stage
        ? {
            widthM: req.features.stage.widthM,
            depthM: req.features.stage.depthM,
            clearanceM: req.rules.stageClearanceM,
            forbiddenBounds: stageZone?.aabb ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 },
          }
        : undefined,
      wallClearanceM: req.rules.wallClearanceM,
      candidateCounts: {
        beforeStaticValidation: debugStats.funnelBeforeStatic,
        afterWall: debugStats.funnelAfterWall,
        afterStage: debugStats.funnelAfterStage,
        afterAccess: debugStats.funnelAfterAccess,
        finalPool: graph.pool.length,
      },
      maximumTableCount: operationalMax,
      validatedFeasibleCount: validatedFeasible,
      provenMaximumCount: provenMaximum,
      maximumProven,
      basicGeometricUpperBound: capacity?.basicGeometricUpperBound ?? geometric,
      physicalExplanation,
    },
    generatorVersion: GENERATOR_VERSION,
    roomDimensions: { widthM: req.block.widthM, depthM: req.block.depthM },
    tablePhysicalFootprint: {
      halfWidthM: primaryFootprint?.physicalHalfWidthM ?? 0,
      halfDepthM: primaryFootprint?.physicalHalfDepthM ?? 0,
    },
    pairwisePitch: {
      xM: (primaryFootprint?.spacingHalfWidthM ?? 0) * 2,
      yM: (primaryFootprint?.spacingHalfDepthM ?? 0) * 2,
    },
    staticCandidateCount: graph.pool.length,
    conflictCount: conflictEdgeCount(graph.conflicts),
    stageRegionCandidateCounts: regionCounts(graph.pool, req),
    capacity: {
      basicUpperBound: capacity?.basicGeometricUpperBound ?? geometric,
      validatedFeasibleCount: validatedFeasible,
      maximumProven,
      provenMaximum,
      searchStates: capacity?.searchStates ?? 0,
      improvementMoves: capacity?.improvementMoves ?? 0,
      repair12: capacity?.repair12 ?? 0,
      repair23: capacity?.repair23 ?? 0,
    },
    generation: {
      requestedCount: requested ?? 0,
      exactSolutionsFound: suggestionDebug.validExactSolutions,
      solutionsBeforeDedup: suggestionDebug.rawExactSolutions,
      removedDuplicates: suggestionDebug.removedNearDuplicates,
      returnedSuggestions: suggestionDebug.finalSuggestions || exactCandidates,
    },
    timing: {
      candidateGenerationMs: timings.candidateGenerationMs,
      conflictBuildMs: timings.conflictBuildMs,
      capacitySearchMs: timings.capacitySearchMs,
      exactSearchMs: timings.exactSearchMs,
      localOptimisationMs: timings.localOptimisationMs,
      totalMs: durationMs,
    },
  });

  const finish = (
    layouts: GeneratedDiningLayout[],
    failureKind: import('./types.ts').DiningGenerationFailureKind,
    bestPartialCount: number,
    extra?: { feasible?: boolean | 'unknown'; validated?: number },
  ) => {
    const durationMs = Date.now() - started;
    const feasibleCount = extra?.validated ?? (mode === 'capacity' ? validatedFeasible : layouts[0]?.tableCount ?? 0);
    return {
      generatorVersion: GENERATOR_VERSION,
      layouts,
      candidateCount: graph.pool.length,
      validCount: layouts.length,
      durationMs,
      rejectionReasons,
      exactCandidateCount: layouts.length,
      requestedTableCount: requested,
      bestPartialCount,
      operationalMaxTableCount: mode === 'capacity' ? operationalMax : feasibleCount,
      validatedFeasibleTableCount: feasibleCount,
      provenMaximumTableCount: mode === 'capacity' ? provenMaximum : null,
      maximumProven: mode === 'capacity' ? maximumProven : false,
      basicGeometricUpperBound: capacity?.basicGeometricUpperBound ?? geometric,
      feasible: extra?.feasible ?? (layouts.length > 0 ? true : 'unknown'),
      witnessLayout: capacity?.witnessLayout ?? null,
      failureKind,
      generationDebug: debugBase(layouts.length, durationMs, bestPartialCount),
    };
  };

  if (mode === 'capacity') {
    return finish(
      capacity?.witnessLayout ? [capacity.witnessLayout] : [],
      capacity?.witnessLayout ? 'EXACT_FOUND' : 'SEARCH_EXHAUSTED',
      operationalMax,
      { feasible: operationalMax > 0 || maximumProven, validated: operationalMax },
    );
  }

  const target = requested ?? 0;
  if (target < 1) {
    bump('no-table-type');
    return finish([], 'SEARCH_EXHAUSTED', 0, { feasible: 'unknown', validated: 0 });
  }

  const zones = graph.zones;
  const insideFn = graph.insideFn;
  const deadline = started + timeBudget;
  const mixQuota = resolveMixQuota(req);
  const seedWitness =
    capacity?.witnessIndices && capacity.witnessIndices.length > 0
      ? capacity.witnessIndices
      : greedyFill(
          [],
          graph.pool,
          graph.conflicts,
          graph.pool.length,
          regionRoundRobinOrder(graph.pool, req),
          mixQuota,
        );
  const maxInternal = mode === 'feasibility' ? 8 : Math.min(30, Math.max(18, want * 5));
  const tExact = Date.now();
  const searched = searchExactSolutions({
    pool: graph.pool,
    conflicts: graph.conflicts,
    target,
    maxSolutions: maxInternal,
    req,
    seed: req.generation.seed,
    deadline: Math.min(deadline, started + Math.floor(timeBudget * 0.82)),
    witnessIndices: seedWitness,
    quota: mixQuota,
  });
  timings.exactSearchMs = Date.now() - tExact;
  suggestionDebug.strategiesAttempted = searched.strategiesAttempted;
  suggestionDebug.rawExactSolutions = searched.solutions.length;

  const exact: GeneratedDiningLayout[] = [];
  let bestPartialCount = 0;
  for (const solution of searched.solutions) {
    if (Date.now() > deadline) {
      break;
    }
    bestPartialCount = Math.max(bestPartialCount, solution.indices.length);
    if (solution.indices.length !== target) {
      bump('capacity-mismatch');
      continue;
    }
    const tables = solution.indices.map((index) => graph.pool[index]!);
    if (!validateTables(req, tables, zones, insideFn, debugStats) || tables.length !== target) {
      bump('invalid');
      continue;
    }
    const layout = materializeLayout(req, solution.family, tables, req.generation.seed, facing);
    if (exclude.some((e) => e === layout.fingerprint || isNearDuplicate(e, layout.fingerprint))) {
      suggestionDebug.excludedByHistory += 1;
      bump('duplicate-excluded');
      continue;
    }
    if (exact.some((v) => isNearDuplicate(v.fingerprint, layout.fingerprint))) {
      suggestionDebug.removedNearDuplicates += 1;
      bump('duplicate');
      continue;
    }
    exact.push({ ...layout, id: `gen-${solution.family}-${req.generation.seed}-${exact.length}` });
  }
  suggestionDebug.validExactSolutions = exact.length;

  const layouts = nameLayouts(pickDiverse(exact, want, req)).filter(
    (layout) => requested == null || layout.tableCount === requested,
  );
  const tLocal = Date.now();
  const typeById = new Map(req.tableCatalogue.map((type) => [type.id, type]));
  const tLocalFallbackType = graph.pool[0]?.type;
  const refinedLayouts = layouts.map((layout) => {
    const placed = generatedTablePoints(layout, req).map((p, i) => {
      // Each table must keep its own catalogue type or a mixed layout collapses
      // into one shape during refinement.
      const type = typeById.get(layout.tables[i]?.catalogueId ?? '') ?? tLocalFallbackType!;
      return makePlacedTable(type, occupiedFootprint(type, req.rules), p.xM, p.yM, layout.tables[i]?.rotationDeg ?? 0);
    });
    if (placed.length !== target) {
      return layout;
    }
    const climbed = hillClimbLayout(placed, req, zones, insideFn, Date.now() + 200, undefined, 1);
    if (
      !validateTables(req, climbed, zones, insideFn, debugStats) ||
      climbed.length !== target ||
      (mixQuota && !matchesMixQuota(climbed, mixQuota))
    ) {
      return layout;
    }
    return { ...materializeLayout(req, layout.family, climbed, req.generation.seed, facing), id: layout.id, name: layout.name };
  });
  timings.localOptimisationMs = Date.now() - tLocal;
  suggestionDebug.finalSuggestions = refinedLayouts.length;
  if (refinedLayouts.length > 0) {
    return finish(refinedLayouts, 'EXACT_FOUND', Math.max(bestPartialCount, refinedLayouts[0]?.tableCount ?? 0), {
      feasible: true,
      validated: target,
    });
  }
  const kind: import('./types.ts').DiningGenerationFailureKind = 'NOT_FOUND_YET';
  return finish(layouts, kind, bestPartialCount, { feasible: 'unknown', validated: 0 });
}

function regionCounts(
  pool: PlacedTable[],
  req: GenerateDiningLayoutsRequest,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const region of STAGE_REGIONS) {
    counts[region] = 0;
  }
  for (const table of pool) {
    const region = classifyStageRegion(table.xM, table.yM, req);
    counts[region] = (counts[region] ?? 0) + 1;
  }
  return counts;
}

function generatedTablePoints(
  layout: GeneratedDiningLayout,
  req: GenerateDiningLayoutsRequest,
): { xM: number; yM: number }[] {
  return layout.tables.map((table) => ({
    xM: (table.xPct / 100) * req.block.widthM,
    yM: (table.yPct / 100) * req.block.depthM,
  }));
}

function pickDiverse(
  valid: GeneratedDiningLayout[],
  want: number,
  req: GenerateDiningLayoutsRequest,
): GeneratedDiningLayout[] {
  const sorted = [...valid].sort(
    (a, b) => b.score - a.score || a.fingerprint.localeCompare(b.fingerprint),
  );
  const selected: GeneratedDiningLayout[] = [];
  const farEnough = (layout: GeneratedDiningLayout, min: number) =>
    selected.every(
      (existing) =>
        layoutDistance(
          generatedTablePoints(existing, req),
          generatedTablePoints(layout, req),
          req,
          existing.aisles.map((a) => a.kind).join(','),
          layout.aisles.map((a) => a.kind).join(','),
        ) >= min,
    );

  for (const layout of sorted) {
    if (selected.length >= want) {
      break;
    }
    if (selected.length === 0 || farEnough(layout, DIVERSITY_CONFIG.minDistance)) {
      selected.push(layout);
    }
  }
  if (selected.length < want) {
    for (const layout of sorted) {
      if (selected.length >= want) {
        break;
      }
      if (selected.includes(layout)) {
        continue;
      }
      if (farEnough(layout, DIVERSITY_CONFIG.relaxedDistance)) {
        selected.push(layout);
      }
    }
  }
  return selected;
}

function nameLayouts(layouts: GeneratedDiningLayout[]): GeneratedDiningLayout[] {
  const familyCount = new Map<string, number>();
  for (const layout of layouts) {
    familyCount.set(layout.family, (familyCount.get(layout.family) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return layouts.map((layout) => {
    const n = (seen.get(layout.family) ?? 0) + 1;
    seen.set(layout.family, n);
    const base = FAMILY_DISPLAY[layout.family]?.name ?? layout.name;
    const suffix = (familyCount.get(layout.family) ?? 0) > 1 ? ` ${String.fromCharCode(64 + n)}` : '';
    return { ...layout, name: `${base}${suffix}` };
  });
}
