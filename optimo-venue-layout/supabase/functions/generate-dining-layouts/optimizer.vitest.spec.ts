import { describe, expect, it } from 'vitest';

import {
  GENERATOR_VERSION,
  computeOperationalCapacity,
  enumerateValidTablePositions,
  generateDiningLayouts,
} from './candidate-generator';
import { DIVERSITY_CONFIG, fingerprintLayout, isNearDuplicate } from './fingerprint';
import { buildForbiddenZones } from './forbidden';
import { circleInsidePolygon, circlesSeparated, orientedRectsOverlap } from './geometry';
import { occupiedFootprint, makePlacedTable } from './rules';
import { DEFAULT_DINING_LAYOUT_RULES, type GenerateDiningLayoutsRequest } from './types';
import { tableHitsForbidden, tablesOverlap } from './validator';

function rules() {
  return { ...DEFAULT_DINING_LAYOUT_RULES };
}

function roundType(widthM: number, chairDepthM = 0.5, chairWidthM = 0.4) {
  return {
    id: 'round',
    name: 'Round',
    shape: 'round' as const,
    widthM,
    depthM: widthM,
    capacity: 3,
    chairWidthM,
    chairDepthM,
    allowed: true,
  };
}

function roomRequest(opts: {
  widthM: number;
  depthM: number;
  tableM: number;
  chairDepthM?: number;
  chairWidthM?: number;
  gapM?: number;
  stage?: boolean;
  access?: boolean;
  seed?: number;
  mode?: 'capacity' | 'generate';
  tableCount?: number;
}): GenerateDiningLayoutsRequest {
  const widthM = opts.widthM;
  const depthM = opts.depthM;
  const type = roundType(opts.tableM, opts.chairDepthM ?? 0.5, opts.chairWidthM ?? 0.4);
  return {
    block: {
      id: 'r',
      polygon: [
        { x: 0, y: 0 },
        { x: widthM, y: 0 },
        { x: widthM, y: depthM },
        { x: 0, y: depthM },
      ],
      widthM,
      depthM,
    },
    accessPoints: opts.access
      ? {
          entrances: [{ kind: 'entrance', xM: widthM / 2, yM: 0.25, widthM: 1.5, depthM: 0.5 }],
          exits: [{ kind: 'exit', xM: widthM / 2, yM: depthM - 0.25, widthM: 1.5, depthM: 0.5 }],
          emergencyExits: [],
        }
      : { entrances: [], exits: [], emergencyExits: [] },
    features: opts.stage
      ? { stage: { xM: widthM / 2, yM: depthM / 2, widthM: 3.3, depthM: 0.9, rotationDeg: 0 } }
      : {},
    tableCatalogue: [type],
    target: opts.tableCount != null ? { tableCount: opts.tableCount, targetCapacity: opts.tableCount * type.capacity } : {},
    rules: { ...rules(), minimumTableToTableClearanceM: opts.gapM ?? 0.6 },
    generation: {
      suggestionCount: 6,
      seed: opts.seed ?? 17,
      candidateLimit: 64,
      timeBudgetMs: 2500,
      mode: opts.mode ?? 'capacity',
    },
    stageFacingAngleDeg: 0,
  };
}

