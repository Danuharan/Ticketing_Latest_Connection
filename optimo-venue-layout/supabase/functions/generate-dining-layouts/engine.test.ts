import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { fingerprintLayout, isNearDuplicate } from './fingerprint.ts';
import { pointInPolygon, rectInsidePolygon } from './geometry.ts';
import { GENERATOR_VERSION, computeOperationalCapacity, generateDiningLayouts } from './candidate-generator.ts';
import { makePlacedTable, occupiedFootprint } from './rules.ts';
import {
  DEFAULT_DINING_LAYOUT_RULES,
  type GenerateDiningLayoutsRequest,
  type PlacedTable,
} from './types.ts';
import { createRng } from './rng.ts';
import { buildForbiddenZones } from './forbidden.ts';
import { tableHitsForbidden, tablesOverlap } from './validator.ts';

const square = [
  { x: 0, y: 0 },
  { x: 16, y: 0 },
  { x: 16, y: 12 },
  { x: 0, y: 12 },
];

function baseRequest(seed: number): GenerateDiningLayoutsRequest {
  return {
    block: { id: 'b1', polygon: square, widthM: 16, depthM: 12 },
    accessPoints: {
      entrances: [{ kind: 'entrance', xM: 8, yM: 0.25, widthM: 1.6, depthM: 0.4 }],
      exits: [{ kind: 'exit', xM: 8, yM: 11.75, widthM: 1.6, depthM: 0.4 }],
    },
    features: {
      stage: { xM: 14.6, yM: 6, widthM: 3.2, depthM: 1.2, rotationDeg: 90 },
      foodPrep: { xM: 3, yM: 10.8, widthM: 2.2, depthM: 1.3 },
    },
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
    rules: DEFAULT_DINING_LAYOUT_RULES,
    generation: { suggestionCount: 6, seed, candidateLimit: 50, timeBudgetMs: 1800 },
    stageFacingAngleDeg: 90,
  };
}

Deno.test('point inside / outside polygon', () => {
  assertEquals(pointInPolygon({ x: 5, y: 4 }, square), true);
  assertEquals(pointInPolygon({ x: 17, y: 4 }, square), false);
});

Deno.test('table rect outside polygon is rejected', () => {
  assertEquals(rectInsidePolygon(0.2, 0.2, 0.8, 0.8, 0, square, 0.4), false);
  assertEquals(rectInsidePolygon(5, 4, 0.6, 0.6, 0, square, 0.4), true);
});

Deno.test('occupied footprint splits physical dining from pairwise table gap', () => {
  const fp = occupiedFootprint(
    {
      id: 't',
      name: 't',
      shape: 'round',
      widthM: 1.5,
      depthM: 1.5,
      capacity: 6,
      chairWidthM: 0.45,
      chairDepthM: 0.5,
      allowed: true,
    },
    DEFAULT_DINING_LAYOUT_RULES,
  );
  assertEquals(Math.abs(fp.physicalHalfWidthM - 1.0) < 1e-9, true);
  assertEquals(Math.abs(fp.spacingHalfWidthM - 1.3) < 1e-9, true);
  assertEquals(fp.spacingHalfWidthM > fp.physicalHalfWidthM, true);
});

Deno.test('same seed is deterministic', () => {
  const a = generateDiningLayouts(baseRequest(42));
  const b = generateDiningLayouts(baseRequest(42));
  assertEquals(a.layouts.map((l) => l.fingerprint).join('|'), b.layouts.map((l) => l.fingerprint).join('|'));
});

Deno.test('different seeds explore differently when both produce layouts', () => {
  const a = generateDiningLayouts(baseRequest(1));
  const b = generateDiningLayouts(baseRequest(99));
  if (a.layouts.length > 0 && b.layouts.length > 0) {
    const same =
      a.layouts.map((l) => l.fingerprint).join('|') === b.layouts.map((l) => l.fingerprint).join('|');
    assertEquals(same, false);
  }
});

Deno.test('returned layouts match requested table count and do not shrink table size', () => {
  const result = generateDiningLayouts(baseRequest(42));
  assertEquals(result.generatorVersion, GENERATOR_VERSION);
  console.log(
    `generation durationMs=${result.durationMs} candidates=${result.candidateCount} valid=${result.validCount} returned=${result.layouts.length} reasons=${JSON.stringify(result.rejectionReasons)}`,
  );
  assertEquals(result.durationMs < 3000, true);
  assertEquals(result.layouts.length > 0, true);
  for (const layout of result.layouts) {
    assertEquals(layout.tableCount, 8);
    assertEquals(layout.capacity, 48);
    for (const table of layout.tables) {
      assertEquals(table.widthM, 1.2);
    }
  }
});

