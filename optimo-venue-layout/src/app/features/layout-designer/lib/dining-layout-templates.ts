import {
  CenterpieceElement,
  DINING_FEATURE_TABLE_CLEARANCE_M,
  DiningFoodPrepareSpec,
  DiningStageSpec,
  DiningTableShape,
  DiningTableSpec,
} from '../models/layout-element.model';
import { PixelRect } from './geometry';
import { polygonCanvasPointsFromBlock } from './block-viewpoint';
import {
  buildDiningEntranceRenderNode,
  buildDiningExitRenderNode,
  buildDiningFoodPrepareRenderNode,
  buildDiningStageRenderNode,
  clampDiningFeatureInsideBlock,
  createDiningExitOnSide,
  createDiningFoodPrepareOnSide,
  createDiningStageOnSide,
  fitDiningFeatureDimsToBlock,
  doDiningFeatureNodesOverlap,
  DINING_FOOD_PREP_FILL,
  DINING_FOOD_PREP_STROKE,
  DINING_STAGE_DISPLAY_LABEL,
  DINING_STAGE_FILL,
  DINING_STAGE_STROKE,
  DINING_ZONE_LABEL_FILL,
  diningFoodPrepIconScale,
  diningFoodPrepIconSvgMarkup,
  diningFoodPrepIconVisible,
  type DiningStageRenderNode,
} from './dining-stage';
import { buildDiningTableChairArcs } from './dining-table-icon';
import { createAutoTableGrid, resolveDiningViewpointAngleDeg, type TableGridOptions } from './dining-tables';
import { pxPerMeter, resolveBlockLengthM, resolveBlockWidthM, resolveChairLengthM, resolveChairWidthM } from './physical-dims';

export type DiningLayoutPattern = 'grid' | 'staggered' | 'banquet';

export interface DiningLayoutDraftInputs {
  shape: DiningTableShape;
  tableWidthM: number;
  tableDepthM: number;
  tableGapM: number;
  seats: number;
  chairWidthM: number;
  chairLengthM: number;
  hasStage: boolean;
  stageWidthM: number;
  stageDepthM: number;
  hasFoodPrep: boolean;
  foodPrepWidthM: number;
  foodPrepDepthM: number;
  hasExit: boolean;
  exitSideEdgeId?: number | null;
  exitOffsetAlongEdgeM?: number;
  tableCount?: number;
  hasServiceRoute: boolean;
  serviceRouteWidthM: number;
  serviceRouteClearanceM: number;
  stageClearanceM?: number;
  foodPrepClearanceM?: number;
  accessClearanceM?: number;
}

export interface DiningLayoutTemplateDescriptor {
  id: string;
  name: string;
  icon: string;
  description: string;
  tableCount: number;
  totalSeats: number;
  template: DiningLayoutPattern;
  stageSide: number | null;
  foodPrepareSide: number | null;
  exitSide: number | null;
  serviceRouteVertical: boolean;
  previewSvg: string;
  stageAlignment?: 'edge' | 'center' | 'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br';
  foodPrepareAlignment?: 'edge' | 'center' | 'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br';
  tableWidthM?: number;
  tableDepthM?: number;
  /** `generated` = Edge Function geometry; `legacy` = 12-recipe fallback. */
  source?: 'generated' | 'legacy';
  family?: string;
  score?: number;
  metrics?: {
    capacityEfficiency: number;
    spaceUtilisation: number;
    guestFlow: number;
    serviceEfficiency: number;
    stageOrientation: number;
  };
  fingerprint?: string;
  seed?: number;
  generatedTables?: DiningTableSpec[];
  generatedStage?: DiningStageSpec;
  generatedFoodPrepare?: DiningFoodPrepareSpec;
}

interface LayoutRecipe {
  id: string;
  name: string;
  icon: string;
  description: string;
  template: DiningLayoutPattern;
  stageSide: number;
  foodPrepareSide: number;
  exitSide: number;
  serviceRouteVertical: boolean;
  stageAlignment?: 'edge' | 'center' | 'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br';
  foodPrepareAlignment?: 'edge' | 'center' | 'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br';
}

