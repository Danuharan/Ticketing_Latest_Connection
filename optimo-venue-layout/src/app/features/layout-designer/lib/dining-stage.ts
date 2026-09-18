import {
  buildBlockMeasureEdges,
  logicalMeasureEdgeById,
  stadiumLogicalEdgeFromView,
  sumStoredLengthsForEdge,
  type BlockMeasureEdge,
} from './block-measure-edges';
import { offsetEdgeSegmentOutward, polygonCanvasPointsFromBlock } from './block-viewpoint';
import {
  canvasPointToElementPct,
  clampPointInsidePolygon,
  pointInPolygon,
} from './custom-shape-seats';
import {
  CenterpieceElement,
  DEFAULT_DINING_ENTRANCE_DEPTH_M,
  DEFAULT_DINING_ENTRANCE_WIDTH_M,
  DEFAULT_DINING_EXIT_DEPTH_M,
  DEFAULT_DINING_EXIT_WIDTH_M,
  DEFAULT_DINING_SHARED_ACCESS_DEPTH_M,
  DEFAULT_DINING_SHARED_ACCESS_WIDTH_M,
  DEFAULT_DINING_FOOD_PREPARE_DEPTH_M,
  DEFAULT_DINING_FOOD_PREPARE_WIDTH_M,
  DEFAULT_DINING_STAGE_DEPTH_M,
  DEFAULT_DINING_STAGE_WIDTH_M,
  DiningAccessPointKind,
  DiningAccessPointSpec,
  MIN_DINING_ACCESS_WIDTH_M,
  resolveDiningAccessMode,
  resolveDiningAccessWidthM,
  DiningExitSpec,
  DiningStageSpec,
  DiningFoodPrepareSpec,
  ElementPosition,
  hasDiningStage,
  hasDiningFoodPrepare,
} from '../models/layout-element.model';
import { PixelRect } from './geometry';
import { pxPerMeter, resolveBlockLengthM, resolveBlockWidthM } from './physical-dims';

export interface DiningStageRenderNode {
  x: number;
  y: number;
  widthPx: number;
  heightPx: number;
  rotationDeg: number;
  label: string;
  selected: boolean;
  sideEdgeId: number;
  kind?: DiningAccessPointKind;
  /** Opening segment on the block border (canvas coords in element space). */
  wallSegment?: { x1: number; y1: number; x2: number; y2: number };
}

/** Canvas / inspector display names — title case, not all-caps. */
export const DINING_STAGE_DISPLAY_LABEL = 'Stage';
export const DINING_FOOD_PREP_DISPLAY_LABEL = 'Food Prep';

/** Planning-tool fills: muted, low-contrast, same family as tables/chairs. */
export const DINING_STAGE_FILL = '#d8dde4';
export const DINING_STAGE_STROKE = '#64748b';
export const DINING_FOOD_PREP_FILL = '#d7e4df';
export const DINING_FOOD_PREP_STROKE = '#5f7d74';
export const DINING_ZONE_LABEL_FILL = '#334155';
export const DINING_ZONE_SELECTED_STROKE = '#2563eb';

/** Serving-cloche mark in a 14-unit local space, origin at visual center. */
export const DINING_FOOD_PREP_ICON_UNIT = 14;

export function diningFoodPrepIconScale(widthPx: number, heightPx: number): number {
  const size = Math.min(widthPx, heightPx);
  const targetPx = Math.max(9, Math.min(16, size * 0.38));
  return targetPx / DINING_FOOD_PREP_ICON_UNIT;
}

export function diningFoodPrepIconVisible(widthPx: number, heightPx: number): boolean {
  return Math.min(widthPx, heightPx) >= 12;
}

/** Compact SVG markup for template thumbnails (same cloche as the canvas). */
export function diningFoodPrepIconSvgMarkup(stroke: string, scale: number): string {
  const sw = (1.15 / Math.max(scale, 0.05)).toFixed(2);
  return [
    `<g transform="scale(${scale.toFixed(3)})" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">`,
    `<ellipse cx="0" cy="3.2" rx="6.4" ry="1.35"/>`,
    `<path d="M-6.2 2.6 C-6.2 -3.4, 6.2 -3.4, 6.2 2.6"/>`,
    `<line x1="0" y1="-3.4" x2="0" y2="-5.1"/>`,
    `<circle cx="0" cy="-5.6" r="0.85"/>`,
    `</g>`,
  ].join('');
}

/**
 * Normalise stored feature labels for canvas display.
 * Existing layouts may still store STAGE / FOOD PREP.
 */
export function diningFeatureDisplayLabel(
  stored: string | undefined,
  kind: 'stage' | 'food-prep',
): string {
  const fallback = kind === 'stage' ? DINING_STAGE_DISPLAY_LABEL : DINING_FOOD_PREP_DISPLAY_LABEL;
  const raw = stored?.trim();
  if (!raw) {
    return fallback;
  }
  const key = raw.replace(/\s+/g, ' ').toUpperCase();
  if (key === 'STAGE') {
    return DINING_STAGE_DISPLAY_LABEL;
  }
  if (
    key === 'FOOD PREP' ||
    key === 'FOOD PREPARE' ||
    key === 'FOOD PREPARATION' ||
    key === 'FOOD'
  ) {
    return DINING_FOOD_PREP_DISPLAY_LABEL;
  }
  return raw;
}

export function rotatedRectCorners(node: DiningStageRenderNode): { x: number; y: number }[] {
  const hw = node.widthPx / 2;
  const hh = node.heightPx / 2;
  const rad = (node.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    { dx: -hw, dy: -hh },
    { dx: hw, dy: -hh },
    { dx: hw, dy: hh },
    { dx: -hw, dy: hh },
  ];
  return corners.map((c) => ({
    x: node.x + c.dx * cos - c.dy * sin,
    y: node.y + c.dx * sin + c.dy * cos,
  }));
}

export function axisOverlap(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMin < bMax && bMin < aMax;
}

export function doDiningFeatureNodesOverlap(a: DiningStageRenderNode, b: DiningStageRenderNode): boolean {
  const aCorners = rotatedRectCorners(a);
  const bCorners = rotatedRectCorners(b);
  const aXs = aCorners.map((p) => p.x);
  const aYs = aCorners.map((p) => p.y);
  const bXs = bCorners.map((p) => p.x);
  const bYs = bCorners.map((p) => p.y);
  const aMinX = Math.min(...aXs);
  const aMaxX = Math.max(...aXs);
  const aMinY = Math.min(...aYs);
  const aMaxY = Math.max(...aYs);
  const bMinX = Math.min(...bXs);
  const bMaxX = Math.max(...bXs);
  const bMinY = Math.min(...bYs);
  const bMaxY = Math.max(...bYs);
  return axisOverlap(aMinX, aMaxX, bMinX, bMaxX) && axisOverlap(aMinY, aMaxY, bMinY, bMaxY);
}

interface StageEdgeFrame {
  edge: { x1: number; y1: number; x2: number; y2: number; midX: number; midY: number };
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  ppm: number;
  sideEdgeId: number;
  sideLabel: string;
}

function blockPolygon(element: CenterpieceElement, rect: PixelRect): { x: number; y: number }[] {
  return polygonCanvasPointsFromBlock(element.customPoints ?? [], rect);
}

function elementPctToCanvasPoint(xPct: number, yPct: number, rect: PixelRect): { x: number; y: number } {
  return {
    x: rect.x + (xPct / 100) * rect.width,
    y: rect.y + (yPct / 100) * rect.height,
  };
}

function canvasPctToCanvasPoint(
  canvasPct: ElementPosition,
  canvas: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: (canvasPct.xPct / 100) * canvas.width,
    y: (canvasPct.yPct / 100) * canvas.height,
  };
}

