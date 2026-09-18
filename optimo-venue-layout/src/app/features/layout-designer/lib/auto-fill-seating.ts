import type {
  CanvasConfig,
  CustomShapeSeatPosition,
  SeatLayoutSpec,
} from '../models/layout-element.model';
import {
  type CenterpieceElement,
  type LayoutElement,
  isCustomizableBlock,
} from '../models/layout-element.model';
import { carrySeatSpacingAdjustments } from './block-seat-layout';
import { applySeatSpacingToPositions } from './seat-spacing';
import type {
  AutoFillBatchResult,
  AutoFillBlockResult,
  AutoFillSeatingConfig,
  AutoFillAisleSlot,
} from '../models/auto-fill-seating.model';
import { normalizeAutoFillAisles } from '../models/auto-fill-seating.model';
import {
  buildBlockMeasureEdges,
  findLogicalEdgeContainingSource,
  resolveViewpointLogicalEdges,
  stadiumLogicalEdgeFromView,
  uniqueLogicalEdgesById,
} from './block-measure-edges';
import {
  DEFAULT_VIEWPOINT_ANGLE_DEG,
  polygonCanvasPointsFromBlock,
  stadiumSideIndexFromViewDirection,
  viewpointAngleFromCanvasPoint,
} from './block-viewpoint';
import type { PhysicalDimsInput } from './custom-shape-seats';
import {
  buildStadiumEdgeFrame,
  computePxPerMetre,
  createArrangeByRowGridSeating,
  estimateArrangeByRowCapacity,
  estimateDefaultSideLengthsM,
  remapDrawnAisleLocalPct,
  resolveSeatStartSide,
  type ArrangeByRowAislePlacement,
} from './drag-seats';
import { isCompleteDrawnAisle } from './drawn-aisle';
import { collectAdjacentBlocks } from './row-seat-align';
import { rectFromPositionSize } from './geometry';
import {
  applySharedBlockCurveToOverrides,
  getCustomShapeVisibleSeatCount,
  parseBlockSeatId,
} from './custom-shape-seats';
import { resolveBlockLengthM, resolveBlockWidthM } from './physical-dims';
import {
  resolveBlockDisplaySideLengthsM,
} from './auto-fill-measurements';
import {
  findStadiumGroundCenterpiece,
  resolveViewpointAngleTowardGround,
} from './stadium-ground';
import { rowLabelToIndex } from './seat-layout';

/** Parse "C, E" / "c,e" into 0-based row indices (C → 2). */
export function parseAisleRowIndices(raw: string): number[] {
  const seen = new Set<number>();
  const indices: number[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const index = rowLabelToIndex(trimmed);
    if (index == null || index < 0 || seen.has(index)) {
      continue;
    }
    seen.add(index);
    indices.push(index);
  }
  return indices.sort((a, b) => a - b);
}

/** Parse "1, 5" into 0-based column indices (1 → 0). */
export function parseAisleColumnIndices(raw: string): number[] {
  const seen = new Set<number>();
  const indices: number[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const oneBased = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(oneBased) || oneBased < 1) {
      continue;
    }
    const index = oneBased - 1;
    if (seen.has(index)) {
      continue;
    }
    seen.add(index);
    indices.push(index);
  }
  return indices.sort((a, b) => a - b);
}

/** Human error when an added aisle is missing required fields. */
export function validateAutoFillAisleRules(config: AutoFillSeatingConfig): string | null {
  const slots = normalizeAutoFillAisles(config.aisles, config);
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const label = `Aisle ${i + 1}`;
    const widthM = slot.widthM ?? 0;
    if (!(widthM > 0)) {
      return `${label}: aisle width must be greater than 0.`;
    }
    if (slot.type === 'row') {
      if (parseAisleRowIndices(slot.rows ?? '').length === 0) {
        return `${label}: enter row letters (example: C or C, E).`;
      }
    } else if (slot.type === 'column') {
      if (parseAisleColumnIndices(slot.columns ?? '').length === 0) {
        return `${label}: enter column numbers (example: 1 or 1, 5).`;
      }
    } else if (slot.type === 'center') {
      if (slot.centerAxis !== 'row' && slot.centerAxis !== 'column') {
        return `${label}: tick Row or Column for center aisle.`;
      }
    } else if (slot.type === 'draw') {
      // Incomplete draw aisles are ignored at pack time — do not fail the
      // whole multi-block Auto Fill run while the user is still placing points.
      if (!isCompleteDrawnAisle(slot)) {
        continue;
      }
    }
  }
  return null;
}