/** @deprecated Kept for fallback + saved pattern-a… ids. New suggestions do not iterate this list. */
export const DINING_LAYOUT_RECIPES: LayoutRecipe[] = [
  {
    id: 'pattern-a',
    name: 'Front Stage Grid',
    icon: '⬜',
    description: 'Stage on front edge, food prep on the right, uniform table grid facing the stage.',
    template: 'grid',
    stageSide: 0,
    foodPrepareSide: 1,
    exitSide: 3,
    serviceRouteVertical: true,
    stageAlignment: 'edge',
    foodPrepareAlignment: 'edge',
  },
  {
    id: 'pattern-b',
    name: 'Side Stage Stagger',
    icon: '◈',
    description: 'Stage on the right, food prep at the back, staggered rows for better sightlines.',
    template: 'staggered',
    stageSide: 1,
    foodPrepareSide: 2,
    exitSide: 0,
    serviceRouteVertical: false,
    stageAlignment: 'edge',
    foodPrepareAlignment: 'edge',
  },
  {
    id: 'pattern-c',
    name: 'Perimeter Banquet',
    icon: '◻',
    description: 'Stage at the back, food prep on the left, tables around an open centre space.',
    template: 'banquet',
    stageSide: 2,
    foodPrepareSide: 3,
    exitSide: 1,
    serviceRouteVertical: true,
    stageAlignment: 'edge',
    foodPrepareAlignment: 'edge',
  },
  {
    id: 'pattern-d',
    name: 'Rear Stage Grid',
    icon: '⬔',
    description: 'Stage on the back edge, food prep on the left, uniform table grid.',
    template: 'grid',
    stageSide: 2,
    foodPrepareSide: 3,
    exitSide: 1,
    serviceRouteVertical: true,
    stageAlignment: 'edge',
    foodPrepareAlignment: 'edge',
  },
  {
    id: 'pattern-e',
    name: 'Front Stage Stagger',
    icon: '◆',
    description: 'Stage on the front edge, food prep on the left, staggered rows.',
    template: 'staggered',
    stageSide: 0,
    foodPrepareSide: 3,
    exitSide: 1,
    serviceRouteVertical: false,
    stageAlignment: 'edge',
    foodPrepareAlignment: 'edge',
  },
  {
    id: 'pattern-f',
    name: 'Center Stage Banquet',
    icon: '⧇',
    description: 'Stage in the center of the block, food prep on the right side, tables surrounding.',
    template: 'banquet',
    stageSide: 0,
    foodPrepareSide: 1,
    exitSide: 3,
    serviceRouteVertical: false,
    stageAlignment: 'center',
    foodPrepareAlignment: 'edge',
  },
  {
    id: 'pattern-g',
    name: 'Corner Stage Grid',
    icon: '⬙',
    description: 'Stage in the top-left corner, food prep on the bottom side, grid tables.',
    template: 'grid',
    stageSide: 0,
    foodPrepareSide: 2,
    exitSide: 1,
    serviceRouteVertical: true,
    stageAlignment: 'corner-tl',
    foodPrepareAlignment: 'edge',
  },
  {
    id: 'pattern-h',
    name: 'Center Food Prep Grid',
    icon: '⬲',
    description: 'Stage on the front edge, food prep in the center, tables surrounding.',
    template: 'grid',
    stageSide: 0,
    foodPrepareSide: 2,
    exitSide: 3,
    serviceRouteVertical: true,
    stageAlignment: 'edge',
    foodPrepareAlignment: 'center',
  },
  {
    id: 'pattern-i',
    name: 'Left Stage Grid',
    icon: '◧',
    description: 'Stage on the left edge, food prep at the back, uniform table grid.',
    template: 'grid',
    stageSide: 3,
    foodPrepareSide: 2,
    exitSide: 1,
    serviceRouteVertical: true,
    stageAlignment: 'edge',
    foodPrepareAlignment: 'edge',
  },
  {
    id: 'pattern-j',
    name: 'Right Stage Banquet',
    icon: '◨',
    description: 'Stage on the right, food prep in front, open centre banquet layout.',
    template: 'banquet',
    stageSide: 1,
    foodPrepareSide: 0,
    exitSide: 3,
    serviceRouteVertical: false,
    stageAlignment: 'edge',
    foodPrepareAlignment: 'edge',
  },
  {
    id: 'pattern-k',
    name: 'Rear Stage Stagger',
    icon: '◇',
    description: 'Stage at the back, food prep on the right, staggered table rows.',
    template: 'staggered',
    stageSide: 2,
    foodPrepareSide: 1,
    exitSide: 0,
    serviceRouteVertical: false,
    stageAlignment: 'edge',
    foodPrepareAlignment: 'edge',
  },
  {
    id: 'pattern-l',
    name: 'Corner Stage Stagger',
    icon: '⬘',
    description: 'Stage in the top-right corner, food prep on the left, staggered rows.',
    template: 'staggered',
    stageSide: 0,
    foodPrepareSide: 3,
    exitSide: 2,
    serviceRouteVertical: true,
    stageAlignment: 'corner-tr',
    foodPrepareAlignment: 'edge',
  },
];

/** Max layout cards shown in Step 6 — working patterns only. */
export const MAX_SUGGESTED_DINING_TEMPLATES = 6;

/** Display name for a saved dining layout template id (e.g. pattern-a). */
export function getDiningLayoutTemplateName(templateId: string): string | null {
  if (templateId === 'image-upload') {
    return 'Uploaded floor plan';
  }
  return DINING_LAYOUT_RECIPES.find((recipe) => recipe.id === templateId)?.name ?? null;
}



export interface FeaturePlacement {
  stageSide: number | null;
  foodPrepareSide: number | null;
  exitSide: number | null;
  stageAlignment?: 'edge' | 'center' | 'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br';
  foodPrepareAlignment?: 'edge' | 'center' | 'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br';
}

