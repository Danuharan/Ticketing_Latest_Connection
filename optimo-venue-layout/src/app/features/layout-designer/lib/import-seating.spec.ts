import { describe, expect, it } from 'vitest';

import {
  parseSeatingImportCsv,
  normalizeBlockCode,
  SEATING_IMPORT_SAMPLE_CSV,
} from './parse-seating-import-file';
import { computeImportSeatingPlan, deriveImportSpacingFromStructure } from './import-seating';
import {
  stadiumLogicalEdgesFacingDirection,
  stadiumLogicalEdgesFromView,
} from './block-measure-edges';
import { polygonCanvasPointsFromBlock } from './block-viewpoint';
import { getSeatLayoutRowSeatCounts } from './block-seat-layout';
import { applyAutoFillToBlock } from './auto-fill-seating';
import { DEFAULT_AUTO_FILL_SEATING_CONFIG } from '../models/auto-fill-seating.model';
import type { CenterpieceElement, CustomShapeSeatPosition, SeatLayoutSpec } from '../models/layout-element.model';

function makeBlock(overrides: Partial<CenterpieceElement> = {}): CenterpieceElement {
  return {
    id: 'blk-1',
    type: 'centerpiece',
    name: 'N3401',
    shape: 'custom',
    label: 'N3401',
    curveDeg: 0,
    customPoints: [
      { xPct: 0, yPct: 0 },
      { xPct: 100, yPct: 0 },
      { xPct: 100, yPct: 100 },
      { xPct: 0, yPct: 100 },
    ],
    position: { xPct: 50, yPct: 20 },
    size: { wPct: 20, hPct: 15 },
    rotation: 0,
    style: { fillColor: '#fff', strokeColor: '#000', labelColor: '#000' },
    ...overrides,
  };
}

// Block box: canvas 1000×700, size 20%×15% → 200×105 px centred at (500,140).
const RECT = { x: 400, y: 87.5, width: 200, height: 105, cx: 500, cy: 140 };

