import { canvasPctToLocalPoint } from './custom-shape';
import { viewpointAngleFromCanvasPoint } from './block-viewpoint';
import {
  findShapeAlignmentBetweenBlocks,
  type ShapeAlignment,
  type ShapeMirrorMode,
} from './block-shape-match';
import { rectFromPositionSize } from './geometry';
import { BlockSeatingConfigSnapshot } from '../models/block-config-template.model';
import {
  ArrangeByRowPath,
  CanvasConfig,
  CenterpieceElement,
  CustomShapeSeatBlock,
  CustomShapeSeatPosition,
  ElementPosition,
} from '../models/layout-element.model';

const ELEMENT_CENTRE = 50;

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

function remapOverrides(
  overrides: Record<string, CustomShapeSeatPosition> | undefined,
  sourceCode: string,
  targetCode: string,
): Record<string, CustomShapeSeatPosition> | undefined {
  if (!overrides) {
    return undefined;
  }
  const next: Record<string, CustomShapeSeatPosition> = {};
  for (const [id, pos] of Object.entries(overrides)) {
    next[remapSeatId(id, sourceCode, targetCode)] = { ...pos };
  }
  return next;
}

function edgeMidpointElementPct(
  customPoints: ElementPosition[],
  edgeIndex: number,
): ElementPosition {
  const a = customPoints[edgeIndex];
  const b = customPoints[(edgeIndex + 1) % customPoints.length];
  return {
    xPct: (a.xPct + b.xPct) / 2,
    yPct: (a.yPct + b.yPct) / 2,
  };
}

function mirrorElementPct(point: ElementPosition, mode: ShapeMirrorMode): ElementPosition {
  switch (mode) {
    case 'horizontal':
      return { xPct: 100 - point.xPct, yPct: point.yPct };
    case 'vertical':
      return { xPct: point.xPct, yPct: 100 - point.yPct };
    case 'both':
      return { xPct: 100 - point.xPct, yPct: 100 - point.yPct };
    default:
      return { ...point };
  }
}

function rotateElementPct(
  point: ElementPosition,
  deltaDeg: number,
  centre = ELEMENT_CENTRE,
): ElementPosition {
  if (Math.abs(deltaDeg) < 0.01) {
    return { ...point };
  }
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.xPct - centre;
  const dy = point.yPct - centre;
  return {
    xPct: centre + dx * cos - dy * sin,
    yPct: centre + dx * sin + dy * cos,
  };
}

function viewpointDeltaDeg(
  customPoints: ElementPosition[],
  sourceSideIndex: number,
  targetSideIndex: number,
): number {
  const count = customPoints.length;
  if (count < 3) {
    return 0;
  }
  const safeSource = Math.max(0, Math.min(count - 1, sourceSideIndex));
  const safeTarget = Math.max(0, Math.min(count - 1, targetSideIndex));
  if (safeSource === safeTarget) {
    return 0;
  }
  const sourceMid = edgeMidpointElementPct(customPoints, safeSource);
  const targetMid = edgeMidpointElementPct(customPoints, safeTarget);
  const sourceAngle = viewpointAngleFromCanvasPoint(
    ELEMENT_CENTRE,
    ELEMENT_CENTRE,
    sourceMid.xPct,
    sourceMid.yPct,
  );
  const targetAngle = viewpointAngleFromCanvasPoint(
    ELEMENT_CENTRE,
    ELEMENT_CENTRE,
    targetMid.xPct,
    targetMid.yPct,
  );
  let delta = targetAngle - sourceAngle;
  while (delta > 180) {
    delta -= 360;
  }
  while (delta <= -180) {
    delta += 360;
  }
  return delta;
}

function alignmentRotationDeg(customPoints: ElementPosition[], vertexShift: number): number {
  const count = customPoints.length;
  if (count < 3 || vertexShift === 0) {
    return 0;
  }
  const safeShift = ((vertexShift % count) + count) % count;
  const base = edgeMidpointElementPct(customPoints, 0);
  const shifted = edgeMidpointElementPct(customPoints, safeShift);
  const baseAngle = viewpointAngleFromCanvasPoint(
    ELEMENT_CENTRE,
    ELEMENT_CENTRE,
    base.xPct,
    base.yPct,
  );
  const shiftedAngle = viewpointAngleFromCanvasPoint(
    ELEMENT_CENTRE,
    ELEMENT_CENTRE,
    shifted.xPct,
    shifted.yPct,
  );
  let delta = shiftedAngle - baseAngle;
  while (delta > 180) {
    delta -= 360;
  }
  while (delta <= -180) {
    delta += 360;
  }
  return delta;
}

function transformElementPct(
  point: ElementPosition,
  alignment: ShapeAlignment | null | undefined,
  customPoints: ElementPosition[],
  viewpointDelta: number,
): ElementPosition {
  let next = { ...point };
  if (alignment) {
    next = mirrorElementPct(next, alignment.mirrorMode);
    const alignDeg = alignmentRotationDeg(customPoints, alignment.vertexShift);
    next = rotateElementPct(next, alignDeg);
  }
  return rotateElementPct(next, viewpointDelta);
}

function rotateOverrides(
  overrides: Record<string, CustomShapeSeatPosition> | undefined,
  transform: (point: ElementPosition) => ElementPosition,
): Record<string, CustomShapeSeatPosition> | undefined {
  if (!overrides) {
    return undefined;
  }
  const next: Record<string, CustomShapeSeatPosition> = {};
  for (const [id, pos] of Object.entries(overrides)) {
    next[id] = transform(pos);
  }
  return next;
}