/** Reject placements where two features share the same edge or overlap geometrically. */
export function isValidFeaturePlacement(
  element: CenterpieceElement,
  rect: PixelRect,
  inputs: DiningLayoutDraftInputs,
  placement: FeaturePlacement,
): boolean {
  const sides: number[] = [];
  if (inputs.hasStage && placement.stageSide != null && (placement.stageAlignment === 'edge' || !placement.stageAlignment)) {
    sides.push(placement.stageSide);
  }
  if (inputs.hasFoodPrep && placement.foodPrepareSide != null && (placement.foodPrepareAlignment === 'edge' || !placement.foodPrepareAlignment)) {
    sides.push(placement.foodPrepareSide);
  }
  if (inputs.exitSideEdgeId !== undefined && inputs.exitSideEdgeId !== null) {
    sides.push(inputs.exitSideEdgeId);
  } else if (inputs.hasExit && placement.exitSide != null) {
    sides.push(placement.exitSide);
  }
  if (new Set(sides).size !== sides.length) {
    return false;
  }

  const preview = buildPreviewElement(element, rect, inputs, placement, false);
  const nodes: DiningStageRenderNode[] = [];
  const stageNode = preview.diningStage
    ? buildDiningStageRenderNode(preview, rect, false)
    : null;
  const foodNode = preview.diningFoodPrepare
    ? buildDiningFoodPrepareRenderNode(preview, rect, false)
    : null;
  if (stageNode) {
    nodes.push(stageNode);
  }
  if (foodNode) {
    nodes.push(foodNode);
  }

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (doDiningFeatureNodesOverlap(nodes[i], nodes[j])) {
        return false;
      }
    }
  }
  return true;
}


function buildPreviewElement(
  base: CenterpieceElement,
  rect: PixelRect,
  inputs: DiningLayoutDraftInputs,
  placement: FeaturePlacement,
  serviceRouteVertical: boolean,
): CenterpieceElement {
  let el: CenterpieceElement = {
    ...base,
    diningStage: undefined,
    diningFoodPrepare: undefined,
    diningEntrance: base.diningEntrance,
    diningExit: undefined,
    diningServiceRoutes: undefined,
    diningTables: undefined,
    chairWidthM: inputs.chairWidthM,
    chairLengthM: inputs.chairLengthM,
    diningServiceRouteClearanceM: inputs.serviceRouteClearanceM ?? DINING_FEATURE_TABLE_CLEARANCE_M,
    diningStageClearanceM: inputs.stageClearanceM,
    diningFoodPrepClearanceM: inputs.foodPrepClearanceM,
    diningAccessClearanceM: inputs.accessClearanceM,
  };

  if (inputs.hasStage && placement.stageSide != null) {
    // Prefer the user's live stage (incl. free rotation) when already placed on the block.
    const liveStage = base.diningStage;
    let stageSpec =
      liveStage &&
      (liveStage.sideEdgeId == null || liveStage.sideEdgeId === placement.stageSide)
        ? { ...liveStage, widthM: inputs.stageWidthM, depthM: inputs.stageDepthM }
        : createDiningStageOnSide(el, rect, placement.stageSide, {
            widthM: inputs.stageWidthM,
            depthM: inputs.stageDepthM,
          });
    if (liveStage?.rotationDeg != null && Number.isFinite(liveStage.rotationDeg) && stageSpec) {
      stageSpec = { ...stageSpec, rotationDeg: liveStage.rotationDeg };
      if (liveStage.xPct != null && liveStage.yPct != null) {
        stageSpec = {
          ...stageSpec,
          xPct: liveStage.xPct,
          yPct: liveStage.yPct,
          alignment: liveStage.alignment ?? stageSpec.alignment,
          offsetAlongEdgeM: liveStage.offsetAlongEdgeM,
          insetFromEdgeM: liveStage.insetFromEdgeM,
        };
      }
    }
    if (stageSpec) {
      const align = placement.stageAlignment ?? stageSpec.alignment ?? 'edge';
      stageSpec.alignment = align;
      if (!liveStage && align === 'center') {
        stageSpec.xPct = 50;
        stageSpec.yPct = 50;
      } else if (!liveStage && align === 'corner-tl') {
        const wPct = (inputs.stageWidthM / resolveBlockWidthM(el)) * 100;
        const dPct = (inputs.stageDepthM / resolveBlockLengthM(el)) * 100;
        stageSpec.xPct = wPct / 2 + 5;
        stageSpec.yPct = dPct / 2 + 5;
      } else if (!liveStage && align === 'corner-tr') {
        const wPct = (inputs.stageWidthM / resolveBlockWidthM(el)) * 100;
        const dPct = (inputs.stageDepthM / resolveBlockLengthM(el)) * 100;
        stageSpec.xPct = 100 - (wPct / 2 + 5);
        stageSpec.yPct = dPct / 2 + 5;
      }
      // Alignment may put AABB % outside an irregular outline — pull fully inside.
      el = {
        ...el,
        diningStage: clampDiningFeatureInsideBlock(el, rect, stageSpec, 'stage'),
      };
    }
  }
  if (inputs.hasFoodPrep && placement.foodPrepareSide != null) {
    const liveFood = base.diningFoodPrepare;
    let foodPrepSpec =
      liveFood &&
      (liveFood.sideEdgeId == null || liveFood.sideEdgeId === placement.foodPrepareSide)
        ? { ...liveFood, widthM: inputs.foodPrepWidthM, depthM: inputs.foodPrepDepthM }
        : createDiningFoodPrepareOnSide(el, rect, placement.foodPrepareSide, {
            widthM: inputs.foodPrepWidthM,
            depthM: inputs.foodPrepDepthM,
          });
    if (liveFood?.rotationDeg != null && Number.isFinite(liveFood.rotationDeg) && foodPrepSpec) {
      foodPrepSpec = { ...foodPrepSpec, rotationDeg: liveFood.rotationDeg };
      if (liveFood.xPct != null && liveFood.yPct != null) {
        foodPrepSpec = {
          ...foodPrepSpec,
          xPct: liveFood.xPct,
          yPct: liveFood.yPct,
          alignment: liveFood.alignment ?? foodPrepSpec.alignment,
          offsetAlongEdgeM: liveFood.offsetAlongEdgeM,
          insetFromEdgeM: liveFood.insetFromEdgeM,
        };
      }
    }
    if (foodPrepSpec) {
      const align = placement.foodPrepareAlignment ?? foodPrepSpec.alignment ?? 'edge';
      foodPrepSpec.alignment = align;
      if (!liveFood && align === 'center') {
        foodPrepSpec.xPct = 50;
        foodPrepSpec.yPct = 50;
      } else if (!liveFood && align === 'corner-tl') {
        const wPct = (inputs.foodPrepWidthM / resolveBlockWidthM(el)) * 100;
        const dPct = (inputs.foodPrepDepthM / resolveBlockLengthM(el)) * 100;
        foodPrepSpec.xPct = wPct / 2 + 5;
        foodPrepSpec.yPct = dPct / 2 + 5;
      } else if (!liveFood && align === 'corner-tr') {
        const wPct = (inputs.foodPrepWidthM / resolveBlockWidthM(el)) * 100;
        const dPct = (inputs.foodPrepDepthM / resolveBlockLengthM(el)) * 100;
        foodPrepSpec.xPct = 100 - (wPct / 2 + 5);
        foodPrepSpec.yPct = dPct / 2 + 5;
      }
      el = {
        ...el,
        diningFoodPrepare: clampDiningFeatureInsideBlock(
          el,
          rect,
          foodPrepSpec,
          'foodprepare',
        ) as typeof foodPrepSpec,
      };
    }
  }
  if (inputs.exitSideEdgeId !== undefined && inputs.exitSideEdgeId !== null) {
    const exitSpec = createDiningExitOnSide(el, rect, inputs.exitSideEdgeId);
    if (exitSpec) {
      if (inputs.exitOffsetAlongEdgeM != null) {
        exitSpec.offsetAlongEdgeM = inputs.exitOffsetAlongEdgeM;
      }
      el = {
        ...el,
        diningExit: exitSpec,
      };
    }
  } else if (inputs.hasExit && placement.exitSide != null) {
    el = {
      ...el,
      diningExit: createDiningExitOnSide(el, rect, placement.exitSide) ?? undefined,
    };
  }
  if (inputs.hasStage && placement.stageSide != null) {
    el = {
      ...el,
      blockViewpointAngleDeg: resolveDiningViewpointAngleDeg(el, rect, placement.stageSide),
    };
  }
  return el;
}

