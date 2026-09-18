import { describe, expect, it } from 'vitest';

import {
  assignOcrCodesToCvPlacements,
  buildOcrSlotPlacements,
  clusterCodeLanes,
  laneRotationDeg,
  matchCodesToBays,
  outlineFromCodes,
  parseParkingSlotCodes,
  straightenLaneCodes,
  type ParkingCodeSlot,
} from './detect-parking-ocr';
import { pointInPolygon } from './contour-geometry';
import type { OcrToken } from './assign-ocr-labels';
import type { DetectedParkingBay } from './detect-parking-plan';
import type { ParkingSlotDefaults } from '../services/parking-slot-defaults.service';

const CAR: ParkingSlotDefaults = { lengthM: 5, widthM: 2.5, aisleWidthM: 6 };

function token(text: string, xPct: number, yPct: number, hPct = 2): OcrToken {
  return { text, xPct, yPct, hPct };
}

describe('parseParkingSlotCodes', () => {
  it('keeps bookable codes and rejects dimensions, units, titles, and lone letters', () => {
    const tokens: OcrToken[] = [
      token('S1', 10, 20),
      token('S27', 10, 80),
      token('EV3', 50, 50),
      token('A12', 30, 40),
      token('180.0', 50, 5), // dimension — has a dot
      token('m', 55, 5), // unit
      token('PARKING', 40, 2), // title word — no digits
      token('A', 45, 2), // lone letter
      token('ENTRANCE', 50, 98), // word
    ];
    const codes = parseParkingSlotCodes(tokens).map((c) => c.code);
    expect(codes).toEqual(['S1', 'S27', 'EV3', 'A12']);
  });

  it('splits the code into lane prefix + numeric index', () => {
    const [code] = parseParkingSlotCodes([token('EV12', 10, 10)]);
    expect(code.laneKey).toBe('EV');
    expect(code.index).toBe(12);
    expect(code.code).toBe('EV12');
  });

  it('drops glyphs far smaller than the median (stray marks) once enough codes exist', () => {
    const tokens: OcrToken[] = [
      token('A1', 10, 10, 3),
      token('A2', 20, 10, 3),
      token('A3', 30, 10, 3),
      token('A4', 40, 10, 3),
      token('A5', 50, 10, 3),
      token('A6', 60, 10, 3),
      token('B9', 70, 10, 0.2), // a tenth of the median height — noise
    ];
    const codes = parseParkingSlotCodes(tokens).map((c) => c.code);
    expect(codes).toContain('A1');
    expect(codes).not.toContain('B9');
  });
});

describe('clusterCodeLanes', () => {
  it('groups by letter prefix and orders each lane by numeric index', () => {
    const codes = parseParkingSlotCodes([
      token('S3', 10, 30),
      token('S1', 10, 10),
      token('S2', 10, 20),
      token('A2', 50, 20),
      token('A1', 50, 10),
    ]);
    const lanes = clusterCodeLanes(codes);
    expect([...lanes.keys()].sort()).toEqual(['A', 'S']);
    expect(lanes.get('S')!.map((c) => c.index)).toEqual([1, 2, 3]);
    expect(lanes.get('A')!.map((c) => c.index)).toEqual([1, 2]);
  });
});

describe('laneRotationDeg', () => {
  it('a vertical code column → slot long axis horizontal (0°)', () => {
    const column: ParkingCodeSlot[] = [10, 20, 30, 40].map((yPct, i) => ({
      code: `S${i + 1}`,
      laneKey: 'S',
      index: i + 1,
      xPct: 10,
      yPct,
      hPct: 2,
    }));
    expect(laneRotationDeg(column, 1000, 1000)).toBeCloseTo(0, 0);
  });

  it('a horizontal code row → slot long axis vertical (90°)', () => {
    const row: ParkingCodeSlot[] = [10, 20, 30, 40].map((xPct, i) => ({
      code: `A${i + 1}`,
      laneKey: 'A',
      index: i + 1,
      xPct,
      yPct: 50,
      hPct: 2,
    }));
    expect(laneRotationDeg(row, 1000, 1000)).toBeCloseTo(90, 0);
  });
});

