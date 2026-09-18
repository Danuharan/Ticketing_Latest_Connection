import type { DiningTableShape } from '../models/layout-element.model';

export type DiningLayoutFamily =
  | 'regular-grid'
  | 'staggered'
  | 'central-aisle'
  | 'twin-aisle'
  | 'stage-facing'
  | 'perimeter'
  | 'banquet-open-centre'
  | 'clustered'
  | 'mixed-table'
  | 'service-zone-balanced'
  | 'balanced-around-stage'
  | 'split-sides';

export interface DiningLayoutRules {
  minimumTableToTableClearanceM: number;
  minimumChairToChairClearanceM: number;
  wallClearanceM: number;
  guestAisleWidthM: number;
  mainGuestAisleWidthM: number;
  waiterAisleWidthM: number;
  serviceRouteClearanceM: number;
  entranceClearanceM: number;
  exitClearanceM: number;
  stageClearanceM: number;
  /** Reserved for a later directional Stage-clearance model. */
  stageFrontClearanceM?: number | null;
  stageRearClearanceM?: number | null;
  stageSideClearanceM?: number | null;
  foodPrepClearanceM: number;
  obstacleClearanceM: number;
  maximumOccupancy?: number | null;
}

export const DEFAULT_DINING_LAYOUT_RULES: DiningLayoutRules = {
  minimumTableToTableClearanceM: 0.6,
  minimumChairToChairClearanceM: 0.2,
  wallClearanceM: 0.4,
  guestAisleWidthM: 0.9,
  mainGuestAisleWidthM: 1.2,
  waiterAisleWidthM: 0.8,
  serviceRouteClearanceM: 0.6,
  entranceClearanceM: 1.0,
  exitClearanceM: 1.0,
  stageClearanceM: 0.8,
  foodPrepClearanceM: 0.8,
  obstacleClearanceM: 0.4,
  maximumOccupancy: null,
};

export interface DiningTableCatalogueItem {
  id: string;
  name: string;
  shape: DiningTableShape;
  widthM: number;
  depthM: number;
  capacity: number;
  chairWidthM: number;
  chairDepthM: number;
  allowed: boolean;
}

export interface DiningTableMixTarget {
  catalogueId: string;
  count: number;
}

export interface GenerateDiningLayoutsRequestDto {
  block: {
    id: string;
    polygon: { x: number; y: number }[];
    widthM: number;
    depthM: number;
  };
  accessPoints: {
    entrances: AccessDto[];
    exits: AccessDto[];
    emergencyExits?: AccessDto[];
  };
  features: {
    stage?: RectDto;
    foodPrep?: RectDto;
    obstacles?: { polygon: { x: number; y: number }[] }[];
    exclusionZones?: { polygon: { x: number; y: number }[] }[];
  };
  tableCatalogue: DiningTableCatalogueItem[];
  target: {
    tableCount?: number;
    targetCapacity?: number;
    maximumOccupancy?: number;
    /** Per-shape quota for mixed-shape blocks. Counts must sum to `tableCount`. */
    mix?: DiningTableMixTarget[];
  };
  rules: DiningLayoutRules;
  generation: {
    suggestionCount: number;
    seed: number;
    excludeFingerprints?: string[];
    relocateFeatures?: boolean;
    timeBudgetMs?: number;
    candidateLimit?: number;
    mode?: 'capacity' | 'generate' | 'feasibility';
  };
  stageFacingAngleDeg?: number;
}

interface AccessDto {
  id?: string;
  kind: 'entrance' | 'exit' | 'emergency-exit' | 'shared';
  xM: number;
  yM: number;
  widthM: number;
  depthM: number;
  rotationDeg?: number;
}

interface RectDto {
  xM: number;
  yM: number;
  widthM: number;
  depthM: number;
  rotationDeg?: number;
}

export interface GeneratedDiningLayoutDto {
  id: string;
  name: string;
  family: DiningLayoutFamily;
  score: number;
  capacity: number;
  tableCount: number;
  metrics: {
    capacityEfficiency: number;
    spaceUtilisation: number;
    guestFlow: number;
    serviceEfficiency: number;
    stageOrientation: number;
    symmetry: number;
    distributionQuality: number;
    circulationQuality?: number;
  };
  tables: {
    id: string;
    label: string;
    xPct: number;
    yPct: number;
    shape: DiningTableShape;
    seats: number;
    widthM: number;
    depthM?: number;
    rotationDeg: number;
    catalogueId: string;
  }[];
  fingerprint: string;
  previewSvg: string;
  seed: number;
  stage?: {
    xPct: number;
    yPct: number;
    widthM: number;
    depthM: number;
    rotationDeg?: number;
    sideEdgeId?: number;
  };
  foodPrep?: {
    xPct: number;
    yPct: number;
    widthM: number;
    depthM: number;
    rotationDeg?: number;
    sideEdgeId?: number;
  };
}