function resolveLogicalEdge(
  element: CenterpieceElement,
  rect: PixelRect,
  sideEdgeId?: number | null,
): BlockMeasureEdge | null {
  const polygon = blockPolygon(element, rect);
  if (polygon.length < 3) {
    return null;
  }
  if (sideEdgeId != null) {
    const byId = logicalMeasureEdgeById(polygon, sideEdgeId);
    if (byId) {
      return byId;
    }
  }
  const angle = element.blockViewpointAngleDeg ?? 0;
  return stadiumLogicalEdgeFromView(polygon, rect.cx, rect.cy, angle);
}

function polygonCentroid2(polygon: { x: number; y: number }[]): { x: number; y: number } {
  if (polygon.length === 0) {
    return { x: 0, y: 0 };
  }
  const sum = polygon.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / polygon.length, y: sum.y / polygon.length };
}

function frameFromLogicalEdge(
  element: CenterpieceElement,
  rect: PixelRect,
  logicalEdge: BlockMeasureEdge,
): StageEdgeFrame {
  const polygon = blockPolygon(element, rect);
  const seg = { x1: logicalEdge.x1, y1: logicalEdge.y1, x2: logicalEdge.x2, y2: logicalEdge.y2 };
  const edgeDx = seg.x2 - seg.x1;
  const edgeDy = seg.y2 - seg.y1;
  const edgeLenPx = Math.hypot(edgeDx, edgeDy) || 1;
  const ux = edgeDx / edgeLenPx;
  const uy = edgeDy / edgeLenPx;
  const midX = (seg.x1 + seg.x2) / 2;
  const midY = (seg.y1 + seg.y2) / 2;

  // Candidate inward normal from winding; force it toward the block interior.
  const inwardAt1 = offsetEdgeSegmentOutward(polygon, seg, -1);
  let nx = inwardAt1.midX - midX;
  let ny = inwardAt1.midY - midY;
  let nlen = Math.hypot(nx, ny) || 1;
  nx /= nlen;
  ny /= nlen;

  const centroid = polygonCentroid2(polygon);
  if (nx * (centroid.x - midX) + ny * (centroid.y - midY) < 0) {
    nx = -nx;
    ny = -ny;
  }
  const sampleIn = { x: midX + nx * 3, y: midY + ny * 3 };
  const sampleOut = { x: midX - nx * 3, y: midY - ny * 3 };
  if (!pointInPolygon(sampleIn, polygon) && pointInPolygon(sampleOut, polygon)) {
    nx = -nx;
    ny = -ny;
  }

  const storedEdgeM = sumStoredLengthsForEdge(logicalEdge, element.customSideLengthsM ?? []);
  const ppm =
    storedEdgeM > 0
      ? edgeLenPx / storedEdgeM
      : pxPerMeter(rect, resolveBlockLengthM(element), resolveBlockWidthM(element));
  return {
    edge: { ...seg, midX, midY },
    ux,
    uy,
    nx,
    ny,
    ppm,
    sideEdgeId: logicalEdge.id,
    sideLabel: logicalEdge.label,
  };
}

export function getStageEdgeFrame(
  element: CenterpieceElement,
  rect: PixelRect,
  sideEdgeId?: number | null,
): StageEdgeFrame | null {
  const logicalEdge = resolveLogicalEdge(element, rect, sideEdgeId);
  if (!logicalEdge) {
    return null;
  }
  return frameFromLogicalEdge(element, rect, logicalEdge);
}

function getStageEdgeFrameForStage(
  element: CenterpieceElement,
  rect: PixelRect,
  stage: DiningStageSpec,
): StageEdgeFrame | null {
  return getStageEdgeFrame(element, rect, stage.sideEdgeId);
}

export function projectToEdge(
  seg: { x1: number; y1: number; x2: number; y2: number },
  x: number,
  y: number,
): { x: number; y: number } {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    return { x: seg.x1, y: seg.y1 };
  }
  let t = ((x - seg.x1) * dx + (y - seg.y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: seg.x1 + t * dx, y: seg.y1 + t * dy };
}

export function stageSideLabel(
  element: CenterpieceElement,
  rect: PixelRect,
  sideEdgeId: number,
): string {
  return getStageEdgeFrame(element, rect, sideEdgeId)?.sideLabel ?? `Side ${sideEdgeId + 1}`;
}

export function stageMetricsFromCanvasPoint(
  element: CenterpieceElement,
  rect: PixelRect,
  stage: DiningStageSpec,
  x: number,
  y: number,
): { offsetAlongEdgeM: number; insetFromEdgeM: number } | null {
  const frame = getStageEdgeFrameForStage(element, rect, stage);
  if (!frame) {
    return null;
  }
  const foot = projectToEdge(frame.edge, x, y);
  const alongPx = (foot.x - frame.edge.midX) * frame.ux + (foot.y - frame.edge.midY) * frame.uy;
  const insetPx = (x - foot.x) * frame.nx + (y - foot.y) * frame.ny;
  return {
    offsetAlongEdgeM: alongPx / frame.ppm,
    insetFromEdgeM: Math.max(0, insetPx / frame.ppm),
  };
}

export function canvasPointFromStageMetrics(
  element: CenterpieceElement,
  rect: PixelRect,
  stage: DiningStageSpec,
  offsetAlongEdgeM: number,
  insetFromEdgeM: number,
): { x: number; y: number } | null {
  const frame = getStageEdgeFrameForStage(element, rect, stage);
  if (!frame) {
    return null;
  }
  const alongPx = offsetAlongEdgeM * frame.ppm;
  const insetPx = insetFromEdgeM * frame.ppm;
  const baseX = frame.edge.midX + frame.ux * alongPx;
  const baseY = frame.edge.midY + frame.uy * alongPx;
  return {
    x: baseX + frame.nx * insetPx,
    y: baseY + frame.ny * insetPx,
  };
}

export function syncStageSpecFromMetrics(
  element: CenterpieceElement,
  rect: PixelRect,
  stage: DiningStageSpec,
): DiningStageSpec {
  const point = canvasPointFromStageMetrics(
    element,
    rect,
    stage,
    stage.offsetAlongEdgeM ?? 0,
    stage.insetFromEdgeM ?? stage.depthM / 2,
  );
  if (!point) {
    return stage;
  }
  const pct = canvasPointToElementPct(point, rect);
  const frame = getStageEdgeFrameForStage(element, rect, stage);
  return {
    ...stage,
    xPct: pct.xPct,
    yPct: pct.yPct,
    sideEdgeId: frame?.sideEdgeId ?? stage.sideEdgeId,
  };
}

/** Length of a block edge in metres (for the given side), or null if unavailable. */
export function diningAccessEdgeLengthM(
  element: CenterpieceElement,
  rect: PixelRect,
  sideEdgeId?: number | null,
): number | null {
  const frame = getStageEdgeFrame(element, rect, sideEdgeId);
  if (!frame) {
    return null;
  }
  const edgeLenPx = Math.hypot(frame.edge.x2 - frame.edge.x1, frame.edge.y2 - frame.edge.y1);
  return edgeLenPx / Math.max(frame.ppm, 0.001);
}

/**
 * Keep an access opening fully on its edge: clamp width to edge length and
 * shift offsetAlongEdgeM so neither end crosses the edge endpoints.
 * Works for axis-aligned and slanted polygon edges via the edge unit vector.
 */
