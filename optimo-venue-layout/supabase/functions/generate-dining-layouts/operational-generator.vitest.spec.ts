import { describe, expect, it } from 'vitest';

import { GENERATOR_VERSION, computeOperationalCapacity, enumerateValidTablePositions, generateDiningLayouts } from './candidate-generator';
import { geometryKeyFromFingerprint, isNearDuplicate } from './fingerprint';
import { makePlacedTable, occupiedFootprint } from './rules';
import { tableHitsForbidden, tablesOverlap, validateLayout } from './validator';
import { buildForbiddenZones } from './forbidden';
import { occupiedRegionSet } from './stage-regions';
import { rectInsidePolygon, rotatedRectAabb } from './geometry';
import type { GenerateDiningLayoutsRequest, PlacedTable, RectFeatureInput } from './types';

function baseRequest(): GenerateDiningLayoutsRequest {
  return {
    block: {
      id: 'b1',
      polygon: [
        { x: 0, y: 0 },
        { x: 16, y: 0 },
        { x: 16, y: 12 },
        { x: 0, y: 12 },
      ],
      widthM: 16,
      depthM: 12,
    },
    accessPoints: {
      entrances: [],
      exits: [],
      emergencyExits: [],
    },
    features: {},
    tableCatalogue: [
      {
        id: 'round-6',
        name: 'Round 6',
        shape: 'round',
        widthM: 1.2,
        depthM: 1.2,
        capacity: 6,
        chairWidthM: 0.45,
        chairDepthM: 0.5,
        allowed: true,
      },
    ],
    target: { tableCount: 8, targetCapacity: 48 },
    rules: {
      minimumTableToTableClearanceM: 0.6,
      minimumChairToChairClearanceM: 0.2,
      wallClearanceM: 0.4,
      guestAisleWidthM: 0.9,
      mainGuestAisleWidthM: 1.2,
      waiterAisleWidthM: 0.8,
      serviceRouteClearanceM: 0.6,
      entranceClearanceM: 1.0,
      exitClearanceM: 1.0,
      stageClearanceM: 0.8,
      foodPrepClearanceM: 0.8,
      obstacleClearanceM: 0.4,
      maximumOccupancy: null,
    },
    generation: { suggestionCount: 2, seed: 42, candidateLimit: 64, timeBudgetMs: 2600 },
    stageFacingAngleDeg: 90,
  };
}

function withAccess(req: GenerateDiningLayoutsRequest): GenerateDiningLayoutsRequest {
  req.accessPoints = {
    entrances: [{ kind: 'entrance', xM: 8, yM: 0.25, widthM: 1.6, depthM: 0.4 }],
    exits: [{ kind: 'exit', xM: 8, yM: 11.75, widthM: 1.6, depthM: 0.4 }],
    emergencyExits: [],
  };
  return req;
}

function expectExact(req: GenerateDiningLayoutsRequest, count: number) {
  req.target = { tableCount: count, targetCapacity: count * 6 };
  const result = generateDiningLayouts(req);
  expect(result.generatorVersion).toBe(GENERATOR_VERSION);
  expect(result.layouts.length).toBeGreaterThan(0);
  expect(result.layouts.every((layout) => layout.tableCount === count)).toBe(true);
  expect(result.failureKind).toBe('EXACT_FOUND');
  return result;
}