Deno.test('impossible requested count returns no layouts', () => {
  const req = baseRequest(3);
  req.target = { tableCount: 80, targetCapacity: 480 };
  const result = generateDiningLayouts(req);
  assertEquals(result.layouts.length, 0);
  assertEquals(result.exactCandidateCount, 0);
  assertEquals(result.operationalMaxTableCount < 80, true);
});

Deno.test('typical 8x10 dining block returns exact requested count or nothing', () => {
  const req = baseRequest(11);
  req.block = {
    id: 'small',
    polygon: [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 10 },
      { x: 0, y: 10 },
    ],
    widthM: 8,
    depthM: 10,
  };
  req.accessPoints = {
    entrances: [{ kind: 'entrance', xM: 4, yM: 0.25, widthM: 1.5, depthM: 0.4 }],
    exits: [{ kind: 'exit', xM: 4, yM: 9.75, widthM: 1.5, depthM: 0.4 }],
  };
  req.features = {
    stage: { xM: 7.2, yM: 5, widthM: 4, depthM: 1.2, rotationDeg: 90 },
    foodPrep: { xM: 2, yM: 9.1, widthM: 2, depthM: 1.3 },
  };
  req.target = { tableCount: 8, targetCapacity: 48 };
  const result = generateDiningLayouts(req);
  for (const layout of result.layouts) {
    assertEquals(layout.tableCount, 8);
    for (const table of layout.tables) {
      assertEquals(table.widthM, 1.2);
    }
  }
});

Deno.test('8x10 block with top stage returns exact requested count or nothing', () => {
  const req = baseRequest(21);
  req.block = {
    id: 'wizard',
    polygon: [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 10 },
      { x: 0, y: 10 },
    ],
    widthM: 8,
    depthM: 10,
  };
  req.accessPoints = {
    entrances: [{ kind: 'entrance', xM: 4, yM: 0.25, widthM: 1.5, depthM: 0.4 }],
    exits: [{ kind: 'exit', xM: 4, yM: 9.75, widthM: 1.5, depthM: 0.4 }],
  };
  req.features = {
    stage: { xM: 4, yM: 0.6, widthM: 4, depthM: 1.2, rotationDeg: 0 },
    foodPrep: { xM: 4, yM: 9, widthM: 2, depthM: 2 },
  };
  req.target = { tableCount: 8, targetCapacity: 48 };
  req.stageFacingAngleDeg = 0;
  const result = generateDiningLayouts(req);
  for (const layout of result.layouts) {
    assertEquals(layout.tableCount, 8);
    for (const table of layout.tables) {
      assertEquals(table.widthM, 1.2);
    }
  }
});

Deno.test('near-duplicate fingerprints are rejected', () => {
  const type = {
    id: 'round-6',
    name: 'Round 6',
    shape: 'round' as const,
    widthM: 1.2,
    depthM: 1.2,
    capacity: 6,
    chairWidthM: 0.45,
    chairDepthM: 0.5,
    allowed: true,
  };
  const make = (dx: number): PlacedTable[] => [
    { xM: 2 + dx, yM: 2, rotationDeg: 0, type, physicalHalfWidthM: 1, physicalHalfDepthM: 1, spacingHalfWidthM: 1.3, spacingHalfDepthM: 1.3 },
    { xM: 4 + dx, yM: 2, rotationDeg: 0, type, physicalHalfWidthM: 1, physicalHalfDepthM: 1, spacingHalfWidthM: 1.3, spacingHalfDepthM: 1.3 },
  ];
  const fa = fingerprintLayout('regular-grid', make(0), []);
  const fb = fingerprintLayout('regular-grid', make(0.1), []);
  assertEquals(isNearDuplicate(fa, fb), true);
});

Deno.test('excludeFingerprints are not returned', () => {
  const first = generateDiningLayouts(baseRequest(7));
  const fps = first.layouts.map((l) => l.fingerprint);
  const req = baseRequest(7);
  req.generation.excludeFingerprints = fps;
  const second = generateDiningLayouts(req);
  for (const layout of second.layouts) {
    assertEquals(fps.includes(layout.fingerprint), false);
  }
});

Deno.test('rng is deterministic', () => {
  const a = createRng(3);
  const b = createRng(3);
  assertEquals([a(), a(), a()].join(), [b(), b(), b()].join());
});

