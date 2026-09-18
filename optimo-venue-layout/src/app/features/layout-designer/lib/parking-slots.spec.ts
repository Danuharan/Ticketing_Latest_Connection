import { describe, expect, it } from 'vitest';

import {
  fillSlotsAlongPath,
  laneLetterFromIndex,
  nextParkingLaneLetter,
  planParkingSlots,
  rotatedRectsOverlap,
  slotRectCorners,
  type PlannedSlot,
} from './parking-slots';
import { ParkingSlotDefaults } from '../services/parking-slot-defaults.service';

// 40 px/m, matches the convention used in parking-shape.spec.ts.
const PX_PER_METER = 40;
const CAR: ParkingSlotDefaults = { lengthM: 5, widthM: 2.5, aisleWidthM: 6 };

function expectNoOverlaps(slots: PlannedSlot[]): void {
  const corners = slots.map(slotRectCorners);
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      expect(rotatedRectsOverlap(corners[i], corners[j])).toBe(false);
    }
  }
}

describe('fillSlotsAlongPath', () => {
  it('fills a straight segment with the maximum number of slots that fit (single-side)', () => {
    const path = [{ x: 0, y: 0 }, { x: 1000, y: 0 }];
    // Outline centroid below the line (larger y) so "inward" is unambiguous.
    const outline = [{ x: -100, y: 0 }, { x: 1100, y: 0 }, { x: 1100, y: 1000 }, { x: -100, y: 1000 }];
    const slots = fillSlotsAlongPath(path, outline, PX_PER_METER, CAR, 'single');
    // 1000px segment / (2.5m * 40px/m = 100px pitch) = 10 slots.
    expect(slots.length).toBe(10);
    expect(slots[0].rotationDeg).toBeCloseTo(90, 0);
    // Slot centre sits lengthPx/2 = 100px inward (toward the outline centroid, +y) of the line.
    expect(slots[0].yPx).toBeCloseTo(100, 0);
  });

  it('leaves a real drivable gap (the vehicle aisle width) between double-side rows', () => {
    const path = [{ x: 0, y: 0 }, { x: 1000, y: 0 }];
    const outline = [{ x: -100, y: 0 }, { x: 1100, y: 0 }, { x: 1100, y: 1000 }, { x: -100, y: 1000 }];
    const slots = fillSlotsAlongPath(path, outline, PX_PER_METER, CAR, 'double');
    expect(slots.length).toBe(20);
    const [a, b] = slots; // first pair, same position-along-line
    const lengthPx = CAR.lengthM * PX_PER_METER;
    const innerFaceA = a.yPx - lengthPx / 2;
    const innerFaceB = b.yPx + lengthPx / 2;
    const gapPx = Math.abs(innerFaceA - innerFaceB);
    // Must equal the vehicle's aisle width in px, not zero — a vehicle needs to fit between the rows.
    expect(gapPx).toBeCloseTo(CAR.aisleWidthM * PX_PER_METER, 0);
    expect(b.rotationDeg).toBeCloseTo(a.rotationDeg + 180, 0);
  });

  it('angled slots use a wider along-row pitch and a non-perpendicular rotation', () => {
    const path = [{ x: 0, y: 0 }, { x: 1000, y: 0 }];
    const outline = [{ x: -100, y: 0 }, { x: 1100, y: 0 }, { x: 1100, y: 1000 }, { x: -100, y: 1000 }];
    const single = fillSlotsAlongPath(path, outline, PX_PER_METER, CAR, 'single');
    const angled = fillSlotsAlongPath(path, outline, PX_PER_METER, CAR, 'angled');
    // widthM/sin(60°) > widthM, so fewer (wider-pitched) slots fit than perpendicular.
    expect(angled.length).toBeLessThan(single.length);
    expect(angled[0].rotationDeg).toBeCloseTo(60, 0);
  });

  it('continues filling slots across a bent (multi-click) path, one direction per segment', () => {
    const path = [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }];
    const outline = [{ x: -200, y: -200 }, { x: 700, y: -200 }, { x: 700, y: 700 }, { x: -200, y: 700 }];
    const slots = fillSlotsAlongPath(path, outline, PX_PER_METER, CAR, 'single');
    // 500px / 100px pitch = 5 slots per segment.
    expect(slots.length).toBe(10);
    const firstSegmentRotations = slots.slice(0, 5).map((s) => Math.round(s.rotationDeg));
    const secondSegmentRotations = slots.slice(5).map((s) => Math.round(s.rotationDeg));
    expect(new Set(firstSegmentRotations).size).toBe(1);
    expect(new Set(secondSegmentRotations).size).toBe(1);
    // The two segments run in different directions, so their slot rotations must differ.
    expect(firstSegmentRotations[0]).not.toBe(secondSegmentRotations[0]);
  });

  it('returns nothing when the path or outline is degenerate', () => {
    expect(fillSlotsAlongPath([{ x: 0, y: 0 }], [], PX_PER_METER, CAR, 'single')).toEqual([]);
    expect(
      fillSlotsAlongPath([{ x: 0, y: 0 }, { x: 10, y: 0 }], [], PX_PER_METER, CAR, 'single'),
    ).toEqual([]);
  });
});