export function clampDiningAccessPointToEdge(
  element: CenterpieceElement,
  rect: PixelRect,
  spec: DiningAccessPointSpec,
): DiningAccessPointSpec {
  const frame = getStageEdgeFrameForStage(element, rect, spec as unknown as DiningStageSpec);
  if (!frame) {
    return spec;
  }
  const edgeLenPx = Math.hypot(frame.edge.x2 - frame.edge.x1, frame.edge.y2 - frame.edge.y1);
  const edgeLenM = edgeLenPx / Math.max(frame.ppm, 0.001);
  const requested = Math.max(MIN_DINING_ACCESS_WIDTH_M, resolveDiningAccessWidthM(spec));
  const widthM = Math.min(requested, edgeLenM);
  const maxOff = Math.max(0, edgeLenM / 2 - widthM / 2);
  const offsetAlongEdgeM = Math.max(-maxOff, Math.min(maxOff, spec.offsetAlongEdgeM ?? 0));
  const depthM = spec.depthM > 0 ? spec.depthM : resolveDiningAccessDefaultDepthM(spec.kind ?? 'exit');
  const insetFromEdgeM = Math.max(depthM / 2, spec.insetFromEdgeM ?? depthM / 2);
  return syncStageSpecFromMetrics(element, rect, {
    ...spec,
    widthM,
    depthM,
    offsetAlongEdgeM,
    insetFromEdgeM,
    alignment: 'edge',
  } as unknown as DiningStageSpec) as unknown as DiningAccessPointSpec;
}

/** True when a point is clearly outside the polygon (border counts as inside). */
function pointClearlyOutsidePolygon(
  point: { x: number; y: number },
  polygon: { x: number; y: number }[],
): boolean {
  if (pointInPolygon(point, polygon)) {
    return false;
  }
  // Near-border points often fail ray-cast; treat as inside if close to an edge.
  const borderTolPx = 2.5;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const x1 = polygon[j].x;
    const y1 = polygon[j].y;
    const x2 = polygon[i].x;
    const y2 = polygon[i].y;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-9) {
      if (Math.hypot(point.x - x1, point.y - y1) <= borderTolPx) {
        return false;
      }
      continue;
    }
    let t = ((point.x - x1) * dx + (point.y - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    if (Math.hypot(point.x - projX, point.y - projY) <= borderTolPx) {
      return false;
    }
  }
  return true;
}

/** True when every corner of the feature rect is inside or on the block border. */
function diningFeatureFullyInsideBlock(
  node: DiningStageRenderNode,
  polygon: { x: number; y: number }[],
): boolean {
  return rotatedRectCorners(node).every((corner) => !pointClearlyOutsidePolygon(corner, polygon));
}

function buildTempFeatureNode(
  element: CenterpieceElement,
  rect: PixelRect,
  spec: DiningStageSpec,
  kind: 'stage' | 'foodprepare',
): DiningStageRenderNode | null {
  if (kind === 'stage') {
    return buildDiningStageRenderNode({ ...element, diningStage: spec }, rect, false);
  }
  return buildDiningFoodPrepareRenderNode(
    { ...element, diningFoodPrepare: spec as DiningFoodPrepareSpec },
    rect,
    false,
  );
}

/** Nudge a free/corner placement toward the polygon centroid until the full rect fits. */
function nudgeFeatureCenterInsideBlock(
  element: CenterpieceElement,
  rect: PixelRect,
  spec: DiningStageSpec,
  kind: 'stage' | 'foodprepare',
  polygon: { x: number; y: number }[],
): DiningStageSpec {
  const widthM = Math.max(0.5, spec.widthM);
  const depthM = Math.max(0.3, spec.depthM);
  let next: DiningStageSpec = { ...spec, widthM, depthM };
  const centroid = polygonCentroid2(polygon);

  for (let attempt = 0; attempt < 48; attempt += 1) {
    const node = buildTempFeatureNode(element, rect, next, kind);
    if (!node) {
      return next;
    }
    if (diningFeatureFullyInsideBlock(node, polygon)) {
      return next;
    }

    const dx = centroid.x - node.x;
    const dy = centroid.y - node.y;
    const len = Math.hypot(dx, dy) || 1;
    const stepPx = Math.max(3, Math.min(18, len * 0.22));
    const candidate = {
      x: node.x + (dx / len) * stepPx,
      y: node.y + (dy / len) * stepPx,
    };
    const clamped = clampPointInsidePolygon(candidate, polygon);
    const pct = canvasPointToElementPct(clamped, rect);
    next = { ...next, xPct: pct.xPct, yPct: pct.yPct, widthM, depthM };
  }
  return next;
}

const MIN_DINING_FEATURE_WIDTH_M = 0.2;
const MIN_DINING_FEATURE_DEPTH_M = 0.2;

/**
 * Shrink stage / food-prep so the footprint fits the chosen block edge.
 * Defaults (e.g. 4×1.2 m stage) must not spill outside a smaller room.
 */
export function fitDiningFeatureDimsToBlock(
  element: CenterpieceElement,
  rect: PixelRect,
  requested: { widthM: number; depthM: number },
  sideEdgeId?: number | null,
): { widthM: number; depthM: number } {
  const wantW = Math.max(MIN_DINING_FEATURE_WIDTH_M, requested.widthM);
  const wantD = Math.max(MIN_DINING_FEATURE_DEPTH_M, requested.depthM);

  const frame = getStageEdgeFrame(element, rect, sideEdgeId ?? undefined);
  if (!frame) {
    const maxW = Math.max(MIN_DINING_FEATURE_WIDTH_M, resolveBlockWidthM(element) * 0.95);
    const maxD = Math.max(MIN_DINING_FEATURE_DEPTH_M, resolveBlockLengthM(element) * 0.45);
    return {
      widthM: Math.min(wantW, maxW),
      depthM: Math.min(wantD, maxD),
    };
  }

  const edgeLenPx = Math.hypot(frame.edge.x2 - frame.edge.x1, frame.edge.y2 - frame.edge.y1);
  const edgeLenM = edgeLenPx / Math.max(frame.ppm, 0.001);
  // Stay just inside the edge so corners clear neighbors / angled walls.
  const maxWidthM = Math.max(MIN_DINING_FEATURE_WIDTH_M, edgeLenM * 0.96);
  const polygon = blockPolygon(element, rect);
  const maxDepthM = measureMaxFeatureDepthAlongInwardNormalM(frame, polygon);

  return {
    widthM: Math.min(wantW, maxWidthM),
    depthM: Math.min(wantD, maxDepthM),
  };
}

function measureMaxFeatureDepthAlongInwardNormalM(
  frame: StageEdgeFrame,
  polygon: { x: number; y: number }[],
): number {
  if (polygon.length < 3) {
    return MIN_DINING_FEATURE_DEPTH_M;
  }
  const edgeLenPx = Math.hypot(frame.edge.x2 - frame.edge.x1, frame.edge.y2 - frame.edge.y1);
  const maxProbePx = Math.max(edgeLenPx * 2, frame.ppm * 20);
  let lastInsidePx = 0;
  const steps = 48;
  for (let i = 1; i <= steps; i += 1) {
    const dPx = (i / steps) * maxProbePx;
    const p = {
      x: frame.edge.midX + frame.nx * dPx,
      y: frame.edge.midY + frame.ny * dPx,
    };
    if (!pointInPolygon(p, polygon)) {
      break;
    }
    lastInsidePx = dPx;
  }
  // Feature center sits at inset = depth/2 from the edge; keep the far face inside.
  return Math.max(
    MIN_DINING_FEATURE_DEPTH_M,
    (lastInsidePx * 0.92) / Math.max(frame.ppm, 0.001),
  );
}