describe('buildOcrSlotPlacements', () => {
  it('keeps the real codes as labels, one slot per code, grouped into lanes', () => {
    const codes = parseParkingSlotCodes([
      token('S1', 10, 20),
      token('S2', 10, 40),
      token('S3', 10, 60),
      token('A1', 40, 20),
      token('A2', 55, 20),
      token('A3', 70, 20),
    ]);
    const placements = buildOcrSlotPlacements(codes, null, 1000, 1000, CAR);
    expect(placements).toHaveLength(6);
    expect(placements.map((p) => p.label).sort()).toEqual(['A1', 'A2', 'A3', 'S1', 'S2', 'S3']);
    // Two distinct lane keys → two laneIndex groups.
    const laneKeys = new Set(placements.map((p) => p.laneKey));
    expect(laneKeys).toEqual(new Set(['S', 'A']));
    // No scale → car defaults.
    for (const p of placements) {
      expect(p.widthM).toBe(CAR.widthM);
      expect(p.lengthM).toBe(CAR.lengthM);
    }
  });

  it('sizes width from the code pitch when a scale is known', () => {
    // Codes 10% apart on a 1000px image = 100px pitch; ppm 40 → 2.5 m width.
    const codes = parseParkingSlotCodes([
      token('A1', 10, 50),
      token('A2', 20, 50),
      token('A3', 30, 50),
    ]);
    const placements = buildOcrSlotPlacements(codes, 40, 1000, 1000, CAR);
    for (const p of placements) {
      expect(p.widthM).toBeCloseTo(2.5, 1);
    }
  });
});

describe('matchCodesToBays', () => {
  // 1000×1000 plan, stalls 200×100 px (5 m × 2.5 m at 40 px/m) in a row across y = 50%.
  const bay = (cxPct: number, cyPct: number, rotationDeg = 0): DetectedParkingBay => ({
    cxPct,
    cyPct,
    rotationDeg,
    lengthPx: 200,
    widthPx: 100,
  });

  it('matches a code printed off-centre in its stall, and leaves an aisle code unmatched', () => {
    const bays = [bay(20, 50), bay(30, 50)];
    // A1/A2 sit 60 px toward the head of their stall; A3 is out on the aisle.
    const codes = parseParkingSlotCodes([token('A1', 14, 50), token('A2', 24, 50), token('A3', 80, 20)]);
    const matched = matchCodesToBays(codes, bays, 1000, 1000);
    expect(matched[0]).toBe(bays[0]);
    expect(matched[1]).toBe(bays[1]);
    expect(matched[2]).toBeNull();
  });

  it('never assigns two codes to the same stall', () => {
    const bays = [bay(20, 50), bay(30, 50)];
    // Both codes fall inside both padded rectangles; greedy nearest-first must split them.
    const codes = parseParkingSlotCodes([token('A1', 19, 50), token('A2', 25, 50)]);
    const matched = matchCodesToBays(codes, bays, 1000, 1000);
    expect(matched[0]).not.toBeNull();
    expect(matched[1]).not.toBeNull();
    expect(matched[0]).not.toBe(matched[1]);
  });

  it('tests containment in the bay-local frame, so a rotated stall does not over-claim', () => {
    // Depth axis vertical: the stall reaches ±100 px in y and only ±50 px in x.
    const bays = [bay(50, 50, 90)];
    const nearInY = parseParkingSlotCodes([token('A1', 50, 58)]);
    const farInX = parseParkingSlotCodes([token('A1', 58, 50)]);
    expect(matchCodesToBays(nearInY, bays, 1000, 1000)[0]).toBe(bays[0]);
    expect(matchCodesToBays(farInX, bays, 1000, 1000)[0]).toBeNull();
  });
});