describe('operational dining generator exact-count search', () => {
  it.each([1, 5, 8, 10, 13, 15, 18, 20])('finds exact %s-table layouts with no features', (count) => {
    expectExact(baseRequest(), count);
  });

  it.each([5, 8, 13])('finds exact %s-table layouts with an edge stage', (count) => {
    const req = withAccess(baseRequest());
    req.features.stage = { xM: 8, yM: 0.6, widthM: 4, depthM: 1.2, rotationDeg: 0 };
    expectExact(req, count);
  });

  it.each([5, 8, 13])('finds exact %s-table layouts around a centre stage', (count) => {
    const req = withAccess(baseRequest());
    const stage: RectFeatureInput = { xM: 8, yM: 6, widthM: 4, depthM: 1.2, rotationDeg: 0 };
    req.features.stage = stage;
    const result = expectExact(req, count);
    for (const layout of result.layouts) {
      expect(layout.stage?.xM).toBeCloseTo(stage.xM, 1);
      expect(layout.stage?.yM).toBeCloseTo(stage.yM, 1);
      expect(layout.stage?.widthM).toBeCloseTo(stage.widthM, 1);
      expect(layout.stage?.depthM).toBeCloseTo(stage.depthM, 1);
    }
  });

  it.each([8, 13])('finds exact %s-table layouts with food prep', (count) => {
    const req = withAccess(baseRequest());
    req.features.foodPrep = { xM: 14, yM: 6, widthM: 2.2, depthM: 1.3, rotationDeg: 90 };
    expectExact(req, count);
  });

  it.each([8, 13])('finds exact %s-table layouts with stage + food prep', (count) => {
    const req = withAccess(baseRequest());
    req.features.stage = { xM: 8, yM: 0.6, widthM: 4, depthM: 1.2, rotationDeg: 0 };
    req.features.foodPrep = { xM: 14, yM: 6, widthM: 2.2, depthM: 1.3, rotationDeg: 90 };
    expectExact(req, count);
  });

  it.each([8, 13])('finds exact %s-table layouts with entrance + exit', (count) => {
    expectExact(withAccess(baseRequest()), count);
  });

  it.each([8, 13])('finds exact %s-table layouts with all anchored features', (count) => {
    const req = withAccess(baseRequest());
    req.features.stage = { xM: 8, yM: 6, widthM: 4, depthM: 1.2, rotationDeg: 0 };
    req.features.foodPrep = { xM: 14, yM: 6, widthM: 2.2, depthM: 1.3, rotationDeg: 90 };
    expectExact(req, count);
  });

  it('never returns partial cards for an impossible count', () => {
    const req = withAccess(baseRequest());
    req.target = { tableCount: 80, targetCapacity: 480 };
    const result = generateDiningLayouts(req);
    expect(result.layouts).toEqual([]);
    expect(result.exactCandidateCount).toBe(0);
    expect(result.operationalMaxTableCount).toBeLessThan(80);
    expect(['OPERATIONAL_MAX_BELOW_REQUEST', 'SEARCH_EXHAUSTED', 'NOT_FOUND_YET']).toContain(result.failureKind);
  });

  it('enumerates overlapping candidate alternatives instead of greedy pruning', () => {
    const req = withAccess(baseRequest());
    const type = req.tableCatalogue[0]!;
    const footprint = occupiedFootprint(type, req.rules);
    const pool = enumerateValidTablePositions(
      req,
      footprint,
      0,
      () => true,
      [],
      [],
      type,
      undefined,
      520,
    );
    expect(pool.length).toBeGreaterThan(13);
    let overlaps = 0;
    for (let i = 0; i < pool.length; i += 1) {
      for (let j = i + 1; j < Math.min(pool.length, i + 40); j += 1) {
        if (tablesOverlap(pool[i]!, pool[j]!)) {
          overlaps += 1;
        }
      }
    }
    expect(overlaps).toBeGreaterThan(0);
  });

  it('proves the old <=12 exact-search cutoff is gone for 13 tables', () => {
    const req = withAccess(baseRequest());
    req.features.stage = { xM: 8, yM: 6, widthM: 4, depthM: 1.2, rotationDeg: 0 };
    req.target = { tableCount: 13, targetCapacity: 78 };
    const result = generateDiningLayouts(req);
    expect(result.layouts.length).toBeGreaterThan(0);
    expect(result.layouts.every((layout) => layout.tableCount === 13)).toBe(true);
  });
});

function centreStageScreenshotRequest(): GenerateDiningLayoutsRequest {
  const req = withAccess(baseRequest());
  req.features.stage = { xM: 8, yM: 6, widthM: 4, depthM: 1.2, rotationDeg: 0 };
  req.generation = { suggestionCount: 6, seed: 17, candidateLimit: 48, timeBudgetMs: 2600 };
  req.stageFacingAngleDeg = 0;
  return req;
}

function placedFromGenerated(req: GenerateDiningLayoutsRequest, layout: { tables: { xPct: number; yPct: number; rotationDeg: number; widthM: number; depthM?: number; seats: number; catalogueId: string; shape: 'round' | 'rectangular' }[] }): PlacedTable[] {
  const type = req.tableCatalogue[0]!;
  const fp = occupiedFootprint(type, req.rules);
  return layout.tables.map((table) =>
    makePlacedTable(
      type,
      fp,
      (table.xPct / 100) * req.block.widthM,
      (table.yPct / 100) * req.block.depthM,
      table.rotationDeg,
    ),
  );
}