describe('parseSeatingImportCsv', () => {
  it('parses the grid, capacity, and optional columns with aliases', () => {
    const csv = [
      'Block Code,Rows,Columns,Capacity,Seat Gap (m),Edge Margin (m)',
      'N3401,11,10,,,',
      'B11,,,96,,',
      'B12,8,,90,0.1,0.3',
      ',,5,,,',
      'BAD,,,,,',
    ].join('\n');
    const result = parseSeatingImportCsv(csv);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({ blockCode: 'N3401', rows: 11, seatsPerRow: 10 });
    expect(result.rows[1]).toMatchObject({ blockCode: 'B11', capacity: 96 });
    expect(result.rows[2]).toMatchObject({ blockCode: 'B12', rows: 8, capacity: 90, seatGapM: 0.1, edgeMarginM: 0.3 });
    expect(result.errors).toHaveLength(2); // missing code + row with no grid/capacity
  });

  it('detects semicolon delimiter and rejects files without a block column', () => {
    const semi = parseSeatingImportCsv('block;rows;columns\nA1;4;6');
    expect(semi.rows[0]).toMatchObject({ blockCode: 'A1', rows: 4, seatsPerRow: 6 });
    const bad = parseSeatingImportCsv('foo,bar\n1,2');
    expect(bad.errors[0]).toContain('block code column');
  });

  it('normalises block codes for matching', () => {
    expect(normalizeBlockCode(' n34-01 ')).toBe('N3401');
    expect(normalizeBlockCode(undefined)).toBe('');
  });

  it('accepts unit suffixes on measurement columns (cm/mm/in/ft)', () => {
    const result = parseSeatingImportCsv(
      'block,rows,columns,chair_width_m,chair_length_m,seat_gap_m,row_gap_m\nA1,4,6,45cm,500 mm,2in,0.5ft',
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0].chairWidthM).toBeCloseTo(0.45, 5);
    expect(result.rows[0].chairLengthM).toBeCloseTo(0.5, 5);
    expect(result.rows[0].seatGapM).toBeCloseTo(0.0508, 5);
    expect(result.rows[0].rowGapM).toBeCloseTo(0.1524, 5);
  });

  it('accepts chair_depth and seat_spacing header aliases', () => {
    const result = parseSeatingImportCsv(
      'block,rows,columns,chair_width,chair_depth,seat_spacing,row_gap,border_gap\nA1,4,6,0.45,0.5,0.08,0.12,0.2',
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      chairWidthM: 0.45,
      chairLengthM: 0.5,
      seatGapM: 0.08,
      rowGapM: 0.12,
      edgeMarginM: 0.2,
    });
  });

  it('parses row_seats ranges with later entries overriding earlier ones', () => {
    const result = parseSeatingImportCsv(
      'block,row_seats\nIRR1,1-5:6|6-8:2|7:5|8-10:20\nBAD1,1-3:4|6:2',
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].rowSeatCounts).toEqual([6, 6, 6, 6, 6, 2, 5, 20, 20, 20]);
    // BAD1 has a gap (rows 4-5 undefined) → row_seats ignored → row skipped.
    expect(result.errors.some((e) => e.includes('rows 4, 5'))).toBe(true);
  });

  it('parses curve_deg and aisle columns', () => {
    const result = parseSeatingImportCsv(
      [
        'block,rows,columns,curve_deg,aisle_type,aisle_rows,aisle_width_m',
        'N3401,8,10,6,row,C,1.2',
      ].join('\n'),
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0].curveDeg).toBe(6);
    expect(result.rows[0].aisles).toHaveLength(1);
    expect(result.rows[0].aisles![0]).toMatchObject({ type: 'row', rows: 'C', widthM: 1.2 });
  });

  it('parses separate row and column aisle CSV columns without aisle_type', () => {
    const result = parseSeatingImportCsv(
      [
        'block,rows,columns,aisle_rows,row_aisle_width_m,aisle_columns,column_aisle_width_m,center_row_aisle_widths_m,center_column_aisle_widths_m',
        'N3401,8,10,"C, E",1.2,"3, 7",0.9,0.4,0.5',
      ].join('\n'),
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0].aisles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'row', rows: 'C, E', widthM: 1.2 }),
        expect.objectContaining({ type: 'column', columns: '3, 7', widthM: 0.9 }),
        expect.objectContaining({ type: 'center', centerAxis: 'row', widthM: 0.4 }),
        expect.objectContaining({ type: 'center', centerAxis: 'column', widthM: 0.5 }),
      ]),
    );
  });

  it('parses the downloadable sample CSV including curve and center aisles', () => {
    const result = parseSeatingImportCsv(SEATING_IMPORT_SAMPLE_CSV);
    expect(result.errors).toEqual([]);
    expect(result.rows.length).toBeGreaterThanOrEqual(5);
    expect(result.rows[0]).toMatchObject({
      blockCode: '1',
      rows: 8,
      seatsPerRow: 8,
      chairWidthM: 0.45,
      chairLengthM: 0.5,
      seatGapM: 0.06,
      rowGapM: 0.1,
      edgeMarginM: 0.2,
      curveDeg: 0,
    });
    expect(result.rows[0].aisles).toHaveLength(2);
    expect(result.rows[0].aisles![0]).toMatchObject({ type: 'center', centerAxis: 'row', widthM: 0.2 });
    expect(result.rows[0].aisles![1]).toMatchObject({ type: 'center', centerAxis: 'column', widthM: 0.2 });
    expect(result.rows[1].curveDeg).toBe(2);
    expect(result.rows[2]).toMatchObject({ seatsPerRow: 10, curveDeg: 3 });
    expect(result.rows[3].rowSeatCounts).toEqual([8, 8, 6, 6, 8, 8, 8, 8]);
    expect(result.rows[4].seatsPerRow).toBeUndefined();
    expect(result.rows[4].rows).toBe(8);
  });

  it('parses saved-template center aisle widths and incomplete row_seats', () => {
    const csv = [
      'block_code,rows,columns,capacity,chair_width_m,chair_length_m,seat_gap_m,row_gap_m,edge_margin_m,row_seats,curve_deg,center_row_aisle_widths_m,center_column_aisle_widths_m',
      '1,8,8,,0.45,0.5,0.06,0.1,0.2,1-2:8|3-4:,0,0.2,0.2',
      '2,8,,,0.45,0.5,0.06,0.1,0.2,,3,0.2,0.2',
    ].join('\n');
    const result = parseSeatingImportCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].rowSeatCounts).toEqual([8, 8, 8, 8, 8, 8, 8, 8]);
    expect(result.rows[0].aisles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'center', centerAxis: 'row', widthM: 0.2 }),
        expect.objectContaining({ type: 'center', centerAxis: 'column', widthM: 0.2 }),
      ]),
    );
    expect(result.rows[1].curveDeg).toBe(3);
    expect(result.rows[1].seatsPerRow).toBeUndefined();
  });

  it('parses a combined aisles cell with row and column walkways', () => {
    const result = parseSeatingImportCsv(
      'block,rows,columns,aisles\nB11,6,8,"row:C:1.2|column:5:1"',
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0].aisles).toHaveLength(2);
    expect(result.rows[0].aisles![0]).toMatchObject({ type: 'row', rows: 'C', widthM: 1.2 });
    expect(result.rows[0].aisles![1]).toMatchObject({ type: 'column', columns: '5', widthM: 1 });
  });
});

function largestFrontRowGap(
  overrides: Record<string, CustomShapeSeatPosition>,
): { width: number; mid: number } {
  const xs = Object.entries(overrides)
    .filter(([id]) => /^A\d+$/.test(id))
    .map(([, seat]) => seat.xPct)
    .sort((a, b) => a - b);
  let width = 0;
  let mid = 50;
  for (let i = 1; i < xs.length; i += 1) {
    const gap = xs[i] - xs[i - 1];
    if (gap > width) {
      width = gap;
      mid = (xs[i - 1] + xs[i]) / 2;
    }
  }
  return { width, mid };
}

