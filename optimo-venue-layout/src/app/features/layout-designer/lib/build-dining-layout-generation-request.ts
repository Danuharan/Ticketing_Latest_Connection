import type { CenterpieceElement } from '../models/layout-element.model';
import {
  DEFAULT_DINING_LAYOUT_RULES,
  type DiningTableCatalogueItem,
  type GenerateDiningLayoutsRequestDto,
} from '../models/dining-layout-generation.model';
import { resolveDiningViewpointAngleDeg } from './dining-tables';
import type { PixelRect } from './geometry';
import { resolveBlockLengthM, resolveBlockWidthM } from './physical-dims';
import { DINING_LAYOUT_ENGINE } from './dining-layout-engine.flag';
import type { TableCategoryTemplate } from '../models/table-category-template.model';
import {
  createDiningFoodPrepareOnSide,
  createDiningStageOnSide,
  resolveDiningFeatureRotationDeg,
} from './dining-stage';

/** One shape lane of a mixed-shape block. */
export interface DiningGenerationMixEntry {
  shape: 'round' | 'rectangular';
  tableWidthM: number;
  tableDepthM: number;
  seats: number;
  chairWidthM: number;
  chairLengthM: number;
  count: number;
}

export function diningMixCatalogueId(shape: string): string {
  return `wizard-mix-${shape}`;
}

export interface DiningGenerationDraft {
  shape: 'round' | 'rectangular';
  tableWidthM: number;
  tableDepthM: number;
  tableGapM: number;
  seats: number;
  chairWidthM: number;
  chairLengthM: number;
  tableCount: number;
  /** When present the block mixes shapes and every lane is generated together. */
  mix?: DiningGenerationMixEntry[];
  hasStage: boolean;
  hasFoodPrep: boolean;
  stageWidthM?: number;
  stageDepthM?: number;
  stageSide?: number;
  foodPrepWidthM?: number;
  foodPrepDepthM?: number;
  foodPrepSide?: number;
  /** Keep-out from Stage edge to dining unit (m). */
  stageClearanceM?: number;
  /** Keep-out from Food Prep edge to dining unit (m). */
  foodPrepClearanceM?: number;
  /** Keep-out from Entry/Exit to dining unit (m). */
  accessClearanceM?: number;
  /** Keep-out from service route centre-line to dining unit (m). */
  serviceRouteClearanceM?: number;
  wallClearanceM?: number;
}