describe('planParkingSlots (placement rules)', () => {
  // Big outline that comfortably contains everything drawn below.
  const BIG_OUTLINE = [
    { x: -300, y: -300 },
    { x: 1400, y: -300 },
    { x: 1400, y: 1400 },
    { x: -300, y: 1400 },
  ];

  it('keeps a full flush row untouched — edge-to-edge neighbours are not overlaps', () => {
    const path = [{ x: 0, y: 0 }, { x: 1000, y: 0 }];
    const slots = planParkingSlots(path, BIG_OUTLINE, PX_PER_METER, CAR, 'single');
    expect(slots.length).toBe(10);
    expectNoOverlaps(slots);
  });

  it('drops corner pile-ups on a bent path and keeps a car-width gap between the two rows', () => {
    // L-shaped path: along the top edge, then down the right side — the exact
    // screenshot scenario where corner slots piled on top of each other.
    const path = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }];
    const raw = fillSlotsAlongPath(path, BIG_OUTLINE, PX_PER_METER, CAR, 'single');
    const slots = planParkingSlots(path, BIG_OUTLINE, PX_PER_METER, CAR, 'single');
    expect(raw.length).toBe(20);
    // Corner slots of the second row that overlap (or sit closer than one car width
    // to) the first row are dropped.
    expect(slots.length).toBe(17);
    expectNoOverlaps(slots);
  });

  it('keeps every slot rectangle out of the way circle around a gate', () => {
    const path = [{ x: 0, y: 0 }, { x: 1000, y: 0 }];
    const gate = { x: 500, y: 0 };
    const slots = planParkingSlots(path, BIG_OUTLINE, PX_PER_METER, CAR, 'single', {
      gateCenters: [gate],
    });
    // Way radius 10m = 400px: only the outermost slot at each end survives.
    expect(slots.length).toBe(2);
    for (const slot of slots) {
      // No corner of any kept slot may be inside the way circle.
      for (const c of slotRectCorners(slot)) {
        expect(Math.hypot(c.x - gate.x, c.y - gate.y)).toBeGreaterThanOrEqual(400);
      }
    }
  });

  it('drops slots whose rectangle pokes outside the outline, even when the centre is inside', () => {
    // Shallow strip (150px = 3.75m deep) — a 5m-long car cannot fit, so everything drops.
    const shallow = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 150 }, { x: 0, y: 150 }];
    expect(planParkingSlots([{ x: 0, y: 140 }, { x: 1000, y: 140 }], shallow, PX_PER_METER, CAR, 'single')).toEqual([]);

    // Deeper strip (400px = 10m): the same row fits fully inside and is kept.
    const deep = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 400 }, { x: 0, y: 400 }];
    const slots = planParkingSlots([{ x: 0, y: 350 }, { x: 1000, y: 350 }], deep, PX_PER_METER, CAR, 'single');
    expect(slots.length).toBe(10);
  });

  it('refuses to stack a new lane on top of an already-committed lane', () => {
    const path = [{ x: 0, y: 0 }, { x: 1000, y: 0 }];
    const firstLane = planParkingSlots(path, BIG_OUTLINE, PX_PER_METER, CAR, 'single');
    const secondLane = planParkingSlots(path, BIG_OUTLINE, PX_PER_METER, CAR, 'single', {
      existingSlots: firstLane,
    });
    expect(secondLane).toEqual([]);
  });
});

