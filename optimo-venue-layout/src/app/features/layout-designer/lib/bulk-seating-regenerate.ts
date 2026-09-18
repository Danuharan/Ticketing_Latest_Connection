import { BlockSeatingConfigSnapshot } from '../models/block-config-template.model';
import {
  estimateSideLengthsFromReference,
  resolveSourceSideLengthsM,
} from './block-shape-match';
import { createDefineByRowColumnSeating } from './define-by-row-column';
import {
  createArrangeByRowGridSeating,
  createDragSeatsSeating,
  fillDragSeatsFullShape,
} from './drag-seats';
import { collectAdjacentBlocks } from './row-seat-align';
import { type PhysicalDimsInput } from './custom-shape-seats';
import { rectFromPositionSize } from './geometry';
import {
  GroundFocalPoint,
  inferGroundViewpointForBlock,
} from './infer-ground-viewpoint';
import {
  CanvasConfig,
  CenterpieceElement,
  CustomShapeSeatPosition,
  DEFAULT_BLOCK_LENGTH_M,
  DEFAULT_BLOCK_WIDTH_M,
  DEFAULT_CHAIR_LENGTH_M,
  DEFAULT_CHAIR_WIDTH_M,
  LayoutElement,
} from '../models/layout-element.model';

function resolveBlockCode(el: CenterpieceElement): string {
  return el.code?.trim() || el.label?.trim() || el.name?.trim() || 'BLOCK';
}

function remapSeatId(id: string, sourceCode: string, targetCode: string): string {
  if (sourceCode === targetCode) {
    return id;
  }
  const prefix = `${sourceCode}-`;
  if (id.startsWith(prefix)) {
    return `${targetCode}-${id.slice(prefix.length)}`;
  }
  return id;
}

function remapSeatIdsInPatch(
  patch: Partial<CenterpieceElement>,
  sourceCode: string,
  targetCode: string,
): Partial<CenterpieceElement> {
  if (sourceCode === targetCode) {
    return patch;
  }

  const next: Partial<CenterpieceElement> = { ...patch, code: targetCode };
  if (next.seatPositionOverrides) {
    const overrides: Record<string, CustomShapeSeatPosition> = {};
    for (const [id, pos] of Object.entries(next.seatPositionOverrides)) {
      overrides[remapSeatId(id, sourceCode, targetCode)] = pos;
    }
    next.seatPositionOverrides = overrides;
  }
  if (next.seatLayout?.hiddenSeatIds) {
    next.seatLayout = {
      ...next.seatLayout,
      hiddenSeatIds: next.seatLayout.hiddenSeatIds.map((id) =>
        remapSeatId(id, sourceCode, targetCode),
      ),
    };
  }
  return next;
}

function buildDimsFromSnapshot(snapshot: BlockSeatingConfigSnapshot): PhysicalDimsInput {
  return {
    physicalLengthM: snapshot.physicalLengthM ?? DEFAULT_BLOCK_LENGTH_M,
    physicalWidthM: snapshot.physicalWidthM ?? DEFAULT_BLOCK_WIDTH_M,
    chairLengthM: snapshot.chairLengthM ?? DEFAULT_CHAIR_LENGTH_M,
    chairWidthM: snapshot.chairWidthM ?? DEFAULT_CHAIR_WIDTH_M,
    seatGapM: snapshot.seatGapM,
    rowGapM: snapshot.rowGapM,
  };
}

function resolveTargetSideLengthsForApply(
  source: CenterpieceElement,
  target: CenterpieceElement,
  snapshot: BlockSeatingConfigSnapshot,
  canvas: CanvasConfig,
): number[] | null {
  const targetVertexCount = target.customPoints?.length ?? 0;
  const sourceLengths =
    snapshot.customSideLengthsM ?? resolveSourceSideLengthsM(source);
  if (!sourceLengths) {
    return null;
  }

  const targetOwn = resolveSourceSideLengthsM(target);
  if (targetOwn && (targetVertexCount < 3 || targetOwn.length === targetVertexCount)) {
    return targetOwn;
  }

  // Always produce one length per target vertex (CV blocks often differ).
  return estimateSideLengthsFromReference(source, sourceLengths, target, canvas);
}

function resolveTargetSideNames(
  source: CenterpieceElement,
  target: CenterpieceElement,
  snapshot: BlockSeatingConfigSnapshot,
  sideLengths: number[],
): string[] {
  if (target.customSideNames?.length === sideLengths.length) {
    return [...target.customSideNames];
  }
  if (snapshot.customSideLengthsM?.length === sideLengths.length) {
    const sourceNames = source.customSideNames ?? [];
    if (sourceNames.length === sideLengths.length) {
      return [...sourceNames];
    }
  }
  return sideLengths.map((_, index) => `Side ${index + 1}`);
}

