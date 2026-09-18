import { describe, expect, it } from 'vitest';

import {
  assignEdgeLengths,
  buildDetectedSlots,
  computeBorderMask,
  dedupeCloseCandidates,
  detectCellsAtPoints,
  detectParkingPlan,
  ensureOutlineContainsBays,
  filterOrientationOutliers,
  parseDimensionTokens,
  polygonSelfIntersects,
  resolveParkingPlanScale,
  suggestPlanName,
  type DetectedParkingBay,
  type ParkingPlanRaster,
} from './detect-parking-plan';
import { isBorderPixel } from './flood-fill';
import { pointInPolygon } from './contour-geometry';
import type { ParkingSlotDefaults } from '../services/parking-slot-defaults.service';
import type { OcrToken } from './assign-ocr-labels';

const CAR: ParkingSlotDefaults = { lengthM: 5, widthM: 2.5, aisleWidthM: 6 };

const GRAY: [number, number, number] = [128, 128, 128];
const WHITE: [number, number, number] = [255, 255, 255];

function makeRaster(width: number, height: number): ParkingPlanRaster {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255); // white background, opaque
  return { data, width, height };
}

function fillRect(
  raster: ParkingPlanRaster,
  x: number,
  y: number,
  w: number,
  h: number,
  [r, g, b]: [number, number, number],
): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const i = (yy * raster.width + xx) * 4;
      raster.data[i] = r;
      raster.data[i + 1] = g;
      raster.data[i + 2] = b;
      raster.data[i + 3] = 255;
    }
  }
}

/** White-outlined bay (14×24 outer) with a gray 10×20 interior — vertical depth axis. */
function addBay(raster: ParkingPlanRaster, x: number, y: number): void {
  fillRect(raster, x, y, 14, 24, WHITE);
  fillRect(raster, x + 2, y + 2, 10, 20, GRAY);
}

/** 300×200 plan: gray lot rect (20,20)–(280,180) with two rows of 8 bays. */
function makePlanRaster(): ParkingPlanRaster {
  const raster = makeRaster(300, 200);
  fillRect(raster, 20, 20, 260, 160, GRAY);
  for (let i = 0; i < 8; i++) {
    addBay(raster, 40 + i * 18, 40); // top row
    addBay(raster, 40 + i * 18, 120); // bottom row
  }
  return raster;
}