function findEffectiveTableSizeForRecipe(
  element: CenterpieceElement,
  rect: PixelRect,
  inputs: DiningLayoutDraftInputs,
  recipe: LayoutRecipe,
  gridOptions: TableGridOptions,
): { widthM: number; depthM: number; tableCount: number; seats: number } | null {
  const placement: FeaturePlacement = {
    stageSide: inputs.hasStage ? recipe.stageSide : null,
    foodPrepareSide: inputs.hasFoodPrep ? recipe.foodPrepareSide : null,
    exitSide: (inputs.exitSideEdgeId !== undefined && inputs.exitSideEdgeId !== null)
      ? inputs.exitSideEdgeId
      : (inputs.hasExit ? recipe.exitSide : null),
    stageAlignment: recipe.stageAlignment,
    foodPrepareAlignment: recipe.foodPrepareAlignment,
  };
  if (!isValidFeaturePlacement(element, rect, inputs, placement)) {
    return null;
  }
  const preview = buildPreviewElement(element, rect, inputs, placement, recipe.serviceRouteVertical);

  // Exact counts from wizard Steps 4 + 5.
  const targetCount = Math.max(1, Math.round(gridOptions.tableCount ?? 0));
  const seats = Math.max(1, Math.round(gridOptions.seats));
  if (targetCount < 1) {
    return null;
  }

  let currentWidth = gridOptions.widthM;
  let currentDepth = gridOptions.depthM;

  // Try each recipe with the user's counts. Shrink table size only when needed
  // so as many layout patterns as possible can still place the exact count.
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const result = createAutoTableGrid(preview, rect, {
      ...gridOptions,
      widthM: currentWidth,
      depthM: currentDepth,
      seats,
      tableCount: targetCount,
      template: recipe.template,
    });
    if (!('error' in result)) {
      const count = result.diningTables?.length ?? 0;
      const seatsOnTables = result.diningTables?.[0]?.seats ?? seats;
      if (count === targetCount && seatsOnTables === seats) {
        return {
          widthM: currentWidth,
          depthM: currentDepth,
          tableCount: targetCount,
          seats,
        };
      }
    }
    currentWidth *= 0.94;
    currentDepth *= 0.94;
    if (currentWidth < 0.45 || (gridOptions.shape === 'rectangular' && currentDepth < 0.45)) {
      break;
    }
  }
  return null;
}

function countTablesForRecipe(
  element: CenterpieceElement,
  rect: PixelRect,
  inputs: DiningLayoutDraftInputs,
  recipe: LayoutRecipe,
  gridOptions: TableGridOptions,
): number {
  const res = findEffectiveTableSizeForRecipe(element, rect, inputs, recipe, gridOptions);
  return res ? res.tableCount : 0;
}