describe('next-level dining optimiser geometry', () => {
  it('uses circle geometry for round table ↔ round table', () => {
    const type = roundType(0.6);
    const fp = occupiedFootprint(type, rules());
    const pitch = fp.spacingHalfWidthM * 2;
    const a = makePlacedTable(type, fp, 2, 2, 0);
    const diagonal = makePlacedTable(type, fp, 2 + pitch * 0.72, 2 + pitch * 0.72, 0);
    expect(tablesOverlap(a, makePlacedTable(type, fp, 2 + pitch - 0.02, 2, 0))).toBe(true);
    expect(tablesOverlap(a, makePlacedTable(type, fp, 2 + pitch + 0.02, 2, 0))).toBe(false);
    expect(circlesSeparated(a.xM, a.yM, fp.physicalHalfWidthM, diagonal.xM, diagonal.yM, fp.physicalHalfWidthM, 0.6)).toBe(true);
    expect(tablesOverlap(a, diagonal)).toBe(false);
  });

  it('applies table gap only between tables, not walls or Stage', () => {
    const type = roundType(0.6);
    const tight = occupiedFootprint(type, { ...rules(), minimumTableToTableClearanceM: 0.2 });
    const wide = occupiedFootprint(type, { ...rules(), minimumTableToTableClearanceM: 1.2 });
    expect(tight.physicalHalfWidthM).toBeCloseTo(wide.physicalHalfWidthM, 6);
    expect(wide.spacingHalfWidthM).toBeGreaterThan(tight.spacingHalfWidthM);
    const req = roomRequest({ widthM: 8, depthM: 8, tableM: 0.6, gapM: 1.2, stage: true, mode: 'capacity' });
    const zones = buildForbiddenZones(req, req.rules);
    const table = makePlacedTable(type, wide, 1.2, 1.2, 0);
    expect(tableHitsForbidden(table, zones.filter((z) => z.id !== 'stage'))).toBe(false);
  });

  it('keeps Stage clearance independent of table gap', () => {
    const reqA = roomRequest({ widthM: 8, depthM: 8, tableM: 0.6, gapM: 0.2, stage: true });
    const reqB = roomRequest({ widthM: 8, depthM: 8, tableM: 0.6, gapM: 1.4, stage: true });
    const a = buildForbiddenZones(reqA, reqA.rules).find((z) => z.id === 'stage')!;
    const b = buildForbiddenZones(reqB, reqB.rules).find((z) => z.id === 'stage')!;
    expect(a.aabb.minX).toBeCloseTo(b.aabb.minX, 6);
    expect(a.aabb.maxX).toBeCloseTo(b.aabb.maxX, 6);
  });

  it('keeps wall clearance independent of table gap', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ];
    expect(circleInsidePolygon(0.95, 2.5, 0.55, poly, 0.4)).toBe(true);
    expect(circleInsidePolygon(0.7, 2.5, 0.55, poly, 0.4)).toBe(false);
  });

  it('creates Stage-adjacent candidates on all valid sides', () => {
    const req = roomRequest({ widthM: 8, depthM: 10, tableM: 0.6, stage: true, mode: 'capacity' });
    const fp = occupiedFootprint(req.tableCatalogue[0]!, req.rules);
    const insideFn = (t: ReturnType<typeof makePlacedTable>) =>
      circleInsidePolygon(t.xM, t.yM, t.physicalHalfWidthM, req.block.polygon, req.rules.wallClearanceM);
    const pool = enumerateValidTablePositions(
      req,
      fp,
      0,
      insideFn,
      buildForbiddenZones(req, req.rules),
      [],
      req.tableCatalogue[0]!,
      undefined,
      800,
    );
    const stage = req.features.stage!;
    const top = pool.filter((t) => t.yM < stage.yM - 0.6).length;
    const bottom = pool.filter((t) => t.yM > stage.yM + 0.6).length;
    const left = pool.filter((t) => t.xM < stage.xM - 0.6).length;
    const right = pool.filter((t) => t.xM > stage.xM + 0.6).length;
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeGreaterThan(0);
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    expect(pool.length).toBeGreaterThan(40);
  });

  it('hex/staggered round packing admits diagonal neighbours the old square AABB rejected', () => {
    const type = roundType(1.05);
    const fp = occupiedFootprint(type, { ...rules(), minimumTableToTableClearanceM: 0.6 });
    const pitch = fp.spacingHalfWidthM * 2;
    const a = makePlacedTable(type, fp, 3, 3, 0);
    const hex = makePlacedTable(type, fp, 3 + pitch / 2, 3 + pitch * Math.sqrt(3) / 2, 0);
    expect(tablesOverlap(a, hex)).toBe(false);
  });

  it('validates rotated rectangular tables with oriented geometry', () => {
    expect(
      orientedRectsOverlap(2, 2, 0.8, 0.4, 0, 3.1, 2, 0.8, 0.4, 0),
    ).toBe(true);
    expect(
      orientedRectsOverlap(2, 2, 0.8, 0.4, 90, 3.7, 2, 0.8, 0.4, 0),
    ).toBe(false);
  });
});