describe('buildOcrSlotPlacements with detected bays', () => {
  const bays: DetectedParkingBay[] = [20, 30, 40].map((cxPct) => ({
    cxPct,
    cyPct: 50,
    rotationDeg: 0,
    lengthPx: 200,
    widthPx: 100,
  }));

  it('places slots on the stalls, at the stall angle and measured size', () => {
    const codes = parseParkingSlotCodes([token('A1', 14, 50), token('A2', 24, 50), token('A3', 34, 50)]);
    const placements = buildOcrSlotPlacements(codes, 40, 1000, 1000, CAR, bays);
    expect(placements.map((p) => p.xPct)).toEqual([20, 30, 40]);
    for (const p of placements) {
      expect(p.yPct).toBe(50);
      // The bay's own depth angle, not the 90° PCA axis of the horizontal code row.
      expect(p.rotationDeg).toBe(0);
      expect(p.lengthM).toBe(5);
      expect(p.widthM).toBe(2.5);
    }
  });

  it('keeps the code position for a code that matched no stall', () => {
    const codes = parseParkingSlotCodes([token('A1', 14, 50), token('A2', 24, 50), token('A3', 90, 90)]);
    const placements = buildOcrSlotPlacements(codes, 40, 1000, 1000, CAR, bays);
    const stray = placements.find((p) => p.label === 'A3');
    expect(stray).toBeDefined();
    expect(stray!.xPct).toBe(90);
    expect(stray!.yPct).toBe(90);
  });

  it('renders a schematic plan at its drawn size instead of clamping back to a car bay', () => {
    // A plan drawn well off its printed scale: stalls 50 px wide at 5 px/m read as 10 m,
    // four times a real car bay. Clamping that to 4.5 m is what left slots floating at
    // half the size of the boxes they sit on.
    const schematicBays: DetectedParkingBay[] = [20, 30, 40].map((cxPct) => ({
      cxPct,
      cyPct: 50,
      rotationDeg: 0,
      lengthPx: 70,
      widthPx: 50,
    }));
    const codes = parseParkingSlotCodes([token('A1', 19, 50), token('A2', 29, 50), token('A3', 39, 50)]);
    const placements = buildOcrSlotPlacements(codes, 5, 1000, 1000, CAR, schematicBays);
    for (const p of placements) {
      expect(p.widthM).toBe(10);
      expect(p.lengthM).toBe(14);
    }
  });

  it('takes the stall pitch as the width when a lane matched no traced cell', () => {
    // Codes 5% apart on a 1000 px image = 50 px pitch; at 5 px/m the stalls are 10 m wide.
    const codes = parseParkingSlotCodes([token('D1', 10, 80), token('D2', 15, 80), token('D3', 20, 80)]);
    const placements = buildOcrSlotPlacements(codes, 5, 1000, 1000, CAR, []);
    for (const p of placements) {
      expect(p.widthM).toBe(10);
      // No traced cell anywhere on the plan → the car aspect (5 m / 2.5 m = 2:1).
      expect(p.lengthM).toBe(20);
    }
  });

  it('borrows the depth ratio of the traced stalls for a lane that matched none', () => {
    const codes = parseParkingSlotCodes([
      token('A1', 14, 50), // matches a 200×100 px bay → 2:1
      token('A2', 24, 50),
      token('D1', 10, 80), // no bay down here; pitch 50 px
      token('D2', 15, 80),
      token('D3', 20, 80),
    ]);
    const wideBays: DetectedParkingBay[] = [20, 30].map((cxPct) => ({
      cxPct,
      cyPct: 50,
      rotationDeg: 0,
      lengthPx: 140, // 1.4:1, not the car's 2:1
      widthPx: 100,
    }));
    const placements = buildOcrSlotPlacements(codes, 5, 1000, 1000, CAR, wideBays);
    const d1 = placements.find((p) => p.label === 'D1')!;
    expect(d1.widthM).toBe(10);
    expect(d1.lengthM).toBe(14); // 10 m × the plan's own 1.4 ratio, not the car's 2.0
  });

  it('distrusts matched cells that contradict the lane\'s own code pitch — the T-column regression: wrong big cells must not drag the lane off the drawing at an inflated size', () => {
    // T column: 6 codes pitched 30 px apart down x = 800. The CV traced big neighbouring
    // cells (70 px wide — over twice the pitch) whose padded rects contain the codes.
    const codes = parseParkingSlotCodes(
      [0, 1, 2, 3, 4, 5].map((i) => token(`T${i + 1}`, 80, 10 + i * 3)),
    );
    const wrongCells: DetectedParkingBay[] = [0, 1, 2, 3, 4, 5].map((i) => ({
      cxPct: 76,
      cyPct: 10 + i * 3,
      rotationDeg: 0,
      lengthPx: 140,
      widthPx: 70,
    }));
    const placements = buildOcrSlotPlacements(codes, 10, 1000, 1000, CAR, wrongCells);
    for (const p of placements) {
      expect(p.xPct).toBe(80); // stays on the printed code column, not the wrong cells
      expect(p.widthM).toBe(3); // 30 px pitch at 10 px/m — not the cells' 7 m
    }
  });

  it('drops a single oversized matched cell but keeps the rest of the lane on its cells', () => {
    const codes = parseParkingSlotCodes([
      token('A1', 14, 50),
      token('A2', 24, 50),
      token('A3', 34, 50),
      token('A4', 44, 50),
    ]);
    const goodCell = (cxPct: number): DetectedParkingBay => ({
      cxPct,
      cyPct: 50,
      rotationDeg: 0,
      lengthPx: 200,
      widthPx: 100,
    });
    // A3's code landed inside a double-width wrong cell instead of its own.
    const wrongCell: DetectedParkingBay = { cxPct: 36, cyPct: 50, rotationDeg: 0, lengthPx: 300, widthPx: 220 };
    const placements = buildOcrSlotPlacements(codes, 40, 1000, 1000, CAR, [
      goodCell(20),
      goodCell(30),
      wrongCell,
      goodCell(50),
    ]);
    const byLabel = new Map(placements.map((p) => [p.label, p]));
    expect(byLabel.get('A1')!.xPct).toBe(20);
    expect(byLabel.get('A2')!.xPct).toBe(30);
    expect(byLabel.get('A4')!.xPct).toBe(50);
    // A3 refuses the wrong cell but still sits on the shared stall line (code + median offset).
    expect(byLabel.get('A3')!.xPct).toBeCloseTo(40, 0);
    expect(byLabel.get('A3')!.widthM).toBe(2.5);
    expect(byLabel.get('A3')!.lengthM).toBe(5);
  });

  it('drops a bay whose centre is out of line with its lane and uses the straightened rect — the D4/D7/S11/S18/A15 overlapped-cell case', () => {
    // A straight 6-code row, pitch 100 px. Five bays sit centred on their codes; A4's
    // cell was drawn across by an arrow, so its traced centre is shifted a full pitch off
    // the row and its box is distorted.
    const codes = parseParkingSlotCodes(
      [0, 1, 2, 3, 4, 5].map((i) => token(`A${i + 1}`, 10 + i * 10, 50)),
    );
    const bays: DetectedParkingBay[] = codes.map((c, i) => ({
      cxPct: c.xPct,
      cyPct: i === 3 ? 62 : 50, // A4 shoved 12% (> 0.3 pitch) off the row
      rotationDeg: i === 3 ? 35 : 0, // and rotated by the bite
      lengthPx: 200,
      widthPx: 100,
    }));
    const placements = buildOcrSlotPlacements(codes, 40, 1000, 1000, CAR, bays);
    const a4 = placements.find((p) => p.label === 'A4')!;
    // Snaps back onto the straight row, upright, no distorted shape.
    expect(a4.yPct).toBeCloseTo(50, 0);
    expect(a4.rotationDeg).toBe(0);
    expect(a4.shapePoints).toBeUndefined();
    // The clean neighbours still ride their own cells.
    expect(placements.find((p) => p.label === 'A3')!.rotationDeg).toBe(0);
  });

  it('forces lane-median rotation even when a mildly tilted bay would pass the old 15° gate (D6 case)', () => {
    const codes = parseParkingSlotCodes(
      [0, 1, 2, 3, 4, 5, 6].map((i) => token(`D${i + 1}`, 10 + i * 10, 50)),
    );
    const bays: DetectedParkingBay[] = codes.map((c, i) => ({
      cxPct: c.xPct,
      // D6 shoved down — must still land on the shared row, not its own bay centre.
      cyPct: i === 5 ? 58 : 50,
      rotationDeg: i === 5 ? 12 : 0,
      lengthPx: 200,
      widthPx: 100,
    }));
    const placements = buildOcrSlotPlacements(codes, 40, 1000, 1000, CAR, bays);
    const d6 = placements.find((p) => p.label === 'D6')!;
    expect(d6.rotationDeg).toBe(0);
    expect(d6.yPct).toBeCloseTo(50, 0);
    // Whole D lane colinear on y.
    expect(placements.filter((p) => p.label?.startsWith('D')).every((p) => Math.abs(p.yPct - 50) < 0.5)).toBe(
      true,
    );
  });

  it('falls back to the code positions entirely when no bays were detected', () => {
    const codes = parseParkingSlotCodes([token('A1', 14, 50), token('A2', 24, 50), token('A3', 34, 50)]);
    const placements = buildOcrSlotPlacements(codes, 40, 1000, 1000, CAR, []);
    expect(placements.map((p) => p.xPct)).toEqual([14, 24, 34]);
  });
});