describe('witness-backed operational capacity and stage-relative search', () => {
  it('never reports a maximum without a validated witness of that size', () => {
    const req = centreStageScreenshotRequest();
    const capacity = computeOperationalCapacity(req);
    expect(capacity.maximumTableCount).toBeGreaterThan(0);
    expect(capacity.witnessLayout).not.toBeNull();
    expect(capacity.witnessLayout!.tables.length).toBe(capacity.maximumTableCount);
    expect(capacity.witnessTables.length).toBe(capacity.maximumTableCount);
    const insideFn = (t: PlacedTable) =>
      rectInsidePolygon(t.xM, t.yM, t.physicalHalfWidthM, t.physicalHalfDepthM, t.rotationDeg, req.block.polygon, req.rules.wallClearanceM);
    const check = validateLayout(
      req.block.polygon,
      capacity.witnessTables,
      buildForbiddenZones(req, req.rules),
      [],
      { ...req, target: { tableCount: undefined, targetCapacity: undefined } },
      req.rules,
      insideFn,
      { requireTargetCount: false },
    );
    expect(check.ok).toBe(true);
  });

  it('is monotonic from 1 to the witness maximum', { timeout: 20000 }, () => {
    const req = centreStageScreenshotRequest();
    const max = computeOperationalCapacity(req).maximumTableCount;
    expect(max).toBeGreaterThanOrEqual(3);
    const limit = Math.min(max, 8);
    for (let n = 1; n <= limit; n += 1) {
      const result = generateDiningLayouts({
        ...req,
        target: { tableCount: n, targetCapacity: n * 6 },
        generation: { ...req.generation, seed: 100 + n, suggestionCount: 2, timeBudgetMs: 2600 },
      });
      expect(result.layouts.length, `exact ${n} of max ${max}`).toBeGreaterThan(0);
      expect(result.layouts.every((layout) => layout.tableCount === n)).toBe(true);
    }
  });

  it('keeps a centre Stage fixed and spreads 3-table suggestions across regions', () => {
    const req = centreStageScreenshotRequest();
    req.target = { tableCount: 3, targetCapacity: 18 };
    const stage = req.features.stage!;
    const result = generateDiningLayouts(req);
    expect(result.layouts.length).toBeGreaterThan(0);
    expect(result.layouts.every((layout) => layout.tableCount === 3)).toBe(true);
    for (const layout of result.layouts) {
      expect(layout.stage?.xM).toBeCloseTo(stage.xM, 5);
      expect(layout.stage?.yM).toBeCloseTo(stage.yM, 5);
      expect(layout.stage?.widthM).toBeCloseTo(stage.widthM, 5);
      expect(layout.stage?.depthM).toBeCloseTo(stage.depthM, 5);
      expect(layout.family).not.toBe('banquet-open-centre');
    }
    if (result.layouts.length >= 2) {
      const keys = result.layouts.map((layout) =>
        [...occupiedRegionSet(placedFromGenerated(req, layout), req)].sort().join('|'),
      );
      const unique = new Set(keys);
      const allSingleSame = keys.every((key) => key === keys[0] && !key.includes('|'));
      expect(allSingleSame && unique.size === 1).toBe(false);
    }
  });

  it('redesign keeps Stage geometry and changes spatial distribution', { timeout: 15000 }, () => {
    const req = centreStageScreenshotRequest();
    req.target = { tableCount: 3, targetCapacity: 18 };
    const stage = { ...req.features.stage! };
    const a = generateDiningLayouts({ ...req, generation: { ...req.generation, seed: 3 } });
    const b = generateDiningLayouts({
      ...req,
      generation: {
        ...req.generation,
        seed: 91,
        excludeFingerprints: a.layouts.map((layout) => layout.fingerprint),
      },
    });
    const c = generateDiningLayouts({
      ...req,
      generation: {
        ...req.generation,
        seed: 204,
        excludeFingerprints: [...a.layouts, ...b.layouts].map((layout) => layout.fingerprint),
      },
    });
    for (const result of [a, b, c]) {
      expect(result.layouts.every((layout) => layout.tableCount === 3)).toBe(true);
      for (const layout of result.layouts) {
        expect(layout.stage?.xM).toBeCloseTo(stage.xM, 5);
        expect(layout.stage?.yM).toBeCloseTo(stage.yM, 5);
      }
    }
    const regionKeys = [a, b, c].flatMap((result) =>
      result.layouts.map((layout) =>
        [...occupiedRegionSet(placedFromGenerated(req, layout), req)].sort().join('|'),
      ),
    );
    expect(new Set(regionKeys).size).toBeGreaterThan(1);
  });

  it('capacity mode returns the witness and not an independent estimate', () => {
    const req = centreStageScreenshotRequest();
    req.generation = { ...req.generation, mode: 'capacity', suggestionCount: 1 };
    const result = generateDiningLayouts(req);
    expect(result.witnessLayout).not.toBeNull();
    expect(result.operationalMaxTableCount).toBe(result.witnessLayout!.tables.length);
    expect(result.generationDebug.witnessValidated).toBe(true);
  });

  it('capacity probe ignores selected tableCount and searches the true maximum', () => {
    const req = centreStageScreenshotRequest();
    req.target = { tableCount: 3, targetCapacity: 18 };
    req.generation = { ...req.generation, mode: 'capacity', suggestionCount: 1, timeBudgetMs: 2500 };
    const result = generateDiningLayouts(req);
    expect(result.generationDebug.candidatePool?.individuallyValid).toBeGreaterThan(8);
    expect(result.operationalMaxTableCount).toBeGreaterThan(3);
    expect(result.witnessLayout?.tables.length).toBe(result.operationalMaxTableCount);
    const byRegion = result.generationDebug.candidatePool?.byRegion ?? {};
    const occupiedSides = ['TOP', 'BOTTOM', 'LEFT', 'RIGHT'].filter((region) => (byRegion[region] ?? 0) > 0);
    expect(occupiedSides.length).toBeGreaterThan(1);
  });

  it('places 0.6m tables around a centre Stage instead of stopping at the selected count', () => {
    const req = centreStageScreenshotRequest();
    req.tableCatalogue[0] = {
      ...req.tableCatalogue[0]!,
      widthM: 0.6,
      depthM: 0.6,
    };
    req.rules.minimumTableToTableClearanceM = 0.6;
    req.target = { tableCount: 3, targetCapacity: 18 };
    req.generation = { ...req.generation, mode: 'capacity', timeBudgetMs: 2500 };
    const result = generateDiningLayouts(req);
    expect(result.operationalMaxTableCount).toBeGreaterThan(3);
    expect(result.witnessLayout?.tables.length).toBe(result.operationalMaxTableCount);
    const gen = generateDiningLayouts({
      ...req,
      generation: { ...req.generation, mode: 'generate', suggestionCount: 4, seed: 9 },
    });
    expect(gen.layouts.length).toBeGreaterThan(0);
    expect(gen.layouts.every((layout) => layout.tableCount === 3)).toBe(true);
  });

  it('returns multiple spatially different exact-8 layouts for an open screenshot-style room', () => {
    const req = withAccess(baseRequest());
    req.tableCatalogue[0] = {
      ...req.tableCatalogue[0]!,
      widthM: 0.6,
      depthM: 0.6,
      capacity: 4,
      chairWidthM: 0.4,
      chairDepthM: 0.5,
    };
    req.rules.minimumTableToTableClearanceM = 0.6;
    req.target = { tableCount: 8, targetCapacity: 32 };
    req.generation = { suggestionCount: 6, seed: 42, timeBudgetMs: 2800, mode: 'generate' };
    const result = generateDiningLayouts(req);
    expect(result.generationDebug.rawExactSolutions ?? 0).toBeGreaterThan(1);
    expect(result.layouts.length).toBeGreaterThanOrEqual(4);
    expect(result.layouts.length).toBeLessThanOrEqual(6);
    expect(result.layouts.every((layout) => layout.tableCount === 8)).toBe(true);
    expect(result.layouts.every((layout) => layout.capacity === 32)).toBe(true);
    const keys = result.layouts.map((layout) => geometryKeyFromFingerprint(layout.fingerprint));
    expect(new Set(keys).size).toBe(result.layouts.length);
    for (let i = 0; i < result.layouts.length; i += 1) {
      for (let j = i + 1; j < result.layouts.length; j += 1) {
        expect(isNearDuplicate(result.layouts[i]!.fingerprint, result.layouts[j]!.fingerprint)).toBe(false);
      }
    }
  });

  it('returns several distinct exact-3 layouts around a centre Stage', () => {
    const req = centreStageScreenshotRequest();
    req.tableCatalogue[0] = {
      ...req.tableCatalogue[0]!,
      widthM: 0.6,
      depthM: 0.6,
      capacity: 4,
    };
    req.target = { tableCount: 3, targetCapacity: 12 };
    req.generation = { suggestionCount: 6, seed: 17, timeBudgetMs: 2800, mode: 'generate' };
    const result = generateDiningLayouts(req);
    expect(result.layouts.length).toBeGreaterThanOrEqual(3);
    expect(result.layouts.every((layout) => layout.tableCount === 3)).toBe(true);
    const regionKeys = result.layouts.map((layout) =>
      [...occupiedRegionSet(placedFromGenerated(req, layout), req)].sort().join('|'),
    );
    expect(new Set(regionKeys).size).toBeGreaterThan(1);
    for (const layout of result.layouts) {
      expect(layout.stage?.xM).toBeCloseTo(req.features.stage!.xM, 5);
      expect(layout.stage?.yM).toBeCloseTo(req.features.stage!.yM, 5);
    }
  });

  it('returns the same ordered suggestions for the same seed', { timeout: 15000 }, () => {
    const req = centreStageScreenshotRequest();
    req.target = { tableCount: 8, targetCapacity: 48 };
    req.generation = { suggestionCount: 6, seed: 77, timeBudgetMs: 2800, mode: 'generate' };
    const a = generateDiningLayouts(req);
    const b = generateDiningLayouts(req);
    expect(a.layouts.map((layout) => layout.fingerprint)).toEqual(b.layouts.map((layout) => layout.fingerprint));
  });

  it('refresh with a new seed and exclusions returns a different exact-count set when alternatives exist', { timeout: 15000 }, () => {
    const req = centreStageScreenshotRequest();
    req.tableCatalogue[0] = { ...req.tableCatalogue[0]!, widthM: 0.6, depthM: 0.6, capacity: 4 };
    req.target = { tableCount: 8, targetCapacity: 32 };
    req.generation = { suggestionCount: 6, seed: 11, timeBudgetMs: 2800, mode: 'generate' };
    const first = generateDiningLayouts(req);
    expect(first.layouts.length).toBeGreaterThanOrEqual(2);
    const second = generateDiningLayouts({
      ...req,
      generation: {
        ...req.generation,
        seed: 88,
        excludeFingerprints: first.layouts.map((layout) => layout.fingerprint),
      },
    });
    expect(second.layouts.every((layout) => layout.tableCount === 8)).toBe(true);
    if (second.layouts.length > 0) {
      const firstKeys = new Set(first.layouts.map((layout) => geometryKeyFromFingerprint(layout.fingerprint)));
      expect(second.layouts.some((layout) => !firstKeys.has(geometryKeyFromFingerprint(layout.fingerprint)))).toBe(true);
    }
  });
});