function buildPreviewSvg(
  element: CenterpieceElement,
  rect: PixelRect,
  inputs: DiningLayoutDraftInputs,
  recipe: LayoutRecipe,
  gridOptions: TableGridOptions,
): string {
  const placement: FeaturePlacement = {
    stageSide: inputs.hasStage ? recipe.stageSide : null,
    foodPrepareSide: inputs.hasFoodPrep ? recipe.foodPrepareSide : null,
    exitSide: (inputs.exitSideEdgeId !== undefined && inputs.exitSideEdgeId !== null)
      ? inputs.exitSideEdgeId
      : (inputs.hasExit ? recipe.exitSide : null),
    stageAlignment: recipe.stageAlignment,
    foodPrepareAlignment: recipe.foodPrepareAlignment,
  };
  const sizeRes = findEffectiveTableSizeForRecipe(element, rect, inputs, recipe, gridOptions);
  const effectiveWidth = sizeRes ? sizeRes.widthM : gridOptions.widthM;
  const effectiveDepth = sizeRes ? sizeRes.depthM : gridOptions.depthM;
  const exactCount = sizeRes?.tableCount ?? gridOptions.tableCount;
  const exactSeats = sizeRes?.seats ?? gridOptions.seats;

  const preview = buildPreviewElement(element, rect, inputs, placement, recipe.serviceRouteVertical);
  const gridResult = createAutoTableGrid(preview, rect, {
    ...gridOptions,
    widthM: effectiveWidth,
    depthM: effectiveDepth,
    seats: exactSeats,
    tableCount: exactCount,
    template: recipe.template,
  });
  const tables = 'error' in gridResult ? [] : (gridResult.diningTables ?? []);
  const previewWithTables: CenterpieceElement = {
    ...preview,
    diningTables: tables,
    chairWidthM: inputs.chairWidthM,
    chairLengthM: inputs.chairLengthM,
  };

  const stageNode = previewWithTables.diningStage
    ? buildDiningStageRenderNode(previewWithTables, rect, false)
    : null;
  const foodNode = previewWithTables.diningFoodPrepare
    ? buildDiningFoodPrepareRenderNode(previewWithTables, rect, false)
    : null;
  const exitNode = previewWithTables.diningExit
    ? buildDiningExitRenderNode(previewWithTables, rect, false)
    : null;
  const entranceNode = previewWithTables.diningEntrance
    ? buildDiningEntranceRenderNode(previewWithTables, rect, false)
    : null;

  const polygon = polygonCanvasPointsFromBlock(element.customPoints ?? [], rect);
  const VB_W = 160;
  const VB_H = 120;
  const pad = 5;
  const xs = polygon.length >= 3 ? polygon.map((p) => p.x) : [rect.x, rect.x + rect.width];
  const ys = polygon.length >= 3 ? polygon.map((p) => p.y) : [rect.y, rect.y + rect.height];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((VB_W - pad * 2) / spanX, (VB_H - pad * 2) / spanY);
  const ox = pad + ((VB_W - pad * 2) - spanX * scale) / 2;
  const oy = pad + ((VB_H - pad * 2) - spanY * scale) / 2;
  const toSvg = (x: number, y: number) => ({
    x: ox + (x - minX) * scale,
    y: oy + (y - minY) * scale,
  });
  const s = (px: number) => Math.max(0.4, px * scale);

  const parts: string[] = [];
  parts.push(
    `<svg viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">`,
    `<rect x="0" y="0" width="${VB_W}" height="${VB_H}" fill="#f1f5f9"/>`,
  );

  // Selected block outline (actual custom shape).
  if (polygon.length >= 3) {
    const polyPts = polygon
      .map((p) => {
        const c = toSvg(p.x, p.y);
        return `${c.x.toFixed(2)},${c.y.toFixed(2)}`;
      })
      .join(' ');
    parts.push(
      `<polygon points="${polyPts}" fill="#dbeafe" stroke="#2563eb" stroke-width="1.6" stroke-linejoin="round"/>`,
    );
  } else {
    const a = toSvg(rect.x, rect.y);
    const b = toSvg(rect.x + rect.width, rect.y + rect.height);
    parts.push(
      `<rect x="${a.x.toFixed(1)}" y="${a.y.toFixed(1)}" width="${(b.x - a.x).toFixed(1)}" height="${(b.y - a.y).toFixed(1)}" fill="#dbeafe" stroke="#2563eb" stroke-width="1.6" rx="1"/>`,
    );
  }

  const drawFeature = (
    node: DiningStageRenderNode,
    fill: string,
    stroke: string,
    label: string,
    textFill = DINING_ZONE_LABEL_FILL,
  ): void => {
    const c = toSvg(node.x, node.y);
    const w = s(node.widthPx);
    const h = s(node.heightPx);
    const fontSize = Math.max(2.2, Math.min(4.4, Math.min(w, h) * 0.28));
    parts.push(
      `<g transform="translate(${c.x.toFixed(2)},${c.y.toFixed(2)}) rotate(${node.rotationDeg.toFixed(1)})">`,
      `<rect x="${(-w / 2).toFixed(2)}" y="${(-h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="0.6" fill="${fill}" stroke="${stroke}" stroke-width="0.55"/>`,
      `<text x="0" y="${(fontSize * 0.35).toFixed(2)}" text-anchor="middle" fill="${textFill}" font-size="${fontSize.toFixed(2)}" font-family="sans-serif" font-weight="600">${label}</text>`,
      `</g>`,
    );
  };

  if (stageNode) {
    drawFeature(stageNode, DINING_STAGE_FILL, DINING_STAGE_STROKE, DINING_STAGE_DISPLAY_LABEL);
  }
  if (foodNode) {
    const c = toSvg(foodNode.x, foodNode.y);
    const w = s(foodNode.widthPx);
    const h = s(foodNode.heightPx);
    parts.push(
      `<g transform="translate(${c.x.toFixed(2)},${c.y.toFixed(2)}) rotate(${foodNode.rotationDeg.toFixed(1)})">`,
      `<rect x="${(-w / 2).toFixed(2)}" y="${(-h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="0.6" fill="${DINING_FOOD_PREP_FILL}" stroke="${DINING_FOOD_PREP_STROKE}" stroke-width="0.55"/>`,
    );
    if (diningFoodPrepIconVisible(foodNode.widthPx, foodNode.heightPx)) {
      const iconScale = diningFoodPrepIconScale(foodNode.widthPx, foodNode.heightPx) * scale;
      parts.push(
        `<g transform="rotate(${(-foodNode.rotationDeg).toFixed(1)})">`,
        diningFoodPrepIconSvgMarkup(DINING_FOOD_PREP_STROKE, iconScale),
        `</g>`,
      );
    }
    parts.push(`</g>`);
  }
  if (entranceNode) {
    drawFeature(entranceNode, '#bbf7d0', '#15803d', 'IN', '#15803d');
  }
  if (exitNode) {
    drawFeature(exitNode, '#fecaca', '#b91c1c', 'OUT', '#b91c1c');
  }

  const ppm = pxPerMeter(rect, resolveBlockLengthM(previewWithTables), resolveBlockWidthM(previewWithTables));
  const chairSizePx = {
    widthPx: resolveChairWidthM(previewWithTables) * ppm,
    depthPx: resolveChairLengthM(previewWithTables) * ppm,
  };
  for (const table of tables) {
    const canvasX = rect.x + (table.xPct / 100) * rect.width;
    const canvasY = rect.y + (table.yPct / 100) * rect.height;
    const c = toSvg(canvasX, canvasY);
    const widthPx = Math.max(4, table.widthM * ppm);
    const depthM = table.shape === 'rectangular' ? (table.depthM ?? table.widthM) : table.widthM;
    const heightPx = Math.max(4, depthM * ppm);
    const icon = buildDiningTableChairArcs(
      table.shape,
      widthPx,
      heightPx,
      table.seats,
      undefined,
      undefined,
      chairSizePx,
    );
    const rot = table.rotationDeg ?? 0;
    const tw = s(widthPx);
    const th = s(heightPx);
    const chairHw = Math.max(0.35, s(icon.chairHalfWidthPx));
    const chairHd = Math.max(0.35, s(icon.chairHalfDepthPx));

    parts.push(`<g transform="translate(${c.x.toFixed(2)},${c.y.toFixed(2)}) rotate(${rot.toFixed(1)})">`);
    if (table.shape === 'rectangular') {
      parts.push(
        `<rect x="${(-tw / 2).toFixed(2)}" y="${(-th / 2).toFixed(2)}" width="${tw.toFixed(2)}" height="${th.toFixed(2)}" rx="${Math.min(1.2, Math.min(tw, th) * 0.12).toFixed(2)}" fill="#ffffff" stroke="#3b82f6" stroke-width="0.7"/>`,
      );
    } else {
      parts.push(
        `<circle cx="0" cy="0" r="${(tw / 2).toFixed(2)}" fill="#ffffff" stroke="#3b82f6" stroke-width="0.7"/>`,
      );
    }
    for (const chair of icon.chairArcs) {
      const cx = chair.x * scale;
      const cy = chair.y * scale;
      parts.push(
        `<ellipse cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" rx="${chairHw.toFixed(2)}" ry="${chairHd.toFixed(2)}" transform="rotate(${chair.rotationDeg.toFixed(1)} ${cx.toFixed(2)} ${cy.toFixed(2)})" fill="#e2e8f0" stroke="#334155" stroke-width="0.35"/>`,
      );
    }
    parts.push(`</g>`);
  }

  parts.push('</svg>');
  return parts.join('');
}

