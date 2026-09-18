/**
 * Fills a user-drawn path (one or more straight segments) with the maximum number of
 * discrete, rotated parking slots that fit — for the "Add vehicle slots" tool. Reuses
 * the same inward-perpendicular convention as the (now-removed) divider-line generator
 * (`getLineInwardPerpendicular` in `custom-shape-seats.ts`), just dropping discrete
 * rectangles along the line instead of drawing one continuous offset line.
 */

import { CanvasPoint } from './custom-shape';
import { getLineInwardPerpendicular, pointInPolygon } from './custom-shape-seats';
import { ParkingSlotDefaults } from '../services/parking-slot-defaults.service';
import { ParkingVehicleType } from '../models/layout-element.model';

export type ParkingSlotPattern = 'single' | 'double' | 'angled' | 'double-angled' | 'one';

export interface ParkingVehicleTypeStyle {
  label: string;
  fill: string;
  stroke: string;
}

export const VEHICLE_TYPE_STYLE: Record<ParkingVehicleType, ParkingVehicleTypeStyle> = {
  car: { label: 'CAR', fill: '#bfdbfe', stroke: '#1d4ed8' },
  bus: { label: 'BUS', fill: '#fde68a', stroke: '#b45309' },
  wheelchair: { label: 'WC', fill: '#a7f3d0', stroke: '#047857' },
  ev: { label: 'EV', fill: '#ddd6fe', stroke: '#6d28d9' },
  bike: { label: 'BIKE', fill: '#fecaca', stroke: '#b91c1c' },
};

/**
 * Default "way" size (metres) — independent of vehicle defaults. Used both as the drawn
 * width of an Enter/Exit gate marker on the outline, and as the minimum clearance radius
 * kept free of parking slots around each gate so a vehicle actually has room to drive in/out.
 */
export const PARKING_ACCESS_WAY_WIDTH_M = 10;