/**
 * Keep stage / food-prep fully inside the block border.
 * Shrinks to fit when the footprint is larger than the room, then nudges position.
 * Edge: flush-or-inward (inset ≥ depth/2), pull further in / slide if corners stick out.
 * Center/corner: nudge toward interior until every corner is inside.
 */
export function clampDiningFeatureInsideBlock(
  element: CenterpieceElement,
  rect: PixelRect,
  spec: DiningStageSpec,
  kind: 'stage' | 'foodprepare' = 'stage',
): DiningStageSpec {
  const polygon = blockPolygon(element, rect);
  if (polygon.length < 3) {
    return spec;
  }

  const fitted = fitDiningFeatureDimsToBlock(
    element,
    rect,
    { widthM: spec.widthM, depthM: spec.depthM },
    spec.sideEdgeId,
  );
  const widthM = fitted.widthM;
  const depthM = fitted.depthM;
  const frame = getStageEdgeFrameForStage(element, rect, spec);

  // Free / center / corner placements — keep size, pull whole rect inside.
  if (!frame || (spec.alignment != null && spec.alignment !== 'edge')) {
    return nudgeFeatureCenterInsideBlock(element, rect, { ...spec, widthM, depthM }, kind, polygon);
  }

  const edgeLenPx = Math.hypot(frame.edge.x2 - frame.edge.x1, frame.edge.y2 - frame.edge.y1);
  const edgeLenM = edgeLenPx / Math.max(frame.ppm, 0.001);
  // Outer face on/inside the border; never less than depth/2 (that would cross outside).
  let insetM = Math.max(depthM / 2, spec.insetFromEdgeM ?? depthM / 2);
  const maxOff = Math.max(0, edgeLenM / 2 - widthM / 2);
  let offsetM = Math.max(-maxOff, Math.min(maxOff, spec.offsetAlongEdgeM ?? 0));

  let next: DiningStageSpec = syncStageSpecFromMetrics(element, rect, {
    ...spec,
    widthM,
    depthM,
    insetFromEdgeM: insetM,
    offsetAlongEdgeM: offsetM,
    alignment: 'edge',
  });

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const node = buildTempFeatureNode(element, rect, next, kind);
    if (node && diningFeatureFullyInsideBlock(node, polygon)) {
      return next;
    }
    // Pull further inside and ease toward edge mid so corners clear slanted neighbors.
    insetM += Math.max(0.025, depthM * 0.05);
    offsetM *= 0.85;
    offsetM = Math.max(-maxOff, Math.min(maxOff, offsetM));
    next = syncStageSpecFromMetrics(element, rect, {
      ...next,
      widthM,
      depthM,
      insetFromEdgeM: insetM,
      offsetAlongEdgeM: offsetM,
      alignment: 'edge',
    });
  }

  // Last resort: keep size, free-nudge toward centroid (still no resize).
  return nudgeFeatureCenterInsideBlock(element, rect, next, kind, polygon);
}

export function syncStageSpecFromPosition(
  element: CenterpieceElement,
  rect: PixelRect,
  stage: DiningStageSpec,
): DiningStageSpec {
  if (stage.xPct == null || stage.yPct == null) {
    return syncStageSpecFromMetrics(element, rect, stage);
  }
  const point = elementPctToCanvasPoint(stage.xPct, stage.yPct, rect);
  const metrics = stageMetricsFromCanvasPoint(element, rect, stage, point.x, point.y);
  if (!metrics) {
    return stage;
  }
  return {
    ...stage,
    offsetAlongEdgeM: metrics.offsetAlongEdgeM,
    insetFromEdgeM: metrics.insetFromEdgeM,
  };
}

function resolveDefaultStageWidthMForFrame(frame: StageEdgeFrame): number {
  const edgeLenPx = Math.hypot(frame.edge.x2 - frame.edge.x1, frame.edge.y2 - frame.edge.y1);
  const edgeLenM = edgeLenPx / Math.max(frame.ppm, 0.001);
  return Math.max(
    MIN_DINING_FEATURE_WIDTH_M,
    Math.min(edgeLenM * 0.75, DEFAULT_DINING_STAGE_WIDTH_M * 2),
  );
}

export function resolveDefaultStageWidthM(
  element: CenterpieceElement,
  rect: PixelRect,
  sideEdgeId?: number,
): number {
  const frame = getStageEdgeFrame(element, rect, sideEdgeId);
  if (!frame) {
    return DEFAULT_DINING_STAGE_WIDTH_M;
  }
  return resolveDefaultStageWidthMForFrame(frame);
}

export function createDiningStageOnSide(
  element: CenterpieceElement,
  rect: PixelRect,
  sideEdgeId: number,
  dims?: { widthM?: number; depthM?: number },
): DiningStageSpec | null {
  const frame = getStageEdgeFrame(element, rect, sideEdgeId);
  if (!frame) {
    return null;
  }
  const fitted = fitDiningFeatureDimsToBlock(
    element,
    rect,
    {
      widthM: dims?.widthM ?? DEFAULT_DINING_STAGE_WIDTH_M,
      depthM: dims?.depthM ?? DEFAULT_DINING_STAGE_DEPTH_M,
    },
    sideEdgeId,
  );
  const depthM = fitted.depthM;
  const widthM = fitted.widthM;
  const draft: DiningStageSpec = {
    widthM,
    depthM,
    sideEdgeId,
    xPct: 50,
    yPct: 50,
    offsetAlongEdgeM: 0,
    insetFromEdgeM: depthM / 2,
    rotationDeg: normalizeDiningFeatureRotationDeg(
      diningFeatureRotationDeg(element, rect, sideEdgeId),
    ),
    label: DINING_STAGE_DISPLAY_LABEL,
  };
  return clampDiningFeatureInsideBlock(
    element,
    rect,
    syncStageSpecFromMetrics(element, rect, draft),
    'stage',
  );
}

/** @deprecated Use createDiningStageOnSide after the user picks a side. */
export function createDefaultDiningStage(
  element: CenterpieceElement,
  rect: PixelRect,
): DiningStageSpec {
  const polygon = blockPolygon(element, rect);
  const fallback = stadiumLogicalEdgeFromView(polygon, rect.cx, rect.cy, element.blockViewpointAngleDeg ?? 0);
  const sideEdgeId = fallback?.id ?? 0;
  return createDiningStageOnSide(element, rect, sideEdgeId) ?? {
    widthM: DEFAULT_DINING_STAGE_WIDTH_M,
    depthM: DEFAULT_DINING_STAGE_DEPTH_M,
    sideEdgeId: 0,
    xPct: 50,
    yPct: 50,
    offsetAlongEdgeM: 0,
    insetFromEdgeM: DEFAULT_DINING_STAGE_DEPTH_M / 2,
    label: DINING_STAGE_DISPLAY_LABEL,
  };
}

export function reorientDiningStageToSide(
  element: CenterpieceElement,
  rect: PixelRect,
  stage: DiningStageSpec,
  sideEdgeId: number,
): DiningStageSpec | null {
  const frame = getStageEdgeFrame(element, rect, sideEdgeId);
  if (!frame) {
    return null;
  }
  const fitted = fitDiningFeatureDimsToBlock(
    element,
    rect,
    { widthM: stage.widthM, depthM: stage.depthM },
    sideEdgeId,
  );
  const depthM = fitted.depthM;
  const widthM = fitted.widthM;
  const draft: DiningStageSpec = {
    ...stage,
    sideEdgeId,
    widthM,
    depthM,
    offsetAlongEdgeM: 0,
    insetFromEdgeM: depthM / 2,
    // Changing side snaps rotation back to the new wall, then the user can tweak.
    rotationDeg: normalizeDiningFeatureRotationDeg(
      diningFeatureRotationDeg(element, rect, sideEdgeId),
    ),
  };
  return clampDiningFeatureInsideBlock(
    element,
    rect,
    syncStageSpecFromMetrics(element, rect, draft),
    'stage',
  );
}