describe('computeImportSeatingPlan', () => {
  const pitchBelow = { x: 500, y: 600 }; // pitch is below the block

  it('fills a rows × columns grid with the viewpoint facing the pitch', () => {
    const plan = computeImportSeatingPlan(makeBlock(), RECT, {
      blockCode: 'N3401',
      rows: 6,
      seatsPerRow: 8,
      lineNumber: 2,
    }, pitchBelow);
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    // Pitch is straight below → viewpoint angle ≈ 180°.
    expect(Math.abs(Math.abs(plan.viewpointAngleDeg) - 180)).toBeLessThan(1);
    expect(plan.rowsPlaced).toBe(6);
    expect(plan.seatsPlaced).toBe(48);
    const layout = plan.patch.seatLayout as SeatLayoutSpec;
    expect(getSeatLayoutRowSeatCounts(layout).every((c) => c === 8)).toBe(true);
    expect(plan.patch.blockType).toBe('seating');
    expect(plan.patch.code).toBe('N3401');
    // First row runs along the pitch-facing (bottom) edge.
    const overrides = plan.patch.seatPositionOverrides!;
    const rowAYs = Array.from({ length: 8 }, (_, s) => overrides[`A${s + 1}`]?.yPct ?? 0);
    const lastRowYs = Array.from({ length: 8 }, (_, s) => overrides[`F${s + 1}`]?.yPct ?? 0);
    expect(rowAYs.every((y) => y > 0)).toBe(true);
    expect(lastRowYs.every((y) => y > 0)).toBe(true);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(rowAYs)).toBeGreaterThan(avg(lastRowYs)); // row A lower (closer to pitch)
  });

  it('locks a single VIEW POINT when only one side faces the ground', () => {
    const plan = computeImportSeatingPlan(makeBlock(), RECT, {
      blockCode: 'N3401',
      rows: 4,
      seatsPerRow: 6,
      lineNumber: 2,
    }, pitchBelow);
    expect('error' in plan).toBe(false);
    if ('error' in plan) {
      return;
    }
    const polygon = polygonCanvasPointsFromBlock(makeBlock().customPoints ?? [], RECT);
    const marked = stadiumLogicalEdgesFromView(
      polygon,
      RECT.cx,
      RECT.cy,
      plan.viewpointAngleDeg,
    );
    expect(marked).toHaveLength(1);
    expect(plan.patch.dragSeatsStadiumSideIndices).toBeUndefined();
    expect(plan.patch.dragSeatsStadiumSideIndex).toBe(marked[0].index);
  });

  it('does not set a viewpoint on an unrelated side when the pitch is toward a corner', () => {
    const pitchTowardCorner = { x: 700, y: 300 };
    const plan = computeImportSeatingPlan(makeBlock(), RECT, {
      blockCode: 'N3401',
      rows: 4,
      seatsPerRow: 6,
      lineNumber: 2,
    }, pitchTowardCorner);
    expect('error' in plan).toBe(false);
    if ('error' in plan) {
      return;
    }
    const polygon = polygonCanvasPointsFromBlock(makeBlock().customPoints ?? [], RECT);
    const marked = stadiumLogicalEdgesFacingDirection(
      polygon,
      RECT.cx,
      RECT.cy,
      plan.viewpointAngleDeg,
    );
    expect(marked).toHaveLength(1);
    expect(plan.patch.dragSeatsStadiumSideIndices).toBeUndefined();
    expect(plan.patch.dragSeatsStadiumSideIndex).toBe(marked[0].index);
  });

  it('sets dual viewpoints when two front sides face the ground', () => {
    const house = makeBlock({
      customPoints: [
        { xPct: 0, yPct: 40 },
        { xPct: 50, yPct: 0 },
        { xPct: 100, yPct: 40 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
    });
    const pitchAbove = { x: 500, y: 20 };
    const plan = computeImportSeatingPlan(house, RECT, {
      blockCode: 'N3401',
      rows: 4,
      seatsPerRow: 6,
      lineNumber: 2,
    }, pitchAbove);
    expect('error' in plan).toBe(false);
    if ('error' in plan) {
      return;
    }
    const polygon = polygonCanvasPointsFromBlock(house.customPoints ?? [], RECT);
    const marked = stadiumLogicalEdgesFacingDirection(
      polygon,
      RECT.cx,
      RECT.cy,
      plan.viewpointAngleDeg,
    );
    expect(marked).toHaveLength(2);
    expect(marked.every((edge) => edge.midY < RECT.cy)).toBe(true);
    expect(plan.patch.dragSeatsStadiumSideIndices).toHaveLength(2);
    expect(plan.patch.dragSeatsStadiumSideIndices?.sort()).toEqual(
      marked.map((edge) => edge.index).sort(),
    );
  });

  it('keeps both CSV viewpoints when Auto Fill runs afterwards', () => {
    const house = makeBlock({
      customPoints: [
        { xPct: 0, yPct: 40 },
        { xPct: 50, yPct: 0 },
        { xPct: 100, yPct: 40 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
    });
    const pitchAbove = { x: 500, y: 20 };
    const plan = computeImportSeatingPlan(house, RECT, {
      blockCode: 'N3401',
      rows: 4,
      seatsPerRow: 6,
      lineNumber: 2,
    }, pitchAbove);
    expect('error' in plan).toBe(false);
    if ('error' in plan) {
      return;
    }
    const imported = { ...house, ...plan.patch } as CenterpieceElement;
    const filled = applyAutoFillToBlock(
      imported,
      [imported],
      { width: 1000, height: 700 },
      DEFAULT_AUTO_FILL_SEATING_CONFIG,
    );
    expect('error' in filled ? filled.error : '').toBe('');
    if ('error' in filled) {
      return;
    }
    expect(filled.patch.dragSeatsStadiumSideIndices).toHaveLength(2);
    expect(filled.patch.dragSeatsStadiumSideIndices?.sort()).toEqual(
      plan.patch.dragSeatsStadiumSideIndices?.slice().sort(),
    );
  });

  it('stores every front-facing viewpoint side from CSV import', () => {
    const steppedFront = makeBlock({
      customPoints: [
        { xPct: 0, yPct: 24 },
        { xPct: 33, yPct: 8 },
        { xPct: 66, yPct: 8 },
        { xPct: 100, yPct: 24 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
    });
    const pitchAbove = { x: 500, y: 20 };
    const plan = computeImportSeatingPlan(steppedFront, RECT, {
      blockCode: 'N3401',
      rows: 4,
      seatsPerRow: 6,
      lineNumber: 2,
    }, pitchAbove);
    expect('error' in plan).toBe(false);
    if ('error' in plan) {
      return;
    }
    const polygon = polygonCanvasPointsFromBlock(steppedFront.customPoints ?? [], RECT);
    const marked = stadiumLogicalEdgesFacingDirection(
      polygon,
      RECT.cx,
      RECT.cy,
      plan.viewpointAngleDeg,
    );
    expect(marked).toHaveLength(3);
    expect(plan.patch.dragSeatsStadiumSideIndices?.slice().sort()).toEqual(
      marked.map((edge) => edge.index).sort(),
    );
  });

  it('fills by capacity only and trims to the exact count', () => {
    const plan = computeImportSeatingPlan(makeBlock(), RECT, {
      blockCode: 'B11',
      capacity: 50,
      lineNumber: 3,
    }, pitchBelow);
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.seatsPlaced).toBe(50);
  });

  it('handles an L-shaped block and synthesises an outline for plain blocks', () => {
    const lShape = makeBlock({
      customPoints: [
        { xPct: 0, yPct: 0 },
        { xPct: 100, yPct: 0 },
        { xPct: 100, yPct: 55 },
        { xPct: 55, yPct: 55 },
        { xPct: 55, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
    });
    const lPlan = computeImportSeatingPlan(lShape, RECT, {
      blockCode: 'L1',
      capacity: 40,
      lineNumber: 2,
    }, pitchBelow);
    expect('error' in lPlan).toBe(false);
    if (!('error' in lPlan)) {
      expect(lPlan.seatsPlaced).toBeGreaterThan(0);
      expect(lPlan.seatsPlaced).toBeLessThanOrEqual(40);
      const byRow = new Map<string, number>();
      for (const id of Object.keys(lPlan.patch.seatPositionOverrides ?? {})) {
        const row = id.replace(/\d+$/, '');
        byRow.set(row, (byRow.get(row) ?? 0) + 1);
      }
      for (const count of byRow.values()) {
        expect(count).toBeGreaterThanOrEqual(2);
      }
    }

    const plain = makeBlock({ shape: 'rectangle', customPoints: undefined });
    const plainPlan = computeImportSeatingPlan(plain, RECT, {
      blockCode: 'P1',
      rows: 4,
      seatsPerRow: 5,
      lineNumber: 2,
    }, pitchBelow);
    expect('error' in plainPlan).toBe(false);
    if (!('error' in plainPlan)) {
      expect(plainPlan.patch.customPoints).toHaveLength(4);
      expect(plainPlan.seatsPlaced).toBe(20);
    }
  });

  it('never places more seats per row than the columns input, even when more fit', () => {
    // Wide trapezoid — lower rows could physically fit far more than 10 seats.
    const trapezoid = makeBlock({
      customPoints: [
        { xPct: 20, yPct: 0 },
        { xPct: 80, yPct: 0 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
    });
    const plan = computeImportSeatingPlan(trapezoid, RECT, {
      blockCode: 'T1',
      rows: 5,
      seatsPerRow: 10,
      chairWidthM: 0.45,
      chairLengthM: 0.5,
      seatGapM: 0.06,
      rowGapM: 0.1,
      edgeMarginM: 0.2,
      lineNumber: 2,
    }, pitchBelow);
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    const counts = getSeatLayoutRowSeatCounts(plan.patch.seatLayout as SeatLayoutSpec);
    expect(counts).toHaveLength(5);
    expect(counts.every((c) => c <= 10)).toBe(true);
    expect(Math.max(...counts)).toBe(10);
  });

  it('fits exact columns on tapered blocks by sizing width to each row depth', () => {
    // Narrow at the pitch side (stadium trapezoid) — previously rows near the
    // front came up short; the chord-aware scale must fit 16 in every row.
    const narrowFront = makeBlock({
      customPoints: [
        { xPct: 0, yPct: 0 },
        { xPct: 100, yPct: 0 },
        { xPct: 70, yPct: 100 },
        { xPct: 30, yPct: 100 },
      ],
    });
    const plan = computeImportSeatingPlan(narrowFront, RECT, {
      blockCode: 'N1',
      rows: 8,
      seatsPerRow: 16,
      lineNumber: 2,
    }, pitchBelow);
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.shortfall).toBeUndefined();
    const counts = getSeatLayoutRowSeatCounts(plan.patch.seatLayout as SeatLayoutSpec);
    expect(counts).toEqual([16, 16, 16, 16, 16, 16, 16, 16]);
  });

  it('same CSV chair size renders the same pitch in every block at the venue scale', () => {
    const venueScale = 0.06; // metres per pixel — above both blocks' requirements
    const wideBlock = computeImportSeatingPlan(makeBlock({ id: 'blk-a' }), RECT, {
      blockCode: 'A1',
      rows: 5,
      seatsPerRow: 6,
      chairWidthM: 0.45,
      chairLengthM: 0.5,
      seatGapM: 0.06,
      lineNumber: 2,
    }, pitchBelow, venueScale);
    const wedge = computeImportSeatingPlan(
      makeBlock({
        id: 'blk-b',
        customPoints: [
          { xPct: 10, yPct: 0 },
          { xPct: 90, yPct: 0 },
          { xPct: 100, yPct: 100 },
          { xPct: 0, yPct: 100 },
        ],
      }),
      RECT,
      {
        blockCode: 'W1',
        chairWidthM: 0.45,
        chairLengthM: 0.5,
        seatGapM: 0.06,
        rowSeatCounts: [4, 4, 6, 6],
        lineNumber: 3,
      },
      pitchBelow,
      venueScale,
    );
    expect('error' in wideBlock).toBe(false);
    expect('error' in wedge).toBe(false);
    if ('error' in wideBlock || 'error' in wedge) return;
    expect(wideBlock.patch.chairWidthM).toBe(0.45);
    expect(wedge.patch.chairWidthM).toBe(0.45);
    const pitchA = (wideBlock.patch.seatLayout as SeatLayoutSpec).customShapeSeatPitchPx ?? 0;
    const pitchB = (wedge.patch.seatLayout as SeatLayoutSpec).customShapeSeatPitchPx ?? 0;
    expect(pitchA).toBeCloseTo(pitchB, 5);
    expect(pitchA).toBeCloseTo((0.45 + 0.06) / venueScale, 5);
  });

  it('renders bigger chairs bigger at the shared venue scale', () => {
    const venueScale = 0.06;
    const big = computeImportSeatingPlan(makeBlock({ id: 'blk-2' }), RECT, {
      blockCode: 'S2',
      rows: 3,
      seatsPerRow: 3,
      chairWidthM: 0.9,
      chairLengthM: 0.9,
      lineNumber: 3,
    }, pitchBelow, venueScale);
    const small = computeImportSeatingPlan(makeBlock({ id: 'blk-3' }), RECT, {
      blockCode: 'S3',
      rows: 5,
      seatsPerRow: 6,
      chairWidthM: 0.45,
      chairLengthM: 0.5,
      lineNumber: 4,
    }, pitchBelow, venueScale);
    expect('error' in big).toBe(false);
    expect('error' in small).toBe(false);
    if ('error' in big || 'error' in small) return;
    const bigPitch = (big.patch.seatLayout as SeatLayoutSpec).customShapeSeatPitchPx ?? 0;
    const smallPitch = (small.patch.seatLayout as SeatLayoutSpec).customShapeSeatPitchPx ?? 0;
    // 0.9m chairs must take visibly more pixels than 0.45m chairs at the same scale.
    expect(bigPitch).toBeGreaterThan(smallPitch * 1.5);
  });

  it('shrinks row pitch so a dense CSV row count still matches the grid', () => {
    const dense = computeImportSeatingPlan(makeBlock(), RECT, {
      blockCode: 'R50',
      rows: 20,
      seatsPerRow: 8,
      lineNumber: 2,
    }, pitchBelow, 0.06);
    const sparse = computeImportSeatingPlan(makeBlock(), RECT, {
      blockCode: 'R6',
      rows: 6,
      seatsPerRow: 8,
      lineNumber: 3,
    }, pitchBelow, 0.06);
    expect('error' in dense).toBe(false);
    expect('error' in sparse).toBe(false);
    if ('error' in dense || 'error' in sparse) return;
    expect(dense.rowsPlaced).toBeGreaterThanOrEqual(16);
    expect(dense.patch.chairLengthM!).toBeLessThan(sparse.patch.chairLengthM!);
    expect(dense.patch.rowGapM!).toBeLessThan(sparse.patch.rowGapM!);
  });

  it('keeps the documented seat pitch instead of stretching rows across the block', () => {
    const plan = computeImportSeatingPlan(makeBlock(), RECT, {
      blockCode: 'P1',
      rows: 3,
      seatsPerRow: 4,
      lineNumber: 2,
    }, pitchBelow, 0.06);
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    const overrides = plan.patch.seatPositionOverrides!;
    const layout = plan.patch.seatLayout as SeatLayoutSpec;
    const pitchPx = layout.customShapeSeatPitchPx ?? 0;
    // Adjacent seats in row A must sit ~pitch apart (not spread block-wide).
    const x1 = ((overrides['A1']?.xPct ?? 0) / 100) * RECT.width;
    const x2 = ((overrides['A2']?.xPct ?? 0) / 100) * RECT.width;
    expect(Math.abs(x2 - x1)).toBeLessThan(pitchPx * 1.25);
  });

  it('fills exact per-row counts from row_seats, centred, without capacity', () => {
    const plan = computeImportSeatingPlan(makeBlock(), RECT, {
      blockCode: 'R1',
      rowSeatCounts: [6, 6, 2, 5, 12],
      lineNumber: 2,
    }, pitchBelow);
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    const counts = getSeatLayoutRowSeatCounts(plan.patch.seatLayout as SeatLayoutSpec);
    expect(counts).toEqual([6, 6, 2, 5, 12]);
    expect(plan.seatsPlaced).toBe(31);
    expect(plan.shortfall).toBeUndefined();
    // Row C (2 seats) keeps the centred pair — near the row's middle.
    const overrides = plan.patch.seatPositionOverrides!;
    const rowCXs = [overrides['C1']?.xPct ?? 0, overrides['C2']?.xPct ?? 0];
    const rowEXs = Array.from({ length: 12 }, (_, s) => overrides[`E${s + 1}`]?.xPct ?? 0);
    const mid = (Math.min(...rowEXs) + Math.max(...rowEXs)) / 2;
    const rowCMid = (rowCXs[0] + rowCXs[1]) / 2;
    expect(Math.abs(rowCMid - mid)).toBeLessThan(15);
  });

  it('reports a shortfall warning when capacity cannot fit', () => {
    const plan = computeImportSeatingPlan(makeBlock(), RECT, {
      blockCode: 'B99',
      rows: 2,
      seatsPerRow: 3,
      chairWidthM: 0.45,
      chairLengthM: 0.5,
      seatGapM: 0.06,
      rowGapM: 0.1,
      capacity: 100,
      lineNumber: 2,
    }, pitchBelow);
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.seatsPlaced).toBeLessThan(100);
    expect(plan.warning).toContain('only');
    expect(plan.warning).toContain('only');
  });

  it('applies CSV center aisles with the same walkway gap as manual Create seats', () => {
    const aisles = [
      { type: 'center' as const, centerAxis: 'column' as const, widthM: 1.2 },
    ];
    const block = makeBlock({
      customSideLengthsM: [12, 8, 12, 8],
      physicalWidthM: 12,
      physicalLengthM: 8,
      blockViewpointAngleDeg: 180,
      blockViewpointManuallySet: true,
      chairWidthM: 0.45,
      chairLengthM: 0.5,
      seatGapM: 0.06,
      rowGapM: 0.1,
      borderGapM: 0.2,
    });
    const csvPlan = computeImportSeatingPlan(
      block,
      RECT,
      {
        blockCode: 'N3401',
        rows: 8,
        seatsPerRow: 8,
        chairWidthM: 0.45,
        chairLengthM: 0.5,
        seatGapM: 0.06,
        rowGapM: 0.1,
        edgeMarginM: 0.2,
        aisles,
        lineNumber: 2,
      },
      pitchBelow,
    );
    const manual = applyAutoFillToBlock(block, [block], { width: 1000, height: 700 }, {
      ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
      chairWidthM: 0.45,
      chairLengthM: 0.5,
      seatGapM: 0.06,
      rowGapM: 0.1,
      borderGapM: 0.2,
      aisles,
    });
    expect('error' in csvPlan).toBe(false);
    expect('error' in manual).toBe(false);
    if ('error' in csvPlan || 'error' in manual) {
      return;
    }
    const csvGap = largestFrontRowGap(csvPlan.patch.seatPositionOverrides ?? {});
    const manualGap = largestFrontRowGap(manual.patch.seatPositionOverrides ?? {});
    expect(csvPlan.rowsPlaced).toBeGreaterThan(0);
    expect(csvGap.width).toBeGreaterThan(4);
    expect(manualGap.width).toBeGreaterThan(8);
    expect(csvPlan.patch.autoFillAisles?.[0]).toMatchObject({
      type: 'center',
      centerAxis: 'column',
      widthM: 1.2,
    });
  });

  it('keeps the same CSV aisle rules on different-sized blocks and fills each shape', () => {
    const csvRow = {
      blockCode: '1',
      rows: 8,
      seatsPerRow: 8,
      chairWidthM: 0.45,
      chairLengthM: 0.5,
      seatGapM: 0.06,
      rowGapM: 0.1,
      edgeMarginM: 0.2,
      curveDeg: 0,
      aisles: [
        { type: 'center' as const, centerAxis: 'row' as const, widthM: 0.2 },
        { type: 'center' as const, centerAxis: 'column' as const, widthM: 0.2 },
      ],
      lineNumber: 2,
    };
    const smallRect = RECT;
    const largeRect = { x: 200, y: 50, width: 400, height: 210, cx: 400, cy: 155 };
    const small = computeImportSeatingPlan(makeBlock({ id: 's' }), smallRect, csvRow, pitchBelow);
    const large = computeImportSeatingPlan(makeBlock({ id: 'l' }), largeRect, csvRow, pitchBelow);
    expect('error' in small).toBe(false);
    expect('error' in large).toBe(false);
    if ('error' in small || 'error' in large) {
      return;
    }
    expect(small.patch.autoFillAisles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'center', centerAxis: 'row', widthM: 0.2 }),
        expect.objectContaining({ type: 'center', centerAxis: 'column', widthM: 0.2 }),
      ]),
    );
    expect(large.patch.autoFillAisles?.map((a) => ({ type: a.type, centerAxis: a.centerAxis, widthM: a.widthM }))).toEqual(
      small.patch.autoFillAisles?.map((a) => ({ type: a.type, centerAxis: a.centerAxis, widthM: a.widthM })),
    );
    expect(largestFrontRowGap(small.patch.seatPositionOverrides ?? {}).width).toBeGreaterThan(4);
    expect(largestFrontRowGap(large.patch.seatPositionOverrides ?? {}).width).toBeGreaterThan(4);
    expect(small.seatsPlaced).toBeGreaterThan(0);
    expect(large.seatsPlaced).toBeGreaterThan(0);
  });

  it('creates seats from the saved-template CSV (curve + center aisles)', () => {
    const parsed = parseSeatingImportCsv(
      [
        'block_code,rows,columns,capacity,chair_width_m,chair_length_m,seat_gap_m,row_gap_m,edge_margin_m,row_seats,curve_deg,center_row_aisle_widths_m,center_column_aisle_widths_m',
        '1,8,8,,0.45,0.5,0.06,0.1,0.2,,2,0.2,0.2',
      ].join('\n'),
    );
    expect(parsed.rows).toHaveLength(1);
    const plan = computeImportSeatingPlan(makeBlock({ name: '1', label: '1' }), RECT, parsed.rows[0], pitchBelow);
    expect('error' in plan).toBe(false);
    if ('error' in plan) {
      return;
    }
    expect(plan.patch.autoFillAisles).toHaveLength(2);
    expect(plan.patch.seatLayout?.rowCurveDeg).toBe(2);
    expect(plan.rowsPlaced).toBeGreaterThan(0);
    expect(plan.seatsPlaced).toBeGreaterThan(0);
  });

  it('applies CSV curve and stores aisle rules on the block patch', () => {
    const plan = computeImportSeatingPlan(
      makeBlock(),
      RECT,
      {
        blockCode: 'N3401',
        rows: 4,
        seatsPerRow: 6,
        curveDeg: 6,
        aisles: [{ type: 'row', rows: 'B', widthM: 1 }],
        lineNumber: 2,
      },
      pitchBelow,
    );
    expect('error' in plan).toBe(false);
    if ('error' in plan) {
      return;
    }
    expect(plan.patch.autoFillAisles?.[0]).toMatchObject({ type: 'row', rows: 'B' });
    expect(plan.patch.seatLayout?.rowCurveDeg).toBe(6);
    const overrides = plan.patch.seatPositionOverrides ?? {};
    const withRotation = Object.values(overrides).filter((s) => s.rotationDeg != null);
    expect(withRotation.length).toBe(0);
  });

  it('derives chair, gap, and border sizes from the CSV grid instead of defaults', () => {
    const plan = computeImportSeatingPlan(
      makeBlock(),
      RECT,
      { blockCode: 'N3401', rows: 6, seatsPerRow: 8, lineNumber: 2 },
      pitchBelow,
    );
    expect('error' in plan).toBe(false);
    if ('error' in plan) {
      return;
    }
    expect(plan.rowsPlaced).toBe(6);
    expect(plan.seatsPlaced).toBe(48);
    expect(plan.patch.chairWidthM).toBeGreaterThan(0);
    expect(plan.patch.chairLengthM).toBeGreaterThan(0);
    expect(plan.patch.seatGapM).toBeGreaterThanOrEqual(0);
    expect(plan.patch.rowGapM).toBeGreaterThanOrEqual(0);
    expect(plan.patch.borderGapM).toBeGreaterThanOrEqual(0);
    const dense = computeImportSeatingPlan(
      makeBlock(),
      RECT,
      { blockCode: 'N3401', rows: 6, seatsPerRow: 16, lineNumber: 3 },
      pitchBelow,
    );
    expect('error' in dense).toBe(false);
    if ('error' in dense) {
      return;
    }
    expect(dense.seatsPlaced).toBe(96);
    expect(dense.patch.chairWidthM!).toBeLessThan(plan.patch.chairWidthM!);
  });

  it('applies CSV chair, gap, and border metres identically and places seats at that pitch', () => {
    const spacing = deriveImportSpacingFromStructure(8, 6, 8, 8, 0.2, 0.2, {
      chairWidthM: 0.45,
      chairLengthM: 0.5,
      seatGapM: 0.06,
      rowGapM: 0.1,
      edgeMarginM: 0.2,
    });
    expect(spacing).toEqual({
      chairWidthM: 0.45,
      chairLengthM: 0.5,
      seatGapM: 0.06,
      rowGapM: 0.1,
      edgeMarginM: 0.2,
    });
    const plan = computeImportSeatingPlan(
      makeBlock(),
      RECT,
      {
        blockCode: 'N3401',
        rows: 8,
        seatsPerRow: 8,
        chairWidthM: 0.45,
        chairLengthM: 0.5,
        seatGapM: 0.06,
        rowGapM: 0.1,
        edgeMarginM: 0.2,
        curveDeg: 2,
        aisles: [
          { type: 'center', centerAxis: 'row', widthM: 0.2 },
          { type: 'center', centerAxis: 'column', widthM: 0.2 },
        ],
        lineNumber: 2,
      },
      pitchBelow,
    );
    expect('error' in plan).toBe(false);
    if ('error' in plan) {
      return;
    }
    expect(plan.patch).toMatchObject({
      chairWidthM: 0.45,
      chairLengthM: 0.5,
      seatGapM: 0.06,
      rowGapM: 0.1,
      borderGapM: 0.2,
    });
    expect(plan.patch.autoFillAisles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'center', centerAxis: 'row', widthM: 0.2 }),
        expect.objectContaining({ type: 'center', centerAxis: 'column', widthM: 0.2 }),
      ]),
    );
    expect(plan.patch.seatLayout?.rowCurveDeg).toBe(2);
    const layout = plan.patch.seatLayout as SeatLayoutSpec;
    expect(layout.customShapeSeatPitchPx ?? 0).toBeGreaterThan(0);
    const straight = computeImportSeatingPlan(
      makeBlock(),
      RECT,
      {
        blockCode: 'N3401',
        rows: 6,
        seatsPerRow: 8,
        chairWidthM: 0.45,
        chairLengthM: 0.5,
        seatGapM: 0.06,
        rowGapM: 0.1,
        edgeMarginM: 0.2,
        lineNumber: 3,
      },
      pitchBelow,
    );
    expect('error' in straight).toBe(false);
    if ('error' in straight) {
      return;
    }
    const straightPitch = (straight.patch.seatLayout as SeatLayoutSpec).customShapeSeatPitchPx ?? 0;
    const ppm = straightPitch / (0.45 + 0.06);
    const seats = straight.patch.seatPositionOverrides ?? {};
    const x1 = ((seats['A1']?.xPct ?? 0) / 100) * RECT.width;
    const x2 = ((seats['A2']?.xPct ?? 0) / 100) * RECT.width;
    expect(ppm).toBeGreaterThan(0);
    expect(Math.abs(x2 - x1)).toBeCloseTo((0.45 + 0.06) * ppm, 0);
  });

  it('packs leftover seats toward the outer edge away from an adjacent filled block', () => {
    const canvas = { width: 1000, height: 700 };
    const trapezoid = [
      { xPct: 15, yPct: 0 },
      { xPct: 85, yPct: 0 },
      { xPct: 100, yPct: 100 },
      { xPct: 0, yPct: 100 },
    ];
    const left = makeBlock({
      id: 'blk-left',
      position: { xPct: 30, yPct: 50 },
      size: { wPct: 18, hPct: 16 },
      customPoints: trapezoid,
    });
    const right = makeBlock({
      id: 'blk-right',
      position: { xPct: 50, yPct: 50 },
      size: { wPct: 18, hPct: 16 },
      customPoints: trapezoid,
      seatPositionOverrides: {
        A1: { xPct: 20, yPct: 40 },
        A2: { xPct: 40, yPct: 40 },
      },
    });
    const plan = computeImportSeatingPlan(
      left,
      { x: 210, y: 294, width: 180, height: 112, cx: 300, cy: 350 },
      {
        blockCode: 'L1',
        rows: 4,
        seatsPerRow: 8,
        chairWidthM: 0.5,
        chairLengthM: 0.5,
        seatGapM: 0.1,
        rowGapM: 0.15,
        edgeMarginM: 0.2,
        lineNumber: 2,
      },
      pitchBelow,
      undefined,
      { elements: [left, right], canvas },
    );
    expect('error' in plan).toBe(false);
    if ('error' in plan) {
      return;
    }
    expect(plan.patch.seatLayout?.seatAlign).not.toBe('center');
    const seats = Object.values(plan.patch.seatPositionOverrides ?? {});
    const xs = seats.map((s) => s.xPct);
    // Neighbour sits to the canvas-right, so leftover packs toward this block's outer (left) edge.
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeLessThan(50);
  });
});