describe('straightenLaneCodes', () => {
  const lane = (specs: [string, number, number][]): ParkingCodeSlot[] =>
    parseParkingSlotCodes(specs.map(([text, x, y]) => token(text, x, y)));

  it('snaps a jittered column onto one straight, evenly-pitched line', () => {
    // True column at x=20, pitch 10 in y — each code nudged by OCR jitter.
    const codes = lane([
      ['S1', 20.8, 10.4],
      ['S2', 19.5, 20.3],
      ['S3', 20.4, 29.2],
      ['S4', 19.6, 40.5],
      ['S5', 20.2, 49.6],
    ]);
    const snapped = straightenLaneCodes(codes, 1000, 1000);
    expect(snapped.size).toBe(5);
    const positions = codes.map((c) => snapped.get(c)!);
    // Straight + evenly pitched = every consecutive step is the same vector.
    const stepX = positions[1].xPct - positions[0].xPct;
    const stepY = positions[1].yPct - positions[0].yPct;
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i].xPct - positions[i - 1].xPct).toBeCloseTo(stepX, 1);
      expect(positions[i].yPct - positions[i - 1].yPct).toBeCloseTo(stepY, 1);
    }
    // The fitted line stays a (near-vertical) column: x barely moves per step, y ≈ pitch 10.
    expect(Math.abs(stepX)).toBeLessThan(1);
    expect(stepY).toBeCloseTo(10, 0);
  });

  it('a missing number leaves a gap of exactly one pitch (S3 unreadable on the plan)', () => {
    const codes = lane([
      ['S1', 20, 10],
      ['S2', 20, 20],
      ['S4', 20, 40],
      ['S5', 20, 50],
    ]);
    const snapped = straightenLaneCodes(codes, 1000, 1000);
    expect(snapped.size).toBe(4);
    const byCode = new Map(codes.map((c) => [c.code, snapped.get(c)!]));
    // S2 → S4 spans two pitches.
    expect(byCode.get('S4')!.yPct - byCode.get('S2')!.yPct).toBeCloseTo(
      2 * (byCode.get('S2')!.yPct - byCode.get('S1')!.yPct),
      1,
    );
  });

  it('returns nothing for a lane with duplicate numbers (OCR misread — snapping would stack them)', () => {
    const codes = lane([
      ['A12', 30, 10],
      ['A12', 40, 10],
      ['A13', 50, 10],
    ]);
    expect(straightenLaneCodes(codes, 1000, 1000).size).toBe(0);
  });

  it('returns nothing for a lane that is not actually a straight row (an L around a corner)', () => {
    const codes = lane([
      ['T1', 10, 10],
      ['T2', 10, 20],
      ['T3', 10, 30],
      ['T4', 20, 38],
      ['T5', 30, 38],
      ['T6', 40, 38],
    ]);
    expect(straightenLaneCodes(codes, 1000, 1000).size).toBe(0);
  });

  it('returns nothing when the whole fit is poor (one wild outlier drags least squares)', () => {
    const codes = lane([
      ['A1', 14, 50],
      ['A2', 24, 50],
      ['A3', 90, 90],
    ]);
    expect(straightenLaneCodes(codes, 1000, 1000).size).toBe(0);
  });

  it('keeps an individual code with a big residual at its raw position, snapping the rest', () => {
    // Six clean codes, pitch 10 — A4's centre misread 8 units off along the row (small
    // misreads inside the half-pitch threshold get corrected toward the fit instead).
    const codes = lane([
      ['A1', 10, 50],
      ['A2', 20, 50],
      ['A3', 30, 50],
      ['A4', 48, 50],
      ['A5', 50, 50],
      ['A6', 60, 50],
    ]);
    const snapped = straightenLaneCodes(codes, 1000, 1000);
    const a4 = codes.find((c) => c.code === 'A4')!;
    expect(snapped.has(a4)).toBe(false);
    expect(snapped.size).toBe(5);
  });

  it('is exact for an already-perfect lane (no drift from the fit itself)', () => {
    const codes = lane([
      ['D1', 10, 80],
      ['D2', 15, 80],
      ['D3', 20, 80],
    ]);
    const snapped = straightenLaneCodes(codes, 1000, 1000);
    expect(snapped.get(codes[0])).toEqual({ xPct: 10, yPct: 80 });
    expect(snapped.get(codes[1])).toEqual({ xPct: 15, yPct: 80 });
    expect(snapped.get(codes[2])).toEqual({ xPct: 20, yPct: 80 });
  });
});