function recordedScenarioRequest(): GenerateDiningLayoutsRequest {
  const widthM = 6.5;
  const depthM = 9.96;
  const req = withAccess(baseRequest());
  req.block = {
    id: 'recorded-6.5x9.96',
    polygon: [
      { x: 0, y: 0 },
      { x: widthM, y: 0 },
      { x: widthM, y: depthM },
      { x: 0, y: depthM },
    ],
    widthM,
    depthM,
  };
  req.accessPoints = {
    entrances: [{ kind: 'entrance', xM: widthM / 2, yM: 0.25, widthM: 1.5, depthM: 0.5 }],
    exits: [{ kind: 'exit', xM: widthM / 2, yM: depthM - 0.25, widthM: 1.5, depthM: 0.5 }],
    emergencyExits: [],
  };
  req.features = {
    stage: { xM: widthM / 2, yM: depthM / 2, widthM: 4, depthM: 1.2, rotationDeg: 0 },
  };
  req.tableCatalogue[0] = {
    id: 'round',
    name: 'Round',
    shape: 'round',
    widthM: 0.6,
    depthM: 0.6,
    capacity: 3,
    chairWidthM: 0.45,
    chairDepthM: 0.5,
    allowed: true,
  };
  req.rules.minimumTableToTableClearanceM = 0.6;
  req.rules.wallClearanceM = 0.4;
  req.rules.stageClearanceM = 0.8;
  req.generation = { suggestionCount: 1, seed: 17, candidateLimit: 64, timeBudgetMs: 2800, mode: 'capacity' };
  req.stageFacingAngleDeg = 0;
  req.target = {};
  return req;
}

