/** Normalized squircle seat tile. */
export const SEAT_HALF_SIZE = 5;
export const SEAT_CORNER_RADIUS = 3.5;
export const SEAT_GRAPHIC_SIZE = SEAT_HALF_SIZE * 2;

/** Legacy alias — spacing math still uses “radius”; maps to squircle half-size. */
export const SEAT_DOT_RADIUS = SEAT_HALF_SIZE;

/** @deprecated Use SEAT_GRAPHIC_SIZE. */
export const CHAIR_VIEW_W = SEAT_GRAPHIC_SIZE;
export const CHAIR_VIEW_H = SEAT_GRAPHIC_SIZE;

/** Friendly default palette: airy blue-tinted chairs, amber when selected (ticket-map convention). */
export const SEAT_BODY_FILL = '#e9f0fa';
export const SEAT_BODY_STROKE = '#7189a5';

export const SEAT_SELECTED_BODY_FILL = '#fbbf24';
export const SEAT_SELECTED_BODY_STROKE = '#b45309';
/** Halo ring drawn around the selected chair. */
export const SEAT_SELECTED_HALO_STROKE = '#f59e0b';

export function squircleRectAttrs(): {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
} {
  const size = SEAT_HALF_SIZE * 2;
  return {
    x: -SEAT_HALF_SIZE,
    y: -SEAT_HALF_SIZE,
    width: size,
    height: size,
    rx: SEAT_CORNER_RADIUS,
    ry: SEAT_CORNER_RADIUS,
  };
}

/** One part of the top-down chair glyph, in local units (same -5..5 box as the squircle). */
export interface ChairPartRect {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
}

/**
 * True top-down chair, facing the stage at the top of the canvas (-y). The rotation
 * math in drag-seats points -y at the block VIEW POINT, so at rotation 0 the open
 * front edge with its small arrow points at the stage and the dark backrest bar sits
 * behind the sitter at the bottom. Thin rails down both sides read as armrests.
 * Footprint stays inside the -5..5 box so pitch/hit-test math is unchanged.
 */
export const CHAIR_BACKREST: ChairPartRect = { x: -4.6, y: 2.6, width: 9.2, height: 2.4, rx: 1.2, ry: 1.2 };
export const CHAIR_RAIL_LEFT: ChairPartRect = { x: -5, y: -3, width: 0.9, height: 6.2, rx: 0.45, ry: 0.45 };
export const CHAIR_RAIL_RIGHT: ChairPartRect = { x: 4.1, y: -3, width: 0.9, height: 6.2, rx: 0.45, ry: 0.45 };
export const CHAIR_CUSHION: ChairPartRect = { x: -3.9, y: -4.8, width: 7.8, height: 8, rx: 2, ry: 2 };
/** Chevron on the cushion pointing at the stage — the at-a-glance facing cue. */
export const CHAIR_FRONT_ARROW_PATH = 'M-1.5 -2.4 L0 -3.9 L1.5 -2.4';

/**
 * Mix a hex color toward white (amount > 0) or black (amount < 0), amount in -1..1.
 * Non-hex inputs are returned unchanged so custom CSS colors still render.
 */
export function shadeHexColor(color: string, amount: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) {
    return color;
  }
  const raw = m[1];
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const target = amount < 0 ? 0 : 255;
  const t = Math.min(1, Math.abs(amount));
  const channel = (offset: number): string => {
    const value = parseInt(full.slice(offset, offset + 2), 16);
    return Math.round(value + (target - value) * t)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

export function chairScaleFromPitchPx(pitchPx: number): number {
  return Math.max(0.55, Math.min(1.4, pitchPx / 13.5));
}

/** Chair glyph scale from seat pitch and documented chair / gap dimensions (metres). */
export function chairScalesFromSeatPitch(
  pitchPx: number,
  chairWidthM: number,
  chairLengthM: number,
  seatGapM: number,
  rowGapM: number,
): { chairScale: number; chairScaleY: number } {
  const colPitchM = chairWidthM + seatGapM;
  const rowPitchM = chairLengthM + rowGapM;
  const pxPerM = colPitchM > 0 ? pitchPx / colPitchM : 0;
  // Never draw a chair larger than ~90% of its pitch — otherwise dense metre
  // packs on a small canvas block melt into a solid blob.
  const maxScaleForPitch = pitchPx > 0 ? (pitchPx * 0.9) / SEAT_GRAPHIC_SIZE : 3;
  const clampScale = (value: number): number =>
    Math.max(0.02, Math.min(3, maxScaleForPitch, value));
  if (chairWidthM > 0 && pxPerM > 0 && rowPitchM > 0) {
    return {
      chairScale: clampScale((chairWidthM * pxPerM) / SEAT_GRAPHIC_SIZE),
      chairScaleY: clampScale((chairLengthM * pxPerM) / SEAT_GRAPHIC_SIZE),
    };
  }
  const scale = chairScaleFromPitchPx(pitchPx);
  return { chairScale: clampScale(scale), chairScaleY: clampScale(scale) };
}

/** Hit target sized to the squircle — avoids selecting the neighbouring seat. */
export function chairHitRadiusFromPitchPx(pitchPx: number): number {
  return chairScaleFromPitchPx(pitchPx) * SEAT_HALF_SIZE * 1.12;
}

export function chairHitRadiusFromSeatRadius(radius: number): number {
  return Math.max(2.5, radius * 1.12);
}

export function chairScaleFromSeatRadius(radius: number): number {
  return Math.max(0.55, Math.min(1.4, radius / SEAT_HALF_SIZE));
}

/** Minimum seat radius before inline labels are shown (circle-era threshold). */
export function seatLabelMinScale(): number {
  return 3.8 / SEAT_HALF_SIZE;
}

/** Label Y offset in local units — on the cushion, just below the front arrow. */
export function seatLabelOffsetY(): number {
  return SEAT_HALF_SIZE * 0.14;
}

/** Font size in local squircle units for a given scale. */
export function seatLabelFontSize(scale: number): number {
  const worldRadius = scale * SEAT_HALF_SIZE;
  const worldFont = worldRadius >= 5 ? 5 : 4;
  return worldFont / Math.max(0.55, scale);
}