/** Resolve Auto Fill aisle settings into placement slots (or undefined when none). */
export function resolveAutoFillAislePlacement(
  config: AutoFillSeatingConfig,
): ArrangeByRowAislePlacement | undefined {
  const slots = normalizeAutoFillAisles(config.aisles, config);
  const aisleRowIndices: number[] = [];
  const aisleColumnIndices: number[] = [];
  let rowAisleWidthM: number | undefined;
  let columnAisleWidthM: number | undefined;
  let centerAisle = false;
  const centerColumnAisleWidthsM: number[] = [];
  const centerRowAisleWidthsM: number[] = [];
  const drawnAisles: NonNullable<ArrangeByRowAislePlacement['drawnAisles']> = [];
  let fallbackWidthM = 1;

  for (const slot of slots) {
    const widthM =
      slot.widthM != null && Number.isFinite(slot.widthM) ? Math.max(0, slot.widthM) : 1;
    if (slot.type === 'none') {
      continue;
    }
    fallbackWidthM = widthM;
    if (slot.type === 'row') {
      const indices = parseAisleRowIndices(slot.rows ?? '');
      for (const index of indices) {
        if (!aisleRowIndices.includes(index)) {
          aisleRowIndices.push(index);
        }
      }
      if (indices.length > 0) {
        rowAisleWidthM = widthM;
      }
    } else if (slot.type === 'column') {
      const indices = parseAisleColumnIndices(slot.columns ?? '');
      for (const index of indices) {
        if (!aisleColumnIndices.includes(index)) {
          aisleColumnIndices.push(index);
        }
      }
      if (indices.length > 0) {
        columnAisleWidthM = widthM;
      }
    } else if (slot.type === 'center') {
      centerAisle = true;
      if (slot.centerAxis === 'row') {
        centerRowAisleWidthsM.push(widthM);
      } else {
        // Default / tick column → across the seating rows.
        centerColumnAisleWidthsM.push(widthM);
      }
    } else if (
      slot.type === 'draw' &&
      slot.drawStart != null &&
      slot.drawEnd != null
    ) {
      drawnAisles.push({
        start: { xPct: slot.drawStart.xPct, yPct: slot.drawStart.yPct },
        end: { xPct: slot.drawEnd.xPct, yPct: slot.drawEnd.yPct },
        widthM,
      });
    }
  }

  aisleRowIndices.sort((a, b) => a - b);
  aisleColumnIndices.sort((a, b) => a - b);

  if (
    !centerAisle &&
    aisleRowIndices.length === 0 &&
    aisleColumnIndices.length === 0 &&
    drawnAisles.length === 0
  ) {
    return undefined;
  }

  return {
    aisleRowIndices: aisleRowIndices.length > 0 ? aisleRowIndices : undefined,
    aisleColumnIndices: aisleColumnIndices.length > 0 ? aisleColumnIndices : undefined,
    aisleWidthM: fallbackWidthM,
    rowAisleWidthM,
    columnAisleWidthM,
    centerAisle: centerAisle || undefined,
    centerColumnAisleWidthsM:
      centerColumnAisleWidthsM.length > 0 ? centerColumnAisleWidthsM : undefined,
    centerRowAisleWidthsM:
      centerRowAisleWidthsM.length > 0 ? centerRowAisleWidthsM : undefined,
    drawnAisles: drawnAisles.length > 0 ? drawnAisles : undefined,
  };
}

/** Remap draw-aisle local % from a reference block onto a target block's frame. */
export function remapAutoFillAislesForBlock(
  aisles: AutoFillAisleSlot[],
  source: {
    rect: ReturnType<typeof rectFromPositionSize>;
    polygon: { x: number; y: number }[];
    stadiumSideIndex: number;
    viewpointAngleDeg: number;
  },
  target: {
    rect: ReturnType<typeof rectFromPositionSize>;
    polygon: { x: number; y: number }[];
    stadiumSideIndex: number;
    viewpointAngleDeg: number;
  },
): AutoFillAisleSlot[] {
  return aisles.map((slot) => {
    if (!isCompleteDrawnAisle(slot) || !slot.drawStart || !slot.drawEnd) {
      return slot;
    }
    return {
      ...slot,
      drawStart: remapDrawnAisleLocalPct(
        slot.drawStart,
        source.rect,
        source.polygon,
        source.stadiumSideIndex,
        source.viewpointAngleDeg,
        target.rect,
        target.polygon,
        target.stadiumSideIndex,
        target.viewpointAngleDeg,
      ),
      drawEnd: remapDrawnAisleLocalPct(
        slot.drawEnd,
        source.rect,
        source.polygon,
        source.stadiumSideIndex,
        source.viewpointAngleDeg,
        target.rect,
        target.polygon,
        target.stadiumSideIndex,
        target.viewpointAngleDeg,
      ),
    };
  });
}