Deno.test('anchored stage and food prep stay at request geometry', () => {
  const req = baseRequest(5);
  req.generation = { ...req.generation, relocateFeatures: true };
  const originalStage = req.features.stage!;
  const originalFood = req.features.foodPrep!;
  const result = generateDiningLayouts(req);
  assertEquals(result.layouts.length > 0, true);
  for (const layout of result.layouts) {
    assertEquals(layout.stage != null, true);
    assertEquals(layout.foodPrep != null, true);
    assertEquals(Math.abs(layout.stage!.xM - originalStage.xM) < 0.05, true);
    assertEquals(Math.abs(layout.stage!.yM - originalStage.yM) < 0.05, true);
    assertEquals(Math.abs(layout.foodPrep!.xM - originalFood.xM) < 0.05, true);
    assertEquals(Math.abs(layout.foodPrep!.yM - originalFood.yM) < 0.05, true);
  }
});

Deno.test('stage and entrance clearance zones reject overlapping tables', () => {
  const req = baseRequest(1);
  const zones = buildForbiddenZones(req, DEFAULT_DINING_LAYOUT_RULES);
  const type = req.tableCatalogue[0];
  const onStage: PlacedTable = {
    xM: req.features.stage!.xM,
    yM: req.features.stage!.yM,
    rotationDeg: 0,
    type,
    physicalHalfWidthM: 0.8,
    physicalHalfDepthM: 0.8,
    spacingHalfWidthM: 1.1,
    spacingHalfDepthM: 1.1,
  };
  const inOpen: PlacedTable = {
    xM: 6,
    yM: 5,
    rotationDeg: 0,
    type,
    physicalHalfWidthM: 0.8,
    physicalHalfDepthM: 0.8,
    spacingHalfWidthM: 1.1,
    spacingHalfDepthM: 1.1,
  };
  assertEquals(tableHitsForbidden(onStage, zones), true);
  assertEquals(tableHitsForbidden(inOpen, zones), false);
});

Deno.test('operational maximum is witness-validated', () => {
  const req = baseRequest(17);
  req.features.stage = { xM: 8, yM: 6, widthM: 4, depthM: 1.2, rotationDeg: 0 };
  const capacity = computeOperationalCapacity(req);
  assertEquals(capacity.maximumTableCount > 0, true);
  assertEquals(capacity.witnessLayout != null, true);
  assertEquals(capacity.witnessLayout!.tables.length, capacity.maximumTableCount);
});

Deno.test('requested counts up to the witness maximum are exact', () => {
  const req = baseRequest(21);
  req.features.stage = { xM: 8, yM: 6, widthM: 4, depthM: 1.2, rotationDeg: 0 };
  const max = Math.min(8, computeOperationalCapacity(req).maximumTableCount);
  assertEquals(max >= 3, true);
  for (let n = 1; n <= max; n += 1) {
    const result = generateDiningLayouts({
      ...req,
      target: { tableCount: n, targetCapacity: n * 6 },
      generation: { ...req.generation, seed: 30 + n, suggestionCount: 2 },
    });
    assertEquals(result.layouts.length > 0, true);
    for (const layout of result.layouts) {
      assertEquals(layout.tableCount, n);
    }
  }
});

Deno.test('0.6m round tables overlap below pairwise pitch and fit at exact pitch', () => {
  const type = {
    id: 'round',
    name: 'round',
    shape: 'round' as const,
    widthM: 0.6,
    depthM: 0.6,
    capacity: 3,
    chairWidthM: 0.45,
    chairDepthM: 0.5,
    allowed: true,
  };
  const rules = { ...DEFAULT_DINING_LAYOUT_RULES, minimumTableToTableClearanceM: 0.6 };
  const fp = occupiedFootprint(type, rules);
  const pitch = fp.spacingHalfWidthM * 2;
  const a = makePlacedTable(type, fp, 2, 2, 0);
  const below = makePlacedTable(type, fp, 2 + pitch - 0.02, 2, 0);
  const exact = makePlacedTable(type, fp, 2 + pitch, 2, 0);
  assertEquals(Math.abs(fp.physicalHalfWidthM - 0.55) < 1e-9, true);
  assertEquals(Math.abs(fp.spacingHalfWidthM - 0.85) < 1e-9, true);
  assertEquals(tablesOverlap(a, below), true);
  assertEquals(tablesOverlap(a, exact), false);
});