describe('detectParkingPlan', () => {
  it('detects the lot outline as a simple polygon close to the drawn rectangle', () => {
    const detection = detectParkingPlan(makePlanRaster());
    expect(detection).not.toBeNull();
    const outline = detection!.outlinePct;
    expect(outline.length).toBeGreaterThanOrEqual(3);
    expect(outline.length).toBeLessThanOrEqual(12);
    const xs = outline.map((p) => p.xPct);
    const ys = outline.map((p) => p.yPct);
    // Lot spans x 20–280 of 300 (6.7%–93.3%), y 20–180 of 200 (10%–90%);
    // contour vertices sit on boundary pixels, so allow ~1.5% (≈4px) slack.
    expect(Math.abs(Math.min(...xs) - 6.7)).toBeLessThan(1.5);
    expect(Math.abs(Math.max(...xs) - 93.3)).toBeLessThan(1.5);
    expect(Math.abs(Math.min(...ys) - 10)).toBeLessThan(1.5);
    expect(Math.abs(Math.max(...ys) - 90)).toBeLessThan(1.5);
  });

  it('detects every bay with the right orientation and size', () => {
    const detection = detectParkingPlan(makePlanRaster());
    expect(detection!.bays.length).toBe(16);
    for (const bay of detection!.bays) {
      // Depth axis is vertical → ±90°.
      const angle = Math.abs(bay.rotationDeg);
      expect(angle).toBeGreaterThan(85);
      expect(angle).toBeLessThan(95);
      expect(bay.widthPx).toBeGreaterThan(8);
      expect(bay.widthPx).toBeLessThan(12);
      expect(bay.lengthPx).toBeGreaterThan(17);
      expect(bay.lengthPx).toBeLessThan(23);
    }
  });

  it('still separates adjacent bays correctly when their dividing line is soft/anti-aliased (not pure white/black)', () => {
    // Same 8+8 bay grid as makePlanRaster, but each bay's outline is a soft off-white
    // (210) with a 1px 170-gray blend ring — representative of a scanned/exported plan
    // where cell dividers aren't razor-sharp — instead of the crisp pure-white outline.
    const raster = makeRaster(300, 200);
    fillRect(raster, 20, 20, 260, 160, GRAY);
    const SOFT_WHITE: [number, number, number] = [210, 210, 210];
    const BLEND: [number, number, number] = [170, 170, 170];
    for (let i = 0; i < 8; i++) {
      for (const y of [40, 120]) {
        const x = 40 + i * 18;
        fillRect(raster, x, y, 14, 24, SOFT_WHITE);
        fillRect(raster, x - 1, y - 1, 16, 1, BLEND); // top blend ring
        fillRect(raster, x - 1, y + 24, 16, 1, BLEND); // bottom blend ring
        fillRect(raster, x + 2, y + 2, 10, 20, GRAY);
      }
    }
    const detection = detectParkingPlan(raster);
    expect(detection).not.toBeNull();
    // Must still find all 16 distinct bays — neither merged into fewer nor fragmented into more.
    expect(detection!.bays.length).toBe(16);
  });

  it('detects a DARK-THEMED plan (dark navy lot, light gold bay boxes) — the inverse of the usual light-background assumption', () => {
    const NAVY: [number, number, number] = [30, 40, 55]; // dark background — mean luminance triggers inversion
    const GOLD: [number, number, number] = [180, 150, 80]; // light bay fill, distinct from inverted-navy
    const raster = makeRaster(300, 200);
    fillRect(raster, 0, 0, 300, 200, NAVY); // the whole plan is dark, not just the lot
    fillRect(raster, 20, 20, 260, 160, NAVY);
    for (let i = 0; i < 8; i++) {
      for (const y of [40, 120]) {
        fillRect(raster, 40 + i * 18, y, 14, 24, GOLD);
      }
    }
    const detection = detectParkingPlan(raster);
    expect(detection).not.toBeNull();
    expect(detection!.bays.length).toBe(16);
    for (const bay of detection!.bays) {
      expect(pointInPolygon(bay.cxPct, bay.cyPct, detection!.outlinePct)).toBe(true);
    }
  });

  it('adapts its line/cell cutoff to a low-contrast plan a fixed threshold would miss (neither tone crosses the old fixed 140 cutoff)', () => {
    const LIGHT_LINE: [number, number, number] = [190, 190, 190]; // "dark" only relative to this image
    const LIGHT_CELL: [number, number, number] = [235, 235, 235];
    const raster = makeRaster(300, 200);
    fillRect(raster, 0, 0, 300, 200, LIGHT_CELL);
    for (let i = 0; i < 10; i++) {
      for (const y of [40, 120]) {
        fillRect(raster, 40 + i * 16, y, 16, 26, LIGHT_LINE);
        fillRect(raster, 42 + i * 16, y + 2, 12, 22, LIGHT_CELL);
      }
    }
    const detection = detectParkingPlan(raster);
    expect(detection).not.toBeNull();
    expect(detection!.bays.length).toBe(20);
  });

  it('leaves an ordinary light-themed plan untouched (no unnecessary inversion)', () => {
    // Mean luminance of makePlanRaster (light gray lot, white bays) is well above the
    // dark-theme cutoff, so detection must behave exactly as the very first test above.
    const detection = detectParkingPlan(makePlanRaster());
    expect(detection!.bays.length).toBe(16);
  });

  it('traces the printed boundary from the drawing itself — side strips in other colours are part of the block, and an entrance gap does not leak the outline', () => {
    // Realistic plan anatomy: white page, dark boundary stroke (rounded-rect style),
    // gray asphalt interior, and a tan side-stall strip INSIDE the boundary whose
    // colour differs from the asphalt — the colour-region "lot" alone would be just
    // the asphalt. Boundary stroke broken at the bottom (an entrance gap).
    const DARK: [number, number, number] = [40, 40, 40];
    const TAN: [number, number, number] = [205, 185, 150];
    const raster = makeRaster(300, 200);
    fillRect(raster, 20, 20, 260, 3, DARK); // top stroke
    fillRect(raster, 20, 177, 260, 3, DARK); // bottom stroke
    fillRect(raster, 20, 20, 3, 160, DARK); // left stroke
    fillRect(raster, 277, 20, 3, 160, DARK); // right stroke
    fillRect(raster, 140, 177, 20, 3, WHITE); // entrance gap in the bottom stroke
    fillRect(raster, 23, 23, 254, 154, GRAY); // asphalt
    fillRect(raster, 26, 26, 20, 148, TAN); // side-stall strip, different colour

    const detection = detectParkingPlan(raster);
    expect(detection).not.toBeNull();
    const outline = detection!.outlinePct;
    // Follows the boundary STROKE (x 20–280 → 6.7–93.3%), not just the asphalt.
    expect(Math.abs(Math.min(...outline.map((p) => p.xPct)) - 6.7)).toBeLessThan(1.5);
    expect(Math.abs(Math.max(...outline.map((p) => p.xPct)) - 93.3)).toBeLessThan(1.5);
    expect(Math.abs(Math.min(...outline.map((p) => p.yPct)) - 10)).toBeLessThan(1.5);
    expect(Math.abs(Math.max(...outline.map((p) => p.yPct)) - 90)).toBeLessThan(1.5);
    // The differently-coloured strip is inside the block.
    expect(pointInPolygon(12, 50, outline)).toBe(true);
  });

  it('returns null for a blank image and for a full-bleed single colour', () => {
    expect(detectParkingPlan(makeRaster(300, 200))).toBeNull();
    const fullGray = makeRaster(300, 200);
    fillRect(fullGray, 0, 0, 300, 200, GRAY);
    expect(detectParkingPlan(fullGray)).toBeNull();
  });

  it('detects OPEN-stripe bays (white divider lines, no closed boxes) as gaps between stripes', () => {
    const raster = makeRaster(300, 200);
    fillRect(raster, 20, 20, 260, 160, GRAY);
    // Two rows of 12 vertical divider stripes (2×24 px) → 11 bays per row.
    for (let i = 0; i < 12; i++) {
      fillRect(raster, 40 + i * 16, 40, 2, 24, WHITE);
      fillRect(raster, 40 + i * 16, 120, 2, 24, WHITE);
    }
    const detection = detectParkingPlan(raster);
    expect(detection).not.toBeNull();
    expect(detection!.bays.length).toBe(22);
    for (const bay of detection!.bays) {
      const angle = Math.abs(bay.rotationDeg);
      expect(angle).toBeGreaterThan(85);
      expect(angle).toBeLessThan(95);
      // Bay width = stripe pitch (16px centre-to-centre).
      expect(bay.widthPx).toBeGreaterThan(14);
      expect(bay.widthPx).toBeLessThan(18);
      expect(bay.lengthPx).toBeGreaterThan(18);
      expect(bay.lengthPx).toBeLessThan(28);
    }
    // Outline must still be the clean lot rectangle, not a striped comb.
    const outline = detection!.outlinePct;
    expect(outline.length).toBeLessThanOrEqual(12);
    expect(Math.abs(Math.min(...outline.map((p) => p.xPct)) - 6.7)).toBeLessThan(2);
    expect(Math.abs(Math.max(...outline.map((p) => p.xPct)) - 93.3)).toBeLessThan(2);
  });

  it('closed-box and stripe detection do not double-count the same bay', () => {
    // Closed boxes also produce stripe-like white edges — total must stay 16.
    const detection = detectParkingPlan(makePlanRaster());
    expect(detection!.bays.length).toBe(16);
  });

  it('falls back to LINE-ART detection: white cells between black lines, block = hull of bays', () => {
    const BLACK: [number, number, number] = [30, 30, 30];
    const raster = makeRaster(300, 200);
    // No filled lot at all — two rows of 10 black-outlined white cells (CAD-style sheet).
    for (let i = 0; i < 10; i++) {
      for (const y of [40, 120]) {
        fillRect(raster, 40 + i * 16, y, 16, 26, BLACK);
        fillRect(raster, 42 + i * 16, y + 2, 12, 22, WHITE);
      }
    }
    const detection = detectParkingPlan(raster);
    expect(detection).not.toBeNull();
    expect(detection!.bays.length).toBe(20);
    const outline = detection!.outlinePct;
    expect(outline.length).toBeGreaterThanOrEqual(3);
    expect(outline.length).toBeLessThanOrEqual(12);
    for (const bay of detection!.bays) {
      expect(pointInPolygon(bay.cxPct, bay.cyPct, outline)).toBe(true);
      const angle = Math.abs(bay.rotationDeg);
      expect(angle).toBeGreaterThan(85);
      expect(angle).toBeLessThan(95);
    }
    // Bay-default scale works off the detected cells too.
    const scale = resolveParkingPlanScale(detection!, [], CAR);
    expect(scale).not.toBeNull();
    expect(scale!.source).toBe('bay-default');
  });
});