/** Degrees of the feature's long edge (0 = along +X). Used by the layout generator AABB. */
export function diningFeatureRotationDeg(
  element: CenterpieceElement,
  rect: PixelRect,
  sideEdgeId?: number | null,
): number {
  const frame = getStageEdgeFrame(element, rect, sideEdgeId);
  if (!frame) {
    return 0;
  }
  return (Math.atan2(frame.uy, frame.ux) * 180) / Math.PI;
}

/** Normalize feature rotation to [0, 360). */
export function normalizeDiningFeatureRotationDeg(deg: number): number {
  if (!Number.isFinite(deg)) {
    return 0;
  }
  let n = deg % 360;
  if (n < 0) {
    n += 360;
  }
  return Math.round(n * 10) / 10;
}

/**
 * Stored free rotation when set; otherwise the wall-edge angle for `sideEdgeId`.
 */
export function resolveDiningFeatureRotationDeg(
  element: CenterpieceElement,
  rect: PixelRect,
  spec: Pick<DiningStageSpec, 'sideEdgeId' | 'rotationDeg'>,
): number {
  if (spec.rotationDeg != null && Number.isFinite(spec.rotationDeg)) {
    return normalizeDiningFeatureRotationDeg(spec.rotationDeg);
  }
  return normalizeDiningFeatureRotationDeg(
    diningFeatureRotationDeg(element, rect, spec.sideEdgeId),
  );
}

function resolveStageCanvasPoint(
  element: CenterpieceElement,
  rect: PixelRect,
  stage: DiningStageSpec,
): { x: number; y: number; rotationDeg: number; sideEdgeId: number } | null {
  const frame = getStageEdgeFrameForStage(element, rect, stage);
  if (!frame) {
    return null;
  }
  const rotationDeg = resolveDiningFeatureRotationDeg(element, rect, stage);

  if (stage.xPct != null && stage.yPct != null) {
    const point = elementPctToCanvasPoint(stage.xPct, stage.yPct, rect);
    return { ...point, rotationDeg, sideEdgeId: frame.sideEdgeId };
  }

  const point = canvasPointFromStageMetrics(
    element,
    rect,
    stage,
    stage.offsetAlongEdgeM ?? 0,
    stage.insetFromEdgeM ?? stage.depthM / 2,
  );
  if (!point) {
    return null;
  }
  return { ...point, rotationDeg, sideEdgeId: frame.sideEdgeId };
}

export function buildDiningStageRenderNode(
  element: CenterpieceElement,
  rect: PixelRect,
  selected: boolean,
): DiningStageRenderNode | null {
  const stage = element.diningStage;
  if (!stage) {
    return null;
  }
  const polygon = blockPolygon(element, rect);
  if (polygon.length < 3) {
    return null;
  }

  const frame = getStageEdgeFrameForStage(element, rect, stage);
  if (!frame) {
    return null;
  }

  const placement = resolveStageCanvasPoint(element, rect, stage);
  if (!placement) {
    return null;
  }

  const widthPx = Math.max(8, stage.widthM * frame.ppm);
  const depthPx = Math.max(6, stage.depthM * frame.ppm);

  return {
    x: placement.x,
    y: placement.y,
    widthPx,
    heightPx: depthPx,
    rotationDeg: placement.rotationDeg,
    label: diningFeatureDisplayLabel(stage.label, 'stage'),
    selected,
    sideEdgeId: placement.sideEdgeId,
  };
}

function checkFeatureCollisionAndFindRotation(
  element: CenterpieceElement,
  rect: PixelRect,
  isStage: boolean,
  candidateSpec: DiningStageSpec
): DiningStageSpec {
  const tempEl: CenterpieceElement = {
    ...element,
    diningStage: isStage ? candidateSpec : element.diningStage,
    diningFoodPrepare: isStage ? element.diningFoodPrepare : (candidateSpec as unknown as DiningFoodPrepareSpec),
  };

  const stageNode = tempEl.diningStage ? buildDiningStageRenderNode(tempEl, rect, false) : null;
  const foodNode = tempEl.diningFoodPrepare ? buildDiningFoodPrepareRenderNode(tempEl, rect, false) : null;
  const accessNodes = diningAccessClearanceNodes(tempEl, rect);
  const exitNode = accessNodes.find((n) => n.kind === 'exit') ?? null;
  const entranceNode = accessNodes.find((n) => n.kind === 'entrance' || n.kind === 'shared') ?? null;

  let collides = false;
  if (stageNode && foodNode && doDiningFeatureNodesOverlap(stageNode, foodNode)) {
    collides = true;
  }
  if (isStage && stageNode && exitNode && doDiningFeatureNodesOverlap(stageNode, exitNode)) {
    collides = true;
  }
  if (!isStage && foodNode && exitNode && doDiningFeatureNodesOverlap(foodNode, exitNode)) {
    collides = true;
  }
  if (isStage && stageNode && entranceNode && doDiningFeatureNodesOverlap(stageNode, entranceNode)) {
    collides = true;
  }
  if (!isStage && foodNode && entranceNode && doDiningFeatureNodesOverlap(foodNode, entranceNode)) {
    collides = true;
  }

  if (!collides) {
    return candidateSpec;
  }

  const currentSide = candidateSpec.sideEdgeId ?? 0;
  for (let i = 1; i <= 3; i++) {
    const nextSide = (currentSide + i) % 4;
    const testSpec: DiningStageSpec = {
      ...candidateSpec,
      sideEdgeId: nextSide,
    };
    
    const testEl: CenterpieceElement = {
      ...element,
      diningStage: isStage ? testSpec : element.diningStage,
      diningFoodPrepare: isStage ? element.diningFoodPrepare : (testSpec as unknown as DiningFoodPrepareSpec),
    };
    
    const testStageNode = testEl.diningStage ? buildDiningStageRenderNode(testEl, rect, false) : null;
    const testFoodNode = testEl.diningFoodPrepare ? buildDiningFoodPrepareRenderNode(testEl, rect, false) : null;
    const testAccess = diningAccessClearanceNodes(testEl, rect);
    const testExitNode = testAccess.find((n) => n.kind === 'exit') ?? null;
    const testEntranceNode = testAccess.find((n) => n.kind === 'entrance' || n.kind === 'shared') ?? null;

    let testCollides = false;
    if (testStageNode && testFoodNode && doDiningFeatureNodesOverlap(testStageNode, testFoodNode)) {
      testCollides = true;
    }
    if (isStage && testStageNode && testExitNode && doDiningFeatureNodesOverlap(testStageNode, testExitNode)) {
      testCollides = true;
    }
    if (!isStage && testFoodNode && testExitNode && doDiningFeatureNodesOverlap(testFoodNode, testExitNode)) {
      testCollides = true;
    }
    if (isStage && testStageNode && testEntranceNode && doDiningFeatureNodesOverlap(testStageNode, testEntranceNode)) {
      testCollides = true;
    }
    if (!isStage && testFoodNode && testEntranceNode && doDiningFeatureNodesOverlap(testFoodNode, testEntranceNode)) {
      testCollides = true;
    }

    if (!testCollides) {
      return testSpec;
    }
  }

  // Keep footprint size — do not swap width/depth to resolve collisions.
  return candidateSpec;
}

