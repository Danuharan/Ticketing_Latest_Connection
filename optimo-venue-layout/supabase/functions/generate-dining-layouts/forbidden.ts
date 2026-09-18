import { expandAabb, polygonAabb, rotatedRectAabb } from './geometry.ts';
import type { AabbM, DiningLayoutRules, GenerateDiningLayoutsRequest, PointM } from './types.ts';

export interface ForbiddenZone {
  id: string;
  aabb: AabbM;
  polygon?: PointM[];
}

export function buildForbiddenZones(req: GenerateDiningLayoutsRequest, rules: DiningLayoutRules): ForbiddenZone[] {
  const zones: ForbiddenZone[] = [];
  const stage = req.features.stage;
  if (stage) {
    // Stage buffer is rules.stageClearanceM only. Table-to-table gap is never added here.
    // Directional front/rear/side fields are reserved; uniform clearance is used until they are set.
    const stagePad = rules.stageClearanceM;
    zones.push({
      id: 'stage',
      aabb: expandAabb(
        rotatedRectAabb(stage.xM, stage.yM, stage.widthM / 2, stage.depthM / 2, stage.rotationDeg ?? 0),
        stagePad,
      ),
    });
  }
  const food = req.features.foodPrep;
  if (food) {
    zones.push({
      id: 'food-prep',
      aabb: expandAabb(
        rotatedRectAabb(food.xM, food.yM, food.widthM / 2, food.depthM / 2, food.rotationDeg ?? 0),
        rules.foodPrepClearanceM,
      ),
    });
  }
  for (const ap of req.accessPoints.entrances) {
    zones.push({
      id: `entrance:${ap.id ?? 'main'}`,
      aabb: expandAabb(
        rotatedRectAabb(ap.xM, ap.yM, ap.widthM / 2, Math.max(ap.depthM, 0.4) / 2, ap.rotationDeg ?? 0),
        rules.entranceClearanceM,
      ),
    });
  }
  for (const ap of [...req.accessPoints.exits, ...(req.accessPoints.emergencyExits ?? [])]) {
    zones.push({
      id: `exit:${ap.id ?? ap.kind}`,
      aabb: expandAabb(
        rotatedRectAabb(ap.xM, ap.yM, ap.widthM / 2, Math.max(ap.depthM, 0.4) / 2, ap.rotationDeg ?? 0),
        rules.exitClearanceM,
      ),
    });
  }
  for (const obs of req.features.obstacles ?? []) {
    if (obs.polygon.length < 3) {
      continue;
    }
    zones.push({
      id: 'obstacle',
      aabb: expandAabb(polygonAabb(obs.polygon), rules.obstacleClearanceM),
      polygon: obs.polygon,
    });
  }
  for (const ex of req.features.exclusionZones ?? []) {
    if (ex.polygon.length < 3) {
      continue;
    }
    zones.push({
      id: 'exclusion',
      aabb: polygonAabb(ex.polygon),
      polygon: ex.polygon,
    });
  }
  return zones;
}
