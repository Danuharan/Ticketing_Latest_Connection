/**
 * OCR-code-driven parking-slot detection.
 *
 * Every bay on a parking plan carries a printed bookable code (S1, T3, A12…). Azure
 * Document Intelligence (already deployed, used for stadium block labels) reads each
 * code as a token with a centre position — far more reliable than pixel bay-detection
 * or a vision model. This module turns those code tokens directly into slot placements:
 * one slot per code, at the code's position, keeping the real code as its label and
 * grouping codes into lanes by their letter prefix.
 *
 * Pure and DOM-free so everything here is unit-testable.
 */

import type { PointPct } from './contour-geometry';
import { bayShapePoints, type DetectedParkingBay, type DetectedParkingSlotPlacement } from './detect-parking-plan';
import type { OcrToken } from './assign-ocr-labels';
import type { ParkingSlotDefaults } from '../services/parking-slot-defaults.service';

export interface ParkingCodeSlot {
  /** Real printed bookable code, used verbatim as the slot label. */
  code: string;
  /** Letter prefix — the lane-grouping key ("S", "A", "EV"). */
  laneKey: string;
  /** Numeric part, for ordering within a lane. */
  index: number;
  /** Token centre, image-% (0–100). */
  xPct: number;
  yPct: number;
  /** Glyph height, image-% — used to drop tiny non-code noise. */
  hPct: number;
}

/**
 * Clamps for sizes we GUESSED (no geometry on the plan backs them up) — a guess outside
 * the range a real vehicle bay can be is worse than the default.
 */
const SLOT_WIDTH_MIN_M = 1.2;
const SLOT_WIDTH_MAX_M = 4.5;
const SLOT_LENGTH_MIN_M = 2.5;
const SLOT_LENGTH_MAX_M = 9;
/**
 * Sizes MEASURED off the plan (a traced stall cell, or the printed code pitch) get much
 * wider bounds — only enough to reject a broken scale, not to second-guess the drawing.
 *
 * Plans are regularly schematic rather than to scale: a lot printed "180.0 m" wide with
 * 15 stalls drawn across it puts each stall at 9.4 m, far past a real 2.5 m bay. Forcing
 * such a plan back to vehicle-sized metres is what leaves slots floating at half the size
 * of the boxes they are supposed to sit on, so measured geometry is rendered as drawn and
 * the metres follow the plan's own scale.
 */
const MEASURED_MIN_M = 0.5;
const MEASURED_MAX_M = 40;
/** A bookable code: 1–3 letters, 1–3 digits, an optional trailing letter (S1, EV3, A12b). */
const SLOT_CODE_RE = /^([A-Za-z]{1,3})(\d{1,3})([A-Za-z])?$/;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Keeps only OCR tokens that read as a bookable slot code. Rejects dimensions
 * ("180.0", "m" — no leading letter / contains a dot), titles ("PARKING A" — the space
 * splits it into non-matching tokens), and lone letters. Tokens far smaller than the
 * median glyph height (aisle ticks, stray marks) are dropped when heights are available.
 */
export function parseParkingSlotCodes(tokens: OcrToken[]): ParkingCodeSlot[] {
  const matched: ParkingCodeSlot[] = [];
  for (const token of tokens) {
    const text = token.text.trim();
    const m = SLOT_CODE_RE.exec(text);
    if (!m) {
      continue;
    }
    matched.push({
      code: text.toUpperCase(),
      laneKey: (m[1] + (m[3] ?? '')).toUpperCase(),
      index: parseInt(m[2], 10),
      xPct: token.xPct,
      yPct: token.yPct,
      hPct: typeof token.hPct === 'number' ? token.hPct : 0,
    });
  }

  const heights = matched.map((c) => c.hPct).filter((h) => h > 0);
  if (heights.length >= 6) {
    const sorted = [...heights].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const minHeight = median * 0.5;
    return matched.filter((c) => c.hPct === 0 || c.hPct >= minHeight);
  }
  return matched;
}

