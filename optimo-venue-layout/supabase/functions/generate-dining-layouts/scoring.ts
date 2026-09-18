import { SCORE_WEIGHTS } from './types.ts';
import type {
  AisleBand,
  DiningLayoutMetrics,
  GenerateDiningLayoutsRequest,
  PlacedTable,
} from './types.ts';
import { clamp } from './geometry.ts';
import { regionEntropyScore } from './stage-regions.ts';

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function scoreLayout(
  tables: PlacedTable[],
  aisles: AisleBand[],
  req: GenerateDiningLayoutsRequest,
): DiningLayoutMetrics {
  const w = req.block.widthM;
  const d = req.block.depthM;
  const area = Math.max(0.1, w * d);
  const occupied = tables.reduce((s, t) => s + t.physicalHalfWidthM * t.physicalHalfDepthM * 4, 0);
  const seats = tables.reduce((s, t) => s + t.type.capacity, 0);
  const targetSeats =
    req.target.tableCount != null
      ? req.target.tableCount * (tables[0]?.type.capacity ?? 0)
      : (req.target.targetCapacity ?? seats);

  const capacityEfficiency = clamp(
    targetSeats <= 0 ? 0 : (seats / targetSeats) * 100,
    0,
    100,
  );
  const spaceUtilisation = clamp((occupied / area) * 180, 8, 100);

  const entrance = req.accessPoints.entrances[0];
  const exitPt = req.accessPoints.exits[0] ?? req.accessPoints.emergencyExits?.[0] ?? entrance;
  let corridorPenalty = 0;
  if (entrance && tables.length) {
    for (const t of tables) {
      const toEntrance = Math.hypot(t.xM - entrance.xM, t.yM - entrance.yM);
      if (toEntrance < 1.2 + t.physicalHalfWidthM) {
        corridorPenalty += 12;
      }
    }
  }
  let pathClear = 70;
  if (entrance && exitPt && tables.length) {
    const dx = exitPt.xM - entrance.xM;
    const dy = exitPt.yM - entrance.yM;
    const len = Math.max(0.01, Math.hypot(dx, dy));
    let blocked = 0;
    for (const t of tables) {
      const tdx = t.xM - entrance.xM;
      const tdy = t.yM - entrance.yM;
      const along = (tdx * dx + tdy * dy) / (len * len);
      if (along <= 0 || along >= 1) {
        continue;
      }
      const px = entrance.xM + along * dx;
      const py = entrance.yM + along * dy;
      const dist = Math.hypot(t.xM - px, t.yM - py);
      if (dist < t.physicalHalfWidthM + 0.45) {
        blocked += 1;
      }
    }
    pathClear = clamp(88 - blocked * 14, 20, 100);
  }
  const circulationQuality = clamp(pathClear - corridorPenalty * 0.4, 15, 100);
  const guestFlow = clamp(
    0.55 * circulationQuality + 0.45 * (40 + aisles.filter((a) => a.kind !== 'waiter').length * 22),
    15,
    100,
  );

  let service = 40 + aisles.filter((a) => a.kind === 'waiter').length * 18;
  const food = req.features.foodPrep;
  if (food && tables.length) {
    const meanDist =
      tables.reduce((s, t) => s + Math.hypot(t.xM - food.xM, t.yM - food.yM), 0) / tables.length;
    const roomDiag = Math.hypot(w, d);
    service += clamp(32 - (meanDist / Math.max(0.1, roomDiag)) * 40, 4, 32);
  } else {
    service += food ? 12 : 8;
  }
  const serviceEfficiency = clamp(service, 15, 100);

  const facing = req.stageFacingAngleDeg ?? 0;
  let orient = 55;
  if (req.features.stage && tables.length) {
    const diffs = tables.map((t) => {
      let delta = Math.abs(((t.rotationDeg - facing + 540) % 360) - 180);
      delta = Math.min(delta, 360 - delta);
      return 100 - Math.min(100, delta);
    });
    orient = mean(diffs);
  }
  const stageOrientation = clamp(orient, 0, 100);

  const xs = tables.map((t) => t.xM);
  const ys = tables.map((t) => t.yM);
  const midX = w / 2;
  const left = xs.filter((x) => x < midX).length;
  const right = xs.length - left;
  const symmetry = tables.length
    ? clamp(100 - (Math.abs(left - right) / tables.length) * 120, 20, 100)
    : 0;

  const spreadX = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const spreadY = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const spreadScore = (spreadX / w) * 50 + (spreadY / d) * 50;
  const regionScore = regionEntropyScore(tables, req);
  const distributionQuality = clamp(spreadScore * 0.55 + regionScore * 0.45, 10, 100);

  return {
    capacityEfficiency,
    spaceUtilisation,
    guestFlow,
    serviceEfficiency,
    stageOrientation,
    symmetry,
    distributionQuality,
    circulationQuality,
  };
}

export function overallScore(metrics: DiningLayoutMetrics): number {
  const raw =
    metrics.capacityEfficiency * SCORE_WEIGHTS.capacityEfficiency +
    metrics.spaceUtilisation * SCORE_WEIGHTS.spaceUtilisation +
    metrics.guestFlow * SCORE_WEIGHTS.guestFlow +
    metrics.serviceEfficiency * SCORE_WEIGHTS.serviceEfficiency +
    metrics.stageOrientation * SCORE_WEIGHTS.stageOrientation +
    metrics.symmetry * SCORE_WEIGHTS.symmetry +
    metrics.distributionQuality * SCORE_WEIGHTS.distributionQuality;
  return Math.round(raw * 10) / 10;
}

export function qualitative(score: number): 'Good' | 'Fair' | 'Limited' {
  if (score >= 70) {
    return 'Good';
  }
  if (score >= 45) {
    return 'Fair';
  }
  return 'Limited';
}