function rotateElementPositions(
  points: ElementPosition[] | undefined,
  transform: (point: ElementPosition) => ElementPosition,
): ElementPosition[] | undefined {
  if (!points) {
    return undefined;
  }
  return points.map((p) => transform(p));
}

function canvasPathToElementPath(
  path: ArrangeByRowPath,
  el: CenterpieceElement,
  canvas: CanvasConfig,
): ArrangeByRowPath {
  return {
    anchor: canvasPctToLocalPoint(el, path.anchor, canvas),
    end: canvasPctToLocalPoint(el, path.end, canvas),
  };
}

function elementPathToCanvasPath(
  path: ArrangeByRowPath,
  el: CenterpieceElement,
  canvas: CanvasConfig,
): ArrangeByRowPath {
  const rect = rectFromPositionSize(el.position, el.size, canvas);
  const toCanvas = (local: ElementPosition): ElementPosition => ({
    xPct: ((rect.x + (local.xPct / 100) * rect.width) / canvas.width) * 100,
    yPct: ((rect.y + (local.yPct / 100) * rect.height) / canvas.height) * 100,
  });
  return {
    anchor: toCanvas(path.anchor),
    end: toCanvas(path.end),
  };
}

function remapCustomSeatBlocks(
  blocks: CustomShapeSeatBlock[] | undefined,
  source: CenterpieceElement,
  target: CenterpieceElement,
  canvas: CanvasConfig,
  sourceCode: string,
  targetCode: string,
  transform: (point: ElementPosition) => ElementPosition,
): CustomShapeSeatBlock[] | undefined {
  if (!blocks) {
    return undefined;
  }
  return blocks.map((block) => {
    const rowLinesElement = block.rowLines?.map((row) =>
      row.map((p) => {
        const asPath = canvasPathToElementPath({ anchor: p, end: p }, source, canvas).anchor;
        return transform(asPath);
      }),
    );
    const rowLinesCanvas = rowLinesElement?.map((row) =>
      row.map((p) => elementPathToCanvasPath({ anchor: p, end: p }, target, canvas).anchor),
    );
    return {
      ...block,
      code: block.code === sourceCode ? targetCode : block.code,
      boundaryPoints: rotateElementPositions(block.boundaryPoints, transform) ?? block.boundaryPoints,
      seatPositionOverrides: rotateOverrides(
        remapOverrides(block.seatPositionOverrides, sourceCode, targetCode),
        transform,
      ),
      rowLines: rowLinesCanvas,
      seatLayout: block.seatLayout
        ? {
            ...block.seatLayout,
            hiddenSeatIds: block.seatLayout.hiddenSeatIds?.map((id) =>
              remapSeatId(id, sourceCode, targetCode),
            ),
          }
        : undefined,
    };
  });
}

export interface RemapSeatingSnapshotOptions {
  snapshot: BlockSeatingConfigSnapshot;
  source: CenterpieceElement;
  target: CenterpieceElement;
  canvas: CanvasConfig;
  sourceSideIndex: number;
  targetSideIndex: number;
  alignment?: ShapeAlignment | null;
}

/** Clone a seating snapshot for a target block with code remap and viewpoint rotation. */
export function remapSeatingSnapshotForTarget(options: RemapSeatingSnapshotOptions): BlockSeatingConfigSnapshot {
  const { snapshot, source, target, canvas, sourceSideIndex, targetSideIndex, alignment } = options;
  const sourceCode = resolveBlockCode(source);
  const targetCode = resolveBlockCode(target);
  const customPoints = target.customPoints ?? source.customPoints ?? [];
  const resolvedAlignment = alignment ?? findShapeAlignmentBetweenBlocks(source, target);
  const viewpointDelta = viewpointDeltaDeg(customPoints, sourceSideIndex, targetSideIndex);
  const transform = (point: ElementPosition) =>
    transformElementPct(point, resolvedAlignment, customPoints, viewpointDelta);

  const cloned: BlockSeatingConfigSnapshot = structuredClone(snapshot);
  cloned.code = targetCode;

  const arrangeRows = cloned.arrangeByRowRows?.map((path) => {
    const elementPath = canvasPathToElementPath(path, source, canvas);
    const rotated = {
      anchor: transform(elementPath.anchor),
      end: transform(elementPath.end),
    };
    return elementPathToCanvasPath(rotated, target, canvas);
  });
  cloned.arrangeByRowRows = arrangeRows;

  const lineRows = cloned.customLineSeatRows?.map((row) =>
    row.map((p) => {
      const local = canvasPctToLocalPoint(source, p, canvas);
      const rotated = transform(local);
      return elementPathToCanvasPath({ anchor: rotated, end: rotated }, target, canvas).anchor;
    }),
  );
  cloned.customLineSeatRows = lineRows;

  cloned.seatPositionOverrides = rotateOverrides(
    remapOverrides(cloned.seatPositionOverrides, sourceCode, targetCode),
    transform,
  );

  if (cloned.seatLayout?.hiddenSeatIds) {
    cloned.seatLayout.hiddenSeatIds = cloned.seatLayout.hiddenSeatIds.map((id) =>
      remapSeatId(id, sourceCode, targetCode),
    );
  }

  cloned.customSeatBlocks = remapCustomSeatBlocks(
    cloned.customSeatBlocks,
    source,
    target,
    canvas,
    sourceCode,
    targetCode,
    transform,
  );

  delete cloned.blockViewpointAngleDeg;
  delete cloned.dragSeatsStadiumSideIndex;

  return cloned;
}