export function moveStageToPoint(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  canvasPct: ElementPosition,
): Partial<CenterpieceElement> {
  const stage = element.diningStage;
  if (!stage) {
    return {};
  }
  const polygon = blockPolygon(element, rect);
  if (polygon.length < 3) {
    return {};
  }
  let placement = canvasPctToCanvasPoint(canvasPct, canvas);
  if (!pointInPolygon(placement, polygon)) {
    placement = clampPointInsidePolygon(placement, polygon);
    if (!pointInPolygon(placement, polygon)) {
      return {};
    }
  }
  const pct = canvasPointToElementPct(placement, rect);

  const distanceToCenter = Math.hypot(pct.xPct - 50, pct.yPct - 50);
  let alignment: 'edge' | 'center' | 'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br' = 'edge';
  if (distanceToCenter < 15) {
    alignment = 'center';
  } else if (pct.xPct < 25 && pct.yPct < 25) {
    alignment = 'corner-tl';
  } else if (pct.xPct > 75 && pct.yPct < 25) {
    alignment = 'corner-tr';
  } else if (pct.xPct < 25 && pct.yPct > 75) {
    alignment = 'corner-bl';
  } else if (pct.xPct > 75 && pct.yPct > 75) {
    alignment = 'corner-br';
  }

  const next: DiningStageSpec = {
    ...stage,
    xPct: pct.xPct,
    yPct: pct.yPct,
    alignment,
  };

  let synced = next;
  if (alignment === 'edge') {
    synced = syncStageSpecFromPosition(element, rect, next);
  }

  const resolved = checkFeatureCollisionAndFindRotation(element, rect, true, synced);
  return {
    diningStage: clampDiningFeatureInsideBlock(element, rect, resolved, 'stage'),
  };
}

export type DiningFeatureResizeHandle = 'left' | 'right' | 'top' | 'bottom';

function featureWorldCenter(
  element: CenterpieceElement,
  rect: PixelRect,
  centerX: number,
  centerY: number,
): { x: number; y: number } {
  const rot = element.rotation ?? 0;
  if (!rot) {
    return { x: centerX, y: centerY };
  }
  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = centerX - rect.cx;
  const dy = centerY - rect.cy;
  return {
    x: rect.cx + dx * cos - dy * sin,
    y: rect.cy + dx * sin + dy * cos,
  };
}

