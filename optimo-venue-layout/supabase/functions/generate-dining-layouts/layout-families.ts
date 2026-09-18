import { circleInsidePolygon, rectInsidePolygon, rotatedRectAabb } from './geometry.ts';
import { makePlacedTable, occupiedFootprint } from './rules.ts';
import type { ForbiddenZone } from './forbidden.ts';
import { tableHitsForbidden, tablesOverlap } from './validator.ts';
import { stageOccupiesCentre } from './stage-regions.ts';
import type {
  AisleBand,
  DiningLayoutFamily,
  DiningLayoutRules,
  DiningTableType,
  GenerateDiningLayoutsRequest,
  PlacedTable,
  PointM,
} from './types.ts';

export interface FamilyContext {
  req: GenerateDiningLayoutsRequest;
  rules: DiningLayoutRules;
  polygon: PointM[];
  zones: ForbiddenZone[];
  type: DiningTableType;
  footprint: ReturnType<typeof occupiedFootprint>;
  rng: () => number;
  facingDeg: number;
}

export interface FamilyResult {
  family: DiningLayoutFamily;
  tables: PlacedTable[];
  aisles: AisleBand[];
}

function tryPlace(
  ctx: FamilyContext,
  x: number,
  y: number,
  rot: number,
  placed: PlacedTable[],
): PlacedTable | null {
  const collisionRot = ctx.type.shape === 'round' ? 0 : rot;
  const t = makePlacedTable(ctx.type, ctx.footprint, x, y, collisionRot);
  const inside =
    ctx.type.shape === 'round'
      ? circleInsidePolygon(x, y, t.physicalHalfWidthM, ctx.polygon, ctx.rules.wallClearanceM)
      : rectInsidePolygon(x, y, t.physicalHalfWidthM, t.physicalHalfDepthM, collisionRot, ctx.polygon, ctx.rules.wallClearanceM);
  if (!inside) {
    return null;
  }
  if (tableHitsForbidden(t, ctx.zones)) {
    return null;
  }
  for (const p of placed) {
    if (tablesOverlap(t, p)) {
      return null;
    }
  }
  return t;
}

function packLattice(
  ctx: FamilyContext,
  opts: {
    stagger: boolean;
    skipU?: { from: number; to: number }[];
    skipV?: { from: number; to: number }[];
    originJitterM?: number;
    pitchScale?: number;
    openCentreR?: number;
    perimeterOnly?: boolean;
    clusterGap?: number;
  },
): PlacedTable[] {
  const pitchU = ctx.footprint.spacingHalfWidthM * 2 * (opts.pitchScale ?? 1);
  const pitchV = ctx.footprint.spacingHalfDepthM * 2 * (opts.pitchScale ?? 1);
  const phyW = ctx.footprint.physicalHalfWidthM;
  const phyD = ctx.footprint.physicalHalfDepthM;
  const w = ctx.req.block.widthM;
  const d = ctx.req.block.depthM;
  const jitter = opts.originJitterM ?? 0;
  const wall = ctx.rules.wallClearanceM;
  const u0 = phyW + wall + Math.max(0, jitter);
  const v0 = phyD + wall + Math.max(0, jitter);
  const placed: PlacedTable[] = [];
  const target = ctx.req.target.tableCount ?? 40;
  const cx = w / 2;
  const cy = d / 2;
  const rot = ctx.facingDeg;

  const inSkip = (bands: { from: number; to: number }[] | undefined, v: number) =>
    (bands ?? []).some((b) => v >= b.from && v <= b.to);

  const nudge = Math.max(0.18, Math.min(pitchU, pitchV) * 0.12);
  let row = 0;
  for (let v = v0; v <= d - phyD - wall && placed.length < target + 8; ) {
    if (inSkip(opts.skipV, v)) {
      v += nudge;
      continue;
    }
    const stagger = opts.stagger && row % 2 === 1 ? pitchU / 2 : 0;
    const before = placed.length;
    for (let u = u0 + stagger; u <= w - phyW - wall && placed.length < target + 8; ) {
      if (inSkip(opts.skipU, u)) {
        u += nudge;
        continue;
      }
      if (opts.openCentreR && Math.hypot(u - cx, v - cy) < opts.openCentreR) {
        u += nudge;
        continue;
      }
      if (opts.perimeterOnly) {
        const edge = Math.min(u, v, w - u, d - v);
        if (edge > Math.max(phyW, phyD) * 2.4 + ctx.rules.wallClearanceM) {
          u += nudge;
          continue;
        }
      }
      const t = tryPlace(ctx, u, v, rot, placed);
      if (t) {
        placed.push(t);
        if (placed.length >= target) {
          return placed;
        }
        u += pitchU;
      } else {
        u += nudge;
      }
    }
    if (placed.length === before) {
      v += nudge;
    } else {
      v += pitchV;
      row += 1;
    }
  }
  return placed;
}