function staticOk(req: GenerateDiningLayoutsRequest, table: PlacedTable): boolean {
  const zones = buildForbiddenZones(req, req.rules);
  return (
    rectInsidePolygon(
      table.xM,
      table.yM,
      table.physicalHalfWidthM,
      table.physicalHalfDepthM,
      table.rotationDeg,
      req.block.polygon,
      req.rules.wallClearanceM,
    ) && !tableHitsForbidden(table, zones)
  );
}

function minValidStageClearance(req: GenerateDiningLayoutsRequest): number {
  const type = req.tableCatalogue[0]!;
  const fp = occupiedFootprint(type, req.rules);
  const stage = req.features.stage!;
  const stageBox = rotatedRectAabb(stage.xM, stage.yM, stage.widthM / 2, stage.depthM / 2, stage.rotationDeg ?? 0);
  let min = Infinity;
  for (let y = 0.05; y < req.block.depthM; y += 0.05) {
    const table = makePlacedTable(type, fp, stage.xM, y, 0);
    if (!staticOk(req, table)) {
      continue;
    }
    const tbox = rotatedRectAabb(table.xM, table.yM, table.physicalHalfWidthM, table.physicalHalfDepthM, 0);
    const gap =
      tbox.maxY <= stageBox.minY
        ? stageBox.minY - tbox.maxY
        : tbox.minY >= stageBox.maxY
          ? tbox.minY - stageBox.maxY
          : 0;
    if (gap > 0 && gap < min) {
      min = gap;
    }
  }
  return min;
}