/** Resize stage / food-prep from a canvas pointer while dragging an edge handle. */
export function resizeDiningFeatureFromCanvasPointer(
  element: CenterpieceElement,
  rect: PixelRect,
  kind: 'stage' | 'foodprepare',
  handle: DiningFeatureResizeHandle,
  canvasX: number,
  canvasY: number,
): Partial<CenterpieceElement> {
  const spec =
    kind === 'stage'
      ? element.diningStage
      : (element.diningFoodPrepare as DiningStageSpec | undefined);
  if (!spec) {
    return {};
  }

  const node =
    kind === 'stage'
      ? buildDiningStageRenderNode(element, rect, false)
      : buildDiningFoodPrepareRenderNode(element, rect, false);
  if (!node) {
    return {};
  }

  const frame = getStageEdgeFrameForStage(element, rect, spec);
  if (!frame) {
    return {};
  }

  const world = featureWorldCenter(element, rect, node.x, node.y);
  const dx = canvasX - world.x;
  const dy = canvasY - world.y;
  const rad = (-node.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  const ppm = frame.ppm;
  let widthM = spec.widthM;
  let depthM = spec.depthM;
  const minHalfW = (MIN_DINING_FEATURE_WIDTH_M * ppm) / 2;
  const minHalfD = (MIN_DINING_FEATURE_DEPTH_M * ppm) / 2;

  if (handle === 'right') {
    widthM = Math.max(MIN_DINING_FEATURE_WIDTH_M, (2 * Math.max(localX, minHalfW)) / ppm);
  } else if (handle === 'left') {
    widthM = Math.max(MIN_DINING_FEATURE_WIDTH_M, (2 * Math.max(-localX, minHalfW)) / ppm);
  } else if (handle === 'top') {
    depthM = Math.max(MIN_DINING_FEATURE_DEPTH_M, (2 * Math.max(-localY, minHalfD)) / ppm);
  } else {
    depthM = Math.max(MIN_DINING_FEATURE_DEPTH_M, (2 * Math.max(localY, minHalfD)) / ppm);
  }

  const next: DiningStageSpec = { ...spec, widthM, depthM };
  const clamped = clampDiningFeatureInsideBlock(element, rect, next, kind);
  return kind === 'stage'
    ? { diningStage: clamped }
    : { diningFoodPrepare: clamped as DiningFoodPrepareSpec };
}

export function listStageSideOptions(
  element: CenterpieceElement,
  rect: PixelRect,
): Array<{ id: number; label: string }> {
  const polygon = blockPolygon(element, rect);
  return buildBlockMeasureEdges(polygon).map((edge) => ({
    id: edge.id,
    label: edge.label,
  }));
}

export function buildDiningFoodPrepareRenderNode(
  element: CenterpieceElement,
  rect: PixelRect,
  selected: boolean,
): DiningStageRenderNode | null {
  const foodPrepare = element.diningFoodPrepare;
  if (!foodPrepare) {
    return null;
  }
  const polygon = blockPolygon(element, rect);
  if (polygon.length < 3) {
    return null;
  }

  const frame = getStageEdgeFrameForStage(element, rect, foodPrepare as DiningStageSpec);
  if (!frame) {
    return null;
  }

  const placement = resolveStageCanvasPoint(element, rect, foodPrepare as DiningStageSpec);
  if (!placement) {
    return null;
  }

  const widthPx = Math.max(8, foodPrepare.widthM * frame.ppm);
  const depthPx = Math.max(6, foodPrepare.depthM * frame.ppm);

  return {
    x: placement.x,
    y: placement.y,
    widthPx,
    heightPx: depthPx,
    rotationDeg: placement.rotationDeg,
    label: diningFeatureDisplayLabel(foodPrepare.label, 'food-prep'),
    selected,
    sideEdgeId: placement.sideEdgeId,
  };
}

export function createDiningFoodPrepareOnSide(
  element: CenterpieceElement,
  rect: PixelRect,
  sideEdgeId: number,
  dims?: { widthM?: number; depthM?: number },
): DiningFoodPrepareSpec | null {
  const frame = getStageEdgeFrame(element, rect, sideEdgeId);
  if (!frame) {
    return null;
  }
  const fitted = fitDiningFeatureDimsToBlock(
    element,
    rect,
    {
      widthM: dims?.widthM ?? DEFAULT_DINING_FOOD_PREPARE_WIDTH_M,
      depthM: dims?.depthM ?? DEFAULT_DINING_FOOD_PREPARE_DEPTH_M,
    },
    sideEdgeId,
  );
  const depthM = fitted.depthM;
  const widthM = fitted.widthM;
  const draft: DiningFoodPrepareSpec = {
    widthM,
    depthM,
    sideEdgeId,
    xPct: 50,
    yPct: 50,
    offsetAlongEdgeM: 0,
    insetFromEdgeM: depthM / 2,
    rotationDeg: normalizeDiningFeatureRotationDeg(
      diningFeatureRotationDeg(element, rect, sideEdgeId),
    ),
    label: DINING_FOOD_PREP_DISPLAY_LABEL,
  };
  return clampDiningFeatureInsideBlock(
    element,
    rect,
    syncStageSpecFromMetrics(element, rect, draft as DiningStageSpec),
    'foodprepare',
  ) as DiningFoodPrepareSpec;
}

export function reorientDiningFoodPrepareToSide(
  element: CenterpieceElement,
  rect: PixelRect,
  foodPrepare: DiningFoodPrepareSpec,
  sideEdgeId: number,
): DiningFoodPrepareSpec | null {
  const frame = getStageEdgeFrame(element, rect, sideEdgeId);
  if (!frame) {
    return null;
  }
  const fitted = fitDiningFeatureDimsToBlock(
    element,
    rect,
    { widthM: foodPrepare.widthM, depthM: foodPrepare.depthM },
    sideEdgeId,
  );
  const depthM = fitted.depthM;
  const widthM = fitted.widthM;
  const draft: DiningFoodPrepareSpec = {
    ...foodPrepare,
    sideEdgeId,
    widthM,
    depthM,
    offsetAlongEdgeM: 0,
    insetFromEdgeM: depthM / 2,
    rotationDeg: normalizeDiningFeatureRotationDeg(
      diningFeatureRotationDeg(element, rect, sideEdgeId),
    ),
  };
  return clampDiningFeatureInsideBlock(
    element,
    rect,
    syncStageSpecFromMetrics(element, rect, draft as DiningStageSpec),
    'foodprepare',
  ) as DiningFoodPrepareSpec;
}

export function moveFoodPrepareToPoint(
  element: CenterpieceElement,
  rect: PixelRect,
  canvas: { width: number; height: number },
  canvasPct: ElementPosition,
): Partial<CenterpieceElement> {
  const foodPrepare = element.diningFoodPrepare;
  if (!foodPrepare) {
    return {};
  }
  const polygon = blockPolygon(element, rect);
  if (polygon.length < 3) {
    return {};
  }
  let placement = canvasPctToCanvasPoint(canvasPct, canvas);
  if (!pointInPolygon(placement, polygon)) {
    placement = clampPointInsidePolygon(placement, polygon);
    if (!pointInPolygon(placement, polygon)) {
      return {};
    }
  }
  const pct = canvasPointToElementPct(placement, rect);

  const distanceToCenter = Math.hypot(pct.xPct - 50, pct.yPct - 50);
  let alignment: 'edge' | 'center' | 'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br' = 'edge';
  if (distanceToCenter < 15) {
    alignment = 'center';
  } else if (pct.xPct < 25 && pct.yPct < 25) {
    alignment = 'corner-tl';
  } else if (pct.xPct > 75 && pct.yPct < 25) {
    alignment = 'corner-tr';
  } else if (pct.xPct < 25 && pct.yPct > 75) {
    alignment = 'corner-bl';
  } else if (pct.xPct > 75 && pct.yPct > 75) {
    alignment = 'corner-br';
  }

  const next: DiningFoodPrepareSpec = {
    ...foodPrepare,
    xPct: pct.xPct,
    yPct: pct.yPct,
    alignment,
  };

  let synced = next;
  if (alignment === 'edge') {
    synced = syncStageSpecFromPosition(element, rect, next as DiningStageSpec) as DiningFoodPrepareSpec;
  }

  const resolved = checkFeatureCollisionAndFindRotation(element, rect, false, synced as DiningStageSpec) as DiningFoodPrepareSpec;
  return {
    diningFoodPrepare: clampDiningFeatureInsideBlock(
      element,
      rect,
      resolved as DiningStageSpec,
      'foodprepare',
    ) as DiningFoodPrepareSpec,
  };
}

let accessPointCounter = 0;

function nextAccessPointId(kind: DiningAccessPointKind): string {
  accessPointCounter += 1;
  return `dap-${kind}-${Date.now().toString(36)}-${accessPointCounter.toString(36)}`;
}

export function cloneAccessPointAsKind(
  spec: DiningAccessPointSpec,
  kind: DiningAccessPointKind,
): DiningAccessPointSpec {
  return {
    ...spec,
    kind,
    label: accessPointDisplayLabel(kind),
  };
}

export function accessPointDisplayLabel(kind: DiningAccessPointKind): string {
  if (kind === 'entrance') {
    return 'Entrance';
  }
  if (kind === 'shared') {
    return 'Entry / Exit';
  }
  if (kind === 'emergency-exit') {
    return 'Emergency';
  }
  return 'Exit';
}

export function resolveDiningAccessDefaultWidthM(
  element: CenterpieceElement,
  kind: DiningAccessPointKind,
): number {
  if (kind === 'entrance') {
    return resolveDiningAccessWidthM(
      { widthM: element.defaultDiningEntranceWidthM },
      DEFAULT_DINING_ENTRANCE_WIDTH_M,
    );
  }
  if (kind === 'shared') {
    return resolveDiningAccessWidthM(
      { widthM: element.defaultDiningSharedAccessWidthM },
      DEFAULT_DINING_SHARED_ACCESS_WIDTH_M,
    );
  }
  return resolveDiningAccessWidthM(
    { widthM: element.defaultDiningExitWidthM },
    DEFAULT_DINING_EXIT_WIDTH_M,
  );
}

export function resolveDiningAccessDefaultDepthM(kind: DiningAccessPointKind): number {
  if (kind === 'entrance') {
    return DEFAULT_DINING_ENTRANCE_DEPTH_M;
  }
  if (kind === 'shared') {
    return DEFAULT_DINING_SHARED_ACCESS_DEPTH_M;
  }
  return DEFAULT_DINING_EXIT_DEPTH_M;
}

/** Create an entrance / exit / emergency-exit on the given block side. */
export function createDiningAccessPointOnSide(
  element: CenterpieceElement,
  rect: PixelRect,
  sideEdgeId: number,
  kind: DiningAccessPointKind,
  widthM?: number,
): DiningAccessPointSpec | null {
  const frame = getStageEdgeFrame(element, rect, sideEdgeId);
  if (!frame) {
    return null;
  }
  const depthM = resolveDiningAccessDefaultDepthM(kind);
  const resolvedWidth = widthM != null && widthM > 0
    ? widthM
    : resolveDiningAccessDefaultWidthM(element, kind);
  const draft: DiningAccessPointSpec = {
    id: nextAccessPointId(kind),
    kind,
    widthM: resolvedWidth,
    depthM,
    sideEdgeId,
    xPct: 50,
    yPct: 50,
    offsetAlongEdgeM: 0,
    insetFromEdgeM: depthM / 2,
    label: accessPointDisplayLabel(kind),
    alignment: 'edge',
  };
  return clampDiningAccessPointToEdge(element, rect, draft);
}

/** Create a small Exit / doorway section on the given block side. */
export function createDiningExitOnSide(
  element: CenterpieceElement,
  rect: PixelRect,
  sideEdgeId: number,
): DiningExitSpec | null {
  return createDiningAccessPointOnSide(element, rect, sideEdgeId, 'exit');
}

export function createDiningEntranceOnSide(
  element: CenterpieceElement,
  rect: PixelRect,
  sideEdgeId: number,
): DiningAccessPointSpec | null {
  return createDiningAccessPointOnSide(element, rect, sideEdgeId, 'entrance');
}

export interface DiningAccessPointPlacementPreview {
  kind: DiningAccessPointKind;
  accessPoint: DiningAccessPointSpec;
  node: DiningStageRenderNode;
  edge: { x1: number; y1: number; x2: number; y2: number; midX: number; midY: number };
  sideLabel: string;
}

/** @deprecated Use DiningAccessPointPlacementPreview — `exit` is the accessPoint. */
export type DiningExitPlacementPreview = DiningAccessPointPlacementPreview & {
  exit: DiningAccessPointSpec;
};

/** Screen-pixel radius for placing / previewing an access point on a block edge. */
export const DINING_ACCESS_EDGE_HIT_SCREEN_PX = 28;

/** Convert the edge hit radius into canvas units for the current zoom. */
export function diningAccessEdgeHitThresholdPx(zoomPct: number): number {
  return DINING_ACCESS_EDGE_HIT_SCREEN_PX / Math.max(0.35, zoomPct / 100);
}

/**
 * Resolve where an access point would land for a canvas pointer — used for click
 * place and for the live dashed hover preview while setting entrance/exit.
 *
 * When `maxDistancePx` is set, the pointer must be that close (canvas units) to
 * the nearest polygon edge. Interior / outside clicks return null.
 */
export function resolveDiningAccessPointAtCanvasPoint(
  element: CenterpieceElement,
  rect: PixelRect,
  canvasX: number,
  canvasY: number,
  kind: DiningAccessPointKind,
  maxDistancePx?: number,
): DiningAccessPointPlacementPreview | null {
  const polygon = blockPolygon(element, rect);
  if (polygon.length < 3) {
    return null;
  }
  const edges = buildBlockMeasureEdges(polygon);
  if (edges.length === 0) {
    return null;
  }

  const distanceToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-9) {
      return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    }
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
  };

  let closestEdge = edges[0];
  let minDistance = Infinity;
  for (const edge of edges) {
    const dist = distanceToSegment(canvasX, canvasY, edge.x1, edge.y1, edge.x2, edge.y2);
    if (dist < minDistance) {
      minDistance = dist;
      closestEdge = edge;
    }
  }

  if (maxDistancePx != null && minDistance > maxDistancePx) {
    return null;
  }

  const spec = createDiningAccessPointOnSide(element, rect, closestEdge.id, kind);
  if (!spec) {
    return null;
  }

  const frame = getStageEdgeFrame(element, rect, closestEdge.id);
  if (frame) {
    const foot = projectToEdge(frame.edge, canvasX, canvasY);
    const alongPx = (foot.x - frame.edge.midX) * frame.ux + (foot.y - frame.edge.midY) * frame.uy;
    spec.offsetAlongEdgeM = alongPx / frame.ppm;
  }

  const finalSpec = clampDiningAccessPointToEdge(element, rect, {
    ...syncStageSpecFromMetrics(
      element,
      rect,
      spec as unknown as DiningStageSpec,
    ) as unknown as DiningAccessPointSpec,
  });

  const tempEl: CenterpieceElement =
    kind === 'shared'
      ? { ...element, diningSharedAccessPoint: finalSpec }
      : kind === 'entrance'
        ? { ...element, diningEntrance: finalSpec }
        : { ...element, diningExit: finalSpec };
  const node =
    kind === 'shared'
      ? buildDiningSharedAccessRenderNode(tempEl, rect, false)
      : kind === 'entrance'
        ? buildDiningEntranceRenderNode(tempEl, rect, false)
        : buildDiningExitRenderNode(tempEl, rect, false);
  if (!node) {
    return null;
  }

  return {
    kind,
    accessPoint: finalSpec,
    node,
    edge: {
      x1: closestEdge.x1,
      y1: closestEdge.y1,
      x2: closestEdge.x2,
      y2: closestEdge.y2,
      midX: (closestEdge.x1 + closestEdge.x2) / 2,
      midY: (closestEdge.y1 + closestEdge.y2) / 2,
    },
    sideLabel: closestEdge.label,
  };
}