function packToTarget(
  ctx: FamilyContext,
  opts: Parameters<typeof packLattice>[1],
): PlacedTable[] {
  const target = ctx.req.target.tableCount;
  const dense = packLattice(ctx, { ...opts, originJitterM: 0, pitchScale: 1 });
  const base = target != null && dense.length < target
    ? (() => {
      const retry = packLattice(ctx, opts);
      return retry.length > dense.length ? retry : dense;
    })()
    : dense;
  if (target == null || base.length >= target) {
    return base;
  }
  return fillLeftovers(ctx, base, target);
}

/** Scan leftover pockets after the lattice so corners beside Stage / Food Prep are used. */
function fillLeftovers(
  ctx: FamilyContext,
  placed: PlacedTable[],
  target: number,
): PlacedTable[] {
  const next = [...placed];
  const phyW = ctx.footprint.physicalHalfWidthM;
  const phyD = ctx.footprint.physicalHalfDepthM;
  const wall = ctx.rules.wallClearanceM;
  const w = ctx.req.block.widthM;
  const d = ctx.req.block.depthM;
  const rot = ctx.type.shape === 'round' ? 0 : ctx.facingDeg;
  const step = Math.max(0.22, Math.min(ctx.footprint.spacingHalfWidthM, ctx.footprint.spacingHalfDepthM) * 0.28);
  for (let v = phyD + wall; v <= d - phyD - wall && next.length < target; v += step) {
    for (let u = phyW + wall; u <= w - phyW - wall && next.length < target; u += step) {
      const t = tryPlace(ctx, u, v, rot, next);
      if (t) {
        next.push(t);
      }
    }
  }
  return next;
}

function skipInFrontOfStage(
  ctx: FamilyContext,
): { skipU?: { from: number; to: number }[]; skipV?: { from: number; to: number }[] } {
  const stage = ctx.req.features.stage;
  if (!stage) {
    return {};
  }
  const guest = ctx.rules.guestAisleWidthM;
  const hw = ctx.footprint.physicalHalfWidthM;
  const hd = ctx.footprint.physicalHalfDepthM;
  const w = ctx.req.block.widthM;
  const d = ctx.req.block.depthM;
  const box = rotatedRectAabb(
    stage.xM,
    stage.yM,
    stage.widthM / 2,
    stage.depthM / 2,
    stage.rotationDeg ?? 0,
  );
  const distTop = box.minY;
  const distBottom = d - box.maxY;
  const distLeft = box.minX;
  const distRight = w - box.maxX;
  const nearest = Math.min(distTop, distBottom, distLeft, distRight);
  if (nearest === distTop) {
    return { skipV: [{ from: box.maxY, to: box.maxY + guest + hd }] };
  }
  if (nearest === distBottom) {
    return { skipV: [{ from: box.minY - guest - hd, to: box.minY }] };
  }
  if (nearest === distLeft) {
    return { skipU: [{ from: box.maxX, to: box.maxX + guest + hw }] };
  }
  return { skipU: [{ from: box.minX - guest - hw, to: box.minX }] };
}

function verticalAisle(req: GenerateDiningLayoutsRequest, xM: number, widthM: number): AisleBand {
  return {
    kind: 'main-guest',
    xM,
    yM: req.block.depthM / 2,
    widthM,
    depthM: req.block.depthM,
    rotationDeg: 0,
  };
}