function greedyLatticeWitness(req: GenerateDiningLayoutsRequest): PlacedTable[] {
  const type = req.tableCatalogue[0]!;
  const fp = occupiedFootprint(type, req.rules);
  const pitch = fp.spacingHalfWidthM * 2;
  const start = fp.physicalHalfWidthM + req.rules.wallClearanceM;
  const placed: PlacedTable[] = [];
  for (let y = start; y <= req.block.depthM - start + 1e-6; y += pitch) {
    for (let x = start; x <= req.block.widthM - start + 1e-6; x += pitch) {
      const table = makePlacedTable(type, fp, Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, 0);
      if (!staticOk(req, table)) {
        continue;
      }
      if (placed.some((existing) => tablesOverlap(table, existing))) {
        continue;
      }
      placed.push(table);
    }
  }
  return placed;
}

describe('physical vs pairwise footprint semantics', () => {
  const roundType = {
    id: 'round',
    name: 'Round',
    shape: 'round' as const,
    widthM: 0.6,
    depthM: 0.6,
    capacity: 3,
    chairWidthM: 0.45,
    chairDepthM: 0.5,
    allowed: true,
  };

  it('does not change isolated-table wall validity when only tableGap changes', () => {
    const req = withAccess(baseRequest());
    req.tableCatalogue[0] = { ...roundType };
    req.features = {};
    req.accessPoints = { entrances: [], exits: [], emergencyExits: [] };
    const type = req.tableCatalogue[0]!;
    const y = 0.55 + 0.4;
    const x = 3;
    const tight = makePlacedTable(type, occupiedFootprint(type, { ...req.rules, minimumTableToTableClearanceM: 0.6 }), x, y, 0);
    const loose = makePlacedTable(type, occupiedFootprint(type, { ...req.rules, minimumTableToTableClearanceM: 1.0 }), x, y, 0);
    expect(tight.physicalHalfWidthM).toBeCloseTo(loose.physicalHalfWidthM, 9);
    expect(staticOk({ ...req, rules: { ...req.rules, minimumTableToTableClearanceM: 0.6 } }, tight)).toBe(true);
    expect(staticOk({ ...req, rules: { ...req.rules, minimumTableToTableClearanceM: 1.0 } }, loose)).toBe(true);
  });

  it('does not change table-to-Stage distance when only tableGap changes', () => {
    const req = withAccess(baseRequest());
    req.tableCatalogue[0] = { ...roundType };
    req.features.stage = { xM: 8, yM: 6, widthM: 4, depthM: 1.2, rotationDeg: 0 };
    req.accessPoints = { entrances: [], exits: [], emergencyExits: [] };
    const a = minValidStageClearance({ ...req, rules: { ...req.rules, minimumTableToTableClearanceM: 0.6 } });
    const b = minValidStageClearance({ ...req, rules: { ...req.rules, minimumTableToTableClearanceM: 1.0 } });
    expect(a).toBeGreaterThan(0);
    expect(b).toBeCloseTo(a, 2);
  });

  it('increases required centre distance when tableGap increases', () => {
    const type = roundType;
    const tightFp = occupiedFootprint(type, { ...baseRequest().rules, minimumTableToTableClearanceM: 0.6 });
    const looseFp = occupiedFootprint(type, { ...baseRequest().rules, minimumTableToTableClearanceM: 1.0 });
    const a = makePlacedTable(type, tightFp, 2, 2, 0);
    const atTightPitch = makePlacedTable(type, tightFp, 2 + tightFp.spacingHalfWidthM * 2, 2, 0);
    const belowLoose = makePlacedTable(type, looseFp, 2 + tightFp.spacingHalfWidthM * 2, 2, 0);
    expect(tablesOverlap(a, atTightPitch)).toBe(false);
    expect(tablesOverlap(makePlacedTable(type, looseFp, 2, 2, 0), belowLoose)).toBe(true);
    expect(looseFp.spacingHalfWidthM).toBeGreaterThan(tightFp.spacingHalfWidthM);
    expect(tightFp.physicalHalfWidthM).toBeCloseTo(looseFp.physicalHalfWidthM, 9);
  });

  it('two 0.6m tables are invalid below pairwise pitch and valid at exact pitch', () => {
    const fp = occupiedFootprint(roundType, { ...baseRequest().rules, minimumTableToTableClearanceM: 0.6 });
    const pitch = fp.spacingHalfWidthM * 2;
    const a = makePlacedTable(roundType, fp, 2, 2, 0);
    expect(tablesOverlap(a, makePlacedTable(roundType, fp, 2 + pitch - 0.01, 2, 0))).toBe(true);
    expect(tablesOverlap(a, makePlacedTable(roundType, fp, 2 + pitch, 2, 0))).toBe(false);
  });

  it('stageClearance 0.4 → 0.8 changes valid positions near Stage', () => {
    const req = withAccess(baseRequest());
    req.tableCatalogue[0] = { ...roundType };
    req.features.stage = { xM: 8, yM: 6, widthM: 4, depthM: 1.2, rotationDeg: 0 };
    req.accessPoints = { entrances: [], exits: [], emergencyExits: [] };
    const near = minValidStageClearance({ ...req, rules: { ...req.rules, stageClearanceM: 0.4 } });
    const far = minValidStageClearance({ ...req, rules: { ...req.rules, stageClearanceM: 0.8 } });
    expect(far).toBeGreaterThan(near + 0.2);
  });

  it('wallClearance 0.2 → 0.4 changes valid positions near walls', () => {
    const req = withAccess(baseRequest());
    req.tableCatalogue[0] = { ...roundType };
    req.features = {};
    req.accessPoints = { entrances: [], exits: [], emergencyExits: [] };
    const type = req.tableCatalogue[0]!;
    const fp = occupiedFootprint(type, req.rules);
    const yTight = fp.physicalHalfDepthM + 0.2;
    const table = makePlacedTable(type, fp, 4, yTight, 0);
    expect(staticOk({ ...req, rules: { ...req.rules, wallClearanceM: 0.2 } }, table)).toBe(true);
    expect(staticOk({ ...req, rules: { ...req.rules, wallClearanceM: 0.4 } }, table)).toBe(false);
  });

  it('recorded 6.5×9.96 centre-Stage case keeps Stage fixed, pairwise gap, and a validated witness', { timeout: 15000 }, () => {
    const req = recordedScenarioRequest();
    const fp = occupiedFootprint(req.tableCatalogue[0]!, req.rules);
    expect(fp.physicalHalfWidthM).toBeCloseTo(0.55, 9);
    expect(fp.spacingHalfWidthM).toBeCloseTo(0.85, 9);
    const result = generateDiningLayouts(req);
    expect(result.generatorVersion).toBe(GENERATOR_VERSION);
    expect(result.generationDebug.capacityDebug?.table.physicalHalfWidthM).toBeCloseTo(0.55, 9);
    expect(result.generationDebug.capacityDebug?.table.pairwiseHalfWidthM).toBeCloseTo(0.85, 9);
    expect(result.witnessLayout).not.toBeNull();
    expect(result.operationalMaxTableCount).toBe(result.witnessLayout!.tables.length);
    expect(result.generationDebug.witnessValidated).toBe(true);
    expect(result.witnessLayout!.stage?.xM).toBeCloseTo(3.25, 5);
    expect(result.witnessLayout!.stage?.yM).toBeCloseTo(4.98, 5);
    const placed = placedFromGenerated(req, result.witnessLayout!);
    const insideFn = (t: PlacedTable) =>
      rectInsidePolygon(t.xM, t.yM, t.physicalHalfWidthM, t.physicalHalfDepthM, t.rotationDeg, req.block.polygon, req.rules.wallClearanceM);
    const check = validateLayout(
      req.block.polygon,
      placed,
      buildForbiddenZones(req, req.rules),
      [],
      req,
      req.rules,
      insideFn,
      { requireTargetCount: false },
    );
    expect(check.ok).toBe(true);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(tablesOverlap(placed[i]!, placed[j]!)).toBe(false);
      }
    }
    const construction = greedyLatticeWitness(req);
    if (construction.length > 6) {
      expect(result.operationalMaxTableCount).toBeGreaterThan(6);
      expect(result.operationalMaxTableCount).toBeGreaterThanOrEqual(construction.length);
    }
    const noAccess = recordedScenarioRequest();
    noAccess.accessPoints = { entrances: [], exits: [], emergencyExits: [] };
    const openMax = generateDiningLayouts(noAccess).operationalMaxTableCount;
    expect(result.generationDebug.capacityDebug?.candidateCounts.finalPool).toBeGreaterThan(0);
    expect(openMax).toBeGreaterThanOrEqual(result.operationalMaxTableCount);
  });
});