/**
 * Prefer different table patterns (grid / staggered / banquet), then fill up to max.
 */
export function selectDiverseDiningTemplates(
  templates: DiningLayoutTemplateDescriptor[],
  max: number = MAX_SUGGESTED_DINING_TEMPLATES,
): DiningLayoutTemplateDescriptor[] {
  if (templates.length <= max) {
    return templates;
  }
  const order: DiningLayoutPattern[] = ['grid', 'staggered', 'banquet'];
  const buckets = new Map<DiningLayoutPattern, DiningLayoutTemplateDescriptor[]>();
  for (const pattern of order) {
    buckets.set(pattern, []);
  }
  for (const tmpl of templates) {
    const list = buckets.get(tmpl.template) ?? [];
    list.push(tmpl);
    buckets.set(tmpl.template, list);
  }

  const selected: DiningLayoutTemplateDescriptor[] = [];
  const used = new Set<string>();

  // Round-robin so cards stay visually different.
  let progressed = true;
  while (selected.length < max && progressed) {
    progressed = false;
    for (const pattern of order) {
      if (selected.length >= max) {
        break;
      }
      const next = (buckets.get(pattern) ?? []).find((t) => !used.has(t.id));
      if (next) {
        selected.push(next);
        used.add(next.id);
        progressed = true;
      }
    }
  }
  return selected;
}