describe('computeBorderMask (edge-gradient pass ported from detect-blocks.ts)', () => {
  it('flags a sharp local colour step even when neither side trips the base border rule', () => {
    // Left two columns gray 100, right two columns gray 170 — a 210-sum jump at the seam,
    // but neither flat value is white/black enough for isBorderPixel to fire on its own.
    expect(isBorderPixel(100, 100, 100, 255)).toBe(false);
    expect(isBorderPixel(170, 170, 170, 255)).toBe(false);
    const width = 4;
    const height = 2;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = x < 2 ? 100 : 170;
        const i = (y * width + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const border = computeBorderMask({ data, width, height }, isBorderPixel);
    // The seam pixel (last column of the left region) is caught by the gradient pass...
    expect(border[0 * width + 1]).toBe(1);
    // ...while a pixel with no sharp neighbour jump is left alone (not over-flagged).
    expect(border[0 * width + 0]).toBe(0);
  });
});

describe('polygonSelfIntersects', () => {
  it('flags a bowtie quad but not a normal square', () => {
    const bowtie = [
      { xPct: 0, yPct: 0 },
      { xPct: 10, yPct: 10 },
      { xPct: 10, yPct: 0 },
      { xPct: 0, yPct: 10 },
    ];
    expect(polygonSelfIntersects(bowtie)).toBe(true);
    const square = [
      { xPct: 0, yPct: 0 },
      { xPct: 10, yPct: 0 },
      { xPct: 10, yPct: 10 },
      { xPct: 0, yPct: 10 },
    ];
    expect(polygonSelfIntersects(square)).toBe(false);
  });
});

describe('ensureOutlineContainsBays (block-first guarantee)', () => {
  function makeBayGrid(): DetectedParkingBay[] {
    const bays: DetectedParkingBay[] = [];
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 6; i++) {
        bays.push({
          cxPct: 30 + i * 8,
          cyPct: 35 + row * 20,
          rotationDeg: 90,
          lengthPx: 20,
          widthPx: 10,
        });
      }
    }
    return bays;
  }

  it('rebuilds a degenerate outline from the bays’ own hull so every slot is inside the block', () => {
    // Bogus tiny triangle in a corner — nothing like the real lot.
    const badOutline = [
      { xPct: 1, yPct: 1 },
      { xPct: 3, yPct: 1 },
      { xPct: 2, yPct: 3 },
    ];
    const bays = makeBayGrid();
    const fixed = ensureOutlineContainsBays(badOutline, bays, 300, 200);
    expect(fixed).not.toBe(badOutline);
    expect(fixed.length).toBeGreaterThanOrEqual(3);
    expect(fixed.length).toBeLessThanOrEqual(12);
    for (const bay of bays) {
      expect(pointInPolygon(bay.cxPct, bay.cyPct, fixed)).toBe(true);
    }
  });

  it('keeps a good outline unchanged', () => {
    const goodOutline = [
      { xPct: 10, yPct: 10 },
      { xPct: 90, yPct: 10 },
      { xPct: 90, yPct: 90 },
      { xPct: 10, yPct: 90 },
    ];
    expect(ensureOutlineContainsBays(goodOutline, makeBayGrid(), 300, 200)).toBe(goodOutline);
  });

  it('repairs an outline that only partially covers the bays (e.g. a whole row cut off), not just a totally bogus one', () => {
    // Covers row 0 (y≈35) fully but stops just above row 1 (y≈55) — the exact shape of
    // the regression where a block excluded one legitimate row of detected slots.
    const partialOutline = [
      { xPct: 20, yPct: 20 },
      { xPct: 80, yPct: 20 },
      { xPct: 80, yPct: 45 },
      { xPct: 20, yPct: 45 },
    ];
    const bays = makeBayGrid();
    const before = bays.filter((b) => pointInPolygon(b.cxPct, b.cyPct, partialOutline)).length;
    expect(before).toBe(6); // only row 0 — 50% of the 12 bays, below the repair threshold
    const fixed = ensureOutlineContainsBays(partialOutline, bays, 300, 200);
    expect(fixed).not.toBe(partialOutline);
    for (const bay of bays) {
      expect(pointInPolygon(bay.cxPct, bay.cyPct, fixed)).toBe(true);
    }
  });

  it('with a raster, growth is clipped to the drawing — the repair can bulge up to the printed boundary but never past it onto the page', () => {
    // Drawing occupies x 20–180 (6.7–60%) of a white page. Base outline stops at 50%;
    // a bay column at 56.7% sits inside the DRAWING but outside the base outline, and
    // its padded growth halo would reach ~64% — onto the white page.
    const raster = makeRaster(300, 200);
    fillRect(raster, 20, 20, 160, 160, GRAY);
    const baseOutline = [
      { xPct: 6.7, yPct: 10 },
      { xPct: 50, yPct: 10 },
      { xPct: 50, yPct: 90 },
      { xPct: 6.7, yPct: 90 },
    ];
    const column: DetectedParkingBay[] = Array.from({ length: 8 }, (_, i) => ({
      cxPct: 56.7,
      cyPct: 15 + i * 10,
      rotationDeg: 0,
      lengthPx: 20,
      widthPx: 10,
    }));

    const unclipped = ensureOutlineContainsBays(baseOutline, column, 300, 200);
    expect(Math.max(...unclipped.map((p) => p.xPct))).toBeGreaterThan(61.5); // proves the halo really overshoots

    const clipped = ensureOutlineContainsBays(baseOutline, column, 300, 200, raster);
    for (const bay of column) {
      expect(pointInPolygon(bay.cxPct, bay.cyPct, clipped)).toBe(true);
    }
    // Never past the drawing's right edge (60%) + one low-res mask cell of slack.
    expect(Math.max(...clipped.map((p) => p.xPct))).toBeLessThanOrEqual(61.5);
  });

  it('pulls in a disconnected outlier bay cluster (e.g. a side stall column) as a local bulge WITHOUT hulling away a real notch/concavity — the exact Emirates Parking A regression', () => {
    // L-shaped lot: outer rect x:[10,75] y:[10,90], with a notch bitten out of the
    // top-right corner (x:[50,75] y:[10,30]) — an entrance/exit-style cut, same idea as
    // the real plan's beveled corner.
    const notchedOutline = [
      { xPct: 10, yPct: 10 },
      { xPct: 50, yPct: 10 },
      { xPct: 50, yPct: 30 },
      { xPct: 75, yPct: 30 },
      { xPct: 75, yPct: 90 },
      { xPct: 10, yPct: 90 },
    ];
    const mainGrid = makeBayGrid(); // x:[30,70] y:[35,55] — safely inside the L's body
    // A narrow column just OUTSIDE the polygon's right edge (x=75) — close enough to
    // fuse in after padding, but NOT already contained — the S/T-column scenario.
    const outlierColumn: DetectedParkingBay[] = [25, 40, 55, 70].map((cyPct) => ({
      cxPct: 79,
      cyPct,
      rotationDeg: 90,
      lengthPx: 20,
      widthPx: 10,
    }));
    const bays = [...mainGrid, ...outlierColumn];

    const beforeInside = bays.filter((b) => pointInPolygon(b.cxPct, b.cyPct, notchedOutline)).length;
    expect(beforeInside).toBe(mainGrid.length); // outlier column starts outside

    const fixed = ensureOutlineContainsBays(notchedOutline, bays, 300, 200);
    for (const bay of bays) {
      expect(pointInPolygon(bay.cxPct, bay.cyPct, fixed)).toBe(true);
    }
    // The notch itself must still read as OUTSIDE the block — proof the repair bulged
    // out locally around the outlier column instead of discarding the concavity for a
    // crude hull-of-everything (which would swallow this whole corner).
    expect(pointInPolygon(60, 15, fixed)).toBe(false);
  });
});