export function buildDiningLayoutGenerationRequest(args: {
  element: CenterpieceElement;
  rect: PixelRect;
  draft: DiningGenerationDraft;
  seed: number;
  excludeFingerprints: string[];
  categories: TableCategoryTemplate[];
  selectedCategoryId: string;
  relocateFeatures?: boolean;
  mode?: 'capacity' | 'generate' | 'feasibility';
  timeBudgetMs?: number;
}): GenerateDiningLayoutsRequestDto {
  const { element, rect, draft } = args;
  const widthM = resolveBlockWidthM(element);
  const depthM = resolveBlockLengthM(element);
  const pts = element.customPoints ?? [];
  const polygon =
    pts.length >= 3
      ? pts.map((p) => ({ x: (p.xPct / 100) * widthM, y: (p.yPct / 100) * depthM }))
      : [
          { x: 0, y: 0 },
          { x: widthM, y: 0 },
          { x: widthM, y: depthM },
          { x: 0, y: depthM },
        ];

  const pctToM = (xPct: number, yPct: number) => ({
    xM: (xPct / 100) * widthM,
    yM: (yPct / 100) * depthM,
  });

  const mixLanes = (draft.mix ?? []).filter((lane) => lane.count > 0);
  const catalogue: DiningTableCatalogueItem[] = [];
  if (mixLanes.length > 0) {
    for (const lane of mixLanes) {
      catalogue.push({
        id: diningMixCatalogueId(lane.shape),
        name: `${lane.shape === 'round' ? 'Round' : 'Rectangular'} table`,
        shape: lane.shape,
        widthM: lane.tableWidthM,
        depthM: lane.shape === 'round' ? lane.tableWidthM : lane.tableDepthM,
        capacity: lane.seats,
        chairWidthM: lane.chairWidthM,
        chairDepthM: lane.chairLengthM,
        allowed: true,
      });
    }
  } else {
    catalogue.push({
      id: 'wizard-current',
      name: 'Current table',
      shape: draft.shape,
      widthM: draft.tableWidthM,
      depthM: draft.tableDepthM,
      capacity: draft.seats,
      chairWidthM: draft.chairWidthM,
      chairDepthM: draft.chairLengthM,
      allowed: true,
    });
  }
  const selected = args.categories.find((c) => c.id === args.selectedCategoryId);
  if (selected) {
    catalogue.push({
      id: selected.id,
      name: selected.name,
      shape: selected.shape,
      widthM: selected.tableWidthM,
      depthM: selected.tableDepthM,
      capacity: selected.tableSeats,
      chairWidthM: selected.chairWidthM,
      chairDepthM: selected.chairLengthM,
      allowed: false,
    });
  }
  for (const cat of args.categories) {
    if (catalogue.some((c) => c.id === cat.id)) {
      continue;
    }
    catalogue.push({
      id: cat.id,
      name: cat.name,
      shape: cat.shape,
      widthM: cat.tableWidthM,
      depthM: cat.tableDepthM,
      capacity: cat.tableSeats,
      chairWidthM: cat.chairWidthM,
      chairDepthM: cat.chairLengthM,
      allowed: false,
    });
  }

  const stageSpec =
    draft.hasStage
      ? (element.diningStage ??
        createDiningStageOnSide(element, rect, draft.stageSide ?? 0, {
          widthM: draft.stageWidthM,
          depthM: draft.stageDepthM,
        }))
      : null;
  const foodPrepSpec =
    draft.hasFoodPrep
      ? (element.diningFoodPrepare ??
        createDiningFoodPrepareOnSide(element, rect, draft.foodPrepSide ?? 2, {
          widthM: draft.foodPrepWidthM,
          depthM: draft.foodPrepDepthM,
        }))
      : null;

  const stage = stageSpec
    ? {
        ...pctToM(stageSpec.xPct, stageSpec.yPct),
        widthM: stageSpec.widthM,
        depthM: stageSpec.depthM,
        rotationDeg: resolveDiningFeatureRotationDeg(element, rect, stageSpec),
      }
    : undefined;
  const foodPrep = foodPrepSpec
    ? {
        ...pctToM(foodPrepSpec.xPct, foodPrepSpec.yPct),
        widthM: foodPrepSpec.widthM,
        depthM: foodPrepSpec.depthM,
        rotationDeg: resolveDiningFeatureRotationDeg(element, rect, foodPrepSpec),
      }
    : undefined;

  const entrance = element.diningSharedAccessPoint ?? element.diningEntrance;
  const exit = element.diningSharedAccessPoint ?? element.diningExit;

  const clampClearance = (value: number | undefined, fallback: number): number =>
    Math.max(0, Number.isFinite(value) ? (value as number) : fallback);

  const accessClearance = clampClearance(
    draft.accessClearanceM,
    DEFAULT_DINING_LAYOUT_RULES.entranceClearanceM,
  );

  const rules = {
    ...DEFAULT_DINING_LAYOUT_RULES,
    minimumTableToTableClearanceM: Math.max(0.1, draft.tableGapM),
    stageClearanceM: clampClearance(draft.stageClearanceM, DEFAULT_DINING_LAYOUT_RULES.stageClearanceM),
    foodPrepClearanceM: clampClearance(
      draft.foodPrepClearanceM,
      DEFAULT_DINING_LAYOUT_RULES.foodPrepClearanceM,
    ),
    entranceClearanceM: accessClearance,
    exitClearanceM: accessClearance,
    serviceRouteClearanceM: clampClearance(
      draft.serviceRouteClearanceM,
      DEFAULT_DINING_LAYOUT_RULES.serviceRouteClearanceM,
    ),
    wallClearanceM: clampClearance(draft.wallClearanceM, DEFAULT_DINING_LAYOUT_RULES.wallClearanceM),
  };

  return {
    block: { id: element.id, polygon, widthM, depthM },
    accessPoints: {
      entrances: entrance
        ? [
            {
              id: entrance.id,
              kind: 'entrance',
              ...pctToM(entrance.xPct, entrance.yPct),
              widthM: entrance.widthM,
              depthM: entrance.depthM ?? 0.4,
            },
          ]
        : [],
      exits: exit
        ? [
            {
              id: exit.id,
              kind: 'exit',
              ...pctToM(exit.xPct, exit.yPct),
              widthM: exit.widthM,
              depthM: exit.depthM ?? 0.4,
            },
          ]
        : [],
    },
    features: { stage, foodPrep },
    tableCatalogue: catalogue,
    target:
      args.mode === 'capacity'
        ? {}
        : mixLanes.length > 0
          ? {
              tableCount: mixLanes.reduce((sum, lane) => sum + lane.count, 0),
              targetCapacity: mixLanes.reduce((sum, lane) => sum + lane.count * lane.seats, 0),
              mix: mixLanes.map((lane) => ({
                catalogueId: diningMixCatalogueId(lane.shape),
                count: lane.count,
              })),
            }
          : {
              tableCount: draft.tableCount,
              targetCapacity: draft.tableCount * draft.seats,
            },
    rules,
    generation: {
      suggestionCount: args.mode === 'capacity' ? 1 : DINING_LAYOUT_ENGINE.suggestionCount,
      seed: args.seed,
      excludeFingerprints: args.excludeFingerprints,
      relocateFeatures: args.relocateFeatures || undefined,
      mode: args.mode,
      timeBudgetMs: args.timeBudgetMs ?? (args.mode === 'capacity' ? 2500 : 2800),
    },
    stageFacingAngleDeg: resolveDiningViewpointAngleDeg(element, rect, stageSpec?.sideEdgeId),
  };
}