function finalizeManualLikePatch(
  patch: Partial<CenterpieceElement>,
  targetViewpoint: {
    blockViewpointAngleDeg: number;
    dragSeatsStadiumSideIndex: number;
    dragSeatsStadiumSideIndices?: number[];
  },
): Partial<CenterpieceElement> {
  return {
    ...patch,
    blockViewpointAngleDeg: targetViewpoint.blockViewpointAngleDeg,
    dragSeatsStadiumSideIndex: targetViewpoint.dragSeatsStadiumSideIndex,
    dragSeatsStadiumSideIndices: targetViewpoint.dragSeatsStadiumSideIndices,
    dragSeatsMode: undefined,
    dragSeatsFirstRowSeatCount: undefined,
    dragFillSeatsMode: undefined,
    interactiveSeatingLocked: true,
    blockType: 'seating',
  };
}

/**
 * Rebuild seating on a target block using the same placement tools as manual setup,
 * so bulk apply matches what the user would get by configuring each block by hand.
 * Rows are always rebuilt against the target block's VIEW POINT edge.
 */
export function regenerateSeatingOnTarget(options: {
  source: CenterpieceElement;
  target: CenterpieceElement;
  snapshot: BlockSeatingConfigSnapshot;
  canvas: CanvasConfig;
  focal: GroundFocalPoint;
  elements?: LayoutElement[];
}): Partial<CenterpieceElement> | null {
  const { source, target, snapshot, canvas, focal, elements = [] } = options;
  const sideLengths = resolveTargetSideLengthsForApply(source, target, snapshot, canvas);
  if (!sideLengths || sideLengths.length < 3) {
    return null;
  }

  const targetViewpoint = inferGroundViewpointForBlock(target, focal, canvas);
  const sideNames = resolveTargetSideNames(source, target, snapshot, sideLengths);
  const dims = buildDimsFromSnapshot(snapshot);
  const preparedTarget: CenterpieceElement = {
    ...target,
    customSideLengthsM: sideLengths,
    customSideNames: sideNames,
    blockViewpointAngleDeg: targetViewpoint.blockViewpointAngleDeg,
    dragSeatsStadiumSideIndex: targetViewpoint.dragSeatsStadiumSideIndex,
    dragSeatsStadiumSideIndices: targetViewpoint.dragSeatsStadiumSideIndices,
  };
  const rect = rectFromPositionSize(preparedTarget.position, preparedTarget.size, canvas);
  const sourceCode = resolveBlockCode(source);
  const targetCode = resolveBlockCode(target);

  let patch: Partial<CenterpieceElement> | null = null;
  const rowCount = snapshot.seatLayout?.rows ?? snapshot.rows ?? 0;
  const isPureDefineByRowColumn =
    snapshot.defineByRowColumnMode === true &&
    !snapshot.arrangeByRowMode &&
    !snapshot.dragSeatsMode;

  if (isPureDefineByRowColumn) {
    const rows = snapshot.defineByRowColumnRows ?? (rowCount || 1);
    const columns =
      snapshot.defineByRowColumnColumns ?? snapshot.seatLayout?.seatsPerRow ?? snapshot.seatsPerRow ?? 1;
    patch = createDefineByRowColumnSeating(preparedTarget, rect, rows, columns);
  } else if (rowCount > 0) {
    // Viewpoint-aware rows: first row along the ground-facing edge, rows grow inward.
    const result = createArrangeByRowGridSeating(
      preparedTarget,
      rect,
      sideLengths,
      sideNames,
      dims,
      targetViewpoint.dragSeatsStadiumSideIndex,
      rowCount,
      undefined,
      targetViewpoint.blockViewpointAngleDeg,
      undefined,
      undefined,
      { adjacentBlocks: collectAdjacentBlocks(preparedTarget, elements, canvas) },
    );
    if ('error' in result) {
      // Fall back to drag-fill if the row count does not fit this polygon.
      const dragPatch = createDragSeatsSeating(
        preparedTarget,
        rect,
        sideLengths,
        dims,
        targetViewpoint.dragSeatsStadiumSideIndex,
        snapshot.dragSeatsFirstRowSeatCount ?? snapshot.seatLayout?.rowSeatCounts?.[0],
      );
      if (Object.keys(dragPatch).length === 0) {
        return null;
      }
      const filled = fillDragSeatsFullShape(
        { ...preparedTarget, ...dragPatch } as CenterpieceElement,
        rect,
      );
      patch = { ...dragPatch, ...filled };
    } else {
      patch = result.patch;
    }
  } else {
    const firstRowSeatCount =
      snapshot.dragSeatsFirstRowSeatCount ?? snapshot.seatLayout?.rowSeatCounts?.[0];
    const dragPatch = createDragSeatsSeating(
      preparedTarget,
      rect,
      sideLengths,
      dims,
      targetViewpoint.dragSeatsStadiumSideIndex,
      firstRowSeatCount,
    );
    if (Object.keys(dragPatch).length === 0) {
      return null;
    }
    const filled = fillDragSeatsFullShape(
      { ...preparedTarget, ...dragPatch } as CenterpieceElement,
      rect,
    );
    patch = { ...dragPatch, ...filled };
  }

  if (!patch || Object.keys(patch).length === 0) {
    return null;
  }

  return remapSeatIdsInPatch(
    finalizeManualLikePatch(patch, targetViewpoint),
    sourceCode,
    targetCode,
  );
}