describe('double-angled (herringbone) pattern', () => {
  it('mirrors angled rows on both sides with the aisle clear between them', () => {
    const path = [{ x: 0, y: 0 }, { x: 1000, y: 0 }];
    const outline = [{ x: -600, y: -600 }, { x: 1600, y: -600 }, { x: 1600, y: 600 }, { x: -600, y: 600 }];
    const slots = fillSlotsAlongPath(path, outline, PX_PER_METER, CAR, 'double-angled');
    // Same pitch as angled (width / sin 60° ≈ 115.5px) → 8 positions × 2 sides.
    expect(slots.length).toBe(16);
    const sideA = slots.filter((s) => s.yPx > 0);
    const sideB = slots.filter((s) => s.yPx < 0);
    expect(sideA.length).toBe(8);
    expect(sideB.length).toBe(8);
    // Mirrored tilts: +60° one side, -60° the other.
    expect(sideA[0].rotationDeg).toBeCloseTo(60, 0);
    expect(sideB[0].rotationDeg).toBeCloseTo(-60, 0);
    // Clear gap between the two rows' nearest extents equals the aisle width (6m = 240px):
    // centre offset − tilted-rect extent toward the line = aisle/2 on each side.
    const extentPerp = 100 * Math.sin(Math.PI / 3) + 50 * Math.cos(Math.PI / 3);
    const gap = sideA[0].yPx - extentPerp - (sideB[0].yPx + extentPerp);
    expect(gap).toBeCloseTo(CAR.aisleWidthM * PX_PER_METER, 0);
  });
});

describe("'one' stamp pattern", () => {
  const OUTLINE = [{ x: -600, y: -600 }, { x: 1600, y: -600 }, { x: 1600, y: 600 }, { x: -600, y: 600 }];

  it('places exactly one axis-aligned slot per clicked point', () => {
    const clicks = [{ x: 100, y: 100 }, { x: 500, y: 200 }, { x: 900, y: 300 }];
    const slots = fillSlotsAlongPath(clicks, OUTLINE, PX_PER_METER, CAR, 'one');
    expect(slots.length).toBe(3);
    expect(slots[0]).toMatchObject({ xPx: 100, yPx: 100, rotationDeg: 0 });
  });

  it('allows stamps side by side without a forced corridor, but never overlapping', () => {
    // 200px apart = exactly one car length → rects touch edge-to-edge, both kept.
    const touching = planParkingSlots(
      [{ x: 100, y: 100 }, { x: 300, y: 100 }],
      OUTLINE,
      PX_PER_METER,
      CAR,
      'one',
    );
    expect(touching.length).toBe(2);
    // Two clicks on the same spot → the second overlapping stamp is dropped.
    const stacked = planParkingSlots(
      [{ x: 100, y: 100 }, { x: 110, y: 100 }],
      OUTLINE,
      PX_PER_METER,
      CAR,
      'one',
    );
    expect(stacked.length).toBe(1);
  });
});

describe('lane letters (bookable slot codes)', () => {
  it('maps indexes to spreadsheet-style letters', () => {
    expect(laneLetterFromIndex(0)).toBe('A');
    expect(laneLetterFromIndex(25)).toBe('Z');
    expect(laneLetterFromIndex(26)).toBe('AA');
    expect(laneLetterFromIndex(27)).toBe('AB');
  });

  it('issues the next unused letter and never re-issues a removed lane letter', () => {
    expect(nextParkingLaneLetter([])).toBe('A');
    expect(nextParkingLaneLetter(['A1', 'A2', 'A3'])).toBe('B');
    // Lane B was removed — only A and C remain — but B must NOT be re-issued,
    // otherwise a booked "B4" could suddenly mean a different physical slot.
    expect(nextParkingLaneLetter(['A1', 'C1', 'C2'])).toBe('D');
    expect(nextParkingLaneLetter(['Z9'])).toBe('AA');
    // Legacy slots without labels are ignored.
    expect(nextParkingLaneLetter([undefined, 'A1'])).toBe('B');
  });
});