function smallTableRoom(opts: {
  stage?: boolean;
  sharedAccess?: boolean;
}): GenerateDiningLayoutsRequest {
  const widthM = 5.6;
  const depthM = 7.73;
  const req = baseRequest();
  req.block = {
    id: 'small-5.6x7.73',
    polygon: [
      { x: 0, y: 0 },
      { x: widthM, y: 0 },
      { x: widthM, y: depthM },
      { x: 0, y: depthM },
    ],
    widthM,
    depthM,
  };
  req.tableCatalogue[0] = {
    id: 'round',
    name: 'Round',
    shape: 'round',
    widthM: 0.6,
    depthM: 0.6,
    capacity: 3,
    chairWidthM: 0.4,
    chairDepthM: 0.5,
    allowed: true,
  };
  req.rules.minimumTableToTableClearanceM = 0.6;
  req.accessPoints = opts.sharedAccess
    ? {
        entrances: [{ kind: 'entrance', xM: widthM / 2, yM: 0.25, widthM: 1.5, depthM: 0.5 }],
        exits: [{ kind: 'exit', xM: widthM / 2, yM: 0.25, widthM: 1.5, depthM: 0.5 }],
        emergencyExits: [],
      }
    : { entrances: [], exits: [], emergencyExits: [] };
  req.features = opts.stage
    ? { stage: { xM: widthM / 2, yM: depthM / 2, widthM: 3.3, depthM: 0.9, rotationDeg: 0 } }
    : {};
  req.generation = { suggestionCount: 1, seed: 17, candidateLimit: 64, timeBudgetMs: 2500, mode: 'capacity' };
  req.stageFacingAngleDeg = 0;
  req.target = {};
  return req;
}