export function generateFamily(ctx: FamilyContext, family: DiningLayoutFamily): FamilyResult {
  const rng = ctx.rng;
  const jitter = (rng() - 0.5) * 0.28;
  const pitchScale = 1 + rng() * 0.08;
  const w = ctx.req.block.widthM;
  const d = ctx.req.block.depthM;
  const main = ctx.rules.mainGuestAisleWidthM;
  const guest = ctx.rules.guestAisleWidthM;
  const hw = ctx.footprint.physicalHalfWidthM;
  const aisleSkip = (x: number, width: number) => ({
    from: x - width / 2 - hw,
    to: x + width / 2 + hw,
  });

  switch (family) {
    case 'regular-grid':
      return {
        family,
        tables: packToTarget(ctx, { stagger: false, originJitterM: jitter, pitchScale }),
        aisles: [],
      };
    case 'staggered':
      return {
        family,
        tables: packToTarget(ctx, { stagger: true, originJitterM: jitter, pitchScale }),
        aisles: [],
      };
    case 'central-aisle': {
      const x = w / 2 + (rng() - 0.5) * w * 0.12;
      const aisle = verticalAisle(ctx.req, x, main);
      return {
        family,
        tables: packToTarget(ctx, {
          stagger: rng() > 0.5,
          originJitterM: jitter,
          pitchScale,
          skipU: [aisleSkip(x, main)],
        }),
        aisles: [aisle],
      };
    }
    case 'twin-aisle': {
      const x1 = w * (0.33 + (rng() - 0.5) * 0.06);
      const x2 = w * (0.67 + (rng() - 0.5) * 0.06);
      return {
        family,
        tables: packToTarget(ctx, {
          stagger: false,
          originJitterM: jitter,
          pitchScale,
          skipU: [aisleSkip(x1, guest), aisleSkip(x2, guest)],
        }),
        aisles: [verticalAisle(ctx.req, x1, guest), verticalAisle(ctx.req, x2, guest)],
      };
    }
    case 'stage-facing': {
      const skip = skipInFrontOfStage(ctx);
      const aisleY =
        skip.skipV && skip.skipV[0]
          ? (skip.skipV[0].from + skip.skipV[0].to) / 2
          : d * 0.22;
      const aisleX =
        skip.skipU && skip.skipU[0]
          ? (skip.skipU[0].from + skip.skipU[0].to) / 2
          : w / 2;
      const aisleVertical = Boolean(skip.skipU?.length);
      return {
        family,
        tables: packToTarget(ctx, {
          stagger: true,
          originJitterM: jitter,
          pitchScale: 1,
          skipU: skip.skipU,
          skipV: skip.skipV,
        }),
        aisles: [
          aisleVertical
            ? {
                kind: 'guest',
                xM: aisleX,
                yM: d / 2,
                widthM: guest,
                depthM: d * 0.7,
                rotationDeg: 0,
              }
            : {
                kind: 'guest',
                xM: w / 2,
                yM: aisleY,
                widthM: w * 0.7,
                depthM: guest,
                rotationDeg: 0,
              },
        ],
      };
    }
    case 'perimeter':
      return {
        family,
        tables: packToTarget(ctx, {
          stagger: false,
          originJitterM: jitter,
          pitchScale,
          perimeterOnly: true,
        }),
        aisles: [],
      };
    case 'banquet-open-centre':
      return {
        family,
        tables: packToTarget(ctx, {
          stagger: rng() > 0.45,
          originJitterM: jitter,
          pitchScale,
          openCentreR: Math.min(w, d) * (0.18 + rng() * 0.08),
        }),
        aisles: [],
      };
    case 'clustered':
      return {
        family,
        tables: packToTarget(ctx, {
          stagger: true,
          originJitterM: jitter * 1.4,
          pitchScale: pitchScale * 1.12,
          skipU: [aisleSkip(w / 2, ctx.rules.waiterAisleWidthM)],
        }),
        aisles: [verticalAisle(ctx.req, w / 2, ctx.rules.waiterAisleWidthM)],
      };
    case 'mixed-table':
      return {
        family,
        tables: packToTarget(ctx, {
          stagger: rng() > 0.4,
          originJitterM: jitter,
          pitchScale: pitchScale * 1.06,
        }),
        aisles: [],
      };
    case 'service-zone-balanced': {
      const food = ctx.req.features.foodPrep;
      const aisleX = food ? food.xM : w * 0.75;
      return {
        family,
        tables: packToTarget(ctx, {
          stagger: true,
          originJitterM: jitter,
          pitchScale,
          skipU: [aisleSkip(aisleX, ctx.rules.waiterAisleWidthM)],
        }),
        aisles: [
          {
            kind: 'waiter',
            xM: aisleX,
            yM: d / 2,
            widthM: ctx.rules.waiterAisleWidthM,
            depthM: d,
            rotationDeg: 0,
          },
        ],
      };
    }
    case 'balanced-around-stage':
      return {
        family,
        tables: packToTarget(ctx, { stagger: true, originJitterM: jitter, pitchScale }),
        aisles: [],
      };
    case 'split-sides': {
      const aisle = verticalAisle(ctx.req, w / 2, main);
      return {
        family,
        tables: packToTarget(ctx, {
          stagger: false,
          originJitterM: jitter,
          pitchScale,
          skipU: [aisleSkip(w / 2, main)],
        }),
        aisles: [aisle],
      };
    }
    default:
      return { family: 'regular-grid', tables: packToTarget(ctx, { stagger: false }), aisles: [] };
  }
}

export const ALL_FAMILIES: DiningLayoutFamily[] = [
  'balanced-around-stage',
  'stage-facing',
  'split-sides',
  'perimeter',
  'service-zone-balanced',
  'staggered',
  'central-aisle',
  'twin-aisle',
  'clustered',
  'mixed-table',
  'regular-grid',
  'banquet-open-centre',
];

export function eligibleFamilies(req: GenerateDiningLayoutsRequest): DiningLayoutFamily[] {
  if (stageOccupiesCentre(req)) {
    return ALL_FAMILIES.filter((family) => family !== 'banquet-open-centre');
  }
  return [...ALL_FAMILIES];
}

export { stageOccupiesCentre };