/**
 * Apply Edge Function table geometry as-is. Do not reconstruct from a recipe id.
 * Anchored Stage / Food Prep on the block are never moved — only tables change.
 */
export function applyGeneratedDiningLayoutPatch(
  element: CenterpieceElement,
  rect: PixelRect,
  inputs: DiningLayoutDraftInputs,
  tmpl: DiningLayoutTemplateDescriptor,
): Partial<CenterpieceElement> | null {
  const tables = tmpl.generatedTables;
  if (!tables?.length) {
    return null;
  }
  return {
    chairWidthM: inputs.chairWidthM,
    chairLengthM: inputs.chairLengthM,
    defaultTableSeats: inputs.seats,
    defaultDiningTableShape: inputs.shape,
    defaultTableWidthM: inputs.tableWidthM,
    defaultTableDepthM: inputs.tableDepthM,
    defaultTableGapM: inputs.tableGapM,
    diningServiceRouteClearanceM:
      inputs.serviceRouteClearanceM ?? DINING_FEATURE_TABLE_CLEARANCE_M,
    diningStageClearanceM: inputs.stageClearanceM,
    diningFoodPrepClearanceM: inputs.foodPrepClearanceM,
    diningAccessClearanceM: inputs.accessClearanceM,
    diningTables: tables.map((t) => ({ ...t })),
    ...diningFeaturesPatchFromDraft(element, rect, inputs, {
      stage: tmpl.generatedStage,
      foodPrepare: tmpl.generatedFoodPrepare,
    }),
    diningLayoutGeneration: {
      family: tmpl.family ?? 'regular-grid',
      score: tmpl.score ?? 0,
      seed: tmpl.seed ?? 0,
      fingerprint: tmpl.fingerprint ?? '',
    },
  };
}

/**
 * Place or keep Stage / Food Prep from wizard drafts so generation and preview match.
 * User-placed features on the canvas are anchored and always win over generator output.
 */
export function diningFeaturesPatchFromDraft(
  element: CenterpieceElement,
  rect: PixelRect,
  inputs: DiningLayoutDraftInputs,
  generated?: { stage?: DiningStageSpec; foodPrepare?: DiningFoodPrepareSpec },
): Pick<CenterpieceElement, 'diningStage' | 'diningFoodPrepare' | 'blockViewpointAngleDeg'> {
  const stageSide = element.diningStage?.sideEdgeId ?? 0;
  const foodPrepareSide =
    element.diningFoodPrepare?.sideEdgeId ?? (stageSide === 0 ? 2 : 0);

  let diningStage: DiningStageSpec | undefined;
  if (inputs.hasStage) {
    if (element.diningStage) {
      const fitted = fitDiningFeatureDimsToBlock(
        element,
        rect,
        { widthM: inputs.stageWidthM, depthM: inputs.stageDepthM },
        element.diningStage.sideEdgeId,
      );
      // Anchored: keep the user's canvas position; only shrink footprint to the block.
      diningStage = {
        ...element.diningStage,
        widthM: fitted.widthM,
        depthM: fitted.depthM,
      };
    } else if (generated?.stage) {
      diningStage = clampDiningFeatureInsideBlock(
        element,
        rect,
        { ...generated.stage },
        'stage',
      );
    } else {
      diningStage =
        createDiningStageOnSide(element, rect, stageSide, {
          widthM: inputs.stageWidthM,
          depthM: inputs.stageDepthM,
        }) ?? undefined;
    }
  }

  let diningFoodPrepare: DiningFoodPrepareSpec | undefined;
  if (inputs.hasFoodPrep) {
    if (element.diningFoodPrepare) {
      const fitted = fitDiningFeatureDimsToBlock(
        element,
        rect,
        { widthM: inputs.foodPrepWidthM, depthM: inputs.foodPrepDepthM },
        element.diningFoodPrepare.sideEdgeId,
      );
      diningFoodPrepare = {
        ...element.diningFoodPrepare,
        widthM: fitted.widthM,
        depthM: fitted.depthM,
      };
    } else if (generated?.foodPrepare) {
      diningFoodPrepare = clampDiningFeatureInsideBlock(
        element,
        rect,
        { ...generated.foodPrepare },
        'foodprepare',
      ) as DiningFoodPrepareSpec;
    } else {
      diningFoodPrepare =
        createDiningFoodPrepareOnSide(element, rect, foodPrepareSide, {
          widthM: inputs.foodPrepWidthM,
          depthM: inputs.foodPrepDepthM,
        }) ?? undefined;
    }
  }

  return {
    diningStage,
    diningFoodPrepare,
    blockViewpointAngleDeg: diningStage
      ? resolveDiningViewpointAngleDeg(element, rect, diningStage.sideEdgeId)
      : element.blockViewpointAngleDeg,
  };
}

/**
 * Build the exact centerpiece patch used for canvas preview / Fix Layout.
 * Same path as generation — so every listed card can preview.
 */