export interface GenerateDiningLayoutsResponseDto {
  ok: boolean;
  generatorVersion?: string;
  /** Present only on builds that honour `target.mix`. Absent means a stale deployment. */
  supportsTableMix?: boolean;
  mode?: 'capacity' | 'generate' | 'feasibility';
  maximumTableCount?: number;
  validatedFeasibleTableCount?: number;
  provenMaximumTableCount?: number | null;
  maximumProven?: boolean;
  basicGeometricUpperBound?: number;
  feasible?: boolean | 'unknown';
  layouts: GeneratedDiningLayoutDto[];
  diagnostics?: {
    candidateCount: number;
    validCount: number;
    durationMs: number;
    rejectionReasons: Record<string, number>;
    message?: string;
    hints?: string[];
    requestedTableCount?: number;
    estimatedOperationalMaxTableCount?: number;
    operationalMaxTableCount?: number;
    witnessTableCount?: number;
    witnessValidated?: boolean;
    failureKind?: 'EXACT_FOUND' | 'OPERATIONAL_MAX_BELOW_REQUEST' | 'SEARCH_EXHAUSTED' | 'NOT_FOUND_YET';
    validatedFeasibleTableCount?: number;
    provenMaximumTableCount?: number | null;
    maximumProven?: boolean;
    basicGeometricUpperBound?: number;
    feasible?: boolean | 'unknown';
    generationDebug?: {
      requestedTableCount: number;
      operationalMaxEstimate: number;
      witnessTableCount?: number;
      witnessValidated?: boolean;
      attempts: number;
      exactCandidates: number;
      bestPartialCount: number;
      requestSnapshot: {
        block: {
          widthM: number;
          depthM: number;
          polygonPointCount: number;
        };
        table: {
          shape: DiningTableShape;
          widthM: number;
          depthM: number;
          chairWidthM: number;
          chairDepthM: number;
          clearanceM: number;
        };
        features: {
          stage?: {
            xM: number;
            yM: number;
            widthM: number;
            depthM: number;
            rotationDeg?: number;
          };
          foodPrep?: {
            xM: number;
            yM: number;
            widthM: number;
            depthM: number;
            rotationDeg?: number;
          };
          entranceCount: number;
          exitCount: number;
        };
        seed: number;
      };
      rejectionCounts: {
        boundary: number;
        stage: number;
        foodPrep: number;
        entrance: number;
        exit: number;
        aisle: number;
        collision: number;
        reachability?: number;
      };
      durationMs: number;
      requestedSuggestions?: number;
      rawExactSolutions?: number;
      validExactSolutions?: number;
      excludedByHistory?: number;
      removedNearDuplicates?: number;
      finalSuggestions?: number;
      strategiesAttempted?: string[];
      candidatePool?: {
        rawAttempts: number;
        individuallyValid: number;
        byRegion: Record<string, number>;
        physicalHalfWidthM?: number;
        physicalHalfDepthM?: number;
        pairwiseHalfWidthM?: number;
        pairwiseHalfDepthM?: number;
        footprintHalfWidthM?: number;
        footprintHalfDepthM?: number;
        debugSvg: string;
      };
      capacityDebug?: {
        room: { widthM: number; depthM: number };
        table: {
          diameterM: number;
          physicalHalfWidthM: number;
          physicalHalfDepthM: number;
          pairwiseHalfWidthM: number;
          pairwiseHalfDepthM: number;
          tableGapM: number;
        };
        stage?: {
          widthM: number;
          depthM: number;
          clearanceM: number;
          forbiddenBounds: { minX: number; minY: number; maxX: number; maxY: number };
        };
        wallClearanceM: number;
        candidateCounts: {
          beforeStaticValidation: number;
          afterWall: number;
          afterStage: number;
          afterAccess: number;
          finalPool: number;
        };
          maximumTableCount: number;
          validatedFeasibleCount?: number;
          provenMaximumCount?: number | null;
          maximumProven?: boolean;
          basicGeometricUpperBound?: number;
          physicalExplanation?: {
            tabletopDiameterM: number;
            chairOccupiedDiameterM: number;
            requiredPitchM: number;
            roomWidthM: number;
            roomDepthM: number;
            wallClearanceM: number;
            stageClearanceM: number;
          };
        };
      generatorVersion?: string;
      roomDimensions?: { widthM: number; depthM: number };
      tablePhysicalFootprint?: { halfWidthM: number; halfDepthM: number };
      pairwisePitch?: { xM: number; yM: number };
      staticCandidateCount?: number;
      conflictCount?: number;
      stageRegionCandidateCounts?: Record<string, number>;
      capacity?: {
        basicUpperBound: number;
        validatedFeasibleCount: number;
        maximumProven: boolean;
        provenMaximum: number | null;
        searchStates: number;
        improvementMoves: number;
        repair12?: number;
        repair23?: number;
      };
      generation?: {
        requestedCount: number;
        exactSolutionsFound: number;
        solutionsBeforeDedup: number;
        removedDuplicates: number;
        returnedSuggestions: number;
      };
      timing?: {
        candidateGenerationMs: number;
        conflictBuildMs: number;
        capacitySearchMs: number;
        exactSearchMs: number;
        localOptimisationMs: number;
        totalMs: number;
      };
    };
  };
  error?: string;
  /** True only for network / undeployed function / unexpected HTTP failures. */
  transportFailed?: boolean;
}

export function metricLabel(score: number): 'Good' | 'Fair' | 'Limited' {
  if (score >= 70) {
    return 'Good';
  }
  if (score >= 45) {
    return 'Fair';
  }
  return 'Limited';
}

export const DINING_FAMILY_DISPLAY: Record<DiningLayoutFamily, { name: string; icon: string }> = {
  'regular-grid': { name: 'Compact Dining Layout', icon: '⬜' },
  staggered: { name: 'Staggered Layout', icon: '◈' },
  'central-aisle': { name: 'Central Aisle Layout', icon: '║' },
  'twin-aisle': { name: 'Twin Aisle Layout', icon: '║║' },
  'stage-facing': { name: 'Stage-Facing Layout', icon: '▲' },
  perimeter: { name: 'Perimeter Layout', icon: '◻' },
  'banquet-open-centre': { name: 'Open Centre Layout', icon: '◎' },
  clustered: { name: 'Clustered Layout', icon: '⋯' },
  'mixed-table': { name: 'Mixed Table Layout', icon: '▦' },
  'service-zone-balanced': { name: 'Service Balanced', icon: '⇄' },
  'balanced-around-stage': { name: 'Balanced Around Stage', icon: '✦' },
  'split-sides': { name: 'Split Sides', icon: '↔' },
};