/** Resolve the Auto Fill reference/configure block used for aisle remapping. */
function resolveReferenceCenterpiece(
  allElements: LayoutElement[],
  config: AutoFillSeatingConfig,
  fallbackId: string,
): CenterpieceElement | null {
  const referenceId = config.referenceBlockId ?? fallbackId;
  const found = allElements.find((el) => el.id === referenceId);
  if (found && found.type === 'centerpiece') {
    return found;
  }
  return null;
}

/**
 * Aisle slots for one Auto Fill target.
 * Uses the shared Auto Fill aisle options so Draw Aisle (and row/column/center)
 * apply to every selected block. Drawn aisles are remapped from the
 * reference/configure block into this block's shape.
 */
export function resolveAutoFillAislesForTargetBlock(
  element: CenterpieceElement,
  allElements: LayoutElement[],
  canvas: CanvasConfig,
  config: AutoFillSeatingConfig,
  targetPlacement: {
    rect: ReturnType<typeof rectFromPositionSize>;
    polygon: { x: number; y: number }[];
    stadiumSideIndex: number;
    viewpointAngleDeg: number;
  },
): AutoFillAisleSlot[] {
  const aisles = normalizeAutoFillAisles(config.aisles, config);
  if (!aisles.some((slot) => isCompleteDrawnAisle(slot))) {
    return aisles;
  }

  const reference = resolveReferenceCenterpiece(allElements, config, element.id);
  if (!reference || reference.id === element.id) {
    return aisles;
  }

  const sourceRect = rectFromPositionSize(reference.position, reference.size, canvas);
  const sourcePolygon = polygonCanvasPointsFromBlock(reference.customPoints ?? [], sourceRect);
  if (sourcePolygon.length < 3) {
    return aisles;
  }

  const sourceViewpoint = resolveViewpointAngleDeg(reference, allElements, canvas);
  const { cx, cy } = blockCenter(sourceRect);
  const sourcePlacement = resolveAutoFillViewpointPlacement(
    sourcePolygon,
    cx,
    cy,
    sourceViewpoint,
  );
  const sourceLogical = buildBlockMeasureEdges(sourcePolygon);
  const sourceStadiumEdge = sourceLogical.find((edge) =>
    edge.sourceIndices.includes(sourcePlacement.sideIndex),
  );

  return remapAutoFillAislesForBlock(
    aisles,
    {
      rect: sourceRect,
      polygon: sourcePolygon,
      stadiumSideIndex: sourceStadiumEdge?.index ?? sourcePlacement.sideIndex,
      viewpointAngleDeg: sourcePlacement.seatingAngleDeg,
    },
    {
      rect: targetPlacement.rect,
      polygon: targetPlacement.polygon,
      stadiumSideIndex: targetPlacement.stadiumSideIndex,
      viewpointAngleDeg: targetPlacement.viewpointAngleDeg,
    },
  );
}

/** Custom polygon blocks that can receive geometry-based Auto Fill seating. */
export function isAutoFillEligibleBlock(el: CenterpieceElement): boolean {
  if (!isCustomizableBlock(el)) {
    return false;
  }
  if (el.blockType === 'dining-table' || el.blockType === 'general-admission') {
    return false;
  }
  return true;
}

function resolveSideLengthsM(
  el: CenterpieceElement,
  rect: ReturnType<typeof rectFromPositionSize>,
  _config: AutoFillSeatingConfig,
): number[] {
  const defaultLengths = estimateDefaultSideLengthsM(el, rect);
  // Pack from THIS block's saved measurements only — never template the shared
  // reference side lengths onto every block (that forced identical seat counts).
  return resolveBlockDisplaySideLengthsM(el.customSideLengthsM, defaultLengths);
}