/** Spreadsheet-style lane letter for a 0-based index: 0→A … 25→Z, 26→AA, 27→AB … */
export function laneLetterFromIndex(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function laneLetterToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

/**
 * Next unused lane letter given every existing slot label ("A1", "B7", …). Always one
 * past the highest letter ever used, so removing lane "B" never re-issues "B" — booked
 * slot codes stay unique for the lifetime of the parking area.
 */
export function nextParkingLaneLetter(existingLabels: Array<string | undefined>): string {
  let maxIndex = -1;
  for (const label of existingLabels) {
    const match = /^([A-Z]+)\d+$/.exec(label ?? '');
    if (match) {
      maxIndex = Math.max(maxIndex, laneLetterToIndex(match[1]));
    }
  }
  return laneLetterFromIndex(maxIndex + 1);
}

export interface PlacedSlotPoint {
  xPx: number;
  yPx: number;
  /** Degrees to rotate a slot glyph whose unrotated "depth" axis points along local +x. */
  rotationDeg: number;
  /** Which path segment (0-based) produced this slot — cross-segment spacing rules key off this. */
  segmentIndex: number;
}

/** Angle (degrees) between an angled slot's centreline and the drawn path — a common angled-parking convention. */
export const ANGLED_SLOT_DEGREES = 60;

/**
 * Walks each consecutive pair of points in `pathPx` as one segment and fills it with
 * slots, so a bent (multi-click) path keeps generating slots across every new segment.
 */
export function fillSlotsAlongPath(
  pathPx: CanvasPoint[],
  outline: CanvasPoint[],
  pxPerMeter: number,
  defaults: ParkingSlotDefaults,
  pattern: ParkingSlotPattern,
): PlacedSlotPoint[] {
  if (outline.length < 3 || pxPerMeter <= 0) {
    return [];
  }
  if (pattern === 'one') {
    // Stamp tool: exactly one axis-aligned slot per clicked point — the user positions
    // each by hand (and can drag it afterwards). All share segment 0 so no cross-row
    // corridor is forced between deliberate manual placements.
    return pathPx.map((p) => ({ xPx: p.x, yPx: p.y, rotationDeg: 0, segmentIndex: 0 }));
  }
  if (pathPx.length < 2) {
    return [];
  }
  const slots: PlacedSlotPoint[] = [];
  for (let i = 0; i < pathPx.length - 1; i++) {
    slots.push(...fillSlotsAlongSegment(pathPx[i], pathPx[i + 1], outline, pxPerMeter, defaults, pattern, i));
  }
  return slots;
}

function fillSlotsAlongSegment(
  a: CanvasPoint,
  b: CanvasPoint,
  outline: CanvasPoint[],
  pxPerMeter: number,
  defaults: ParkingSlotDefaults,
  pattern: ParkingSlotPattern,
  segmentIndex: number,
): PlacedSlotPoint[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const segLenPx = Math.hypot(dx, dy);
  if (segLenPx < 1) {
    return [];
  }
  const dirX = dx / segLenPx;
  const dirY = dy / segLenPx;
  const { perpX, perpY } = getLineInwardPerpendicular([a, b], outline);

  // Angle between the slot's depth axis and the path direction: 90° (perpendicular) for
  // single/double-side, tilted for angled parking. depthAxis = dir*cos + perp*sin, so at
  // 90° this collapses to exactly `perp` (unchanged behaviour for single/double).
  const angleDeg = pattern === 'angled' || pattern === 'double-angled' ? ANGLED_SLOT_DEGREES : 90;
  const angleRad = (angleDeg * Math.PI) / 180;
  const depthX = dirX * Math.cos(angleRad) + perpX * Math.sin(angleRad);
  const depthY = dirY * Math.cos(angleRad) + perpY * Math.sin(angleRad);
  const rotationDeg = (Math.atan2(depthY, depthX) * 180) / Math.PI;

  const lengthPx = defaults.lengthM * pxPerMeter;
  // Pitch along the line: angled slots take more room along the row than their own
  // width (standard angled-parking geometry: widthM / sin(angle)).
  const pitchPx = (defaults.widthM * pxPerMeter) / Math.sin(angleRad);
  if (pitchPx < 1) {
    return [];
  }
  const count = Math.max(0, Math.floor(segLenPx / pitchPx));
  const aisleHalfPx = (defaults.aisleWidthM * pxPerMeter) / 2;

  const slots: PlacedSlotPoint[] = [];
  for (let i = 0; i < count; i++) {
    const alongPx = pitchPx * (i + 0.5);
    const baseX = a.x + dirX * alongPx;
    const baseY = a.y + dirY * alongPx;

    if (pattern === 'double') {
      // Pushed apart by the vehicle type's aisle width so there's a real drivable gap
      // between the two facing rows, not a zero-gap back-to-back pair.
      slots.push({
        xPx: baseX + depthX * (aisleHalfPx + lengthPx / 2),
        yPx: baseY + depthY * (aisleHalfPx + lengthPx / 2),
        rotationDeg,
        segmentIndex,
      });
      slots.push({
        xPx: baseX - depthX * (aisleHalfPx + lengthPx / 2),
        yPx: baseY - depthY * (aisleHalfPx + lengthPx / 2),
        rotationDeg: rotationDeg + 180,
        segmentIndex,
      });
    } else if (pattern === 'double-angled') {
      // Herringbone: mirrored angled rows on both sides of the line. The centre offset
      // is measured perpendicular to the line and accounts for the tilted rect's full
      // extent, so the clear gap between the two rows is exactly the aisle width.
      const widthPx = defaults.widthM * pxPerMeter;
      const offsetPerpPx =
        aisleHalfPx + (lengthPx / 2) * Math.sin(angleRad) + (widthPx / 2) * Math.cos(angleRad);
      // Mirror the depth axis across the line direction for the far side.
      const depth2X = dirX * Math.cos(angleRad) - perpX * Math.sin(angleRad);
      const depth2Y = dirY * Math.cos(angleRad) - perpY * Math.sin(angleRad);
      const rotation2Deg = (Math.atan2(depth2Y, depth2X) * 180) / Math.PI;
      slots.push({
        xPx: baseX + perpX * offsetPerpPx,
        yPx: baseY + perpY * offsetPerpPx,
        rotationDeg,
        segmentIndex,
      });
      slots.push({
        xPx: baseX - perpX * offsetPerpPx,
        yPx: baseY - perpY * offsetPerpPx,
        rotationDeg: rotation2Deg,
        segmentIndex,
      });
    } else {
      slots.push({
        xPx: baseX + depthX * (lengthPx / 2),
        yPx: baseY + depthY * (lengthPx / 2),
        rotationDeg,
        segmentIndex,
      });
    }
  }
  return slots;
}

// --- Placement rules ---------------------------------------------------------

/** One slot as a rotated rectangle in canvas px — the shape all placement rules reason about. */
export interface SlotRect {
  cx: number;
  cy: number;
  rotationDeg: number;
  lengthPx: number;
  widthPx: number;
}

export interface PlannedSlot extends SlotRect {
  segmentIndex: number;
}

export interface SlotPlanContext {
  /** Canvas-px centres of the Enter/Exit gates — the "way" circle around each stays slot-free. */
  gateCenters?: CanvasPoint[];
  /** Slots already committed on the element (earlier lanes) — new slots must keep a car-width gap from them. */
  existingSlots?: SlotRect[];
}

/** Penetration below this (px) doesn't count as overlap, so flush edge-to-edge neighbours in one row never self-collide. */
const SAT_EPS = 1e-3;

/** Corners of a slot rect whose length runs along the rotated +x axis, width along +y. */
export function slotRectCorners(slot: SlotRect): CanvasPoint[] {
  const rad = (slot.rotationDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const hl = slot.lengthPx / 2;
  const hw = slot.widthPx / 2;
  return [
    { x: slot.cx + ux * hl - uy * hw, y: slot.cy + uy * hl + ux * hw },
    { x: slot.cx + ux * hl + uy * hw, y: slot.cy + uy * hl - ux * hw },
    { x: slot.cx - ux * hl + uy * hw, y: slot.cy - uy * hl - ux * hw },
    { x: slot.cx - ux * hl - uy * hw, y: slot.cy - uy * hl + ux * hw },
  ];
}

function projectSpan(corners: CanvasPoint[], ax: number, ay: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of corners) {
    const t = p.x * ax + p.y * ay;
    min = Math.min(min, t);
    max = Math.max(max, t);
  }
  return { min, max };
}

/** Separating-axis test for two convex quads (rotated rects). Exact edge-touch is NOT overlap. */
export function rotatedRectsOverlap(a: CanvasPoint[], b: CanvasPoint[]): boolean {
  for (const rect of [a, b]) {
    for (let i = 0; i < rect.length; i++) {
      const p1 = rect[i];
      const p2 = rect[(i + 1) % rect.length];
      const len = Math.hypot(p1.y - p2.y, p2.x - p1.x) || 1;
      const ax = (p1.y - p2.y) / len;
      const ay = (p2.x - p1.x) / len;
      const sa = projectSpan(a, ax, ay);
      const sb = projectSpan(b, ax, ay);
      if (sa.max <= sb.min + SAT_EPS || sb.max <= sa.min + SAT_EPS) {
        return false;
      }
    }
  }
  return true;
}

function distPointToSegment(px: number, py: number, a: CanvasPoint, b: CanvasPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    return Math.hypot(px - a.x, py - a.y);
  }
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function rectIntersectsCircle(corners: CanvasPoint[], center: CanvasPoint, radius: number): boolean {
  if (pointInPolygon(center, corners)) {
    return true;
  }
  for (let i = 0; i < corners.length; i++) {
    if (distPointToSegment(center.x, center.y, corners[i], corners[(i + 1) % corners.length]) < radius) {
      return true;
    }
  }
  return false;
}

function scaledTowardCenter(corners: CanvasPoint[], factor: number): CanvasPoint[] {
  const cx = corners.reduce((sum, p) => sum + p.x, 0) / corners.length;
  const cy = corners.reduce((sum, p) => sum + p.y, 0) / corners.length;
  return corners.map((p) => ({ x: cx + (p.x - cx) * factor, y: cy + (p.y - cy) * factor }));
}

/**
 * Fills the drawn path with slots, then enforces the placement rules, keeping earlier
 * slots and dropping later conflicting ones:
 *
 * 1. The whole slot rectangle must sit inside the outline (2% shrink tolerance so a
 *    flush-against-the-boundary slot still counts).
 * 2. No part of a slot may enter the "way" circle (radius `PARKING_ACCESS_WAY_WIDTH_M`)
 *    around any Enter/Exit gate — vehicles need that space to drive in and out.
 * 3. Slots within one row segment may touch edge-to-edge but never overlap (fixes
 *    corner pile-ups when a drawn path bends).
 * 4. Between slots of *different* segments or different lanes there must be at least a
 *    vehicle-width gap, so a car can always drive out from between two rows.
 */
export function planParkingSlots(
  pathPx: CanvasPoint[],
  outline: CanvasPoint[],
  pxPerMeter: number,
  defaults: ParkingSlotDefaults,
  pattern: ParkingSlotPattern,
  context: SlotPlanContext = {},
): PlannedSlot[] {
  const raw = fillSlotsAlongPath(pathPx, outline, pxPerMeter, defaults, pattern);
  if (raw.length === 0) {
    return [];
  }
  const lengthPx = defaults.lengthM * pxPerMeter;
  const widthPx = defaults.widthM * pxPerMeter;
  const gateClearancePx = PARKING_ACCESS_WAY_WIDTH_M * pxPerMeter;
  // Half of the required cross-row corridor per rect — two inflated rects meeting
  // means the true gap is below one vehicle width. Hand-stamped single slots ('one')
  // are deliberate placements, so only plain non-overlap applies to them.
  const passHalfGapPx = pattern === 'one' ? 0 : widthPx / 2;
  const gateCenters = context.gateCenters ?? [];
  const inflate = (slot: SlotRect) =>
    slotRectCorners({
      ...slot,
      lengthPx: slot.lengthPx + passHalfGapPx * 2,
      widthPx: slot.widthPx + passHalfGapPx * 2,
    });
  const existingInflated = (context.existingSlots ?? []).map(inflate);

  const kept: PlannedSlot[] = [];
  const keptExact: CanvasPoint[][] = [];
  const keptInflated: CanvasPoint[][] = [];

  for (const slot of raw) {
    const cand: PlannedSlot = {
      cx: slot.xPx,
      cy: slot.yPx,
      rotationDeg: slot.rotationDeg,
      lengthPx,
      widthPx,
      segmentIndex: slot.segmentIndex,
    };
    const exact = slotRectCorners(cand);
    if (!scaledTowardCenter(exact, 0.98).every((p) => pointInPolygon(p, outline))) {
      continue;
    }
    if (gateCenters.some((g) => rectIntersectsCircle(exact, g, gateClearancePx))) {
      continue;
    }
    const inflated = inflate(cand);
    let blocked = existingInflated.some((e) => rotatedRectsOverlap(inflated, e));
    for (let i = 0; !blocked && i < kept.length; i++) {
      blocked =
        kept[i].segmentIndex === cand.segmentIndex
          ? rotatedRectsOverlap(keptExact[i], exact)
          : rotatedRectsOverlap(keptInflated[i], inflated);
    }
    if (blocked) {
      continue;
    }
    kept.push(cand);
    keptExact.push(exact);
    keptInflated.push(inflated);
  }
  return kept;
}