describe('outlineFromCodes', () => {
  it('produces a padded hull that contains every code', () => {
    const codes = parseParkingSlotCodes([
      token('A1', 20, 20),
      token('A2', 80, 20),
      token('A3', 80, 80),
      token('A4', 20, 80),
      token('A5', 50, 50),
    ]);
    const outline = outlineFromCodes(codes, 1000, 1000);
    expect(outline.length).toBeGreaterThanOrEqual(3);
    for (const code of codes) {
      expect(pointInPolygon(code.xPct, code.yPct, outline)).toBe(true);
    }
  });
});

describe('assignOcrCodesToCvPlacements', () => {
  it('names nearest CV slots from printed codes and reports uncovered codes', () => {
    const placements = [
      { xPct: 20, yPct: 20, rotationDeg: 0, lengthM: 5, widthM: 2.5, laneIndex: 0 },
      { xPct: 40, yPct: 20, rotationDeg: 0, lengthM: 5, widthM: 2.5, laneIndex: 0 },
    ];
    const codes = parseParkingSlotCodes([token('D4', 20.5, 20.2), token('D5', 80, 80)]);
    const { placements: next, uncovered } = assignOcrCodesToCvPlacements(placements, codes);
    expect(next[0].label).toBe('D4');
    expect(next[0].laneKey).toBe('D');
    expect(next[1].label).toBeUndefined();
    expect(uncovered.map((c) => c.code)).toEqual(['D5']);
  });
});