function resolveSideNames(el: CenterpieceElement, sideCount: number): string[] {
  const names = [...(el.customSideNames ?? [])];
  while (names.length < sideCount) {
    names.push('');
  }
  return names;
}

export const AUTO_FILL_CURVE_MIN = 0;
export const AUTO_FILL_CURVE_MAX = 50;
/**
 * Default bow when Curve is enabled and Create seats runs.
 * Also the reference value that yields a full geometric maxAmp curve.
 */
export const AUTO_FILL_CURVE_DEFAULT_DEG = 6;
/** Step used by Curve − / + controls after seats exist. */
export const AUTO_FILL_CURVE_STEP_DEG = 1;

/** How strongly `curveDeg` bows seats (1 = full maxAmp at the default value). */
export function autoFillCurveAmplitudeFactor(curveDeg: number | undefined | null): number {
  return clampAutoFillCurveDeg(curveDeg) / AUTO_FILL_CURVE_DEFAULT_DEG;
}

export function clampAutoFillCurveDeg(value: number | undefined | null): number {
  if (value == null || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(AUTO_FILL_CURVE_MIN, Math.min(AUTO_FILL_CURVE_MAX, value));
}

/** Curve value for Create seats when Curved is on — never leave at 0. */
export function resolveCreateAutoFillCurveDeg(config: AutoFillSeatingConfig): number {
  if (config.curveEnabled !== true) {
    return 0;
  }
  const current = clampAutoFillCurveDeg(config.curveDeg);
  return current > 0 ? current : AUTO_FILL_CURVE_DEFAULT_DEG;
}

/** Active curve for Create seats / Auto Fill — 0 unless Curved is ticked. */
export function resolveEffectiveAutoFillCurveDeg(config: AutoFillSeatingConfig): number {
  if (config.curveEnabled !== true) {
    return 0;
  }
  return clampAutoFillCurveDeg(config.curveDeg);
}

/** Stamp one uniform Auto Fill curve across every row. */
export function applyAutoFillCurveToSeatLayout(
  layout: SeatLayoutSpec,
  curveDeg: number | undefined | null,
): SeatLayoutSpec {
  const safe = clampAutoFillCurveDeg(curveDeg);
  const rows = Math.max(1, layout.rows);
  return {
    ...layout,
    rowCurveDeg: safe,
    rowCurveDegs: Array.from({ length: rows }, () => safe),
  };
}

/** Push a VIEW POINT focus slightly outside the block so chairs aim at that edge. */
function edgeFocusOutsidePolygon(
  edge: { midX: number; midY: number; lengthPx: number },
  cx: number,
  cy: number,
): { x: number; y: number } {
  const vx = edge.midX - cx;
  const vy = edge.midY - cy;
  const len = Math.hypot(vx, vy);
  if (len < 1e-6) {
    return { x: edge.midX, y: edge.midY };
  }
  const push = Math.max(16, edge.lengthPx * 0.15);
  return {
    x: edge.midX + (vx / len) * push,
    y: edge.midY + (vy / len) * push,
  };
}

/**
 * Two VIEW POINT foci (stored order) when the block has dual front edges.
 * Used so a curved row can face the first viewpoint on one half and the second
 * on the remaining half.
 */
export function resolveDualCurveFoci(
  element: Pick<CenterpieceElement, 'dragSeatsStadiumSideIndices'>,
  polygon: { x: number; y: number }[],
  rect: { x: number; y: number; width: number; height: number; cx?: number; cy?: number },
): { x: number; y: number }[] | undefined {
  const indices = element.dragSeatsStadiumSideIndices ?? [];
  if (indices.length < 2 || polygon.length < 3) {
    return undefined;
  }
  const cx = rect.cx ?? rect.x + rect.width / 2;
  const cy = rect.cy ?? rect.y + rect.height / 2;
  const foci: { x: number; y: number }[] = [];
  const seen = new Set<number>();
  for (const source of indices) {
    const edge = findLogicalEdgeContainingSource(polygon, source);
    if (!edge || seen.has(edge.id)) {
      continue;
    }
    seen.add(edge.id);
    foci.push(edgeFocusOutsidePolygon(edge, cx, cy));
    if (foci.length >= 2) {
      break;
    }
  }
  return foci.length >= 2 ? foci : undefined;
}

function curveFrameWithDualFoci(
  element: CenterpieceElement,
  polygon: { x: number; y: number }[],
  rect: ReturnType<typeof rectFromPositionSize>,
) {
  const frame = buildStadiumEdgeFrame(
    polygon,
    rect,
    element.dragSeatsStadiumSideIndex ?? 0,
    element.blockViewpointAngleDeg,
  );
  return {
    ...frame,
    dualFoci: resolveDualCurveFoci(element, polygon, rect),
  };
}

/** Curve all created seats on a block from the VIEW POINT edge. */
export function applyAutoFillBlockCurve(
  element: CenterpieceElement,
  rect: ReturnType<typeof rectFromPositionSize>,
  overrides: Record<string, { xPct: number; yPct: number; rotationDeg?: number }>,
  curveDeg: number | undefined | null,
): Record<string, { xPct: number; yPct: number; rotationDeg?: number }> {
  const polygon = polygonCanvasPointsFromBlock(element.customPoints ?? [], rect);
  return applySharedBlockCurveToOverrides(
    overrides,
    rect,
    polygon,
    clampAutoFillCurveDeg(curveDeg),
    curveFrameWithDualFoci(element, polygon, rect),
    resolveCurveMinEdgeGapPx(element, rect, polygon),
  );
}

export interface BakedAutoFillSeatPositions {
  autoFillStraightSeatPositions: Record<string, CustomShapeSeatPosition>;
  seatPositionOverrides: Record<string, CustomShapeSeatPosition>;
  seatLayout: SeatLayoutSpec | undefined;
}

/**
 * Final seat positions from the straight Auto Fill baseline:
 * baseline grid → custom row / seat gaps (+ overflow hiding) → row curve.
 *
 * Every place that re-derives positions from `autoFillStraightSeatPositions`
 * must go through here so the per-row / per-seat gaps survive curve edits,
 * spacing edits and Create-seats re-grids alike.
 */
export function bakeAutoFillSeatPositions(
  element: CenterpieceElement,
  rect: ReturnType<typeof rectFromPositionSize>,
  baseline: Record<string, CustomShapeSeatPosition>,
  curveDeg: number | undefined | null,
  spec: SeatLayoutSpec | undefined = element.seatLayout,
): BakedAutoFillSeatPositions {
  const polygon = polygonCanvasPointsFromBlock(element.customPoints ?? [], rect);
  const safe = clampAutoFillCurveDeg(curveDeg);
  const working: CenterpieceElement = spec ? { ...element, seatLayout: spec } : element;
  const spaced = applySeatSpacingToPositions(working, rect, polygon, baseline, spec);
  const curved = applySharedBlockCurveToOverrides(
    spaced.positions,
    rect,
    polygon,
    safe,
    curveFrameWithDualFoci(working, polygon, rect),
    resolveCurveMinEdgeGapPx(working, rect, polygon),
  );
  // The straight baseline keeps every chair; manually deleted seats stay out
  // of the final positions.
  for (const hiddenId of spec?.hiddenSeatIds ?? []) {
    delete curved[hiddenId];
  }
  return {
    autoFillStraightSeatPositions: { ...baseline },
    seatPositionOverrides: curved,
    seatLayout: spec
      ? {
          ...applyAutoFillCurveToSeatLayout(spec, safe),
          spacingHiddenSeatIds: spaced.hiddenSeatIds,
        }
      : undefined,
  };
}

function resolveCurveMinEdgeGapPx(
  element: CenterpieceElement,
  rect: ReturnType<typeof rectFromPositionSize>,
  polygon: { x: number; y: number }[],
): number {
  const borderGapM = Math.max(0, element.borderGapM ?? 0);
  if (borderGapM <= 0 || polygon.length < 3) {
    return 0;
  }
  const sideLengthsM =
    element.customSideLengthsM && element.customSideLengthsM.length >= polygon.length
      ? element.customSideLengthsM
      : estimateDefaultSideLengthsM(element, rect);
  return borderGapM * computePxPerMetre(polygon, sideLengthsM);
}

function applyAutoFillCurveToPatch(
  element: CenterpieceElement,
  patch: Partial<CenterpieceElement>,
  rect: ReturnType<typeof rectFromPositionSize>,
  polygon: { x: number; y: number }[],
  curveDeg: number | undefined | null,
): Partial<CenterpieceElement> {
  const straight = { ...(patch.seatPositionOverrides ?? {}) };
  const safe = clampAutoFillCurveDeg(curveDeg);
  // A re-grid produces a fresh spec — keep the user's per-row / per-seat gaps.
  const spec = patch.seatLayout
    ? carrySeatSpacingAdjustments(element.seatLayout, patch.seatLayout)
    : patch.seatLayout;
  const merged: CenterpieceElement = { ...element, ...patch, seatLayout: spec };
  const baked = bakeAutoFillSeatPositions(merged, rect, straight, safe, spec);
  return {
    ...patch,
    autoFillStraightSeatPositions: baked.autoFillStraightSeatPositions,
    seatPositionOverrides: baked.seatPositionOverrides,
    seatLayout: baked.seatLayout,
  };
}

function configToPhysicalDims(
  el: CenterpieceElement,
  config: AutoFillSeatingConfig,
): PhysicalDimsInput {
  return {
    physicalLengthM: resolveBlockLengthM(el),
    physicalWidthM: resolveBlockWidthM(el),
    chairLengthM: config.chairLengthM,
    chairWidthM: config.chairWidthM,
    seatGapM: config.seatGapM,
    rowGapM: config.rowGapM,
    borderGapM: config.borderGapM ?? 0,
  };
}

function blockCenter(rect: ReturnType<typeof rectFromPositionSize>): { cx: number; cy: number } {
  return {
    cx: rect.x + rect.width / 2,
    cy: rect.y + rect.height / 2,
  };
}

function resolveViewpointAngleDeg(
  element: CenterpieceElement,
  allElements: LayoutElement[],
  canvas: CanvasConfig,
): number {
  if (element.blockViewpointManuallySet && element.blockViewpointAngleDeg != null) {
    return element.blockViewpointAngleDeg;
  }
  const ground = findStadiumGroundCenterpiece(allElements);
  return (
    resolveViewpointAngleTowardGround(element, ground, canvas) ??
    element.blockViewpointAngleDeg ??
    DEFAULT_VIEWPOINT_ANGLE_DEG
  );
}

/** Dual ground-facing sides for storage/aisles; seating rows stay on the primary side. */
function resolveAutoFillViewpointPlacement(
  polygon: { x: number; y: number }[],
  cx: number,
  cy: number,
  viewpointAngleDeg: number,
): {
  sideIndex: number;
  dualIndices: number[] | undefined;
  seatingAngleDeg: number;
} {
  const sides = uniqueLogicalEdgesById(
    resolveViewpointLogicalEdges(polygon, cx, cy, viewpointAngleDeg),
  );
  const bestFromView = stadiumLogicalEdgeFromView(polygon, cx, cy, viewpointAngleDeg);
  const primary =
    (bestFromView && sides.some((s) => s.id === bestFromView.id) ? bestFromView : null) ??
    sides[0] ?? null;
  const sideIndex =
    primary?.index ?? stadiumSideIndexFromViewDirection(polygon, cx, cy, viewpointAngleDeg);
  const dualIndices =
    sides.length > 1 ? sides.map((edge) => edge.index) : undefined;
  const seatingAngleDeg =
    dualIndices == null || !primary
      ? viewpointAngleDeg
      : viewpointAngleFromCanvasPoint(cx, cy, primary.midX, primary.midY);
  return { sideIndex, dualIndices, seatingAngleDeg };
}

/**
 * Geometry-based Auto Fill for one custom polygon block:
 * border gap → grid → point-in-polygon → viewpoint rotation → numbering.
 */
export function applyAutoFillToBlock(
  element: CenterpieceElement,
  allElements: LayoutElement[],
  canvas: CanvasConfig,
  config: AutoFillSeatingConfig,
): { patch: Partial<CenterpieceElement>; seatCount: number } | { error: string } {
  if (!isAutoFillEligibleBlock(element)) {
    return { error: 'Only custom seating blocks can be auto-filled.' };
  }

  const rect = rectFromPositionSize(element.position, element.size, canvas);
  const polygon = polygonCanvasPointsFromBlock(element.customPoints ?? [], rect);
  if (polygon.length < 3) {
    return { error: 'Block outline needs at least 3 points.' };
  }

  const sideLengthsM = resolveSideLengthsM(element, rect, config);
  if (sideLengthsM.length < 3) {
    return { error: 'Could not resolve block side lengths.' };
  }

  const sideNames = resolveSideNames(element, sideLengthsM.length);
  const dims = configToPhysicalDims(element, config);
  const { cx, cy } = blockCenter(rect);
  const viewpointAngleDeg = resolveViewpointAngleDeg(element, allElements, canvas);
  const placement = resolveAutoFillViewpointPlacement(
    polygon,
    cx,
    cy,
    viewpointAngleDeg,
  );
  const stadiumSideIndex = placement.sideIndex;
  const dualIndices = placement.dualIndices;
  const seatingAngleDeg = placement.seatingAngleDeg;
  const logicalEdges = buildBlockMeasureEdges(polygon);
  const stadiumEdge = logicalEdges.find((edge) =>
    edge.sourceIndices.includes(stadiumSideIndex),
  );

  const cap = estimateArrangeByRowCapacity(
    element,
    rect,
    sideLengthsM,
    dims,
    stadiumEdge?.index ?? stadiumSideIndex,
    seatingAngleDeg,
  );

  if (cap.maxCapacity <= 0) {
    return { error: 'No seats fit inside this block with the current configuration.' };
  }

  const targetAisles = resolveAutoFillAislesForTargetBlock(
    element,
    allElements,
    canvas,
    config,
    {
      rect,
      polygon,
      stadiumSideIndex: stadiumEdge?.index ?? stadiumSideIndex,
      viewpointAngleDeg: seatingAngleDeg,
    },
  );
  const aisleRuleError = validateAutoFillAisleRules({ ...config, aisles: targetAisles });
  if (aisleRuleError) {
    return { error: aisleRuleError };
  }

  const packWithAisles = (aisles: AutoFillAisleSlot[]) =>
    createArrangeByRowGridSeating(
      {
        ...element,
        dragSeatsStadiumSideIndices: dualIndices,
        blockViewpointAngleDeg: viewpointAngleDeg,
      },
      rect,
      sideLengthsM,
      sideNames,
      dims,
      stadiumEdge?.index ?? stadiumSideIndex,
      cap.maxRows,
      undefined,
      seatingAngleDeg,
      undefined,
      resolveAutoFillAislePlacement({ ...config, aisles }),
      {
        adjacentBlocks: collectAdjacentBlocks(element, allElements, canvas),
        // Explicit choice, else keep a legacy block's current numbering, else left.
        seatStartSide: resolveSeatStartSide(element, rect),
      },
    );

  let packedAisles = targetAisles;
  let result = packWithAisles(packedAisles);
  // Keep filling this selected block even if a drawn aisle is too wide for the
  // shape — fall back to row/column/center aisles only.
  if ('error' in result && packedAisles.some((slot) => isCompleteDrawnAisle(slot))) {
    packedAisles = packedAisles.filter((slot) => slot.type !== 'draw');
    result = packWithAisles(packedAisles);
  }

  if ('error' in result) {
    return { error: result.error };
  }

  const patch = applyAutoFillCurveToPatch(
    element,
    {
      ...result.patch,
      borderGapM: Math.max(0, config.borderGapM),
      blockViewpointAngleDeg: viewpointAngleDeg,
      blockViewpointManuallySet: element.blockViewpointManuallySet,
      dragSeatsStadiumSideIndex: stadiumEdge?.index ?? stadiumSideIndex,
      dragSeatsStadiumSideIndices: dualIndices,
      blockType: element.blockType ?? 'seating',
      customSideLengthsM: sideLengthsM,
      autoFillAisles: packedAisles,
    },
    rect,
    polygon,
    resolveCreateAutoFillCurveDeg(config),
  );
  const patched: CenterpieceElement = { ...element, ...patch };
  const seatCount = getCustomShapeVisibleSeatCount(patched, rect);

  return {
    patch,
    seatCount,
  };
}

export interface AutoFillAnimationStep {
  elementId: string;
  patch: Partial<CenterpieceElement>;
  seatCount: number;
}

/** `block` = one step per block (fast multi-block fill). `row` = one step per row (single-block preview). */
export type AutoFillAnimationMode = 'row' | 'block';

export interface AutoFillAnimationOptions {
  mode?: AutoFillAnimationMode;
}

/** Target frame count for the visual fill — actual duration adapts via batching. */
export const AUTO_FILL_ANIMATION_MAX_FRAMES = 48;

/**
 * Build incremental patches for animated Auto Fill visualization.
 * Row mode adds one row per step; block mode applies the full block in one step.
 * Uses the same packing path as applyAutoFillToBlock so every selected block
 * gets remapped draw aisles and consistent fill results.
 */
export function buildAutoFillAnimationSteps(
  element: CenterpieceElement,
  allElements: LayoutElement[],
  canvas: CanvasConfig,
  config: AutoFillSeatingConfig,
  options: AutoFillAnimationOptions = {},
): { steps: AutoFillAnimationStep[]; totalSeats: number } | { error: string } {
  const mode = options.mode ?? 'row';
  const outcome = applyAutoFillToBlock(element, allElements, canvas, config);
  if ('error' in outcome) {
    return { error: outcome.error };
  }

  const basePatch = outcome.patch;
  const totalSeats = outcome.seatCount;
  if (totalSeats === 0) {
    return { error: 'No seats fit inside this block with the current configuration.' };
  }

  if (mode === 'block') {
    return {
      steps: [
        {
          elementId: element.id,
          patch: basePatch,
          seatCount: totalSeats,
        },
      ],
      totalSeats,
    };
  }

  const blockCode = element.code?.trim() || element.name?.trim() || 'CUSTOM';
  const finalOverrides = basePatch.seatPositionOverrides ?? {};
  // Row 0 is the VIEW POINT edge (createArrangeByRowGridSeating firstDepth) —
  // sort ascending so animated fill sweeps viewpoint → back, then along each row.
  const sortedSeatIds = Object.keys(finalOverrides).sort((a, b) => {
    const pa = parseBlockSeatId(a, blockCode, 'letter');
    const pb = parseBlockSeatId(b, blockCode, 'letter');
    if (!pa || !pb) {
      return a.localeCompare(b);
    }
    if (pa.rowIndex !== pb.rowIndex) {
      return pa.rowIndex - pb.rowIndex;
    }
    return pa.seatIndex - pb.seatIndex;
  });

  const seatsByRow = new Map<number, string[]>();
  for (const seatId of sortedSeatIds) {
    const parsed = parseBlockSeatId(seatId, blockCode, 'letter');
    const rowIndex = parsed?.rowIndex ?? 0;
    const row = seatsByRow.get(rowIndex);
    if (row) {
      row.push(seatId);
    } else {
      seatsByRow.set(rowIndex, [seatId]);
    }
  }

  const rowIndices = [...seatsByRow.keys()].sort((a, b) => a - b);
  const steps: AutoFillAnimationStep[] = [];
  const cumulative: Record<string, (typeof finalOverrides)[string]> = {};
  for (const rowIndex of rowIndices) {
    for (const seatId of seatsByRow.get(rowIndex) ?? []) {
      cumulative[seatId] = finalOverrides[seatId];
    }
    steps.push({
      elementId: element.id,
      patch: {
        ...basePatch,
        seatPositionOverrides: { ...cumulative },
      },
      seatCount: Object.keys(cumulative).length,
    });
  }

  return {
    steps,
    totalSeats,
  };
}

/** Apply master Auto Fill configuration to multiple blocks independently. */
export function applyAutoFillToBlocks(
  elements: CenterpieceElement[],
  allElements: LayoutElement[],
  canvas: CanvasConfig,
  config: AutoFillSeatingConfig,
): AutoFillBatchResult {
  const results: AutoFillBlockResult[] = [];
  let totalSeats = 0;
  let successCount = 0;

  let workingElements = [...allElements];
  for (const element of elements) {
    const label = element.name?.trim() || element.code?.trim() || element.id;
    const outcome = applyAutoFillToBlock(element, workingElements, canvas, config);
    if ('error' in outcome) {
      results.push({
        elementId: element.id,
        elementName: label,
        success: false,
        error: outcome.error,
      });
      continue;
    }
    workingElements = workingElements.map((item) =>
      item.id === element.id ? ({ ...item, ...outcome.patch } as typeof item) : item,
    );
    results.push({
      elementId: element.id,
      elementName: label,
      success: true,
      seatCount: outcome.seatCount,
    });
    totalSeats += outcome.seatCount;
    successCount += 1;
  }

  return {
    results,
    totalSeats,
    successCount,
    failureCount: results.length - successCount,
  };
}