describe('parseDimensionTokens / suggestPlanName', () => {
  it('parses single-token and split ("160.0" + "m") dimension labels', () => {
    const tokens: OcrToken[] = [
      { text: '160.0 m', xPct: 4, yPct: 50 },
      { text: '150,5', xPct: 50, yPct: 95 },
      { text: 'm', xPct: 53, yPct: 95 },
      { text: 'PARKING B', xPct: 50, yPct: 45, hPct: 3 },
    ];
    const dims = parseDimensionTokens(tokens);
    expect(dims.length).toBe(2);
    expect(dims[0].valueM).toBeCloseTo(160, 1);
    expect(dims[1].valueM).toBeCloseTo(150.5, 1);
  });

  it('suggests the biggest non-dimension text as the plan name', () => {
    const tokens: OcrToken[] = [
      { text: '160.0 m', xPct: 4, yPct: 50, hPct: 2 },
      { text: 'PARKING B', xPct: 50, yPct: 45, hPct: 3 },
      { text: 'NOTES', xPct: 10, yPct: 95, hPct: 5 },
    ];
    expect(suggestPlanName(tokens)).toBe('PARKING B');
  });
});

describe('resolveParkingPlanScale + assignEdgeLengths', () => {
  it('uses an OCR dimension label matched to its nearest edge', () => {
    const detection = detectParkingPlan(makePlanRaster())!;
    // "160 m" just below the bottom edge (y = 90% + a bit).
    const dims = parseDimensionTokens([{ text: '160 m', xPct: 50, yPct: 93 }]);
    const scale = resolveParkingPlanScale(detection, dims, CAR);
    expect(scale).not.toBeNull();
    expect(scale!.source).toBe('ocr');
    // Bottom edge ≈ 260px for 160m → ppm ≈ 1.62.
    expect(scale!.ppm).toBeGreaterThan(1.5);
    expect(scale!.ppm).toBeLessThan(1.75);

    const lengths = assignEdgeLengths(detection.outlinePct, detection.widthPx, detection.heightPx, scale!.ppm);
    expect(lengths.length).toBe(detection.outlinePct.length);
    // Horizontal edges ≈ 160m, vertical edges ≈ 160px/ppm ≈ 98.5m.
    expect(Math.max(...lengths)).toBeGreaterThan(150);
    expect(Math.max(...lengths)).toBeLessThan(170);
    expect(Math.min(...lengths)).toBeGreaterThan(88);
    expect(Math.min(...lengths)).toBeLessThan(108);
  });

  it('falls back to median bay width = default car width when no dimensions found', () => {
    const detection = detectParkingPlan(makePlanRaster())!;
    const scale = resolveParkingPlanScale(detection, [], CAR);
    expect(scale).not.toBeNull();
    expect(scale!.source).toBe('bay-default');
    // Median bay width ≈ 10px for 2.5m → ppm ≈ 4.
    expect(scale!.ppm).toBeGreaterThan(3.5);
    expect(scale!.ppm).toBeLessThan(4.5);
  });

  it('returns null with no dimensions and too few bays', () => {
    const raster = makeRaster(300, 200);
    fillRect(raster, 20, 20, 260, 160, GRAY); // lot with no bays
    const detection = detectParkingPlan(raster)!;
    expect(detection.bays.length).toBe(0);
    expect(resolveParkingPlanScale(detection, [], CAR)).toBeNull();
  });
});