describe('next-level optimiser search behaviour', { timeout: 20000 }, () => {
  it('is deterministic for the same seed', () => {
    const req = roomRequest({ widthM: 5.6, depthM: 7.73, tableM: 0.6, chairDepthM: 0.5, chairWidthM: 0.4, mode: 'generate', tableCount: 6, seed: 42 });
    const a = generateDiningLayouts(req);
    const b = generateDiningLayouts(req);
    expect(a.layouts.map((l) => l.fingerprint)).toEqual(b.layouts.map((l) => l.fingerprint));
    expect(a.generatorVersion).toBe(GENERATOR_VERSION);
  });

  it('explores alternatives with a different seed', () => {
    const base = roomRequest({ widthM: 5.6, depthM: 7.73, tableM: 0.6, mode: 'generate', tableCount: 6, seed: 11 });
    const other = { ...base, generation: { ...base.generation, seed: 99 } };
    const a = generateDiningLayouts(base);
    const b = generateDiningLayouts(other);
    expect(a.layouts.length).toBeGreaterThan(0);
    expect(b.layouts.length).toBeGreaterThan(0);
    expect(a.layouts.map((l) => l.fingerprint).join('|')).not.toBe(b.layouts.map((l) => l.fingerprint).join('|'));
  });

  it('does not recompute a smaller fake maximum in generate mode', () => {
    const cap = generateDiningLayouts(roomRequest({ widthM: 5.6, depthM: 7.73, tableM: 0.6, mode: 'capacity' }));
    const gen = generateDiningLayouts(
      roomRequest({ widthM: 5.6, depthM: 7.73, tableM: 0.6, mode: 'generate', tableCount: 8 }),
    );
    expect(gen.maximumProven).toBe(false);
    expect(gen.layouts.every((l) => l.tableCount === 8)).toBe(true);
    expect(cap.validatedFeasibleTableCount).toBeGreaterThan(3);
  });

  it('generates exact 1..M when an M-table witness exists', () => {
    const cap = computeOperationalCapacity(
      roomRequest({ widthM: 5.6, depthM: 7.73, tableM: 0.6, mode: 'capacity' }),
    );
    const m = Math.min(cap.validatedFeasibleTableCount, 6);
    expect(m).toBeGreaterThanOrEqual(4);
    for (let n = 1; n <= m; n += 1) {
      const result = generateDiningLayouts(
        roomRequest({ widthM: 5.6, depthM: 7.73, tableM: 0.6, mode: 'generate', tableCount: n, seed: 30 + n }),
      );
      expect(result.layouts.length).toBeGreaterThan(0);
      expect(result.layouts.every((l) => l.tableCount === n)).toBe(true);
    }
  });

  it('returns multiple exact-N layouts where alternatives exist', () => {
    const result = generateDiningLayouts(
      roomRequest({ widthM: 5.6, depthM: 7.73, tableM: 0.6, mode: 'generate', tableCount: 6, seed: 5 }),
    );
    expect(result.layouts.length).toBeGreaterThan(1);
    const fps = new Set(result.layouts.map((l) => l.fingerprint));
    expect(fps.size).toBe(result.layouts.length);
  });

  it('never moves a fixed Stage or Food Prep', () => {
    const req = roomRequest({ widthM: 8, depthM: 10, tableM: 0.6, stage: true, mode: 'generate', tableCount: 4 });
    req.features.foodPrep = { xM: 1.2, yM: 1.2, widthM: 1.4, depthM: 1.1, rotationDeg: 0 };
    const result = generateDiningLayouts(req);
    for (const layout of result.layouts) {
      expect(layout.stage?.widthM).toBeCloseTo(3.3, 5);
      expect(layout.stage?.depthM).toBeCloseTo(0.9, 5);
      expect(layout.foodPrep?.widthM).toBeCloseTo(1.4, 5);
    }
  });
});

describe('realistic rooms', { timeout: 20000 }, () => {
  it('optimises the 6.13×9.19 / 1.05m round table case', () => {
    const req = roomRequest({
      widthM: 6.13,
      depthM: 9.19,
      tableM: 1.05,
      chairDepthM: 0.5,
      chairWidthM: 0.4,
      gapM: 0.6,
      access: true,
      mode: 'capacity',
      seed: 17,
    });
    const result = generateDiningLayouts(req);
    expect(result.validatedFeasibleTableCount).toBeGreaterThanOrEqual(6);
    expect(result.maximumProven && (result.provenMaximumTableCount ?? 0) === 3).toBe(false);
    expect(result.candidateCount).toBeGreaterThan(20);
  });

  it('does not claim an unexplained max of 3 for the small-table room', () => {
    const open = generateDiningLayouts(roomRequest({ widthM: 5.6, depthM: 7.73, tableM: 0.6, mode: 'capacity' }));
    const staged = generateDiningLayouts(
      roomRequest({ widthM: 5.6, depthM: 7.73, tableM: 0.6, stage: true, mode: 'capacity' }),
    );
    expect(open.validatedFeasibleTableCount).toBeGreaterThan(3);
    expect(staged.validatedFeasibleTableCount).toBeGreaterThan(3);
    expect(open.maximumProven && open.provenMaximumTableCount === 3).toBe(false);
  });
});