export function buildDiningLayoutPatchFromTemplate(
  element: CenterpieceElement,
  rect: PixelRect,
  inputs: DiningLayoutDraftInputs,
  tmpl: DiningLayoutTemplateDescriptor,
): Partial<CenterpieceElement> | null {
  if (tmpl.source === 'generated' && tmpl.generatedTables?.length) {
    return applyGeneratedDiningLayoutPatch(element, rect, inputs, tmpl);
  }
  const placement: FeaturePlacement = {
    stageSide: tmpl.stageSide,
    foodPrepareSide: tmpl.foodPrepareSide,
    exitSide: tmpl.exitSide,
    stageAlignment: tmpl.stageAlignment,
    foodPrepareAlignment: tmpl.foodPrepareAlignment,
  };
  if (!isValidFeaturePlacement(element, rect, inputs, placement)) {
    return null;
  }

  const preview = buildPreviewElement(
    element,
    rect,
    inputs,
    placement,
    tmpl.serviceRouteVertical,
  );
  const widthM = tmpl.tableWidthM ?? inputs.tableWidthM;
  const depthM = tmpl.tableDepthM ?? inputs.tableDepthM;
  const seats = Math.max(1, Math.round(inputs.seats));
  const tableCount = Math.max(1, Math.round(tmpl.tableCount));

  const result = createAutoTableGrid(preview, rect, {
    shape: inputs.shape,
    seats,
    widthM,
    depthM,
    gapM: inputs.tableGapM,
    tableCount,
    template: tmpl.template,
  });
  if ('error' in result) {
    return null;
  }
  if ((result.diningTables?.length ?? 0) !== tableCount) {
    return null;
  }

  return {
    chairWidthM: inputs.chairWidthM,
    chairLengthM: inputs.chairLengthM,
    defaultTableSeats: seats,
    defaultDiningTableShape: inputs.shape,
    defaultTableWidthM: widthM,
    defaultTableDepthM: depthM,
    defaultTableGapM: inputs.tableGapM,
    diningServiceRouteClearanceM: inputs.serviceRouteClearanceM ?? DINING_FEATURE_TABLE_CLEARANCE_M,
    diningStageClearanceM: inputs.stageClearanceM,
    diningFoodPrepClearanceM: inputs.foodPrepClearanceM,
    diningAccessClearanceM: inputs.accessClearanceM,
    diningStage: preview.diningStage,
    diningFoodPrepare: preview.diningFoodPrepare,
    diningEntrance: preview.diningEntrance,
    diningExit: preview.diningExit,
    diningServiceRoutes: undefined,
    blockViewpointAngleDeg: preview.blockViewpointAngleDeg,
    ...result,
  };
}

/**
 * @deprecated Isolated 12-recipe generator. Do not call from the dining wizard
 * normal path — use `DiningLayoutSuggestionService` (Edge Function) instead.
 */
export function generateLegacyDiningLayouts(
  element: CenterpieceElement,
  rect: PixelRect,
  inputs: DiningLayoutDraftInputs,
): DiningLayoutTemplateDescriptor[] {
  const gridOptions: TableGridOptions = {
    shape: inputs.shape,
    seats: inputs.seats,
    widthM: inputs.tableWidthM,
    depthM: inputs.tableDepthM,
    gapM: inputs.tableGapM,
    tableCount: inputs.tableCount,
  };

  const templates: DiningLayoutTemplateDescriptor[] = [];

  for (const recipe of DINING_LAYOUT_RECIPES) {
    const placement: FeaturePlacement = {
      stageSide: inputs.hasStage ? recipe.stageSide : null,
      foodPrepareSide: inputs.hasFoodPrep ? recipe.foodPrepareSide : null,
      exitSide: (inputs.exitSideEdgeId !== undefined && inputs.exitSideEdgeId !== null)
        ? inputs.exitSideEdgeId
        : (inputs.hasExit ? recipe.exitSide : null),
      stageAlignment: recipe.stageAlignment,
      foodPrepareAlignment: recipe.foodPrepareAlignment,
    };
    if (!isValidFeaturePlacement(element, rect, inputs, placement)) {
      continue;
    }

    const sizeRes = findEffectiveTableSizeForRecipe(element, rect, inputs, recipe, {
      ...gridOptions,
      template: recipe.template,
    });
    if (!sizeRes) {
      continue;
    }

    const candidate: DiningLayoutTemplateDescriptor = {
      id: recipe.id,
      name: recipe.name,
      icon: recipe.icon,
      description: recipe.description,
      tableCount: sizeRes.tableCount,
      totalSeats: sizeRes.tableCount * sizeRes.seats,
      template: recipe.template,
      stageSide: placement.stageSide,
      foodPrepareSide: placement.foodPrepareSide,
      exitSide: placement.exitSide,
      serviceRouteVertical: recipe.serviceRouteVertical,
      stageAlignment: recipe.stageAlignment,
      foodPrepareAlignment: recipe.foodPrepareAlignment,
      tableWidthM: sizeRes.widthM,
      tableDepthM: sizeRes.depthM,
      source: 'legacy',
      previewSvg: '',
    };

    // Drop anything that cannot actually place — never show a broken card.
    const patch = buildDiningLayoutPatchFromTemplate(element, rect, inputs, candidate);
    if (!patch) {
      continue;
    }

    candidate.previewSvg = buildPreviewSvg(element, rect, inputs, recipe, {
      ...gridOptions,
      seats: sizeRes.seats,
      tableCount: sizeRes.tableCount,
      widthM: sizeRes.widthM,
      depthM: sizeRes.depthM,
      template: recipe.template,
    });
    templates.push(candidate);
  }

  return selectDiverseDiningTemplates(templates, MAX_SUGGESTED_DINING_TEMPLATES);
}