describe('buildDetectedSlots — custom shapes', () => {
  it('never attaches shapePoints — even non-rectangular traces stay plain rects', () => {
    const triangleBay: DetectedParkingBay = {
      cxPct: 50,
      cyPct: 50,
      rotationDeg: 0,
      lengthPx: 40,
      widthPx: 20,
      // Half of the bounding box — clearly not a rectangle.
      polygonPct: [
        { xPct: (130 / 300) * 100, yPct: 45 },
        { xPct: (170 / 300) * 100, yPct: 45 },
        { xPct: (130 / 300) * 100, yPct: 55 },
      ],
    };
    const rectBay: DetectedParkingBay = {
      cxPct: 20,
      cyPct: 20,
      rotationDeg: 0,
      lengthPx: 40,
      widthPx: 20,
      polygonPct: [
        { xPct: ((60 - 20) / 300) * 100, yPct: ((40 - 10) / 200) * 100 },
        { xPct: ((60 + 20) / 300) * 100, yPct: ((40 - 10) / 200) * 100 },
        { xPct: ((60 + 20) / 300) * 100, yPct: ((40 + 10) / 200) * 100 },
        { xPct: ((60 - 20) / 300) * 100, yPct: ((40 + 10) / 200) * 100 },
      ],
    };
    const detection = {
      widthPx: 300,
      heightPx: 200,
      outlinePct: [
        { xPct: 0, yPct: 0 },
        { xPct: 100, yPct: 0 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
      bays: [triangleBay, rectBay],
    };
    const slots = buildDetectedSlots(detection, 8, CAR);
    expect(slots.length).toBe(2);
    // Auto-detect prefers clean oriented rects over mid-quality flood-fill polygons.
    expect(slots.every((s) => s.shapePoints === undefined)).toBe(true);
  });
});

describe('buildDetectedSlots', () => {
  it('clusters the two rows into two lanes and sizes from measured bay px / ppm', () => {
    const detection = detectParkingPlan(makePlanRaster())!;
    const scale = resolveParkingPlanScale(detection, [], CAR)!;
    const slots = buildDetectedSlots(detection, scale.ppm, CAR);
    expect(slots.length).toBe(16);
    const lanes = new Map<number, number>();
    for (const slot of slots) {
      lanes.set(slot.laneIndex, (lanes.get(slot.laneIndex) ?? 0) + 1);
      // Bay-default ppm ≈ medianWidth/carWidth → sizes near car defaults (drawn size).
      expect(slot.widthM).toBeGreaterThan(2);
      expect(slot.widthM).toBeLessThan(4);
      expect(slot.lengthM).toBeGreaterThan(4);
      expect(slot.lengthM).toBeLessThan(7);
    }
    expect([...lanes.values()].sort()).toEqual([8, 8]);
    // Top row (smaller yPct) must be lane 0.
    const lane0Y = slots.filter((s) => s.laneIndex === 0).map((s) => s.yPct);
    const lane1Y = slots.filter((s) => s.laneIndex === 1).map((s) => s.yPct);
    expect(Math.max(...lane0Y)).toBeLessThan(Math.min(...lane1Y));
  });

  it('sizes each lane from its own bays — a narrow side column keeps its own pitch instead of inheriting the main grid size', () => {
    // A real plan mixes families: a main car-bay grid PLUS a narrower, tighter-pitched
    // side-stall column (e.g. the "S"/"T" columns hugging a perimeter wall). Forcing
    // every lane to one plan-wide median size — the old behaviour — snaps the narrow
    // column up to the main grid's (larger) size, so its slots overlap into a stacked
    // mass since consecutive centres are closer together than that borrowed length.
    const mainGrid: DetectedParkingBay[] = [10, 20, 30, 40].map((cyPct) => ({
      cxPct: 20,
      cyPct,
      rotationDeg: 0,
      lengthPx: 40,
      widthPx: 20,
    }));
    const sideColumn: DetectedParkingBay[] = [10, 16, 22, 28].map((cyPct) => ({
      cxPct: 80,
      cyPct,
      rotationDeg: 0,
      lengthPx: 24,
      widthPx: 10,
    }));
    const detection = {
      widthPx: 200,
      heightPx: 200,
      outlinePct: [
        { xPct: 0, yPct: 0 },
        { xPct: 100, yPct: 0 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
      bays: [...mainGrid, ...sideColumn],
    };
    const slots = buildDetectedSlots(detection, 8, CAR);
    expect(slots.length).toBe(8);

    const mainSlots = slots.filter((s) => s.xPct === 20);
    const sideSlots = slots.filter((s) => s.xPct === 80);
    expect(mainSlots.length).toBe(4);
    expect(sideSlots.length).toBe(4);

    // Main grid: 40px/8ppm = 5 m, 20px/8ppm = 2.5 m — snaps exactly to the car defaults.
    for (const s of mainSlots) {
      expect(s.lengthM).toBeCloseTo(5, 5);
      expect(s.widthM).toBeCloseTo(2.5, 5);
    }
    // Side column: its OWN (much smaller) size — 24px/8 = 3.0 m, 10px/8 = 1.25 m (rounds
    // to 1.3) — must not be forced to the main grid's size, or consecutive slots
    // (~1.5 m pitch) overlap.
    for (const s of sideSlots) {
      expect(s.lengthM).toBeCloseTo(3, 5);
      expect(s.widthM).toBeCloseTo(1.3, 5);
    }
  });
});

describe('filterOrientationOutliers', () => {
  it('drops stray glyphs at random angles (e.g. a curved traffic arrow) while keeping grid-aligned bays, including a perpendicular side column', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ rotationDeg: 1, cxPct: i, cyPct: 0 }));
    // A perpendicular side column (90° off) is the SAME grid family — must survive.
    const sideColumn = Array.from({ length: 4 }, (_, i) => ({ rotationDeg: 91, cxPct: 0, cyPct: i }));
    const arrowGlyph = { rotationDeg: 37, cxPct: 50, cyPct: 50 };
    const filtered = filterOrientationOutliers([...rows, ...sideColumn, arrowGlyph]);
    expect(filtered).toHaveLength(rows.length + sideColumn.length);
    expect(filtered).not.toContain(arrowGlyph);
  });

  it('leaves candidates untouched when there are too few to vote reliably', () => {
    const few = Array.from({ length: 5 }, (_, i) => ({ rotationDeg: i * 20 }));
    expect(filterOrientationOutliers(few)).toEqual(few);
  });
});

describe('dedupeCloseCandidates', () => {
  it('keeps the larger of two candidates whose centres sit on top of each other (a divider line split one bay into two blobs)', () => {
    const big = { cxPct: 50, cyPct: 50, widthPx: 20, areaPx: 400 };
    const splitFragment = { cxPct: 50.5, cyPct: 50, widthPx: 20, areaPx: 150 };
    const farAway = { cxPct: 90, cyPct: 90, widthPx: 20, areaPx: 300 };
    const result = dedupeCloseCandidates([big, splitFragment, farAway], 200, 200);
    expect(result).toEqual([big, farAway]);
  });
});