describe('candidate coverage and diversity', { timeout: 20000 }, () => {
  it('multiple grid phases create more candidates than a single lattice origin', () => {
    const req = roomRequest({ widthM: 8, depthM: 10, tableM: 0.6, mode: 'capacity' });
    const fp = occupiedFootprint(req.tableCatalogue[0]!, req.rules);
    const pitch = fp.spacingHalfWidthM * 2;
    const insideFn = (t: ReturnType<typeof makePlacedTable>) =>
      circleInsidePolygon(t.xM, t.yM, t.physicalHalfWidthM, req.block.polygon, req.rules.wallClearanceM);
    const pool = enumerateValidTablePositions(
      req,
      fp,
      0,
      insideFn,
      buildForbiddenZones(req, req.rules),
      [],
      req.tableCatalogue[0]!,
      undefined,
      800,
    );
    const phases = new Set(pool.map((t) => Math.round(((t.xM - fp.physicalHalfWidthM - req.rules.wallClearanceM) / pitch) * 5) % 5));
    expect(phases.size).toBeGreaterThan(1);
    expect(pool.length).toBeGreaterThan(30);
  });

  it('near-identical layouts deduplicate', () => {
    const type = roundType(0.6);
    const fp = occupiedFootprint(type, rules());
    const req = roomRequest({ widthM: 8, depthM: 10, tableM: 0.6 });
    const a = [makePlacedTable(type, fp, 2, 2, 0), makePlacedTable(type, fp, 4.2, 2, 0)];
    const jitter = [makePlacedTable(type, fp, 2.02, 2.01, 0), makePlacedTable(type, fp, 4.21, 2.01, 0)];
    const other = [makePlacedTable(type, fp, 6.4, 7.1, 0), makePlacedTable(type, fp, 6.4, 5.0, 0)];
    const fa = fingerprintLayout('regular-grid', a, [], null, req);
    const fb = fingerprintLayout('staggered', jitter, [], null, req);
    const fc = fingerprintLayout('perimeter', other, [], null, req);
    expect(isNearDuplicate(fa, fb)).toBe(true);
    expect(isNearDuplicate(fa, fc)).toBe(false);
    expect(DIVERSITY_CONFIG.minDistance).toBeGreaterThan(0.1);
  });

  it('keeps access points usable in generated layouts', () => {
    const req = roomRequest({
      widthM: 5.6,
      depthM: 7.73,
      tableM: 0.6,
      access: true,
      mode: 'generate',
      tableCount: 6,
    });
    const result = generateDiningLayouts(req);
    expect(result.layouts.length).toBeGreaterThan(0);
    const zones = buildForbiddenZones(req, req.rules).filter(
      (z) => z.id.startsWith('entrance') || z.id.startsWith('exit'),
    );
    const fp = occupiedFootprint(req.tableCatalogue[0]!, req.rules);
    for (const layout of result.layouts) {
      for (const table of layout.tables) {
        const placed = makePlacedTable(
          req.tableCatalogue[0]!,
          fp,
          (table.xPct / 100) * req.block.widthM,
          (table.yPct / 100) * req.block.depthM,
          table.rotationDeg,
        );
        expect(tableHitsForbidden(placed, zones)).toBe(false);
      }
    }
  });

  it('returns debug metrics including conflict graph size', () => {
    const result = generateDiningLayouts(roomRequest({ widthM: 5.6, depthM: 7.73, tableM: 0.6, mode: 'capacity' }));
    expect(result.generationDebug.generatorVersion).toBe(GENERATOR_VERSION);
    expect(result.generationDebug.conflictCount).toBeGreaterThan(0);
    expect(result.generationDebug.staticCandidateCount).toBeGreaterThan(20);
    expect(result.generationDebug.timing?.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.generationDebug.capacity?.searchStates).toBeGreaterThanOrEqual(0);
  });

  it('does not claim a proven maximum when the time budget already expired', () => {
    const cap = computeOperationalCapacity(
      roomRequest({ widthM: 12, depthM: 14, tableM: 0.6, mode: 'capacity' }),
      undefined,
      Date.now() - 1,
    );
    expect(cap.maximumProven).toBe(false);
    expect(cap.provenMaximumTableCount).toBeNull();
  });
});