describe('small-table 5.6×7.73 capacity certification', () => {
  it('does not collapse an open room to a proven max of 3', () => {
    const result = generateDiningLayouts(smallTableRoom({}));
    expect(result.validatedFeasibleTableCount).toBeGreaterThanOrEqual(8);
    expect(result.maximumProven && result.provenMaximumTableCount === 3).toBe(false);
  });

  it('does not collapse shared Entry/Exit to a proven max of 3', () => {
    const result = generateDiningLayouts(smallTableRoom({ sharedAccess: true }));
    expect(result.validatedFeasibleTableCount).toBeGreaterThanOrEqual(7);
    expect(result.maximumProven && result.provenMaximumTableCount === 3).toBe(false);
  });

  it('does not collapse a centre Stage room to 3 when a 6-table witness exists', () => {
    const result = generateDiningLayouts(smallTableRoom({ stage: true }));
    expect(result.validatedFeasibleTableCount).toBeGreaterThanOrEqual(5);
    if (result.validatedFeasibleTableCount >= 6) {
      expect(result.witnessLayout?.tables.length).toBeGreaterThanOrEqual(6);
    }
    expect(result.maximumProven && (result.provenMaximumTableCount ?? 0) <= 3).toBe(false);
  });

  it('searches exact-8 in generate mode without a shorter capacity reject', () => {
    const req = smallTableRoom({});
    req.target = { tableCount: 8, targetCapacity: 24 };
    req.generation = { ...req.generation, mode: 'generate', suggestionCount: 4, timeBudgetMs: 2800 };
    const result = generateDiningLayouts(req);
    expect(result.layouts.length).toBeGreaterThan(0);
    expect(result.layouts.every((layout) => layout.tableCount === 8)).toBe(true);
    expect(result.failureKind).toBe('EXACT_FOUND');
  });
});
