import { rotatedRectAabb } from './geometry.ts';
import type { GenerateDiningLayoutsRequest, PlacedTable, RectFeatureInput } from './types.ts';

export const STAGE_REGIONS = [
  'TOP',
  'BOTTOM',
  'LEFT',
  'RIGHT',
  'TOP_LEFT',
  'TOP_RIGHT',
  'BOTTOM_LEFT',
  'BOTTOM_RIGHT',
] as const;

export type StageRegion = (typeof STAGE_REGIONS)[number];

export function stageOccupiesCentre(req: GenerateDiningLayoutsRequest): boolean {
  const stage = req.features.stage;
  if (!stage) {
    return false;
  }
  const cx = req.block.widthM / 2;
  const cy = req.block.depthM / 2;
  const box = rotatedRectAabb(
    stage.xM,
    stage.yM,
    stage.widthM / 2,
    stage.depthM / 2,
    stage.rotationDeg ?? 0,
  );
  const containsCentre = box.minX <= cx && box.maxX >= cx && box.minY <= cy && box.maxY >= cy;
  const dist = Math.hypot(stage.xM - cx, stage.yM - cy);
  return containsCentre || dist < Math.min(req.block.widthM, req.block.depthM) * 0.22;
}

export function classifyStageRegion(
  xM: number,
  yM: number,
  req: GenerateDiningLayoutsRequest,
): StageRegion {
  const origin = regionOrigin(req);
  const dx = xM - origin.x;
  const dy = yM - origin.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < 1e-6 && ay < 1e-6) {
    return 'TOP';
  }
  if (ay > ax * 1.25) {
    return dy < 0 ? 'TOP' : 'BOTTOM';
  }
  if (ax > ay * 1.25) {
    return dx < 0 ? 'LEFT' : 'RIGHT';
  }
  return `${dy < 0 ? 'TOP' : 'BOTTOM'}_${dx < 0 ? 'LEFT' : 'RIGHT'}` as StageRegion;
}

export function classifyTables(
  tables: PlacedTable[],
  req: GenerateDiningLayoutsRequest,
): StageRegion[] {
  return tables.map((table) => classifyStageRegion(table.xM, table.yM, req));
}

export function regionOccupancyKey(
  tables: PlacedTable[],
  req: GenerateDiningLayoutsRequest,
): string {
  const counts = emptyRegionCounts();
  for (const table of tables) {
    counts[classifyStageRegion(table.xM, table.yM, req)] += 1;
  }
  return STAGE_REGIONS.map((region) => `${region[0]}${counts[region]}`).join('');
}

export function occupiedRegionSet(
  tables: PlacedTable[],
  req: GenerateDiningLayoutsRequest,
): Set<StageRegion> {
  const set = new Set<StageRegion>();
  for (const table of tables) {
    set.add(classifyStageRegion(table.xM, table.yM, req));
  }
  return set;
}

export function regionEntropyScore(
  tables: PlacedTable[],
  req: GenerateDiningLayoutsRequest,
): number {
  if (tables.length === 0) {
    return 0;
  }
  const counts = emptyRegionCounts();
  for (const table of tables) {
    counts[classifyStageRegion(table.xM, table.yM, req)] += 1;
  }
  const used = STAGE_REGIONS.filter((region) => counts[region] > 0).length;
  const cardinal =
    (counts.TOP > 0 ? 1 : 0) +
    (counts.BOTTOM > 0 ? 1 : 0) +
    (counts.LEFT > 0 ? 1 : 0) +
    (counts.RIGHT > 0 ? 1 : 0);
  return Math.min(100, used * 10 + cardinal * 12 + (used > 1 ? 20 : 0));
}

/** Audience / front of stage, based on facing (0 = −Y / up). */
export function audienceRegion(req: GenerateDiningLayoutsRequest): StageRegion {
  const facing = req.stageFacingAngleDeg ?? 0;
  const rad = (facing * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy < 0 ? 'TOP' : 'BOTTOM';
  }
  return dx < 0 ? 'LEFT' : 'RIGHT';
}

export function splitSideRegions(req: GenerateDiningLayoutsRequest): StageRegion[] {
  const front = audienceRegion(req);
  if (front === 'TOP' || front === 'BOTTOM') {
    return ['LEFT', 'RIGHT'];
  }
  return ['TOP', 'BOTTOM'];
}

export function oppositeRegion(region: StageRegion): StageRegion {
  if (region === 'TOP') {
    return 'BOTTOM';
  }
  if (region === 'BOTTOM') {
    return 'TOP';
  }
  if (region === 'LEFT') {
    return 'RIGHT';
  }
  if (region === 'RIGHT') {
    return 'LEFT';
  }
  if (region === 'TOP_LEFT') {
    return 'BOTTOM_RIGHT';
  }
  if (region === 'TOP_RIGHT') {
    return 'BOTTOM_LEFT';
  }
  if (region === 'BOTTOM_LEFT') {
    return 'TOP_RIGHT';
  }
  return 'TOP_LEFT';
}

function regionOrigin(req: GenerateDiningLayoutsRequest): { x: number; y: number } {
  const stage: RectFeatureInput | undefined = req.features.stage;
  if (stage) {
    return { x: stage.xM, y: stage.yM };
  }
  return { x: req.block.widthM / 2, y: req.block.depthM / 2 };
}

function emptyRegionCounts(): Record<StageRegion, number> {
  return {
    TOP: 0,
    BOTTOM: 0,
    LEFT: 0,
    RIGHT: 0,
    TOP_LEFT: 0,
    TOP_RIGHT: 0,
    BOTTOM_LEFT: 0,
    BOTTOM_RIGHT: 0,
  };
}