/**
 * Resolve where an exit would land for a canvas pointer — used for click place
 * and for the live dashed hover preview while setting the exit.
 */
export function resolveDiningExitAtCanvasPoint(
  element: CenterpieceElement,
  rect: PixelRect,
  canvasX: number,
  canvasY: number,
  maxDistancePx?: number,
): DiningExitPlacementPreview | null {
  const preview = resolveDiningAccessPointAtCanvasPoint(
    element,
    rect,
    canvasX,
    canvasY,
    'exit',
    maxDistancePx,
  );
  if (!preview) {
    return null;
  }
  return { ...preview, exit: preview.accessPoint };
}

/** Access openings that occupy floor area for table / feature clearance. */
export function diningAccessClearanceNodes(
  element: CenterpieceElement,
  rect: PixelRect,
): DiningStageRenderNode[] {
  if (resolveDiningAccessMode(element) === 'shared') {
    const shared = buildDiningSharedAccessRenderNode(element, rect, false);
    return shared ? [shared] : [];
  }
  const nodes: DiningStageRenderNode[] = [];
  const entrance = buildDiningEntranceRenderNode(element, rect, false);
  const exit = buildDiningExitRenderNode(element, rect, false);
  if (entrance) {
    nodes.push(entrance);
  }
  if (exit) {
    nodes.push(exit);
  }
  return nodes;
}

function buildDiningAccessPointRenderNode(
  spec: DiningAccessPointSpec,
  element: CenterpieceElement,
  rect: PixelRect,
  selected: boolean,
  fallbackKind: DiningAccessPointKind,
): DiningStageRenderNode | null {
  const polygon = blockPolygon(element, rect);
  if (polygon.length < 3) {
    return null;
  }
  const kind = spec.kind ?? fallbackKind;
  const clamped = clampDiningAccessPointToEdge(element, rect, spec);
  const frame = getStageEdgeFrameForStage(element, rect, clamped as unknown as DiningStageSpec);
  if (!frame) {
    return null;
  }
  const placement = resolveStageCanvasPoint(element, rect, clamped as unknown as DiningStageSpec);
  if (!placement) {
    return null;
  }
  const widthM = resolveDiningAccessWidthM(clamped, resolveDiningAccessDefaultWidthM(element, kind));
  const depthM = clamped.depthM > 0 ? clamped.depthM : resolveDiningAccessDefaultDepthM(kind);
  const widthPx = Math.max(8, widthM * frame.ppm);
  const depthPx = Math.max(5, depthM * frame.ppm);
  const offsetAlongM = clamped.offsetAlongEdgeM ?? 0;
  const halfWidthM = widthM / 2;
  const along0Px = (offsetAlongM - halfWidthM) * frame.ppm;
  const along1Px = (offsetAlongM + halfWidthM) * frame.ppm;
  const wallSegment = {
    x1: frame.edge.midX + frame.ux * along0Px,
    y1: frame.edge.midY + frame.uy * along0Px,
    x2: frame.edge.midX + frame.ux * along1Px,
    y2: frame.edge.midY + frame.uy * along1Px,
  };
  return {
    x: placement.x,
    y: placement.y,
    widthPx,
    heightPx: depthPx,
    rotationDeg: placement.rotationDeg,
    label: clamped.label?.trim() || accessPointDisplayLabel(kind),
    selected,
    sideEdgeId: placement.sideEdgeId,
    kind,
    wallSegment,
  };
}

/** Build the render node for a dining Exit section. */
export function buildDiningExitRenderNode(
  element: CenterpieceElement,
  rect: PixelRect,
  selected: boolean,
): DiningStageRenderNode | null {
  if (!element.diningExit) {
    return null;
  }
  return buildDiningAccessPointRenderNode(element.diningExit, element, rect, selected, 'exit');
}

/** Build the render node for a dining Entrance section. */
export function buildDiningEntranceRenderNode(
  element: CenterpieceElement,
  rect: PixelRect,
  selected: boolean,
): DiningStageRenderNode | null {
  if (!element.diningEntrance) {
    return null;
  }
  return buildDiningAccessPointRenderNode(element.diningEntrance, element, rect, selected, 'entrance');
}

/** Build the render node for a shared entrance/exit opening. */
export function buildDiningSharedAccessRenderNode(
  element: CenterpieceElement,
  rect: PixelRect,
  selected: boolean,
): DiningStageRenderNode | null {
  if (!element.diningSharedAccessPoint) {
    return null;
  }
  return buildDiningAccessPointRenderNode(
    element.diningSharedAccessPoint,
    element,
    rect,
    selected,
    'shared',
  );
}