/**
 * After browser-CV placement, attach printed OCR codes to the nearest slot (naming
 * only — geometry stays CV). Each code is used at most once. Returns placements with
 * labels filled where a code was within maxDistPct of the slot centre.
 */
export function assignOcrCodesToCvPlacements(
  placements: DetectedParkingSlotPlacement[],
  codes: ParkingCodeSlot[],
  maxDistPct = 3.5,
): { placements: DetectedParkingSlotPlacement[]; uncovered: ParkingCodeSlot[] } {
  if (placements.length === 0 || codes.length === 0) {
    return { placements: [...placements], uncovered: [...codes] };
  }
  const usedCode = new Set<number>();
  const next = placements.map((p) => ({ ...p }));
  for (let i = 0; i < next.length; i += 1) {
    let best = -1;
    let bestDist = maxDistPct;
    for (let c = 0; c < codes.length; c += 1) {
      if (usedCode.has(c)) {
        continue;
      }
      const d = Math.hypot(next[i].xPct - codes[c].xPct, next[i].yPct - codes[c].yPct);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (best >= 0) {
      usedCode.add(best);
      next[i] = {
        ...next[i],
        label: codes[best].code,
        laneKey: codes[best].laneKey,
      };
    }
  }
  const uncovered = codes.filter((_, i) => !usedCode.has(i));
  return { placements: next, uncovered };
}

/** Groups codes by their letter prefix; each lane ordered by numeric index. */
export function clusterCodeLanes(codes: ParkingCodeSlot[]): Map<string, ParkingCodeSlot[]> {
  const lanes = new Map<string, ParkingCodeSlot[]>();
  for (const code of codes) {
    const list = lanes.get(code.laneKey);
    if (list) {
      list.push(code);
    } else {
      lanes.set(code.laneKey, [code]);
    }
  }
  for (const list of lanes.values()) {
    list.sort((a, b) => a.index - b.index);
  }
  return lanes;
}

/**
 * Slot long-axis angle (deg, [0,180)) for a lane: the codes in one lane sit on a line
 * (a column like S1..S27, or a row like A1..A20). The slots' long axis is PERPENDICULAR
 * to that line — a vertical code column → 0° (cars point left-right), a horizontal code
 * row → 90°. Derived from the PCA principal axis of the lane's code centres in px space.
 */
export function laneRotationDeg(
  lane: ParkingCodeSlot[],
  imageWidthPx: number,
  imageHeightPx: number,
  fallbackDeg = 90,
): number {
  if (lane.length < 2) {
    return fallbackDeg;
  }
  const pts = lane.map((c) => ({
    x: (c.xPct / 100) * imageWidthPx,
    y: (c.yPct / 100) * imageHeightPx,
  }));
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  // Principal-axis (line) direction from the 2×2 covariance.
  const lineAngle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const perpDeg = (lineAngle * 180) / Math.PI + 90;
  return ((perpDeg % 180) + 180) % 180;
}

/**
 * Corrected, straightened positions for a lane's codes. OCR centres carry per-token
 * jitter (each code lands where its glyphs happened to print, half a stall high, nudged
 * sideways), so slots placed on raw centres render as a crooked row over a perfectly
 * straight painted one. But the lane's true geometry is recoverable from the codes
 * themselves: stalls in a lane sit on a straight line at a constant pitch, numbered
 * consecutively — so fit the PCA line, regress position against the printed NUMBER
 * (missing codes then leave a correct-width gap), and put each code at its fitted spot.
 *
 * Only returns positions it is confident about; the map is empty when the lane is not
 * actually a straight evenly-numbered row:
 * - fewer than 3 codes (nothing to average out),
 * - duplicate numbers (an OCR misread — snapping both onto one fitted spot would stack them),
 * - perpendicular scatter comparable to the pitch (an L-shaped or wrapped "lane"),
 * and an individual code whose along-line residual exceeds half a pitch keeps its raw
 * position (it genuinely sits off the row, or its number was misread).
 */
export function straightenLaneCodes(
  lane: ParkingCodeSlot[],
  imageWidthPx: number,
  imageHeightPx: number,
): Map<ParkingCodeSlot, PointPct> {
  const out = new Map<ParkingCodeSlot, PointPct>();
  if (lane.length < 3) {
    return out;
  }
  if (new Set(lane.map((c) => c.index)).size !== lane.length) {
    return out;
  }

  const pts = lane.map((c) => ({ x: (c.xPct / 100) * imageWidthPx, y: (c.yPct / 100) * imageHeightPx }));
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const lineAngle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(lineAngle);
  const uy = Math.sin(lineAngle);
  // Perpendicular unit vector.
  const nx = -uy;
  const ny = ux;

  const along = pts.map((p) => (p.x - mx) * ux + (p.y - my) * uy);
  const across = pts.map((p) => (p.x - mx) * nx + (p.y - my) * ny);

  // Least-squares along-line position against the printed number: t = a + b·index.
  const meanIdx = lane.reduce((s, c) => s + c.index, 0) / n;
  const meanT = along.reduce((s, t) => s + t, 0) / n;
  let sii = 0;
  let sit = 0;
  lane.forEach((c, i) => {
    sii += (c.index - meanIdx) ** 2;
    sit += (c.index - meanIdx) * (along[i] - meanT);
  });
  if (sii < 1e-9) {
    return out;
  }
  const pitch = sit / sii; // signed px per index step
  const intercept = meanT - pitch * meanIdx;
  const absPitch = Math.abs(pitch);
  if (absPitch < 2) {
    return out;
  }

  // Not-a-straight-row guard: perpendicular scatter must be small next to the pitch.
  const sortedAcross = [...across].sort((a, b) => a - b);
  const medianAcross = sortedAcross[Math.floor(sortedAcross.length / 2)];
  const scatter = across.map((s) => Math.abs(s - medianAcross)).sort((a, b) => a - b);
  if (scatter[Math.floor(scatter.length / 2)] > absPitch * 0.35) {
    return out;
  }

  // Fit-quality gate: OCR jitter is a small fraction of a stall pitch, so a typical
  // (along-line) residual beyond a quarter pitch means the lane is not the straight
  // consecutively-numbered row this model assumes (a wild outlier also drags the whole
  // least-squares fit, so per-code residual checks alone cannot be trusted then).
  const residuals = lane.map((c, i) => Math.abs(along[i] - (intercept + pitch * c.index)));
  const sortedResiduals = [...residuals].sort((a, b) => a - b);
  if (sortedResiduals[Math.floor(sortedResiduals.length / 2)] > absPitch * 0.25) {
    return out;
  }

  lane.forEach((c, i) => {
    if (residuals[i] > absPitch * 0.5) {
      return; // genuinely off the row (or misread number) — keep the raw position
    }
    const fittedT = intercept + pitch * c.index;
    const x = mx + ux * fittedT + nx * medianAcross;
    const y = my + uy * fittedT + ny * medianAcross;
    // 0.01% (sub-pixel everywhere) — also keeps an already-exact position exactly put.
    out.set(c, {
      xPct: Math.round(clamp((x / imageWidthPx) * 100, 0, 100) * 100) / 100,
      yPct: Math.round(clamp((y / imageHeightPx) * 100, 0, 100) * 100) / 100,
    });
  });
  return out;
}

/**
 * Robust per-stall pitch for sanity checks (px): consecutive-code gaps normalised by
 * their index step (a missing number widens the raw gap, not the per-stall pitch), with
 * far-out gaps (a stray code parked across the lot) dropped before taking the median.
 */
function laneSanityPitchPx(lane: ParkingCodeSlot[], imageWidthPx: number, imageHeightPx: number): number {
  if (lane.length < 2) {
    return 0;
  }
  const gaps: number[] = [];
  for (let i = 0; i + 1 < lane.length; i++) {
    const steps = Math.max(1, Math.abs(lane[i + 1].index - lane[i].index));
    gaps.push(
      Math.hypot(
        ((lane[i + 1].xPct - lane[i].xPct) / 100) * imageWidthPx,
        ((lane[i + 1].yPct - lane[i].yPct) / 100) * imageHeightPx,
      ) / steps,
    );
  }
  const minGap = Math.min(...gaps);
  const kept = gaps.filter((g) => g <= minGap * 2.5).sort((a, b) => a - b);
  return kept[Math.floor(kept.length / 2)];
}

/** Median centre-to-centre pitch between consecutive codes in a lane (px), 0 when unknown. */
function laneMedianPitchPx(lane: ParkingCodeSlot[], imageWidthPx: number, imageHeightPx: number): number {
  if (lane.length < 2) {
    return 0;
  }
  const gaps: number[] = [];
  for (let i = 0; i + 1 < lane.length; i++) {
    gaps.push(
      Math.hypot(
        ((lane[i + 1].xPct - lane[i].xPct) / 100) * imageWidthPx,
        ((lane[i + 1].yPct - lane[i].yPct) / 100) * imageHeightPx,
      ),
    );
  }
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * One `DetectedParkingBay` per code, so the existing scale/outline helpers
 * (`resolveParkingPlanScale`, `assignEdgeLengths`, `ensureOutlineContainsBays`) can be
 * reused unchanged. Bay px extents come from the resolved scale, or a pitch/height
 * default when no scale exists.
 */
export function codesToPseudoBays(
  codes: ParkingCodeSlot[],
  imageWidthPx: number,
  imageHeightPx: number,
  ppm: number | null,
  carDefaults: ParkingSlotDefaults,
): DetectedParkingBay[] {
  const lanes = clusterCodeLanes(codes);
  const bays: DetectedParkingBay[] = [];
  const dominant = dominantRotation(lanes, imageWidthPx, imageHeightPx);
  for (const lane of lanes.values()) {
    const rotationDeg = laneRotationDeg(lane, imageWidthPx, imageHeightPx, dominant);
    const pitchPx = laneMedianPitchPx(lane, imageWidthPx, imageHeightPx);
    // Take the LARGER of the scale-based and pitch-based estimates: on a schematic plan
    // (stalls drawn far bigger than the printed scale implies) the car-default size in px
    // is a fraction of the real drawn stall, and pseudo-bays that small make the outline
    // growth clip the drawn boxes at the lot edge.
    const widthPx = Math.max(ppm ? carDefaults.widthM * ppm : 0, pitchPx > 0 ? pitchPx * 0.9 : 0) || 20;
    const lengthPx = Math.max(ppm ? carDefaults.lengthM * ppm : 0, widthPx * 2);
    for (const code of lane) {
      bays.push({ cxPct: code.xPct, cyPct: code.yPct, rotationDeg, lengthPx, widthPx });
    }
  }
  return bays;
}

/** The rotation shared by the most codes — used as the fallback for single-code lanes. */
function dominantRotation(
  lanes: Map<string, ParkingCodeSlot[]>,
  imageWidthPx: number,
  imageHeightPx: number,
): number {
  let bestDeg = 90;
  let bestCount = -1;
  for (const lane of lanes.values()) {
    if (lane.length < 2) {
      continue;
    }
    if (lane.length > bestCount) {
      bestCount = lane.length;
      bestDeg = laneRotationDeg(lane, imageWidthPx, imageHeightPx);
    }
  }
  return bestDeg;
}

/**
 * Merges per-code traced cells (`detectCellsAtPoints`) into the main bay list, skipping
 * cells that duplicate an already-detected bay (same stall found by both passes). The
 * filtered main pass stays authoritative; the cells fill in what it dropped — side
 * columns outside the asphalt region or below the dominant size cluster.
 */
export function mergeDetectedCellBays(
  bays: DetectedParkingBay[],
  cells: (DetectedParkingBay | null)[],
  imageWidthPx: number,
  imageHeightPx: number,
): DetectedParkingBay[] {
  const merged = [...bays];
  for (const cell of cells) {
    if (!cell) {
      continue;
    }
    const cx = (cell.cxPct / 100) * imageWidthPx;
    const cy = (cell.cyPct / 100) * imageHeightPx;
    const duplicate = merged.some((b) => {
      const bx = (b.cxPct / 100) * imageWidthPx;
      const by = (b.cyPct / 100) * imageHeightPx;
      return Math.hypot(cx - bx, cy - by) < Math.max(b.widthPx, cell.widthPx) * 0.6;
    });
    if (!duplicate) {
      merged.push(cell);
    }
  }
  return merged;
}

/**
 * A printed code sits inside its own stall, but rarely dead-centre — it is usually set
 * near the head of the bay and can straddle a stall line. Containment is therefore
 * tested against the bay's oriented rectangle grown by this factor.
 */
const BAY_CONTAINMENT_PAD = 1.15;

/**
 * Pairs each code with the pixel-CV bay it was printed inside, so a slot can take the
 * bay's real centre, angle, extents and traced outline instead of a default box dropped
 * on the text position. One bay per code, so two codes printed close together never
 * collapse onto the same stall.
 *
 * Plans print their codes at a *consistent* spot inside the stall — typically near the
 * head, not the centre. Scoring candidates by raw distance therefore mis-assigns a whole
 * row: every code sits nearer its neighbour's centre than its own. So the systematic
 * offset is estimated first (the median bay-local offset over all containing pairs) and
 * candidates are ranked by how far they deviate from it — the row then lines up
 * one-to-one, and a genuinely stray code still scores badly.
 *
 * Result is index-aligned with `codes`; `null` means no bay contained that code (a code
 * printed on an aisle, or a stall the CV pass missed) — the caller falls back to the
 * lane estimate for those.
 */
export function matchCodesToBays(
  codes: ParkingCodeSlot[],
  bays: DetectedParkingBay[],
  imageWidthPx: number,
  imageHeightPx: number,
): (DetectedParkingBay | null)[] {
  const matched: (DetectedParkingBay | null)[] = codes.map(() => null);
  if (bays.length === 0) {
    return matched;
  }

  const candidates: { codeIndex: number; bayIndex: number; along: number; across: number }[] = [];
  codes.forEach((code, codeIndex) => {
    const px = (code.xPct / 100) * imageWidthPx;
    const py = (code.yPct / 100) * imageHeightPx;
    bays.forEach((bay, bayIndex) => {
      const halfLength = (bay.lengthPx / 2) * BAY_CONTAINMENT_PAD;
      const halfWidth = (bay.widthPx / 2) * BAY_CONTAINMENT_PAD;
      if (halfLength <= 0 || halfWidth <= 0) {
        return;
      }
      const dx = px - (bay.cxPct / 100) * imageWidthPx;
      const dy = py - (bay.cyPct / 100) * imageHeightPx;
      // Same bay-local frame as `bayShapePoints`: x along the depth axis, y across it.
      const rad = (-bay.rotationDeg * Math.PI) / 180;
      const along = dx * Math.cos(rad) - dy * Math.sin(rad);
      const across = dx * Math.sin(rad) + dy * Math.cos(rad);
      if (Math.abs(along) > halfLength || Math.abs(across) > halfWidth) {
        return;
      }
      candidates.push({ codeIndex, bayIndex, along, across });
    });
  });
  if (candidates.length === 0) {
    return matched;
  }

  const offsetAlong = median(candidates.map((c) => c.along));
  const offsetAcross = median(candidates.map((c) => c.across));
  const scored = candidates.map((c) => ({
    ...c,
    score: Math.hypot(c.along - offsetAlong, c.across - offsetAcross),
  }));
  scored.sort((a, b) => a.score - b.score);

  const takenBays = new Set<number>();
  for (const c of scored) {
    if (matched[c.codeIndex] || takenBays.has(c.bayIndex)) {
      continue;
    }
    matched[c.codeIndex] = bays[c.bayIndex];
    takenBays.add(c.bayIndex);
  }
  return matched;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Detected px extent → rendered metres. Keep the plan's drawn size (no snap to the
 * vehicle default) so slots match the uploaded image stall boxes. Bounded only
 * against a broken scale — see `MEASURED_MAX_M`.
 */
function measuredExtentToMetres(px: number, ppm: number, _defaultM: number): number {
  const raw = px / ppm;
  return round1(clamp(raw, MEASURED_MIN_M, MEASURED_MAX_M));
}

/**
 * Turns code tokens into slot placements: one per code, real code as the label, grouped
 * into lanes by prefix (ordered top-to-bottom then left-to-right, same as the CV path).
 *
 * When `bays` (the pixel-CV stall cells) are supplied, a code matched to a bay takes that
 * bay's geometry — centre, depth angle, and traced outline for non-rectangular cells —
 * and the lane is measured from the median of its own matched bays, so the slots land on
 * the painted stalls at their real size instead of on the text at a default size. Codes
 * with no matching bay (and the no-bays case) keep the previous behaviour: the code
 * position, the lane's PCA angle, and a size from the code pitch or the car defaults.
 */
export function buildOcrSlotPlacements(
  codes: ParkingCodeSlot[],
  ppm: number | null,
  imageWidthPx: number,
  imageHeightPx: number,
  carDefaults: ParkingSlotDefaults,
  bays: DetectedParkingBay[] = [],
): DetectedParkingSlotPlacement[] {
  const matchedBays = matchCodesToBays(codes, bays, imageWidthPx, imageHeightPx);
  const bayForCode = new Map<ParkingCodeSlot, DetectedParkingBay>();
  codes.forEach((code, i) => {
    const bay = matchedBays[i];
    if (bay) {
      bayForCode.set(code, bay);
    }
  });

  const lanes = clusterCodeLanes(codes);
  const dominant = dominantRotation(lanes, imageWidthPx, imageHeightPx);
  const aspect = carDefaults.widthM > 0 ? carDefaults.lengthM / carDefaults.widthM : 2;

  // Deterministic lane order: top-to-bottom by centroid, then left-to-right.
  const ordered = [...lanes.entries()].sort(([, a], [, b]) => {
    const ca = a.reduce((s, c) => s + c.yPct * 1000 + c.xPct, 0) / a.length;
    const cb = b.reduce((s, c) => s + c.yPct * 1000 + c.xPct, 0) / b.length;
    return ca - cb;
  });

  // Depth-to-width ratio of the stalls actually traced on this plan. A lane that matched
  // no bay borrows it, so its slots stay as deep as the drawn boxes around them instead
  // of defaulting to the 2:1 of a real car bay.
  const matchedAspects = [...bayForCode.values()]
    .filter((b) => b.widthPx > 0)
    .map((b) => b.lengthPx / b.widthPx);
  const planAspect = matchedAspects.length > 0 ? median(matchedAspects) : aspect;

  const placements: DetectedParkingSlotPlacement[] = [];
  ordered.forEach(([laneKey, lane], laneIndex) => {
    const laneRotation = laneRotationDeg(lane, imageWidthPx, imageHeightPx, dominant);

    // Distrust bay matches this lane's own geometry contradicts. The code pitch is
    // ground truth for the stall width (one code per stall, printed consecutively), so a
    // matched cell far wider or narrower than the pitch is the WRONG cell — a big
    // neighbouring region whose padded rect happened to contain the code. Using its
    // centre/size drags the whole lane off the drawing at an inflated size (the T-column
    // regression). Distrusted codes fall back to the straightened code position.
    const laneBayFor = new Map<ParkingCodeSlot, DetectedParkingBay>();
    for (const code of lane) {
      const bay = bayForCode.get(code);
      if (bay) {
        laneBayFor.set(code, bay);
      }
    }
    const sanityPitchPx = laneSanityPitchPx(lane, imageWidthPx, imageHeightPx);
    if (sanityPitchPx > 0 && laneBayFor.size > 0) {
      const medW = median([...laneBayFor.values()].map((b) => b.widthPx));
      if (medW > sanityPitchPx * 1.7 || medW < sanityPitchPx * 0.45) {
        laneBayFor.clear(); // the whole lane matched the wrong cell family
      } else {
        for (const [code, bay] of [...laneBayFor]) {
          if (bay.widthPx > medW * 1.6 || bay.widthPx < medW * 0.5) {
            laneBayFor.delete(code); // one odd cell in an otherwise-consistent lane
          }
        }
      }
    }
    const laneBays = [...laneBayFor.values()];
    // Fallback rotation for a code with no trusted bay: the rotation the lane's good bays
    // actually drew at, so a dropped cell sits parallel to its neighbours — not the
    // abstract PCA angle (which is 90° off the bays for a horizontal code row).
    const fallbackRotation = laneBays.length > 0 ? median(laneBays.map((b) => b.rotationDeg)) : laneRotation;

    let widthM: number;
    let lengthM: number;
    const pitchPx = ppm ? laneMedianPitchPx(lane, imageWidthPx, imageHeightPx) : 0;
    if (ppm && laneBays.length > 0) {
      // Measured off the stalls this lane actually matched — one median size for the
      // whole lane, so per-bay pixel noise doesn't make neighbouring slots disagree.
      widthM = measuredExtentToMetres(median(laneBays.map((b) => b.widthPx)), ppm, carDefaults.widthM);
      lengthM = measuredExtentToMetres(median(laneBays.map((b) => b.lengthPx)), ppm, carDefaults.lengthM);
    } else if (ppm && pitchPx > 0) {
      // No traced cell, but the code spacing IS a measurement of the stall pitch — stalls
      // in a row sit edge to edge, so the pitch is the width.
      widthM = measuredExtentToMetres(pitchPx, ppm, carDefaults.widthM);
      lengthM = round1(clamp(widthM * planAspect, MEASURED_MIN_M, MEASURED_MAX_M));
    } else {
      // Nothing measurable — fall back to the configured vehicle defaults.
      widthM = round1(clamp(carDefaults.widthM, SLOT_WIDTH_MIN_M, SLOT_WIDTH_MAX_M));
      lengthM = round1(clamp(carDefaults.lengthM, SLOT_LENGTH_MIN_M, SLOT_LENGTH_MAX_M));
    }

    // Straightened line for the lane — ground truth for WHERE each stall sits (fitted
    // from every code together, immune to a single cell's distortion).
    const straightened = straightenLaneCodes(lane, imageWidthPx, imageHeightPx);

    const angleDiff = (a: number, b: number): number => {
      let d = Math.abs(a - b) % 180;
      return d > 90 ? 180 - d : d;
    };

    const maxBayDriftPx = sanityPitchPx > 0 ? sanityPitchPx * 0.3 : Infinity;

    // Printed glyph height → metres, so labels render at the size they have on the plan.
    // One size per lane (the median): the plan sets its codes in a single point size, so
    // per-token OCR height wobble would otherwise show up as uneven label sizes.
    const glyphHeights = lane.map((c) => c.hPct).filter((h) => h > 0);
    const labelHeightM =
      ppm && glyphHeights.length > 0
        ? round1(clamp((median(glyphHeights) / 100) * imageHeightPx / ppm, MEASURED_MIN_M, MEASURED_MAX_M))
        : undefined;

    // Shared print offset (code → stall centre) from trusted bays only. Every slot then
    // sits on the straightened code line + this ONE offset — a single corrupted cell
    // (tilted / shoved D6) cannot yank just that stall off the row.
    const trustedForOffset: { dx: number; dy: number }[] = [];
    for (const code of lane) {
      const bay = laneBayFor.get(code);
      const straight = straightened.get(code);
      if (!bay || !straight) {
        continue;
      }
      if (angleDiff(bay.rotationDeg, fallbackRotation) > 8) {
        continue;
      }
      trustedForOffset.push({
        dx: ((bay.cxPct - straight.xPct) / 100) * imageWidthPx,
        dy: ((bay.cyPct - straight.yPct) / 100) * imageHeightPx,
      });
    }
    // Drop offset outliers before taking the median (one shoved D6 must not bias the row).
    let shareDx = 0;
    let shareDy = 0;
    if (trustedForOffset.length > 0) {
      const medDx0 = median(trustedForOffset.map((o) => o.dx));
      const medDy0 = median(trustedForOffset.map((o) => o.dy));
      const inliers = Number.isFinite(maxBayDriftPx)
        ? trustedForOffset.filter((o) => Math.hypot(o.dx - medDx0, o.dy - medDy0) <= maxBayDriftPx)
        : trustedForOffset;
      const use = inliers.length > 0 ? inliers : trustedForOffset;
      shareDx = median(use.map((o) => o.dx));
      shareDy = median(use.map((o) => o.dy));
    }
    const shareXPct = (shareDx / imageWidthPx) * 100;
    const shareYPct = (shareDy / imageHeightPx) * 100;

    for (const code of lane) {
      let bay = laneBayFor.get(code);
      const straight = straightened.get(code);
      if (bay && angleDiff(bay.rotationDeg, fallbackRotation) > 8) {
        bay = undefined;
      }
      if (bay && straight && Number.isFinite(maxBayDriftPx)) {
        const driftPx = Math.hypot(
          ((bay.cxPct - straight.xPct) / 100) * imageWidthPx - shareDx,
          ((bay.cyPct - straight.yPct) / 100) * imageHeightPx - shareDy,
        );
        if (driftPx > maxBayDriftPx) {
          bay = undefined;
        }
      }
      const shapePoints = bay ? bayShapePoints(bay, imageWidthPx, imageHeightPx) : undefined;
      const along = straight ?? { xPct: code.xPct, yPct: code.yPct };
      placements.push({
        xPct: along.xPct + shareXPct,
        yPct: along.yPct + shareYPct,
        rotationDeg: round1(fallbackRotation),
        lengthM,
        widthM,
        laneIndex,
        label: code.code,
        laneKey,
        ...(shapePoints ? { shapePoints } : {}),
        ...(labelHeightM ? { labelHeightM } : {}),
      });
    }
  });
  return placements;
}

/** Andrew's monotone-chain convex hull. */
function convexHull(points: PointPct[]): PointPct[] {
  if (points.length <= 3) {
    return [...points];
  }
  const pts = [...points].sort((a, b) => a.xPct - b.xPct || a.yPct - b.yPct);
  const cross = (o: PointPct, a: PointPct, b: PointPct): number =>
    (a.xPct - o.xPct) * (b.yPct - o.yPct) - (a.yPct - o.yPct) * (b.xPct - o.xPct);
  const lower: PointPct[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: PointPct[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Padded convex hull of all code centres — the parking-area outline when the pixel-CV
 * lot detection is unavailable. Pads outward from the hull centroid so codes sitting on
 * the very edge (a perimeter stall column) end up comfortably inside the block.
 */
export function outlineFromCodes(
  codes: ParkingCodeSlot[],
  imageWidthPx: number,
  imageHeightPx: number,
  padPct = 3,
): PointPct[] {
  if (codes.length < 3) {
    return [];
  }
  const hull = convexHull(codes.map((c) => ({ xPct: c.xPct, yPct: c.yPct })));
  if (hull.length < 3) {
    return [];
  }
  const cx = hull.reduce((s, p) => s + p.xPct, 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p.yPct, 0) / hull.length;
  return hull.map((p) => {
    const dx = p.xPct - cx;
    const dy = p.yPct - cy;
    const dist = Math.hypot(dx, dy) || 1;
    return {
      xPct: clamp(p.xPct + (dx / dist) * padPct, 0, 100),
      yPct: clamp(p.yPct + (dy / dist) * padPct, 0, 100),
    };
  });
}
