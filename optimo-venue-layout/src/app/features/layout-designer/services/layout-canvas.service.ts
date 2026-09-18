import { computed, DestroyRef, inject, Injectable, NgZone, signal } from '@angular/core';

import { VenueLayoutConfig, ReferenceImageConfig } from '../../../core/models/venue-layout-config.model';
import {
  extractSeatingSnapshot,
  extractDiningSnapshot,
  extractGaSnapshot,
  seatingSnapshotToPatch,
  diningSnapshotToPatch,
  gaSnapshotToPatch,
} from './block-config-template.service';
import { blockTypeHasCustomizationFlow, blockTypeHasGaFlow, blockTypeUsesSideLabelConfigureUi, BlockTypeId } from '../models/block-type.model';
import { BlockDiningConfigSnapshot, BlockGaConfigSnapshot, BlockSeatingConfigSnapshot } from '../models/block-config-template.model';
import { createElement, createCustomPieceFromPoints, createParkingAreaFromPoints, createBlockGrid } from '../data/element-factory';
import { blueprintBlockStyle } from '../lib/cv-to-layout';
import { findOcrLabelForTracedBlock, type OcrToken } from '../lib/assign-ocr-labels';
import { canvasPointToReferencePct, referenceImageDrawRect } from '../lib/canvas-image';
import { dataUrlToFile } from '../lib/detect-blocks';
import type { PointPct } from '../lib/contour-geometry';
import { BlueprintAnalyzerService } from './blueprint-analyzer.service';
import {
  buildQuickCustomShapeOutline,
  canvasPctToLocalPoint,
  canvasPxToPct,
  localPointsToAbsolute,
  renormalizeFromCanvasPoints,
} from '../lib/custom-shape';
import { classifyBlockShape } from '../lib/classify-block-shape';
import {
  hydrateBlockGridFromGeometry,
  hydrateCenterpieceFromGeometry,
  syncBlockGridGeometry,
  syncCenterpieceGeometry,
} from '../lib/block-shape-geometry';
import { PixelRect, rectFromPositionSize } from '../lib/geometry';
import {
  addIndependentCustomShapeSeats,
  addCustomShapeSeatAtPoint,
  addSeatRowFromLine,
  applySeatLayoutWithCapacity,
  createEmptyCustomShapeSeating,
  createSeatBlockFromDrawnZone,
  getCustomShapeVisibleSeatCount,
  resolveCustomShapeSeatPitchPx,
  pointInPolygon,
  recalcSeatPitchOnDimChange,
  regenerateBlockSeats,
  removeCustomShapeSeat,
  updateLineSeatRowCount,
  updateSeatOverride,
  type PhysicalDimsInput,
} from '../lib/custom-shape-seats';
import {
  buildParkingOutlinePoints,
  computeParkingPxPerMeter,
  relaxParkingPolygonToLengths,
  MAX_EDGE_BOW_RATIO,
} from '../lib/parking-shape';
import { nextParkingLaneLetter, planParkingSlots, type ParkingSlotPattern, type SlotRect } from '../lib/parking-slots';
import { ParkingSlotDefaultsService } from './parking-slot-defaults.service';
import {
  blockMetresFromSideLengths,
  pxPerMeter,
  resolveBlockLengthM,
  resolveBlockWidthM,
  resolveChairLengthM,
  resolveChairWidthM,
  resolveRowGapM,
  resolveSeatGapM,
} from '../lib/physical-dims';
import { chairScalesFromSeatPitch, SEAT_GRAPHIC_SIZE } from '../lib/chair-seat-icon';
import {
  beginArrangeByRowAnchor,
  enableArrangeByRowSeating,
  expandArrangeByRowRow,
  expandArrangeByRowLastSeat,
  isArrangeByRowElement,
} from '../lib/arrange-by-row';
import {
  buildBlockMeasureEdges,
  countMeasuredLogicalEdges,
  findLogicalEdgeContainingSource,
  logicalMeasureEdgeById,
  stadiumLogicalEdgeFromView,
  uniqueLogicalEdgesById,
  resolveViewpointLogicalEdges,
} from '../lib/block-measure-edges';
import {
  edgeSegment,
  polygonCanvasPointsFromBlock,
  clampViewpointDistance,
  DEFAULT_VIEWPOINT_ANGLE_DEG,
  defaultViewpointDistance,
  minViewpointDistance,
  stadiumSideIndexFromViewDirection,
  viewpointAngleFromCanvasPoint,
  viewpointPositionFromAngle,
} from '../lib/block-viewpoint';
import {
  findSimilarSeatingBlockCandidates,
  type SimilarBlockCandidate,
} from '../lib/block-shape-match';
import { regenerateSeatingOnTarget } from '../lib/bulk-seating-regenerate';
import {
  inferGroundViewpointForBlock,
  resolveGroundFocalPoint,
  type GroundFocalPoint,
} from '../lib/infer-ground-viewpoint';
import {
  defaultLabelOffsetOutsideViewpoint,
  hasCustomLabelOffset,
} from '../lib/block-label';
import {
  enableDragFillSeats,
  expandDragFillAtCanvasPoint,
  expandDragFillRowToCanvasPoint,
  isDragFillSeatsElement,
  placeDragFillSeedSeat,
  removeDragFillSeat,
} from '../lib/drag-fill-seats';
import {
  createArrangeByRowGridSeating,
  deriveBlockDimsFromSides,
  estimateArrangeByRowCapacity,
  type ArrangeByRowBlueprintScale,
  createDragSeatsSeating,
  estimateDefaultSideLengthsM,
  expandDragSeatsToCanvasPoint,
  fillDragSeatsFullShape,
  isDragSeatsElement,
  resolveSeatFacingDegForShapeSeats,
  resolveSeatStartSide,
  stadiumSideLabel,
  updateDragSeatsFirstRowSeatCount,
  updateDragSeatsSpacing,
  updateDragSeatsSeatGap,
  type SeatStartSide,
} from '../lib/drag-seats';
import { collectAdjacentBlocks } from '../lib/row-seat-align';
import {
  addTableAtPoint,
  computeMaxFillTableCount,
  createAutoTableGrid,
  createTableCountGrid,
  deleteTable,
  findTableGapViolation,
  formatTableGapViolationMessage,
  moveTableToPoint,
  removeAllTables,
  resolveDefaultTableDepthM,
  resolveDefaultTableGapM,
  resolveDefaultTableSeats,
  resolveDefaultTableShape,
  resolveDefaultTableWidthM,
  resolveDiningViewpointAngleDeg,
  updateTable,
  type TableCountGridOptions,
  type TableGridOptions,
} from '../lib/dining-tables';
import { DINING_LAYOUT_RECIPES } from '../lib/dining-layout-templates';
import {
  diningBackgroundImageFromFit,
  type DiningBackgroundClipSource,
  type DiningBackgroundFit,
} from '../lib/dining-background-image';

import {
  createDiningStageOnSide,
  moveStageToPoint,
  reorientDiningStageToSide,
  stageSideLabel,
  syncStageSpecFromMetrics,
  syncStageSpecFromPosition,
  createDiningFoodPrepareOnSide,
  reorientDiningFoodPrepareToSide,
  moveFoodPrepareToPoint,
  createDiningExitOnSide,
  resizeDiningFeatureFromCanvasPointer,
  type DiningFeatureResizeHandle,
  resolveDiningAccessPointAtCanvasPoint,
  diningAccessEdgeHitThresholdPx,
  diningAccessEdgeLengthM,
  clampDiningAccessPointToEdge,
  clampDiningFeatureInsideBlock,
  normalizeDiningFeatureRotationDeg,
  cloneAccessPointAsKind,
  getStageEdgeFrame,
  projectToEdge,
  type DiningAccessPointPlacementPreview,
} from '../lib/dining-stage';
import {
  addServiceRouteFromCanvasPoints,
  deleteServiceRoute,
  removeAllServiceRoutes,
} from '../lib/dining-service-routes';
import {
  DiningAccessMode,
  DiningAccessPointKind,
  DiningAccessPointSpec,
  DiningStageSpec,
  DiningFoodPrepareSpec,
  DiningExitSpec,
  MIN_DINING_ACCESS_WIDTH_M,
  resolveDiningAccessWidthM,
} from '../models/layout-element.model';
import { getDiningTableCount } from '../models/layout-element.model';
import { createDefineByRowColumnSeating } from '../lib/define-by-row-column';
import {
  computeImportSeatingPlan,
  type ImportSeatingPlan,
} from '../lib/import-seating';
import { normalizeBlockCode, type SeatingImportRow } from '../lib/parse-seating-import-file';
import { visibleSeatCount } from '../lib/sector-seat-layout';
import { ElementTypeId } from '../models/element-type.model';
import type { SeatingChartSpec } from '../models/seating-spec.model';
import type { DiningTableChartSpec } from '../models/dining-spec.model';
import {
  autoFillAislesEqual,
  autoFillSeatingPatchIsNoop,
  DEFAULT_AUTO_FILL_SEATING_CONFIG,
  normalizeAutoFillAisles,
  type AutoFillAisleSlot,
  type AutoFillBatchResult,
  type AutoFillSeatingConfig,
} from '../models/auto-fill-seating.model';
import { isCompleteDrawnAisle } from '../lib/drawn-aisle';
import {
  applyAutoFillCurveToSeatLayout,
  applyAutoFillToBlock,
  AUTO_FILL_ANIMATION_MAX_FRAMES,
  bakeAutoFillSeatPositions,
  buildAutoFillAnimationSteps,
  clampAutoFillCurveDeg,
  isAutoFillEligibleBlock,
  resolveCreateAutoFillCurveDeg,
  resolveEffectiveAutoFillCurveDeg,
  type AutoFillAnimationStep,
} from '../lib/auto-fill-seating';
import {
  applySideLengthDeltasM,
  computeBlockMeasurementScaleFactor,
  computeSideLengthDeltasM,
  scaleSideLengthsM,
} from '../lib/auto-fill-measurements';
import {
  findStadiumGroundCenterpiece,
  resolveViewpointAngleTowardGround,
} from '../lib/stadium-ground';
import {
  getRowGapExtraM,
  getSeatGapExtraM,
  getSeatLayoutRowSeatCounts,
  getSeatLayoutSpec,
  hasSeatSpacingAdjustments,
  MAX_GAP_EXTRA_M,
  parseSeatGapExtraKey,
  seatGapExtraKey,
} from '../lib/block-seat-layout';
import { mirrorSeatNumbering, roundGapM } from '../lib/seat-spacing';

/** Row-gap edit scope: the selected row pair only, or every row pair in the block. */
export type SeatRowGapScope = 'row' | 'all';
/** Seat-gap edit scope: one pair, every pair in that row, or every pair in the block. */
export type SeatPairGapScope = 'pair' | 'row' | 'all';
import {
  BlockGridShapeId,
  CanvasConfig,
  CenterpieceElement,
  CustomShapeSeatBlock,
  DEFAULT_CANVAS,
  DEFAULT_TABLE_DEPTH_M,
  DEFAULT_TABLE_GAP_M,
  DEFAULT_TABLE_SEATS,
  DEFAULT_TABLE_WIDTH_M,
  DiningLayoutReferenceImage,
  ElementPosition,
  LayoutElement,
  SeatLayoutSpec,
  LayerRingElement,
  SelectedRingBlock,
  hasSeats,
  isCenterpiece,
  isCustomizableBlock,
  isCustomShapeSeatingEnabled,
  isParkingArea,
  hasTracedBlockOutline,
  ParkingAccessPointSpec,
  ParkingRouteSpec,
  ParkingSlotSpec,
  ParkingVehicleType,
} from '../models/layout-element.model';

const MAX_HISTORY = 50;
/** Maximum zoom % while editing a block inside the customization workspace. */
const BLOCK_WORKSPACE_MAX_ZOOM = 800;
/** Overview click-to-read seats may zoom this far so chairs are a readable size. */
const OVERVIEW_SEAT_READABLE_MAX_ZOOM = 800;
/** Target on-screen chair size (px) when clicking a seating block. */
const TARGET_CHAIR_SCREEN_PX = 18;
const DEFAULT_BLOCK_FILL_COLOR = '#e2e8f0';

/** Normalize fill colours so #abc and #aabbcc match the same block group. */
export function normalizeBlockFillColor(color: string | undefined): string {
  const raw = (color ?? DEFAULT_BLOCK_FILL_COLOR).trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/.exec(raw);
  if (short) {
    const [r, g, b] = short[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return raw;
}
/** Sentinel drawingElementId while placing a brand-new parking area's outline. */
export const PARKING_AREA_DRAFT_ID = '__draft-parking__';

export type ParkingWorkspaceStepId = 'draw-area' | 'measure-edges' | 'draw-lines' | 'save';

/** Transient canvas highlight driven by the blueprint audit panel. */
export type AuditHighlight =
  | { kind: 'elements'; ids: string[] }
  | {
      kind: 'region';
      rect: { x: number; y: number; width: number; height: number };
      label?: string;
    };

/** Per-block outcome of a bulk seating file import. */
export interface SeatingImportReportEntry {
  blockCode: string;
  status: 'filled' | 'not-found' | 'error' | 'skipped';
  message?: string;
  seats?: number;
  rows?: number;
}

/**
 * Raised mid-import when a block cannot fit the documented seats per row.
 * The user chooses: continue (fill what fits), skip the block, or stop the import.
 */
export interface SeatingImportConflict {
  blockCode: string;
  /** e.g. "9 rows fit fewer seats than the document asks (A: 12/16, …)" */
  detail: string;
  /** Seats that would be placed if the user continues. */
  placeableSeats: number;
  /** Seats the document asked for. */
  requestedSeats: number;
  /** Rows that fit fewer seats than requested. */
  shortfallRows: { row: string; placed: number; requested: number }[];
  /** Position of this block in the sweep (1-based) and the sweep size. */
  index: number;
  total: number;
}

export type SeatingImportConflictDecision = 'continue' | 'continue-all' | 'skip' | 'stop';

export type BlockWorkspaceStepId = 'block-type' | 'viewpoint' | 'configure' | 'edit' | 'save';

/** Summary of a remote block whose measurements were synced from the workspace reference block. */
export interface WorkspaceMeasurementSyncEntry {
  blockId: string;
  blockName: string;
  sides: { label: string; lengthM: number }[];
}

export const BLOCK_WORKSPACE_STEPS: { id: BlockWorkspaceStepId; number: number; label: string }[] = [
  { id: 'block-type', number: 1, label: 'Select block type' },
  { id: 'viewpoint', number: 2, label: 'Set VIEW POINT' },
  { id: 'configure', number: 3, label: 'Configure block' },
  { id: 'edit', number: 4, label: 'Edit block' },
  { id: 'save', number: 5, label: 'Save' },
];

export interface BlockWorkspaceProgress {
  /** @deprecated Use customizationFlow — kept for stepper compatibility */
  seatingFlow: boolean;
  customizationFlow: boolean;
  activeStep: BlockWorkspaceStepId;
  completed: Record<BlockWorkspaceStepId, boolean>;
  canGoBack: boolean;
  backLabel: string;
  backTarget: BlockWorkspaceStepId | null;
}

export interface BulkApplySeatingPrompt {
  sourceId: string;
  sourceLabel: string;
  sourceTierLabel: string;
  configId: string;
  configName: string;
  snapshot: BlockSeatingConfigSnapshot;
  candidates: SimilarBlockCandidate[];
}

function isCurveOnlyBlockPatch(
  patch: Omit<Partial<CustomShapeSeatBlock>, 'seatLayout'> & { seatLayout?: Partial<SeatLayoutSpec> },
): boolean {
  const blockKeys = Object.keys(patch).filter(
    (key) => key !== 'seatLayout' && patch[key as keyof CustomShapeSeatBlock] !== undefined,
  );
  if (blockKeys.length > 0) {
    return false;
  }
  const layout = patch.seatLayout;
  if (!layout) {
    return false;
  }
  const layoutKeys = Object.keys(layout).filter(
    (key) => layout[key as keyof SeatLayoutSpec] !== undefined,
  );
  return layoutKeys.length === 1 && layoutKeys[0] === 'rowCurveDegs';
}

/**
 * Holds the live layout (elements + selection) using signals, plus a simple
 * undo/redo history. Mutations either "commit" (push history) or run "silent"
 * (used during an active drag so we don't flood history with intermediate steps).
 */
@Injectable({ providedIn: 'root' })
export class LayoutCanvasService {
  private readonly blueprintAnalyzer = inject(BlueprintAnalyzerService);
  private readonly parkingSlotDefaults = inject(ParkingSlotDefaultsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);
  private ocrEnsureInflight: Promise<void> | null = null;

  private readonly canvasState = signal<CanvasConfig>({ ...DEFAULT_CANVAS });
  readonly canvas = this.canvasState.asReadonly();

  readonly elements = signal<LayoutElement[]>([]);
  readonly selectedId = signal<string | null>(null);
  /** All selected element ids (supports marquee multi-select). */
  readonly selectedIds = signal<string[]>([]);

  /** Master seating configuration shared across Auto Fill batch operations. */
  readonly autoFillSeatingConfig = signal<AutoFillSeatingConfig>({
    ...DEFAULT_AUTO_FILL_SEATING_CONFIG,
  });
  readonly autoFillLastResult = signal<AutoFillBatchResult | null>(null);
  readonly autoFillError = signal<string | null>(null);
  /** True when the user entered Auto Fill from block configure — 2D layout selection mode. */
  readonly autoFillLayoutMode = signal(false);
  /** True while seats are being placed row-by-row for visual feedback. */
  readonly autoFillAnimating = signal(false);
  /** Other blocks updated after reference block measurement sync — shown in configure UI. */
  readonly workspaceMeasurementSyncInfo = signal<WorkspaceMeasurementSyncEntry[]>([]);

  private autoFillAnimationToken = 0;
  /** Coalesce Auto Fill settings → workspace-block writes to one frame. */
  private autoFillSpacingSyncRaf: number | null = null;
  private pendingAutoFillSpacingPatch: Partial<AutoFillSeatingConfig> | null = null;
  /** Seating state captured before Auto Fill creates seats — restored on Exit Auto Fill mode. */
  private autoFillLayoutRevertSnapshots = new Map<
    string,
    BlockSeatingConfigSnapshot & {
      interactiveSeatingLocked?: boolean;
      borderGapM?: number;
      seatFacingDeg?: number;
    }
  >();

  /** Selected custom polygon blocks eligible for geometry-based Auto Fill. */
  readonly selectedAutoFillBlocks = computed(() => {
    const idSet = new Set(this.selectedIds());
    return this.elements()
      .filter((el): el is CenterpieceElement => el.type === 'centerpiece' && idSet.has(el.id))
      .filter(isAutoFillEligibleBlock);
  });

  /** Fill colour of the last block deselected in Auto Fill layout mode. */
  readonly autoFillColorDeselectHint = signal<string | null>(null);

  readonly autoFillSameColorSelectedCount = computed(() => {
    const hint = this.autoFillColorDeselectHint();
    if (!hint) {
      return 0;
    }
    return this.selectedAutoFillBlocks().filter(
      (block) => this.blockFillColorKey(block) === hint,
    ).length;
  });

  readonly showAutoFillSameColorDeselect = computed(
    () =>
      this.autoFillLayoutMode() &&
      this.autoFillColorDeselectHint() != null &&
      this.autoFillSameColorSelectedCount() > 0,
  );

  /** Sector block selected inside a layer ring (canvas + inspector). */
  readonly selectedRingBlock = signal<SelectedRingBlock | null>(null);
  readonly referenceImage = signal<ReferenceImageConfig | null>(null);

  /** When true, clicking the blueprint flood-fills a coloured region into a 2D block. */
  readonly colorDetectMode = signal(false);
  readonly colorDetectTolerance = signal(48);
  /**
   * Expected block area (canvas px) for the next trace click — set by the
   * audit Fix flow so the flood fill can reunite label-split fragments.
   */
  readonly traceTargetRect = signal<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  /** Cached OCR from blueprint upload / AI analysis — used to name manually traced blocks. */
  readonly referenceOcrTokens = signal<OcrToken[]>([]);

  /**
   * Venue scale calibration — metres per canvas pixel, set by the user from
   * one reference block ("this block is really 12 m wide"). When set, CSV
   * measurements map to true on-screen sizes for the whole venue.
   */
  readonly venueMetresPerPx = signal<number | null>(null);
  /** Reference info shown in the UI, e.g. "Block 23 = 12 m". */
  readonly venueScaleReference = signal<string | null>(null);

  /** Side being calibrated — highlighted on the canvas while the user types. */
  readonly venueScaleEdgePick = signal<{ elementId: string; edgeId: number } | null>(null);

  private venueScaleEdges(el: CenterpieceElement): ReturnType<typeof buildBlockMeasureEdges> {
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const points =
      (el.customPoints?.length ?? 0) >= 3
        ? (el.customPoints as ElementPosition[])
        : [
            { xPct: 0, yPct: 0 },
            { xPct: 100, yPct: 0 },
            { xPct: 100, yPct: 100 },
            { xPct: 0, yPct: 100 },
          ];
    return buildBlockMeasureEdges(polygonCanvasPointsFromBlock(points, rect));
  }

  /** Selectable sides of a block for scale calibration. */
  venueScaleSideOptions(elementId: string): { id: number; label: string; lengthPx: number }[] {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return [];
    }
    return this.venueScaleEdges(el).map((edge) => ({
      id: edge.id,
      label: edge.label,
      lengthPx: edge.lengthPx,
    }));
  }

  /** Calibrate the venue scale: the chosen side of the block is `realLengthM` metres. */
  setVenueScaleFromEdge(elementId: string, edgeId: number, realLengthM: number): boolean {
    const el = this.getCenterpiece(elementId);
    if (!el || realLengthM <= 0) {
      return false;
    }
    const edge = this.venueScaleEdges(el).find((item) => item.id === edgeId);
    if (!edge || edge.lengthPx <= 0) {
      return false;
    }
    this.venueMetresPerPx.set(realLengthM / edge.lengthPx);
    const label = el.label?.trim() || el.name?.trim() || 'block';
    this.venueScaleReference.set(`${label} · ${edge.label} = ${realLengthM} m`);
    this.venueScaleEdgePick.set(null);
    return true;
  }

  clearVenueScale(): void {
    this.venueMetresPerPx.set(null);
    this.venueScaleReference.set(null);
    this.venueScaleEdgePick.set(null);
  }

  // View state (not part of undo history).
  readonly zoom = signal(100);
  /** Camera centre in canvas pixel coordinates — drives the infinite pan/zoom view. */
  readonly cameraX = signal(DEFAULT_CANVAS.width / 2);
  readonly cameraY = signal(DEFAULT_CANVAS.height / 2);
  /** Live CSS size of the stage viewport, published by the canvas stage component. */
  readonly viewportPx = signal<{ width: number; height: number }>({ width: 0, height: 0 });

  private blockCounter = 0;
  private parkingIdCounter = 0;

  private nextParkingId(prefix: string): string {
    this.parkingIdCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.parkingIdCounter.toString(36)}`;
  }

  /** When set, the canvas is in custom-piece point-drawing mode for this id. */
  readonly drawingElementId = signal<string | null>(null);
  readonly draftPoints = signal<ElementPosition[]>([]);
  /** Parking area draft only: per-segment bow ratio, one entry per already-placed segment
   *  (index i = edge from draftPoints[i] to draftPoints[i+1]). Lets the user bow an edge
   *  while still drawing, before the shape is closed. */
  readonly draftEdgeBowAmounts = signal<number[]>([]);

  /** Drawn seat rows locked on canvas, waiting for dimension inputs. */
  readonly pendingSeatRow = signal<{ elementId: string; rowLines: ElementPosition[][] } | null>(null);
  /** Preview block depth (m) while pending zone is locked — drives canvas overlay. */
  readonly pendingBlockPreviewLengthM = signal(10);
  readonly pendingBlockPreviewWidthM = signal(8);

  /** Custom seat row line drawing inside a custom piece. */
  readonly seatRowDrawingElementId = signal<string | null>(null);
  readonly seatRowDraftPoints = signal<ElementPosition[]>([]);
  /** Completed row lines while drawing a block (canvas %). */
  readonly seatRowDraftRows = signal<ElementPosition[][]>([]);

  /** Single-line seat placement along a drawn path (custom line seat tool). */
  readonly lineSeatDrawingElementId = signal<string | null>(null);
  readonly lineSeatDraftPoints = signal<ElementPosition[]>([]);

  /** Click-to-place one table at a time inside a custom piece. */
  readonly tablePlacementElementId = signal<string | null>(null);
  /**
   * Draft table category / size used while placing one-by-one.
   * Kept off the element so typing in the sidebar does not rewrite centerpiece
   * state (which recreates the inspector DOM and jumps the page scroll).
   */
  readonly tablePlacementDefaults = signal<{
    shape: 'round' | 'rectangular';
    seats: number;
    widthM: number;
    depthM: number;
    gapM: number;
    chairWidthM: number;
    chairLengthM: number;
  } | null>(null);
  readonly accessPointPlacementElementId = signal<string | null>(null);
  readonly accessPointPlacementKind = signal<DiningAccessPointKind>('exit');
  /** Live dashed access-point ghost while the pointer moves during placement. */
  readonly accessPointPlacementPreview = signal<DiningAccessPointPlacementPreview | null>(null);
  /** Helper shown in the inspector while placement is active. */
  readonly accessPointPlacementHint = signal<string | null>(null);
  /** When true, dining access points cannot be moved (after wizard step 2). */
  readonly diningAccessPointsLocked = signal(false);
  /**
   * Coalesce spinner/typing width edits into one undo step.
   * Cleared on blur / commitAccessWidthEdit().
   */
  private accessWidthHistoryOpen = false;
  /** @deprecated Use accessPointPlacementElementId. */
  get exitPlacementElementId() {
    return this.accessPointPlacementElementId;
  }
  /** @deprecated Use accessPointPlacementPreview. */
  get exitPlacementPreview() {
    return this.accessPointPlacementPreview;
  }
  /** Selected dining table inside a custom-shape block. */
  readonly selectedTableId = signal<string | null>(null);
  readonly selectedTableIds = signal<string[]>([]);
  readonly diningStageSelected = signal(false);
  readonly stageSidePickElementId = signal<string | null>(null);
  readonly stageSidePickReorient = signal(false);
  readonly diningFoodPrepareSelected = signal(false);
  readonly foodPrepareSidePickElementId = signal<string | null>(null);
  readonly foodPrepareSidePickReorient = signal(false);
  readonly serviceRouteDrawingElementId = signal<string | null>(null);
  readonly serviceRouteDraftPoints = signal<ElementPosition[]>([]);
  readonly selectedServiceRouteId = signal<string | null>(null);

  readonly serviceRouteTableGenPending = signal<boolean>(false);
  readonly serviceRouteTableGenClearance = signal<number>(1.0);
  readonly serviceRouteTableGenType = signal<'count' | 'grid' | null>(null);
  readonly serviceRouteTableGenOptions = signal<any | null>(null);

  /** Click-to-place one seat at a time inside a custom piece. */
  readonly perSeatPlacementElementId = signal<string | null>(null);

  /** Two-click draw-aisle session on the workspace seating block. */
  readonly drawAisleSession = signal<{
    aisleId: string;
    blockId: string;
    pendingStart?: { xPct: number; yPct: number };
  } | null>(null);

  /** Drag-and-fill seats tool — double-click seed, drag row then rows. */
  readonly dragFillSeatsElementId = signal<string | null>(null);

  /** Anchor + drag to extend seat columns along a row. */
  readonly arrangeByRowElementId = signal<string | null>(null);
  readonly arrangeByRowRowIndex = signal<number | null>(null);
  readonly arrangeByRowAnchor = signal<ElementPosition | null>(null);
  readonly arrangeByRowDragging = signal(false);
  /** Wizard: measure sides → enter rows/seats → place grid. */
  readonly arrangeByRowWizardPhase = signal<'idle' | 'measure' | 'layout'>('idle');
  /** Logical side ids clicked but not yet confirmed (click order). */
  readonly arrangeByRowPendingSideIds = signal<number[]>([]);
  readonly arrangeByRowMeasuredSides = signal<boolean[]>([]);
  readonly arrangeByRowDraftSideLengthsM = signal<number[]>([]);
  readonly arrangeByRowDraftSideNames = signal<string[]>([]);
  readonly arrangeByRowWizardError = signal<string | null>(null);
  readonly autoDiningSpecError = signal<string | null>(null);
  /** Manual table arrange: tables closer than the configured table gap. */
  readonly tableGapRuleAlert = signal<string | null>(null);
  /** Why side-measure mode is active (block workspace setup vs arrange-by-row tool). */
  readonly blockMeasureContext = signal<'none' | 'workspace-setup' | 'arrange-by-row'>('none');
  /** Block workspace: all logical sides have metre lengths saved on the element. */
  readonly blockWorkspaceSidesConfigured = signal(false);
  /**
   * Seating / dining: user left configure (measurements + path choice) and entered
   * Step 4 edit tools ("Add seats/tables by editing block").
   */
  readonly blockWorkspaceSeatingEditMode = signal(false);

  readonly isArrangeByRowMeasureMode = computed(
    () =>
      this.arrangeByRowWizardPhase() === 'measure' && Boolean(this.arrangeByRowElementId()),
  );

  readonly isBlockWorkspaceMeasureSetup = computed(
    () =>
      this.blockMeasureContext() === 'workspace-setup' && this.isArrangeByRowMeasureMode(),
  );

  /** Selected seat inside a custom-shape block (seat id string). */
  readonly selectedSeatId = signal<string | null>(null);
  /** Element that owns the selected seat — seat ids repeat across blocks (every block has an "A1"). */
  readonly selectedSeatElementId = signal<string | null>(null);
  /** Selected row inside a custom-shape block for row-wise curve editing. */
  readonly selectedCustomRow = signal<{ blockId: string; rowIndex: number } | null>(null);

  /** When set, the designer is in single-block customization mode. */
  readonly blockWorkspaceId = signal<string | null>(null);
  readonly blockWorkspaceElement = computed(() => {
    const id = this.blockWorkspaceId();
    if (!id) {
      return null;
    }
    const el = this.elements().find((item) => item.id === id);
    return el && isCustomizableBlock(el) ? el : null;
  });

  private blockWorkspaceReturnView: {
    zoom: number;
    cameraX: number;
    cameraY: number;
  } | null = null;

  /** When set, the designer is in the Parking Workspace (draw area → measure edges → add lines → save). */
  readonly parkingWorkspaceId = signal<string | null>(null);
  readonly parkingWorkspaceStep = signal<ParkingWorkspaceStepId>('draw-area');
  readonly parkingWorkspaceElement = computed(() => {
    const id = this.parkingWorkspaceId();
    if (!id) {
      return null;
    }
    const el = this.elements().find((item) => item.id === id);
    return el && isParkingArea(el) ? el : null;
  });
  private parkingWorkspaceReturnView: {
    zoom: number;
    cameraX: number;
    cameraY: number;
  } | null = null;

  /** Which raw edge of the parking outline is selected for length entry (yellow on canvas). */
  readonly parkingMeasureEdgeIndex = signal<number | null>(null);

  /**
   * Large-template seat hydration: outline first (blocks only), then progressive seat graphics.
   * Avoids freezing the main thread when opening stadium layouts with 10k+ seats.
   */
  readonly seatHydrationPhase = signal<'complete' | 'outline' | 'progressive'>('complete');
  readonly seatRenderBudget = signal(Number.MAX_SAFE_INTEGER);
  readonly seatHydrationTotal = signal(0);
  /** True when seats fill in after leaving a block — do not cover the canvas with a loading overlay. */
  readonly seatHydrationSilent = signal(false);
  private seatHydrationRaf = 0;
  private seatHydrationTimer: ReturnType<typeof setTimeout> | 0 = 0;
  private seatHydrationWorker: Worker | null = null;
  private seatHydrationBusy = false;
  private seatHydrationVisibilityBound = false;
  readonly seatHydrationProgress = computed(() => {
    const total = this.seatHydrationTotal();
    if (total <= 0 || this.seatHydrationPhase() === 'complete') {
      return null;
    }
    return {
      loaded: Math.min(this.seatRenderBudget(), total),
      total,
    };
  });

  beginSeatHydration(totalSeats: number, options?: { silent?: boolean }): void {
    const total = Math.max(0, totalSeats);
    this.seatHydrationSilent.set(options?.silent === true);
    if (total <= 0) {
      this.completeSeatHydration();
      return;
    }
    this.seatHydrationTotal.set(total);
    this.seatRenderBudget.set(0);
    this.seatHydrationPhase.set('outline');
    this.ensureHydrationVisibilityListener();
    this.scheduleSeatHydrationLoop();
  }

  /** Adds more seats to the render budget; returns true when the budget covers every seat. */
  advanceSeatHydration(increment: number): boolean {
    const total = this.seatHydrationTotal();
    if (total <= 0 || this.seatHydrationPhase() === 'complete') {
      return true;
    }
    const next = Math.min(this.seatRenderBudget() + Math.max(0, increment), total);
    this.seatRenderBudget.set(next);
    this.seatHydrationPhase.set(next > 0 ? 'progressive' : 'outline');
    return next >= total;
  }

  completeSeatHydration(): void {
    this.stopSeatHydrationLoop();
    this.seatHydrationSilent.set(false);
    this.seatHydrationPhase.set('complete');
    this.seatRenderBudget.set(Number.MAX_SAFE_INTEGER);
    this.seatHydrationTotal.set(0);
  }

  /**
   * Hydrate in painted batches so the counter matches chairs appearing on the
   * canvas. A Worker clock keeps ticking in background tabs (rAF pauses there).
   * Never dump the remaining 10k+ seats in one step — that finishes the numbers
   * first and only then paints chairs.
   */
  private scheduleSeatHydrationLoop(): void {
    this.stopSeatHydrationLoop();
    this.seatHydrationBusy = false;
    const tick = (): void => {
      if (this.seatHydrationBusy || this.seatHydrationPhase() === 'complete') {
        return;
      }
      this.seatHydrationBusy = true;
      const total = Math.max(1, this.seatHydrationTotal());
      const hidden = typeof document !== 'undefined' && document.hidden;
      const batch = hidden
        ? Math.max(600, Math.ceil(total / 16))
        : Math.max(250, Math.ceil(total / 60));
      const budgetFull = this.advanceSeatHydration(batch);
      const afterPaint = (): void => {
        this.seatHydrationBusy = false;
        if (budgetFull) {
          this.finishHydrationAfterPaint();
        }
      };
      if (hidden) {
        this.seatHydrationTimer = setTimeout(afterPaint, 0);
      } else {
        this.seatHydrationRaf = requestAnimationFrame(afterPaint);
      }
    };
    this.startHydrationClock(tick);
  }

  private finishHydrationAfterPaint(): void {
    this.stopSeatHydrationClock();
    const finish = (): void => this.completeSeatHydration();
    if (typeof document !== 'undefined' && document.hidden) {
      this.seatHydrationTimer = setTimeout(finish, 0);
      return;
    }
    this.seatHydrationRaf = requestAnimationFrame(() => {
      this.seatHydrationRaf = requestAnimationFrame(finish);
    });
  }

  private startHydrationClock(tick: () => void): void {
    tick();
    if (this.seatHydrationPhase() === 'complete') {
      return;
    }
    try {
      const blob = new Blob(
        ['setInterval(function(){postMessage(0)},16);'],
        { type: 'text/javascript' },
      );
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = () => this.ngZone.run(() => tick());
      this.seatHydrationWorker = worker;
      return;
    } catch {
      // CSP or older browsers — fall back to timers.
    }
    const loop = (): void => {
      if (this.seatHydrationPhase() === 'complete') {
        return;
      }
      tick();
      const hidden = typeof document !== 'undefined' && document.hidden;
      this.seatHydrationTimer = setTimeout(loop, hidden ? 0 : 16);
    };
    this.seatHydrationTimer = setTimeout(loop, 16);
  }

  private stopSeatHydrationClock(): void {
    if (this.seatHydrationWorker) {
      this.seatHydrationWorker.terminate();
      this.seatHydrationWorker = null;
    }
  }

  private ensureHydrationVisibilityListener(): void {
    if (this.seatHydrationVisibilityBound || typeof document === 'undefined') {
      return;
    }
    this.seatHydrationVisibilityBound = true;
    const onVisibility = (): void => {
      if (this.seatHydrationPhase() === 'complete') {
        return;
      }
      this.scheduleSeatHydrationLoop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      this.stopSeatHydrationLoop();
    });
  }

  private stopSeatHydrationLoop(): void {
    this.stopSeatHydrationClock();
    if (this.seatHydrationRaf) {
      cancelAnimationFrame(this.seatHydrationRaf);
      this.seatHydrationRaf = 0;
    }
    if (this.seatHydrationTimer) {
      clearTimeout(this.seatHydrationTimer);
      this.seatHydrationTimer = 0;
    }
    this.seatHydrationBusy = false;
  }

  /** Live viewBox string while middle-mouse panning (rAF-throttled; avoids per-pixel CD). */
  readonly panViewBoxOverride = signal<string | null>(null);
  /** True while the canvas is middle-drag panning — used for CSS (pointer-events off on seats). */
  readonly viewportPanning = signal(false);

  clearPanPreview(): void {
    this.panViewBoxOverride.set(null);
    this.viewportPanning.set(false);
  }

  /** Which sub-phase of the "Add parking lines" step is active. */
  readonly parkingSlotPhase = signal<'access-points' | 'slots' | 'routes'>('access-points');

  /** Enter/Exit marker placement — click-to-snap-to-nearest-edge, same idea as Exit placement. */
  readonly parkingAccessPlacementElementId = signal<string | null>(null);
  readonly parkingAccessPlacementKind = signal<'enter' | 'exit'>('enter');

  /** Vehicle-slot path drawing — click to place points, one or more bent segments. */
  readonly parkingSlotDrawingElementId = signal<string | null>(null);
  readonly parkingSlotDraftPoints = signal<ElementPosition[]>([]);
  readonly parkingSlotDraftVehicleType = signal<ParkingVehicleType | null>(null);
  readonly parkingSlotDraftPattern = signal<ParkingSlotPattern>('single');

  /** Individually selected placed slot (click on canvas) — drag to move, Delete/Remove to delete. */
  readonly selectedParkingSlotId = signal<string | null>(null);

  /** Custom-shape slot drawing — click dots (min 3) tracing one slot's own outline. */
  readonly parkingCustomSlotDrawingElementId = signal<string | null>(null);
  readonly parkingCustomSlotDraftPoints = signal<ElementPosition[]>([]);

  /** Driving-route drawing (routes phase) — click to place points, yellow arrowed path. */
  readonly parkingRouteDrawingElementId = signal<string | null>(null);
  readonly parkingRouteDraftPoints = signal<ElementPosition[]>([]);

  /** Label offsets captured when entering workspace — restored on exit if config was not saved. */
  private blockWorkspaceLabelSnapshot: {
    labelOffsetXPct?: number;
    labelOffsetYPct?: number;
  } | null = null;

  /** Viewpoint angle (deg) on a ring around the fixed block — 0° = above, like a stage label. */
  readonly blockWorkspaceViewpointAngleDeg = signal(DEFAULT_VIEWPOINT_ANGLE_DEG);
  /** Custom distance from block centre (px); null = use default for current block size. */
  readonly blockWorkspaceViewpointDistancePx = signal<number | null>(null);
  readonly blockWorkspaceViewpointConfirmed = signal(false);
  readonly blockWorkspaceSeatingSideIndex = signal(0);
  /** Raw polygon edge index highlighted from drag-seats wizard side-length fields. */
  readonly dragSeatsHighlightSideIndex = signal<number | null>(null);
  /** When true, stepper highlights Edit even though seats exist (back from Save). */
  readonly blockWorkspaceForceEditStep = signal(false);
  readonly blockWorkspaceConfigSaved = signal(false);

  /** Prompt shown after saving a master block when similar empty blocks exist. */
  readonly bulkApplyPrompt = signal<BulkApplySeatingPrompt | null>(null);

  /** Crop/adjust dialog for a dining block background (rendered at page root). */
  readonly diningBackgroundAdjust = signal<{
    elementId: string;
    source: DiningLayoutReferenceImage;
    blockAspect: number;
    clipSource: DiningBackgroundClipSource;
    initialFit: DiningBackgroundFit;
  } | null>(null);

  readonly groundFocalPoint = computed(() =>
    resolveGroundFocalPoint(this.elements(), this.canvas()),
  );

  // ── General Admission workspace signals ──────────────────────────────────
  /** Which logical side id (from buildBlockMeasureEdges) is currently selected (yellow). */
  readonly gaWorkspacePendingSideId = signal<number | null>(null);
  /** True when user has moved past side-labelling to the max-participants step. */
  readonly gaWorkspaceMaxParticipantsStep = signal(false);

  readonly blockWorkspaceViewpointLayout = computed(() => {
    const el = this.blockWorkspaceElement();
    if (!el) {
      return null;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const defaultDist = defaultViewpointDistance(polygon, rect.cx, rect.cy);
    const minDist = minViewpointDistance(polygon, rect.cx, rect.cy);
    const customDist = this.blockWorkspaceViewpointDistancePx();
    const distance = customDist != null ? clampViewpointDistance(polygon, rect.cx, rect.cy, customDist) : defaultDist;
    const angle = this.blockWorkspaceViewpointAngleDeg();
    const position = viewpointPositionFromAngle(rect.cx, rect.cy, angle, distance);
    const storedIndices = Array.from(
      new Set([
        ...(el.dragSeatsStadiumSideIndex != null ? [el.dragSeatsStadiumSideIndex] : []),
        ...(el.dragSeatsStadiumSideIndices ?? []),
      ]),
    );
    const storedEdges = storedIndices
      .map((index) => findLogicalEdgeContainingSource(polygon, index))
      .filter((edge): edge is NonNullable<typeof edge> => edge != null);
    const storedAngle = el.blockViewpointAngleDeg;
    const angleUnchanged =
      storedAngle != null &&
      Math.abs((((angle - storedAngle) % 360) + 540) % 360 - 180) < 0.51;
    const facing = uniqueLogicalEdgesById(
      resolveViewpointLogicalEdges(polygon, rect.cx, rect.cy, angle),
    );
    const storedFronts = uniqueLogicalEdgesById(
      storedEdges.filter((edge) => facing.some((front) => front.id === edge.id)),
    );
    const logicalEdges =
      storedFronts.length > 0 && angleUnchanged ? storedFronts : facing;
    const logicalEdge =
      (angleUnchanged && el.dragSeatsStadiumSideIndex != null
        ? logicalEdges.find((edge) => edge.sourceIndices.includes(el.dragSeatsStadiumSideIndex!))
        : null) ??
      logicalEdges[0] ??
      stadiumLogicalEdgeFromView(polygon, rect.cx, rect.cy, angle);
    const sideIndex = logicalEdge?.index ?? stadiumSideIndexFromViewDirection(polygon, rect.cx, rect.cy, angle);
    const sideLabel =
      logicalEdges.length > 1
        ? logicalEdges.map((edge) => edge.label).join(' + ')
        : (logicalEdge?.label ?? `Side ${sideIndex + 1}`);
    return {
      rect,
      distance,
      minDist,
      defaultDist,
      angle,
      position,
      sideIndex,
      sideIndices: logicalEdges.map((edge) => edge.index),
      logicalEdge,
      logicalEdges,
      sideLabel,
      polygon,
    };
  });

  /** True when the open block workspace is a General Admission block. */
  readonly isGaWorkspace = computed(() => {
    return this.blockWorkspaceElement()?.blockType === 'general-admission' && Boolean(this.blockWorkspaceId());
  });

  /** True when the shared side-label configure UI should be active (sidebar + canvas edges). */
  readonly sideLabelConfigureActive = computed(() => {
    const el = this.blockWorkspaceElement();
    if (!el?.blockType || !this.blockWorkspaceId()) {
      return false;
    }
    if (!blockTypeUsesSideLabelConfigureUi(el.blockType)) {
      return false;
    }
    if (blockTypeHasGaFlow(el.blockType)) {
      return !this.gaWorkspaceMaxParticipantsStep();
    }
    return this.blockWorkspaceViewpointConfirmed() && !this.blockWorkspaceSidesConfigured();
  });

  /** GA-mode side edges with colour state — used by canvas-stage for rendering. */
  readonly gaWorkspaceEdges = computed(() => {
    if (!this.sideLabelConfigureActive()) {
      return null;
    }
    const el = this.blockWorkspaceElement();
    if (!el || el.type !== 'centerpiece' || !hasTracedBlockOutline(el)) {
      return null;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const edges = buildBlockMeasureEdges(polygon);
    const configured = el.gaConfiguredSides ?? [];
    const customSideLengths = el.customSideLengthsM ?? [];
    // Geometric fallback: distribute a 24 m perimeter proportionally across raw edges.
    const geometricLengths = estimateDefaultSideLengthsM(el, rect);
    const pendingId = this.gaWorkspacePendingSideId();
    const zoom = Math.max(1, this.zoom() / 100);
    const hitWidth = Math.max(24, 40 / zoom);
    const lineWidth = Math.max(5, 8 / zoom);
    const viewpointIds = new Set(
      (this.blockWorkspaceViewpointLayout()?.logicalEdges ?? []).map((edge) => edge.id),
    );
    return edges.map((edge) => {
      const conf = configured.find((s) => s.logicalId === edge.id);
      const isDone = Boolean(conf);
      const isPending = edge.id === pendingId;
      const isViewpoint = viewpointIds.has(edge.id);
      // Preferred: lengths measured in the seating/dining step.
      const srcMeasured = edge.sourceIndices.map((i) => customSideLengths[i] ?? 0);
      // Fallback: geometry-proportional estimate (rounded to 1 dp).
      const srcGeometric = edge.sourceIndices.map((i) => geometricLengths[i] ?? 0);
      const suggestedLengthM: number | undefined =
        srcMeasured.length > 0 && srcMeasured.every((l) => l > 0)
          ? srcMeasured.reduce((a, b) => a + b, 0)
          : srcGeometric.length > 0 && srcGeometric.every((l) => l > 0)
            ? Math.round(srcGeometric.reduce((a, b) => a + b, 0) * 10) / 10
            : undefined;
      return {
        id: edge.id,
        x1: edge.x1,
        y1: edge.y1,
        x2: edge.x2,
        y2: edge.y2,
        midX: edge.midX,
        midY: edge.midY,
        /** Canvas label — user's saved label when confirmed, otherwise "Side N". */
        label: isDone ? conf!.label : edge.label,
        /** Always "Side N" — used for panel row headers. */
        sideLabel: edge.label,
        /** User-saved GA length in metres (if any). */
        lengthM: conf?.lengthM,
        /** Fallback length from customSideLengthsM (seating/dining measurement step). */
        suggestedLengthM,
        /**
         * Length for the selected (pending) side on the canvas — saved value, else geometric estimate.
         * Other sides stay label-only so only the active block side shows a metre readout.
         */
        displayLengthM: conf?.lengthM ?? suggestedLengthM,
        stroke: isPending ? '#eab308' : isViewpoint ? '#22c55e' : '#94a3b8',
        strokeWidth: isPending ? lineWidth * 1.3 : isViewpoint ? lineWidth * 1.15 : lineWidth,
        dashArray: isDone || isPending || isViewpoint ? '0' : '8 6',
        hitWidth,
        isDone,
        isPending,
        isViewpoint,
      };
    });
  });

  /**
   * Canvas-only overlay. After Save/Update (every side labelled + measured), hide
   * side lines and metre labels so only the selected block shape remains.
   * The sidebar still uses `gaWorkspaceEdges` so values can be updated.
   */
  readonly gaCanvasWorkspaceEdges = computed(() => {
    const edges = this.gaWorkspaceEdges();
    if (!edges) {
      return null;
    }
    const el = this.blockWorkspaceElement();
    if (el && this.allGaSidesConfigured(el)) {
      return null;
    }
    return edges;
  });

  readonly blockWorkspaceNeedsViewpoint = computed(() => {
    const el = this.blockWorkspaceElement();
    return Boolean(
      this.blockWorkspaceId() &&
        blockTypeHasCustomizationFlow(el?.blockType) &&
        !this.blockWorkspaceViewpointConfirmed(),
    );
  });

  readonly blockWorkspaceTableCount = computed(() => {
    const el = this.blockWorkspaceElement();
    if (!el) {
      return 0;
    }
    return getDiningTableCount(el);
  });

  readonly blockWorkspaceSeatCount = computed(() => {
    const el = this.blockWorkspaceElement();
    if (!el || !hasSeats(el)) {
      return 0;
    }
    if (el.type === 'centerpiece') {
      return getCustomShapeVisibleSeatCount(el);
    }
    return countSeats(el);
  });

  readonly blockWorkspaceProgress = computed((): BlockWorkspaceProgress => {
    const el = this.blockWorkspaceElement();
    const blockType = el?.blockType ?? null;
    const customizationFlow = blockTypeHasCustomizationFlow(blockType);
    const seatingFlow = blockType === 'seating';
    const diningFlow = blockType === 'dining-table';
    const measurementsSaved = Boolean(
      el && customizationFlow && this.allGaSidesConfigured(el),
    );

    const editComplete =
      (seatingFlow && this.blockWorkspaceSeatCount() > 0) ||
      (diningFlow && this.blockWorkspaceTableCount() > 0);

    const completed: Record<BlockWorkspaceStepId, boolean> = {
      'block-type': Boolean(blockType),
      viewpoint: customizationFlow && this.blockWorkspaceViewpointConfirmed(),
      configure:
        customizationFlow &&
        (this.blockWorkspaceSidesConfigured() || measurementsSaved),
      edit: customizationFlow && editComplete,
      save: this.blockWorkspaceConfigSaved(),
    };

    let activeStep: BlockWorkspaceStepId = 'block-type';
    if (!completed['block-type']) {
      activeStep = 'block-type';
    } else if (!customizationFlow) {
      activeStep = 'save';
    } else if (!completed.viewpoint) {
      activeStep = 'viewpoint';
    } else if (customizationFlow && !this.blockWorkspaceSeatingEditMode()) {
      activeStep = 'configure';
    } else if (this.blockWorkspaceForceEditStep() || !completed.edit) {
      activeStep = 'edit';
    } else {
      activeStep = 'save';
    }

    let canGoBack = false;
    let backLabel = '';
    let backTarget: BlockWorkspaceStepId | null = null;

    if (activeStep === 'viewpoint') {
      canGoBack = true;
      backLabel = 'Select block type';
      backTarget = 'block-type';
    } else if (activeStep === 'configure') {
      canGoBack = true;
      backLabel = 'Set VIEW POINT';
      backTarget = 'viewpoint';
    } else if (activeStep === 'edit') {
      canGoBack = true;
      backLabel = 'Configure block';
      backTarget = 'configure';
    } else if (activeStep === 'save') {
      canGoBack = true;
      backLabel = customizationFlow ? 'Edit block' : 'Select block type';
      backTarget = customizationFlow ? 'edit' : 'block-type';
    }

    return { seatingFlow: customizationFlow, customizationFlow, activeStep, completed, canGoBack, backLabel, backTarget };
  });

  private past: LayoutElement[][] = [];
  private future: LayoutElement[][] = [];
  /** Snapshot taken at the start of a drag/rotate — committed only if the gesture changed layout. */
  private gestureBaseline: LayoutElement[] | null = null;
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  readonly selected = computed(() => {
    const id = this.selectedId();
    return id ? this.elements().find((el) => el.id === id) ?? null : null;
  });

  readonly elementCount = computed(() => this.elements().length);

  readonly blockCount = computed(() =>
    this.elements().reduce((total, el) => {
      if (el.type === 'layer-ring' || el.type === 'layer-rect') {
        return total + el.blocks.length;
      }
      if (el.type === 'block-grid' || el.type === 'seat-section') {
        return total + 1;
      }
      if (el.type === 'centerpiece' && isCustomShapeSeatingEnabled(el)) {
        const rect = rectFromPositionSize(el.position, el.size, this.canvas());
        return total + (getCustomShapeVisibleSeatCount(el, rect) > 0 ? 1 : 0);
      }
      return total;
    }, 0),
  );

  readonly seatCount = computed(() =>
    this.elements().reduce((total, el) => total + countSeats(el), 0),
  );

  /** Adds a tool to the canvas and selects it. Custom Piece enters draw mode only. */
  addTool(toolId: ElementTypeId): LayoutElement | null {
    if (toolId === 'custom-piece') {
      this.startCustomPieceDrawing();
      return null;
    }

    const element = createElement(toolId);
    if (!element) {
      return null;
    }
    this.pushHistory();
    this.elements.update((items) => [...items, element]);
    this.selectedId.set(element.id);
    this.selectedIds.set([element.id]);
    this.selectedRingBlock.set(null);
    this.drawingElementId.set(null);
    this.draftPoints.set([]);
    return element;
  }

  /** Adds a Block Grid with a specific outline shape (Focus area → Parts). */
  addBlockGrid(shape: BlockGridShapeId = 'square'): LayoutElement {
    const element = createBlockGrid(shape, { canvas: this.canvas() });
    this.pushHistory();
    this.elements.update((items) => [...items, element]);
    this.selectedId.set(element.id);
    this.selectedIds.set([element.id]);
    this.selectedRingBlock.set(null);
    this.drawingElementId.set(null);
    this.draftPoints.set([]);
    return element;
  }

  /** Custom Piece: crosshair mode — no box until the user finishes drawing. */
  startCustomPieceDrawing(): void {
    this.drawingElementId.set('__draft__');
    this.draftPoints.set([]);
    this.selectedId.set(null);
    this.selectedIds.set([]);
    this.selectedRingBlock.set(null);
  }

  /** Add Parking: enters the dedicated Parking Workspace and starts area drafting. */
  enterParkingWorkspace(): void {
    this.parkingWorkspaceReturnView = {
      zoom: this.zoom(),
      cameraX: this.cameraX(),
      cameraY: this.cameraY(),
    };
    this.parkingWorkspaceId.set(PARKING_AREA_DRAFT_ID);
    this.parkingWorkspaceStep.set('draw-area');
    this.parkingMeasureEdgeIndex.set(null);
    this.startParkingAreaDrawing();
  }

  /** Parking area: crosshair mode — no box until the user finishes drawing. */
  startParkingAreaDrawing(): void {
    this.drawingElementId.set(PARKING_AREA_DRAFT_ID);
    this.draftPoints.set([]);
    this.selectedId.set(null);
    this.selectedIds.set([]);
    this.selectedRingBlock.set(null);
  }

  /** Redraw the whole outline of an already-placed parking area. */
  startParkingOutlineRedraw(elementId: string): void {
    this.parkingWorkspaceStep.set('draw-area');
    this.startCustomDrawOnElement(elementId);
  }

  /** Re-opens the Parking Workspace on an already-drawn parking area (skips to Add Lines). */
  enterParkingWorkspaceForExisting(elementId: string): boolean {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isParkingArea(el)) {
      return false;
    }
    if (this.parkingWorkspaceId() === elementId) {
      return true;
    }
    this.parkingWorkspaceReturnView = {
      zoom: this.zoom(),
      cameraX: this.cameraX(),
      cameraY: this.cameraY(),
    };
    this.parkingWorkspaceId.set(elementId);
    // Defensive: legacy/incomplete data without full edge measurements sends the user
    // back to measure them rather than silently using an invalid scale.
    this.parkingWorkspaceStep.set(this.allParkingEdgesMeasured(elementId) ? 'draw-lines' : 'measure-edges');
    this.parkingMeasureEdgeIndex.set(null);
    this.parkingSlotPhase.set(this.hasRequiredParkingAccessPoints(elementId) ? 'slots' : 'access-points');
    this.selectElement(elementId);
    this.fitCameraToElement(elementId, { blockWorkspace: true });
    return true;
  }

  /** Returns to the main layout workspace, restoring the previous camera view (Save/Back). */
  exitParkingWorkspace(): void {
    const returnView = this.parkingWorkspaceReturnView;
    this.parkingWorkspaceId.set(null);
    this.parkingWorkspaceStep.set('draw-area');
    this.parkingMeasureEdgeIndex.set(null);
    this.parkingWorkspaceReturnView = null;
    this.cancelDrawing();
    this.cancelParkingAccessPointPlacement();
    this.cancelParkingSlotDrawing();
    this.cancelParkingRouteDrawing();
    this.cancelParkingCustomSlotDrawing();
    this.selectedParkingSlotId.set(null);
    if (returnView) {
      this.zoom.set(returnView.zoom);
      this.cameraX.set(returnView.cameraX);
      this.cameraY.set(returnView.cameraY);
    }
  }

  selectElement(id: string | null): void {
    // In Auto Fill layout mode, keep the multi-selection intact so every
    // selected block still receives seats when Auto Fill runs.
    if (this.autoFillLayoutMode() && id) {
      const current = this.selectedIds();
      if (current.includes(id)) {
        this.selectedId.set(id);
        this.selectedSeatId.set(null);
        this.selectedCustomRow.set(null);
        this.syncAutoFillScaledMeasurementsToSelection();
        return;
      }
      this.selectElements([...current, id], id);
      return;
    }
    this.selectedId.set(id);
    this.selectedIds.set(id ? [id] : []);
    this.selectedSeatId.set(null);
    this.selectedCustomRow.set(null);
    if (!id) {
      this.selectedRingBlock.set(null);
    }
    this.syncAutoFillScaledMeasurementsToSelection();
  }

  selectElements(ids: string[], focusId?: string | null): void {
    const unique = [...new Set(ids)];
    this.selectedIds.set(unique);
    const focus =
      focusId && unique.includes(focusId) ? focusId : (unique[0] ?? null);
    this.selectedId.set(focus);
    this.selectedSeatId.set(null);
    this.selectedCustomRow.set(null);
    this.selectedRingBlock.set(null);
    this.syncAutoFillScaledMeasurementsToSelection();
  }

  selectSeat(seatId: string | null, elementId?: string | null): void {
    this.selectedSeatId.set(seatId);
    if (!seatId) {
      this.selectedSeatElementId.set(null);
      return;
    }
    this.selectedCustomRow.set(null);
    // Seat ids repeat per block, so remember which element the seat belongs to.
    this.selectedSeatElementId.set(
      elementId !== undefined
        ? elementId
        : (this.blockWorkspaceId() ?? this.selectedIds()[0] ?? null),
    );
  }

  selectCustomRow(blockId: string, rowIndex: number): void {
    this.selectedCustomRow.set({ blockId, rowIndex });
    this.selectedSeatId.set(null);
    this.selectedRingBlock.set(null);
  }

  toggleRowLabelHidden(elementId: string, rowIndex: number, blockId?: string): void {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || el.type !== 'centerpiece') {
      return;
    }
    if (blockId) {
      const blocks = el.customSeatBlocks ?? [];
      const block = blocks.find((item) => item.id === blockId);
      if (!block?.seatLayout) {
        return;
      }
      const hidden = new Set(block.seatLayout.hiddenRowLabelIndices ?? []);
      if (hidden.has(rowIndex)) {
        hidden.delete(rowIndex);
      } else {
        hidden.add(rowIndex);
      }
      this.applyPatch(elementId, {
        customSeatBlocks: blocks.map((item) =>
          item.id === blockId
            ? {
                ...item,
                seatLayout: {
                  ...item.seatLayout!,
                  hiddenRowLabelIndices: [...hidden].sort((a, b) => a - b),
                },
              }
            : item,
        ),
      });
      return;
    }
    const seatLayout = el.seatLayout;
    if (!seatLayout) {
      return;
    }
    const hidden = new Set(seatLayout.hiddenRowLabelIndices ?? []);
    if (hidden.has(rowIndex)) {
      hidden.delete(rowIndex);
    } else {
      hidden.add(rowIndex);
    }
    this.applyPatch(elementId, {
      seatLayout: {
        ...seatLayout,
        hiddenRowLabelIndices: [...hidden].sort((a, b) => a - b),
      },
    });
  }

  selectRingBlock(elementId: string, blockId: string): void {
    this.selectedId.set(elementId);
    this.selectedIds.set([elementId]);
    this.selectedRingBlock.set({ elementId, blockId });
  }

  /** Live angular reposition of one sector during drag — does not record history. */
  moveRingBlockSilent(
    elementId: string,
    blockId: string,
    startAngleDeg: number,
    endAngleDeg: number,
  ): void {
    this.elements.update((items) =>
      items.map((el) => {
        if (el.id !== elementId || el.type !== 'layer-ring') {
          return el;
        }
        return {
          ...el,
          blocks: el.blocks.map((block) =>
            block.id === blockId ? { ...block, startAngleDeg, endAngleDeg } : block,
          ),
        } satisfies LayerRingElement;
      }),
    );
  }

  zoomIn(step = 10): void {
    // 1000% everywhere: inspecting small blocks / audit fixes needs deep zoom
    // in the main workspace too, not just inside a block workspace.
    this.zoom.update((z) => Math.min(1000, z + step));
  }

  zoomOut(step = 10): void {
    this.zoom.update((z) => Math.max(40, z - step));
  }

  /** Reset zoom to 100% without changing pan position. */
  resetZoomTo100(): void {
    this.zoom.set(100);
  }

  /** Pan the camera by screen-pixel delta (middle-mouse drag). */
  panBy(screenDx: number, screenDy: number, viewportWidth: number, viewportHeight: number): void {
    const zoom = this.zoom() / 100;
    const viewW = this.canvas().width / zoom;
    const viewH = this.canvas().height / zoom;
    const deltaX = viewportWidth > 0 ? (screenDx / viewportWidth) * viewW : 0;
    const deltaY = viewportHeight > 0 ? (screenDy / viewportHeight) * viewH : 0;
    this.cameraX.update((x) => x - deltaX);
    this.cameraY.update((y) => y - deltaY);
  }

  resetView(): void {
    this.zoom.set(100);
    const { width, height } = this.canvas();
    this.cameraX.set(width / 2);
    this.cameraY.set(height / 2);
  }

  setCanvasSize(size: CanvasConfig): void {
    this.canvasState.set({ ...size });
    this.cameraX.set(size.width / 2);
    this.cameraY.set(size.height / 2);
  }

  toggleColorDetectMode(): void {
    this.colorDetectMode.update((on) => !on);
    if (this.colorDetectMode()) {
      this.drawingElementId.set(null);
      this.draftPoints.set([]);
    } else {
      this.traceTargetRect.set(null);
    }
  }

  setColorDetectTolerance(value: number): void {
    this.colorDetectTolerance.set(Math.max(12, Math.min(96, Math.round(value))));
  }

  /** Clears placed elements but keeps the uploaded reference chart on canvas. */
  startFromUploadedImage(): void {
    this.pushHistory();
    this.elements.set([]);
    this.selectedId.set(null);
    this.selectedIds.set([]);
    this.drawingElementId.set(null);
    this.draftPoints.set([]);
  }

  setReferenceOcrTokens(tokens: OcrToken[]): void {
    this.referenceOcrTokens.set(tokens);
  }

  /** Load OCR tokens from the reference chart when missing (saved layouts, first trace). */
  async ensureReferenceOcrTokens(): Promise<void> {
    if (this.referenceOcrTokens().length > 0) {
      return;
    }
    const ref = this.referenceImage();
    const dataUrl = ref?.dataUrl;
    if (!dataUrl) {
      return;
    }
    if (this.ocrEnsureInflight) {
      await this.ocrEnsureInflight;
      return;
    }
    this.ocrEnsureInflight = (async () => {
      try {
        const file = await dataUrlToFile(dataUrl, ref?.name ?? 'chart.png');
        const tokens = await this.blueprintAnalyzer.fetchOcr(file);
        this.referenceOcrTokens.set(tokens);
      } catch {
        this.referenceOcrTokens.set([]);
      }
    })();
    try {
      await this.ocrEnsureInflight;
    } finally {
      this.ocrEnsureInflight = null;
    }
  }

  resolveTracedBlockLabel(
    imagePolygon: PointPct[],
    clickRefPct: PointPct | null,
    drawContext?: {
      imageWidth: number;
      imageHeight: number;
    },
  ): string | undefined {
    const claimedCentroids = drawContext
      ? this.claimedBlockLabelRefCentroids(drawContext.imageWidth, drawContext.imageHeight)
      : [];
    return (
      findOcrLabelForTracedBlock(imagePolygon, clickRefPct, this.referenceOcrTokens(), {
        claimedCentroids,
      }) ?? undefined
    );
  }

  private claimedBlockLabelRefCentroids(imageWidth: number, imageHeight: number): PointPct[] {
    const ref = this.referenceImage();
    const canvas = this.canvasState();
    if (!ref) {
      return [];
    }
    const drawRect = referenceImageDrawRect(
      canvas,
      imageWidth,
      imageHeight,
      ref.geometryScale ?? 1,
    );
    const centroids: PointPct[] = [];
    for (const el of this.elements()) {
      if (el.type !== 'centerpiece' || !hasTracedBlockOutline(el)) {
        continue;
      }
      centroids.push(
        canvasPointToReferencePct(el.position.xPct, el.position.yPct, canvas, drawRect),
      );
    }
    return centroids;
  }

  private syncBlockCounterFromElements(): void {
    let max = 0;
    for (const el of this.elements()) {
      if (el.type !== 'centerpiece') {
        continue;
      }
      const fromId = el.id.match(/cv-block-[^-]+-(\d+)$/);
      if (fromId) {
        max = Math.max(max, Number(fromId[1]));
      }
      const fromLabel = /^Block\s+(\d+)$/i.exec(el.label.trim());
      if (fromLabel) {
        max = Math.max(max, Number(fromLabel[1]));
      }
    }
    this.blockCounter = max;
  }

  /**
   * Creates a semi-transparent custom polygon block from a flood-filled region.
   * Returns the new element id, or null when the polygon could not be built.
   */
  addBlockFromDetectedRegion(
    polygon: PointPct[],
    fillColor: string,
    label?: string,
  ): string | null {
    const normalized = renormalizeFromCanvasPoints(polygon);
    if (!normalized) {
      return null;
    }
    this.blockCounter += 1;
    const blockLabel = label?.trim() ?? '';
    const blockStyle = blueprintBlockStyle(fillColor);
    const element: CenterpieceElement = {
      id: `cv-block-${Date.now().toString(36)}-${this.blockCounter}`,
      type: 'centerpiece',
      name: blockLabel,
      shape: classifyBlockShape(normalized.customPoints),
      label: blockLabel,
      curveDeg: 0,
      customPoints: normalized.customPoints,
      position: normalized.position,
      size: normalized.size,
      rotation: 0,
      style: {
        fillColor: blockStyle.fillColor,
        strokeColor: blockStyle.strokeColor,
        labelColor: blockStyle.labelColor,
      },
    };
    this.pushHistory();
    this.elements.update((items) => [...items, element]);
    this.selectedId.set(element.id);
    this.traceTargetRect.set(null);
    return element.id;
  }

  /** Live position update during drag — does not record history. */
  moveSilent(id: string, position: ElementPosition): void {
    this.elements.update((items) =>
      items.map((el) => {
        if (el.id !== id) {
          return el;
        }
        // Oval / circle Block Grids store an absolute geometry.center. Keep it
        // aligned with position so drag matches square / curved-line behavior.
        if (
          el.type === 'block-grid' &&
          (el.geometry?.type === 'circle' || el.geometry?.type === 'ellipse')
        ) {
          return {
            ...el,
            position,
            geometry: { ...el.geometry, center: { xPct: position.xPct, yPct: position.yPct } },
          };
        }
        return { ...el, position } as LayoutElement;
      }),
    );
  }

  /** Patch any element fields and record history (used by the inspector). */
  update(id: string, patch: Partial<LayoutElement>): void {
    this.pushHistory();
    this.applyPatch(id, patch);
  }

  /** Patch without recording history (used by the inspector during typing). */
  updateSilent(id: string, patch: Partial<LayoutElement>): void {
    this.applyPatch(id, patch);
  }

  private applyPatch(id: string, patch: Partial<LayoutElement>): void {
    this.elements.update((items) => {
      const index = items.findIndex((el) => el.id === id);
      if (index < 0) {
        return items;
      }
      const el = items[index];
      const elRecord = el as unknown as Record<string, unknown>;
      const patchRecord = patch as Record<string, unknown>;
      const hasChange = Object.keys(patchRecord).some((key) => elRecord[key] !== patchRecord[key]);
      if (!hasChange) {
        return items;
      }
      const next = items.slice();
      let merged = { ...el, ...patch } as LayoutElement;
      if (merged.type === 'centerpiece') {
        const touchesGeometry =
          'shape' in patchRecord ||
          'size' in patchRecord ||
          'position' in patchRecord ||
          'curveDeg' in patchRecord ||
          'geometry' in patchRecord;
        if (touchesGeometry) {
          merged = syncCenterpieceGeometry(merged, this.canvas());
        }
      } else if (merged.type === 'block-grid') {
        const touchesGeometry =
          'shape' in patchRecord ||
          'size' in patchRecord ||
          'position' in patchRecord ||
          'curveDeg' in patchRecord ||
          'geometry' in patchRecord;
        if (touchesGeometry) {
          merged = syncBlockGridGeometry(merged, this.canvas());
        }
      }
      next[index] = merged;
      return next;
    });
  }

  remove(id: string): void {
    this.removeMany([id]);
  }

  removeSelected(): void {
    const ids = this.selectedIds();
    if (ids.length > 0) {
      this.removeMany(ids);
      return;
    }
    const id = this.selectedId();
    if (id) {
      this.removeMany([id]);
    }
  }

  removeMany(ids: string[]): void {
    if (ids.length === 0) {
      return;
    }
    this.pushHistory();
    const idSet = new Set(ids);
    this.elements.update((items) => items.filter((el) => !idSet.has(el.id)));
    const nextSelected = this.selectedIds().filter((id) => !idSet.has(id));
    this.selectedIds.set(nextSelected);
    if (this.selectedId() && idSet.has(this.selectedId()!)) {
      this.selectedId.set(nextSelected[0] ?? null);
      this.selectedRingBlock.set(null);
    }
    const drawingId = this.drawingElementId();
    if (drawingId && idSet.has(drawingId)) {
      this.drawingElementId.set(null);
      this.draftPoints.set([]);
    }
  }

  /** Remember layout at gesture start (drag/rotate) so we can undo only real changes. */
  beginGesture(): void {
    this.gestureBaseline = this.snapshot();
  }

  /** Record a finished drag/rotate for undo when position or rotation actually changed. */
  commitGesture(): void {
    if (!this.gestureBaseline) {
      return;
    }
    const baseline = this.gestureBaseline;
    this.gestureBaseline = null;
    if (snapshotsEqual(baseline, this.elements())) {
      return;
    }
    this.past.push(baseline);
    if (this.past.length > MAX_HISTORY) {
      this.past.shift();
    }
    this.future = [];
    this.syncHistoryFlags();
  }

  cancelGesture(): void {
    this.gestureBaseline = null;
  }

  // --- Custom piece drawing ---

  addDraftPoint(point: ElementPosition): void {
    const hadPoints = this.draftPoints().length > 0;
    this.draftPoints.update((pts) => [...pts, point]);
    if (hadPoints) {
      // A new segment just formed between the previous last point and this one.
      this.draftEdgeBowAmounts.update((amts) => [...amts, 0]);
    }
  }

  /** Live drag update for the bow of one already-placed draft segment (before the shape closes). */
  updateDraftEdgeBowSilent(segmentIndex: number, canvasPct: ElementPosition): void {
    const points = this.draftPoints();
    if (segmentIndex < 0 || segmentIndex >= points.length - 1) {
      return;
    }
    const canvas = this.canvas();
    const a = points[segmentIndex];
    const b = points[segmentIndex + 1];
    const aPx = { x: (a.xPct / 100) * canvas.width, y: (a.yPct / 100) * canvas.height };
    const bPx = { x: (b.xPct / 100) * canvas.width, y: (b.yPct / 100) * canvas.height };
    const pPx = { x: (canvasPct.xPct / 100) * canvas.width, y: (canvasPct.yPct / 100) * canvas.height };
    const dx = bPx.x - aPx.x;
    const dy = bPx.y - aPx.y;
    const len = Math.hypot(dx, dy) || 1;
    const perpX = -dy / len;
    const perpY = dx / len;
    const midX = (aPx.x + bPx.x) / 2;
    const midY = (aPx.y + bPx.y) / 2;
    const offset = (pPx.x - midX) * perpX + (pPx.y - midY) * perpY;
    const ratio = Math.max(-MAX_EDGE_BOW_RATIO, Math.min(MAX_EDGE_BOW_RATIO, offset / len));
    this.draftEdgeBowAmounts.update((amts) => {
      const next = [...amts];
      next[segmentIndex] = ratio;
      return next;
    });
  }

  finishDrawing(): void {
    const drawingId = this.drawingElementId();
    const points = [...this.draftPoints()];
    // Open-segment bows placed while drawing; the closing edge (last point back to the
    // first) always starts straight — bow it afterwards via "Edit outline curves".
    const openBowAmounts = [...this.draftEdgeBowAmounts()];
    this.drawingElementId.set(null);
    this.draftPoints.set([]);
    this.draftEdgeBowAmounts.set([]);
    if (points.length < 3) {
      return;
    }
    const edgeBowAmounts = [...openBowAmounts, 0].slice(0, points.length);

    // Brand-new parking area — must be checked before the "resume on real id" branch below,
    // since the sentinel is truthy and !== '__draft__'.
    if (drawingId === PARKING_AREA_DRAFT_ID) {
      const element = createParkingAreaFromPoints(points, edgeBowAmounts);
      if (!element) {
        return;
      }
      this.pushHistory();
      this.elements.update((items) => [...items, element]);
      this.selectElement(element.id);
      this.parkingWorkspaceId.set(element.id);
      this.parkingWorkspaceStep.set('measure-edges');
      this.parkingMeasureEdgeIndex.set(0);
      this.fitCameraToElement(element.id, { blockWorkspace: true });
      return;
    }

    if (drawingId && drawingId !== '__draft__') {
      const normalized = renormalizeFromCanvasPoints(points);
      if (!normalized) {
        return;
      }
      const existing = this.elements().find((item) => item.id === drawingId);
      const isParkingRedraw = Boolean(existing && isParkingArea(existing));
      this.pushHistory();
      this.applyPatch(drawingId, {
        shape: isParkingRedraw ? 'custom' : classifyBlockShape(normalized.customPoints),
        customPoints: normalized.customPoints,
        position: normalized.position,
        size: normalized.size,
        ...(isParkingRedraw
          ? {
              edgeBowAmounts,
              customSideLengthsM: undefined,
              parkingReferenceLine: undefined,
              parkingDividerLines: undefined,
            }
          : {}),
      });
      this.selectElement(drawingId);
      if (isParkingRedraw) {
        // Redrawing changes edge count/geometry — old measurements no longer apply.
        this.parkingWorkspaceStep.set('measure-edges');
        this.parkingMeasureEdgeIndex.set(0);
      }
      return;
    }

    const element = createCustomPieceFromPoints(points);
    if (!element) {
      return;
    }
    this.pushHistory();
    this.elements.update((items) => [...items, element]);
    this.selectedId.set(element.id);
  }

  cancelDrawing(): void {
    this.drawingElementId.set(null);
    this.draftPoints.set([]);
    this.draftEdgeBowAmounts.set([]);
  }

  /** Resume point-by-point drawing on an existing custom piece. */
  startCustomDrawOnElement(id: string): void {
    this.drawingElementId.set(id);
    this.draftPoints.set([]);
    this.selectedId.set(id);
    this.applyPatch(id, { adjustEdges: false });
  }

  clearCustomShape(id: string): void {
    this.pushHistory();
    this.applyPatch(id, { customPoints: [], size: { wPct: 1, hPct: 1 }, adjustEdges: false });
  }

  duplicateSelected(): void {
    const el = this.selected();
    if (!el) {
      return;
    }
    const copy = structuredClone(el);
    copy.id = `dup-${Date.now().toString(36)}`;
    copy.position = { xPct: el.position.xPct + 3, yPct: el.position.yPct + 3 };
    this.pushHistory();
    this.elements.update((items) => [...items, copy]);
    this.selectedId.set(copy.id);
    this.selectedIds.set([copy.id]);
    this.selectedRingBlock.set(null);
  }

  /** Move element one step toward the top of the render stack (later in the array). */
  moveLayerUp(id: string): void {
    this.pushHistory();
    this.elements.update((items) => {
      const index = items.findIndex((el) => el.id === id);
      if (index < 0 || index >= items.length - 1) {
        return items;
      }
      const next = [...items];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  /** Move element one step toward the bottom of the render stack (earlier in the array). */
  moveLayerDown(id: string): void {
    this.pushHistory();
    this.elements.update((items) => {
      const index = items.findIndex((el) => el.id === id);
      if (index <= 0) {
        return items;
      }
      const next = [...items];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  toggleLayerVisible(id: string): void {
    const el = this.elements().find((item) => item.id === id);
    if (!el) {
      return;
    }
    this.pushHistory();
    this.applyPatch(id, { visible: el.visible === false });
  }

  toggleLayerLocked(id: string): void {
    const el = this.elements().find((item) => item.id === id);
    if (!el) {
      return;
    }
    this.pushHistory();
    this.applyPatch(id, { locked: !el.locked });
  }

  generateQuickShape(id: string, segments: number): void {
    const el = this.elements().find((item) => item.id === id);
    if (!el || el.type !== 'centerpiece') {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const outline = buildQuickCustomShapeOutline(segments, rect);
    const absolute = outline.points.map((p) => canvasPxToPct(p, this.canvas()));
    if (outline.closed && absolute.length >= 3) {
      const normalized = renormalizeFromCanvasPoints(absolute);
      if (!normalized) {
        return;
      }
      this.pushHistory();
      this.applyPatch(id, {
        shape: classifyBlockShape(normalized.customPoints),
        customPoints: normalized.customPoints,
        position: normalized.position,
        size: normalized.size,
      });
      return;
    }
    this.pushHistory();
    this.applyPatch(id, { shape: 'custom', customPoints: absolute.map((p) => canvasPctToLocalPoint(el, p, this.canvas())) });
  }

  updateCustomVertexSilent(id: string, index: number, canvasPct: ElementPosition): void {
    const el = this.elements().find((item) => item.id === id);
    if (!el || el.type !== 'centerpiece' || !hasTracedBlockOutline(el)) {
      return;
    }
    const absolute = localPointsToAbsolute(el, this.canvas());
    if (index < 0 || index >= absolute.length) {
      return;
    }
    absolute[index] = canvasPct;
    const normalized = renormalizeFromCanvasPoints(absolute);
    if (!normalized) {
      return;
    }
    this.applyPatch(id, {
      customPoints: normalized.customPoints,
      position: normalized.position,
      size: normalized.size,
    });
  }

  // --- Parking area: edge bow-curve + divider lines ---

  /** Live drag update for one parking-area edge's bow-curve amount (no history push). */
  updateParkingEdgeBowSilent(id: string, edgeIndex: number, canvasPct: ElementPosition): void {
    const el = this.elements().find((item) => item.id === id);
    if (!el || !isParkingArea(el)) {
      return;
    }
    const points = el.customPoints ?? [];
    const n = points.length;
    if (n < 3 || edgeIndex < 0 || edgeIndex >= n) {
      return;
    }
    const absolute = localPointsToAbsolute(el, this.canvas());
    const a = absolute[edgeIndex];
    const b = absolute[(edgeIndex + 1) % n];
    const canvas = this.canvas();
    const aPx = { x: (a.xPct / 100) * canvas.width, y: (a.yPct / 100) * canvas.height };
    const bPx = { x: (b.xPct / 100) * canvas.width, y: (b.yPct / 100) * canvas.height };
    const pPx = { x: (canvasPct.xPct / 100) * canvas.width, y: (canvasPct.yPct / 100) * canvas.height };
    const dx = bPx.x - aPx.x;
    const dy = bPx.y - aPx.y;
    const len = Math.hypot(dx, dy) || 1;
    const perpX = -dy / len;
    const perpY = dx / len;
    const midX = (aPx.x + bPx.x) / 2;
    const midY = (aPx.y + bPx.y) / 2;
    const offset = (pPx.x - midX) * perpX + (pPx.y - midY) * perpY;
    const ratio = Math.max(-MAX_EDGE_BOW_RATIO, Math.min(MAX_EDGE_BOW_RATIO, offset / len));
    const amounts = [...(el.edgeBowAmounts ?? points.map(() => 0))];
    amounts[edgeIndex] = ratio;
    this.applyPatch(id, { edgeBowAmounts: amounts });
  }

  // --- Entrances & Exits ---

  /** Start placement mode for one Enter/Exit marker. */
  startParkingAccessPointPlacement(elementId: string, kind: 'enter' | 'exit'): void {
    this.cancelParkingSlotDrawing();
    this.parkingAccessPlacementElementId.set(elementId);
    this.parkingAccessPlacementKind.set(kind);
  }

  cancelParkingAccessPointPlacement(): void {
    this.parkingAccessPlacementElementId.set(null);
  }

  /**
   * Accurate px-per-metre for a parking area: prefers the per-edge measured scale
   * (customSideLengthsM) over the generic bounding-box L×W fallback. Every parking
   * metre<->px conversion should go through this — `getStageEdgeFrame`'s own `.ppm`
   * (from dining-stage.ts) uses the generic scale and is wrong for a measured outline.
   */
  private parkingPxPerMeter(el: CenterpieceElement, rect: PixelRect): number {
    return (
      computeParkingPxPerMeter(rect, el.customPoints ?? [], el.customSideLengthsM ?? []) ??
      pxPerMeter(rect, resolveBlockLengthM(el), resolveBlockWidthM(el))
    );
  }

  /** Canvas-px centre of every placed Enter/Exit gate — used to keep the "way" clear of slots. */
  private parkingAccessPointCentersPx(el: CenterpieceElement, rect: PixelRect): { x: number; y: number }[] {
    const points = el.parkingAccessPoints ?? [];
    if (points.length === 0) {
      return [];
    }
    const ppm = this.parkingPxPerMeter(el, rect);
    const centers: { x: number; y: number }[] = [];
    for (const point of points) {
      const frame = getStageEdgeFrame(el, rect, point.sideEdgeId);
      if (!frame) {
        continue;
      }
      const alongPx = point.offsetAlongEdgeM * ppm;
      centers.push({
        x: frame.edge.midX + frame.ux * alongPx,
        y: frame.edge.midY + frame.uy * alongPx,
      });
    }
    return centers;
  }

  /** Places an Enter/Exit marker at the outline edge nearest the click (snap-to-nearest-edge, same idea as Exit placement). */
  placeParkingAccessPointAt(elementId: string, pct: ElementPosition): void {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isParkingArea(el)) {
      return;
    }
    const kind = this.parkingAccessPlacementKind();
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const canvasX = (pct.xPct / 100) * this.canvas().width;
    const canvasY = (pct.yPct / 100) * this.canvas().height;

    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const edges = buildBlockMeasureEdges(polygon);
    if (edges.length === 0) {
      return;
    }
    const distanceToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-9) {
        return Math.hypot(px - x1, py - y1);
      }
      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
      return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
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
    const sideEdgeId = closestEdge.id;
    let offsetAlongEdgeM = 0;
    const frame = getStageEdgeFrame(el, rect, sideEdgeId);
    if (frame) {
      // frame.ppm is the generic bounding-box L×W scale (dining-stage.ts) — wrong for a
      // measured parking outline. Use the accurate per-edge scale instead.
      const ppm = this.parkingPxPerMeter(el, rect);
      const foot = projectToEdge(frame.edge, canvasX, canvasY);
      const alongPx = (foot.x - frame.edge.midX) * frame.ux + (foot.y - frame.edge.midY) * frame.uy;
      offsetAlongEdgeM = alongPx / ppm;
    }

    const point: ParkingAccessPointSpec = {
      id: this.nextParkingId('pap'),
      kind,
      sideEdgeId,
      offsetAlongEdgeM,
      label: kind === 'enter' ? 'ENTER' : 'EXIT',
    };
    this.pushHistory();
    this.applyPatch(elementId, { parkingAccessPoints: [...(el.parkingAccessPoints ?? []), point] });
    this.parkingAccessPlacementElementId.set(null);
  }

  removeParkingAccessPoint(elementId: string, pointId: string): void {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isParkingArea(el)) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, {
      parkingAccessPoints: (el.parkingAccessPoints ?? []).filter((p) => p.id !== pointId),
    });
  }

  /** True once at least one Enter and one Exit marker are placed. */
  hasRequiredParkingAccessPoints(elementId: string): boolean {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isParkingArea(el)) {
      return false;
    }
    const points = el.parkingAccessPoints ?? [];
    return points.some((p) => p.kind === 'enter') && points.some((p) => p.kind === 'exit');
  }

  /** Advances from "Entrances & Exits" to "Vehicle slots" — only once both are placed. */
  proceedFromParkingAccessPoints(elementId: string): boolean {
    if (!this.hasRequiredParkingAccessPoints(elementId)) {
      return false;
    }
    this.parkingSlotPhase.set('slots');
    return true;
  }

  // --- Vehicle slot placement ---

  /** Start drawing a slot-filled path/lane for one vehicle type + pattern. */
  startParkingSlotDrawing(elementId: string, vehicleType: ParkingVehicleType, pattern: ParkingSlotPattern): void {
    this.cancelParkingAccessPointPlacement();
    this.parkingSlotDrawingElementId.set(elementId);
    this.parkingSlotDraftPoints.set([]);
    this.parkingSlotDraftVehicleType.set(vehicleType);
    this.parkingSlotDraftPattern.set(pattern);
  }

  /** Ignores clicks outside the parking outline — the drawn row must stay inside the block. */
  addParkingSlotDraftPoint(point: ElementPosition): void {
    const elementId = this.parkingSlotDrawingElementId();
    const el = elementId ? this.elements().find((item) => item.id === elementId) : undefined;
    if (el && isParkingArea(el)) {
      const rect = rectFromPositionSize(el.position, el.size, this.canvas());
      const outline = buildParkingOutlinePoints(rect, el.customPoints ?? [], el.edgeBowAmounts ?? []);
      if (outline.length >= 3) {
        const px = {
          x: (point.xPct / 100) * this.canvas().width,
          y: (point.yPct / 100) * this.canvas().height,
        };
        if (!pointInPolygon(px, outline)) {
          return;
        }
      }
    }
    this.parkingSlotDraftPoints.update((pts) => [...pts, point]);
  }

  cancelParkingSlotDrawing(): void {
    this.parkingSlotDrawingElementId.set(null);
    this.parkingSlotDraftPoints.set([]);
    this.parkingSlotDraftVehicleType.set(null);
  }

  /** Committed slots as canvas-px rects — the shape the placement rules reason about. */
  private parkingExistingSlotRects(el: CenterpieceElement, rect: PixelRect, ppm: number): SlotRect[] {
    return (el.parkingSlots ?? []).map((s) => ({
      cx: rect.x + (s.xPct / 100) * rect.width,
      cy: rect.y + (s.yPct / 100) * rect.height,
      rotationDeg: s.rotationDeg,
      lengthPx: s.lengthM * ppm,
      widthPx: s.widthM * ppm,
    }));
  }

  /**
   * Finishes the drawn path — fills every segment with the max slots that fit, then
   * `planParkingSlots` enforces the placement rules (inside outline, clear of every
   * gate's "way" circle, no slot overlap, car-width gap between independent rows)
   * before committing the survivors as one lane. Returns false when nothing could be
   * placed (caller should tell the user why).
   */
  finishParkingSlotDrawing(): boolean {
    const elementId = this.parkingSlotDrawingElementId();
    const points = [...this.parkingSlotDraftPoints()];
    const vehicleType = this.parkingSlotDraftVehicleType();
    const pattern = this.parkingSlotDraftPattern();
    this.parkingSlotDrawingElementId.set(null);
    this.parkingSlotDraftPoints.set([]);
    this.parkingSlotDraftVehicleType.set(null);
    // 'one' is the stamp tool — a single click is already a valid placement.
    if (!elementId || !vehicleType || points.length < (pattern === 'one' ? 1 : 2)) {
      return false;
    }
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isParkingArea(el)) {
      return false;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const outline = buildParkingOutlinePoints(rect, el.customPoints ?? [], el.edgeBowAmounts ?? []);
    if (outline.length < 3) {
      return false;
    }
    // Draft points are canvas-wide percentages (from toCanvasPct), NOT element-local —
    // convert against the full canvas, exactly like the live preview does. Mapping them
    // through the element rect instead would shrink the drawn path into a miniature
    // copy inside the block.
    const canvas = this.canvas();
    const pathPx = points.map((p) => ({
      x: (p.xPct / 100) * canvas.width,
      y: (p.yPct / 100) * canvas.height,
    }));
    const ppm = this.parkingPxPerMeter(el, rect);
    const defaults = this.parkingSlotDefaults.defaults()[vehicleType];
    const placed = planParkingSlots(pathPx, outline, ppm, defaults, pattern, {
      gateCenters: this.parkingAccessPointCentersPx(el, rect),
      existingSlots: this.parkingExistingSlotRects(el, rect, ppm),
    });
    if (placed.length === 0) {
      return false;
    }
    const laneId = this.nextParkingId('lane');
    // Bookable codes: one letter per lane (A, B, …), numbered 1..n along the row.
    const laneLetter = nextParkingLaneLetter((el.parkingSlots ?? []).map((s) => s.label));
    const newSlots: ParkingSlotSpec[] = placed.map((slot, index) => ({
      id: this.nextParkingId('slot'),
      laneId,
      label: `${laneLetter}${index + 1}`,
      vehicleType,
      xPct: ((slot.cx - rect.x) / Math.max(1, rect.width)) * 100,
      yPct: ((slot.cy - rect.y) / Math.max(1, rect.height)) * 100,
      rotationDeg: slot.rotationDeg,
      lengthM: defaults.lengthM,
      widthM: defaults.widthM,
    }));
    this.pushHistory();
    this.applyPatch(elementId, { parkingSlots: [...(el.parkingSlots ?? []), ...newSlots] });
    return true;
  }

  selectParkingSlot(slotId: string | null): void {
    this.selectedParkingSlotId.set(slotId);
  }

  /** Removes one individually selected slot — its code is never re-issued (see nextParkingLaneLetter). */
  removeParkingSlot(elementId: string, slotId: string): void {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isParkingArea(el)) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, {
      parkingSlots: (el.parkingSlots ?? []).filter((s) => s.id !== slotId),
    });
    if (this.selectedParkingSlotId() === slotId) {
      this.selectedParkingSlotId.set(null);
    }
  }

  /** Rename a parking slot's bookable code (audit misnamed auto-fix). */
  renameParkingSlot(elementId: string, slotId: string, label: string): void {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isParkingArea(el)) {
      return;
    }
    const next = label.trim();
    if (!next) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, {
      parkingSlots: (el.parkingSlots ?? []).map((s) => (s.id === slotId ? { ...s, label: next } : s)),
    });
  }

  /** Drag-move one slot (canvas gesture — silent updates, history via begin/commitGesture). */
  updateParkingSlotPositionSilent(elementId: string, slotId: string, xPct: number, yPct: number): void {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isParkingArea(el)) {
      return;
    }
    this.updateSilent(elementId, {
      parkingSlots: (el.parkingSlots ?? []).map((s) => (s.id === slotId ? { ...s, xPct, yPct } : s)),
    });
  }

  // --- Driving routes (Enter → Exit) ---

  /** Advances from "Add slots" to "Add routes". */
  proceedFromParkingSlots(): void {
    this.cancelParkingSlotDrawing();
    this.selectedParkingSlotId.set(null);
    this.parkingSlotPhase.set('routes');
  }

  /** Back from "Add routes" to "Add slots" (routes already drawn are kept). */
  backToParkingSlots(): void {
    this.cancelParkingRouteDrawing();
    this.parkingSlotPhase.set('slots');
  }

  startParkingRouteDrawing(elementId: string): void {
    this.cancelParkingAccessPointPlacement();
    this.cancelParkingSlotDrawing();
    this.parkingRouteDrawingElementId.set(elementId);
    this.parkingRouteDraftPoints.set([]);
  }

  /** Ignores clicks outside the parking outline — routes must stay inside the block. */
  addParkingRouteDraftPoint(point: ElementPosition): void {
    const elementId = this.parkingRouteDrawingElementId();
    const el = elementId ? this.elements().find((item) => item.id === elementId) : undefined;
    if (el && isParkingArea(el)) {
      const rect = rectFromPositionSize(el.position, el.size, this.canvas());
      const outline = buildParkingOutlinePoints(rect, el.customPoints ?? [], el.edgeBowAmounts ?? []);
      if (outline.length >= 3) {
        const px = {
          x: (point.xPct / 100) * this.canvas().width,
          y: (point.yPct / 100) * this.canvas().height,
        };
        if (!pointInPolygon(px, outline)) {
          return;
        }
      }
    }
    this.parkingRouteDraftPoints.update((pts) => [...pts, point]);
  }

  cancelParkingRouteDrawing(): void {
    this.parkingRouteDrawingElementId.set(null);
    this.parkingRouteDraftPoints.set([]);
  }

  /** Finishes the drawn route — stored element-local %, click order = driving direction. */
  finishParkingRouteDrawing(): boolean {
    const elementId = this.parkingRouteDrawingElementId();
    const points = [...this.parkingRouteDraftPoints()];
    this.parkingRouteDrawingElementId.set(null);
    this.parkingRouteDraftPoints.set([]);
    if (!elementId || points.length < 2) {
      return false;
    }
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isParkingArea(el)) {
      return false;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const canvas = this.canvas();
    const localPoints: ElementPosition[] = points.map((p) => ({
      xPct: (((p.xPct / 100) * canvas.width - rect.x) / Math.max(1, rect.width)) * 100,
      yPct: (((p.yPct / 100) * canvas.height - rect.y) / Math.max(1, rect.height)) * 100,
    }));
    const route: ParkingRouteSpec = {
      id: this.nextParkingId('route'),
      points: localPoints,
      label: `Route ${(el.parkingRoutes?.length ?? 0) + 1}`,
    };
    this.pushHistory();
    this.applyPatch(elementId, { parkingRoutes: [...(el.parkingRoutes ?? []), route] });
    return true;
  }

  removeParkingRoute(elementId: string, routeId: string): void {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isParkingArea(el)) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, {
      parkingRoutes: (el.parkingRoutes ?? []).filter((r) => r.id !== routeId),
    });
  }

  /**
   * Step 1 of the AI plan flow: creates ONLY the parking-area block from the detected
   * outline (prefilling every edge measurement when a scale was resolved), so the user
   * can inspect/correct it before confirming. Slots are added afterwards via
   * `addDetectedParkingSlots`. Lands the workspace on the right step: measurements
   * known → "Add parking lines" (access-points phase); otherwise → "measure edges".
   */
  applyDetectedParkingPlan(input: {
    outlineCanvasPct: ElementPosition[];
    sideLengthsM?: number[];
  }): string | null {
    const element = createParkingAreaFromPoints(input.outlineCanvasPct);
    if (!element || !isParkingArea(element)) {
      return null;
    }
    const edgeCount = element.customPoints?.length ?? 0;
    const lengths =
      input.sideLengthsM && input.sideLengthsM.length >= edgeCount && edgeCount >= 3
        ? input.sideLengthsM.slice(0, edgeCount)
        : undefined;
    if (lengths) {
      element.customSideLengthsM = lengths;
    }

    this.pushHistory();
    this.cancelDrawing();
    this.elements.update((items) => [...items, element]);
    this.selectElement(element.id);
    this.parkingWorkspaceId.set(element.id);
    if (lengths && this.allParkingEdgesMeasured(element.id)) {
      this.parkingWorkspaceStep.set('draw-lines');
      this.parkingSlotPhase.set('access-points');
      this.parkingMeasureEdgeIndex.set(null);
    } else {
      this.parkingWorkspaceStep.set('measure-edges');
      this.parkingMeasureEdgeIndex.set(0);
    }
    this.fitCameraToElement(element.id, { blockWorkspace: true });
    return element.id;
  }

  /**
   * Step 2 of the AI plan flow (after the user confirmed the block): places the
   * detected bays as labelled slots into the block. Conversion to element-local %
   * happens against the element's CURRENT rect, so an outline the user corrected in
   * between still lines the slots up with the plan image. Slots whose centre falls
   * outside the current outline are dropped. Returns the created lane ids so the
   * caller can offer an "undo" that removes exactly these lanes.
   */
  addDetectedParkingSlots(
    elementId: string,
    placements: {
      xPct: number;
      yPct: number;
      rotationDeg: number;
      lengthM: number;
      widthM: number;
      laneIndex: number;
      shapePoints?: { xPct: number; yPct: number }[];
      /** Real printed code (e.g. "S27") — used verbatim instead of auto-lettering. */
      label?: string;
      /** Lane-grouping key (a code prefix); falls back to laneIndex when absent. */
      laneKey?: string;
      /** Plan glyph height in metres — keeps canvas labels sized like the upload. */
      labelHeightM?: number;
    }[],
  ): { slotCount: number; laneIds: string[] } | null {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isParkingArea(el)) {
      return null;
    }
    const canvas = this.canvas();
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const outline = buildParkingOutlinePoints(rect, el.customPoints ?? [], el.edgeBowAmounts ?? []);
    const inside = placements.filter((p) => {
      if (outline.length < 3) {
        return true;
      }
      return pointInPolygon(
        { x: (p.xPct / 100) * canvas.width, y: (p.yPct / 100) * canvas.height },
        outline,
      );
    });
    if (inside.length === 0) {
      return { slotCount: 0, laneIds: [] };
    }

    const originX = el.position.xPct - el.size.wPct / 2;
    const originY = el.position.yPct - el.size.hPct / 2;
    // Lane letters continue after any already-used letters on this element (only used
    // for placements without a real printed code).
    const workingLabels: (string | undefined)[] = (el.parkingSlots ?? []).map((s) => s.label);
    const lanes = new Map<string, { laneId: string; letter: string; count: number }>();
    const newSlots: ParkingSlotSpec[] = [];
    for (const p of inside) {
      const laneGroupKey = p.laneKey ?? `#${p.laneIndex}`;
      let lane = lanes.get(laneGroupKey);
      if (!lane) {
        const letter = nextParkingLaneLetter(workingLabels);
        lane = { laneId: this.nextParkingId('lane'), letter, count: 0 };
        lanes.set(laneGroupKey, lane);
        workingLabels.push(`${letter}1`);
      }
      lane.count += 1;
      // Prefer the real printed code; fall back to the auto-generated A1/B1 scheme.
      const label = p.label ?? `${lane.letter}${lane.count}`;
      newSlots.push({
        id: this.nextParkingId('slot'),
        laneId: lane.laneId,
        label,
        vehicleType: 'car',
        xPct: ((p.xPct - originX) / Math.max(0.01, el.size.wPct)) * 100,
        yPct: ((p.yPct - originY) / Math.max(0.01, el.size.hPct)) * 100,
        rotationDeg: p.rotationDeg,
        lengthM: p.lengthM,
        widthM: p.widthM,
        ...(p.shapePoints && p.shapePoints.length >= 3 ? { shapePoints: p.shapePoints } : {}),
        ...(p.labelHeightM && p.labelHeightM > 0 ? { labelHeightM: p.labelHeightM } : {}),
      });
    }
    this.pushHistory();
    this.applyPatch(elementId, { parkingSlots: [...(el.parkingSlots ?? []), ...newSlots] });
    return { slotCount: newSlots.length, laneIds: [...lanes.values()].map((l) => l.laneId) };
  }

  // --- Custom-shape slot tool (dots → confirm → one slot) ---

  startParkingCustomSlotDrawing(elementId: string): void {
    this.cancelParkingAccessPointPlacement();
    this.cancelParkingSlotDrawing();
    this.cancelParkingRouteDrawing();
    this.selectedParkingSlotId.set(null);
    this.parkingCustomSlotDrawingElementId.set(elementId);
    this.parkingCustomSlotDraftPoints.set([]);
  }

  /** Ignores clicks outside the parking outline — the slot must stay inside the block. */
  addParkingCustomSlotDraftPoint(point: ElementPosition): void {
    const elementId = this.parkingCustomSlotDrawingElementId();
    const el = elementId ? this.elements().find((item) => item.id === elementId) : undefined;
    if (el && isParkingArea(el)) {
      const rect = rectFromPositionSize(el.position, el.size, this.canvas());
      const outline = buildParkingOutlinePoints(rect, el.customPoints ?? [], el.edgeBowAmounts ?? []);
      if (outline.length >= 3) {
        const px = {
          x: (point.xPct / 100) * this.canvas().width,
          y: (point.yPct / 100) * this.canvas().height,
        };
        if (!pointInPolygon(px, outline)) {
          return;
        }
      }
    }
    this.parkingCustomSlotDraftPoints.update((pts) => [...pts, point]);
  }

  cancelParkingCustomSlotDrawing(): void {
    this.parkingCustomSlotDrawingElementId.set(null);
    this.parkingCustomSlotDraftPoints.set([]);
  }

  /**
   * Confirms the drawn dots as ONE custom-shaped slot: its bounding box becomes the
   * slot's length×width (metres via the parking scale), the dots become `shapePoints`
   * (slot-local %), and it gets its own lane letter + "1" as the bookable code.
   */
  finishParkingCustomSlotDrawing(): boolean {
    const elementId = this.parkingCustomSlotDrawingElementId();
    const points = [...this.parkingCustomSlotDraftPoints()];
    this.parkingCustomSlotDrawingElementId.set(null);
    this.parkingCustomSlotDraftPoints.set([]);
    if (!elementId || points.length < 3) {
      return false;
    }
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isParkingArea(el)) {
      return false;
    }
    const canvas = this.canvas();
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const ppm = this.parkingPxPerMeter(el, rect);
    const pxPoints = points.map((p) => ({
      x: (p.xPct / 100) * canvas.width,
      y: (p.yPct / 100) * canvas.height,
    }));
    const minX = Math.min(...pxPoints.map((p) => p.x));
    const maxX = Math.max(...pxPoints.map((p) => p.x));
    const minY = Math.min(...pxPoints.map((p) => p.y));
    const maxY = Math.max(...pxPoints.map((p) => p.y));
    const boxW = Math.max(1, maxX - minX);
    const boxH = Math.max(1, maxY - minY);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const letter = nextParkingLaneLetter((el.parkingSlots ?? []).map((s) => s.label));
    const slot: ParkingSlotSpec = {
      id: this.nextParkingId('slot'),
      laneId: this.nextParkingId('lane'),
      label: `${letter}1`,
      vehicleType: 'car',
      xPct: ((centerX / canvas.width) * 100 - (el.position.xPct - el.size.wPct / 2)) /
        Math.max(0.01, el.size.wPct) * 100,
      yPct: ((centerY / canvas.height) * 100 - (el.position.yPct - el.size.hPct / 2)) /
        Math.max(0.01, el.size.hPct) * 100,
      rotationDeg: 0,
      lengthM: Math.max(0.5, Math.round((boxW / ppm) * 10) / 10),
      widthM: Math.max(0.5, Math.round((boxH / ppm) * 10) / 10),
      shapePoints: pxPoints.map((p) => ({
        xPct: ((p.x - minX) / boxW) * 100,
        yPct: ((p.y - minY) / boxH) * 100,
      })),
    };
    this.pushHistory();
    this.applyPatch(elementId, { parkingSlots: [...(el.parkingSlots ?? []), slot] });
    this.selectedParkingSlotId.set(slot.id);
    return true;
  }

  /** Removes every slot placed by one drawn path (lane), so it can be redrawn. */
  removeParkingSlotLane(elementId: string, laneId: string): void {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isParkingArea(el)) {
      return;
    }
    const selected = this.selectedParkingSlotId();
    if (selected && (el.parkingSlots ?? []).some((s) => s.id === selected && s.laneId === laneId)) {
      this.selectedParkingSlotId.set(null);
    }
    this.pushHistory();
    this.applyPatch(elementId, {
      parkingSlots: (el.parkingSlots ?? []).filter((s) => s.laneId !== laneId),
    });
  }

  /** Selects one raw edge of the parking outline for length entry (yellow on canvas + sidebar). */
  parkingSelectMeasureEdge(index: number | null): void {
    this.parkingMeasureEdgeIndex.set(index);
  }

  /**
   * Confirms a real-world length for one raw edge. Extends `customSideLengthsM` to match
   * `customPoints.length` (preserving already-confirmed entries), then auto-advances
   * selection to the next unmeasured edge so entry can proceed quickly edge-by-edge.
   */
  confirmParkingEdgeLength(elementId: string, edgeIndex: number, lengthM: number): void {
    if (!lengthM || lengthM <= 0) {
      return;
    }
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isParkingArea(el)) {
      return;
    }
    const n = el.customPoints?.length ?? 0;
    if (edgeIndex < 0 || edgeIndex >= n) {
      return;
    }
    const lengths = [...(el.customSideLengthsM ?? [])];
    while (lengths.length < n) {
      lengths.push(0);
    }
    lengths[edgeIndex] = lengthM;
    this.pushHistory();
    this.applyPatch(elementId, { customSideLengthsM: lengths });
    this.reshapeParkingOutlineToMeasuredLengths(elementId);

    // Auto-advance to the next unmeasured edge (lengthM was just set above, so this
    // naturally skips edgeIndex without needing to exclude it explicitly).
    const nextUnmeasured = lengths.findIndex((v) => !(v > 0));
    this.parkingMeasureEdgeIndex.set(nextUnmeasured >= 0 ? nextUnmeasured : null);
  }

  /**
   * Redraws the parking outline so each measured edge's on-screen length is proportional
   * to its real-world length (e.g. a 10 m edge renders twice as long as a 5 m edge),
   * instead of the freehand-drawn shape staying pixel-for-pixel unchanged. Re-runs on
   * every edge save so the block visibly settles into its true-to-scale shape as
   * measurements are filled in. No-ops until at least one edge has a saved length.
   */
  private reshapeParkingOutlineToMeasuredLengths(elementId: string): void {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isParkingArea(el) || (el.customPoints?.length ?? 0) < 3) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const relaxed = relaxParkingPolygonToLengths(rect, el.customPoints ?? [], el.customSideLengthsM ?? []);
    if (!relaxed) {
      return;
    }
    const canvas = this.canvas();
    const normalized = renormalizeFromCanvasPoints(relaxed.map((p) => canvasPxToPct(p, canvas)));
    if (!normalized) {
      return;
    }
    this.applyPatch(elementId, {
      position: normalized.position,
      size: normalized.size,
      customPoints: normalized.customPoints,
    });
  }

  /** True once every raw edge of the outline has a positive measured length. */
  allParkingEdgesMeasured(elementId: string): boolean {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isParkingArea(el)) {
      return false;
    }
    const n = el.customPoints?.length ?? 0;
    if (n < 3) {
      return false;
    }
    const lengths = el.customSideLengthsM ?? [];
    for (let i = 0; i < n; i++) {
      if (!(lengths[i] > 0)) {
        return false;
      }
    }
    return true;
  }

  /** Advances from "measure edges" to "add parking lines" — only once every edge is measured. */
  proceedFromParkingMeasureEdges(elementId: string): boolean {
    if (!this.allParkingEdgesMeasured(elementId)) {
      return false;
    }
    this.parkingMeasureEdgeIndex.set(null);
    this.parkingWorkspaceStep.set('draw-lines');
    this.parkingSlotPhase.set(this.hasRequiredParkingAccessPoints(elementId) ? 'slots' : 'access-points');
    return true;
  }

  // --- Custom shape seating ---

  private getCenterpiece(id: string): CenterpieceElement | null {
    const el = this.elements().find((item) => item.id === id);
    return el?.type === 'centerpiece' ? el : null;
  }

  enableCustomShapeSeating(id: string, dims: PhysicalDimsInput, startDraw = false): void {
    const el = this.getCenterpiece(id);
    if (!el || !hasTracedBlockOutline(el)) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = createEmptyCustomShapeSeating(el, rect, dims);
    this.pushHistory();
    this.applyPatch(id, patch);
    this.seatRowDrawingElementId.set(null);
    this.seatRowDraftPoints.set([]);
    if (startDraw) {
      this.startSeatRowDrawing(id);
    }
  }

  startSeatRowDrawing(id: string): void {
    const el = this.getCenterpiece(id);
    if (!el || !hasTracedBlockOutline(el)) {
      return;
    }
    this.cancelPerSeatPlacement();
    this.cancelArrangeByRow();
    this.cancelLineSeatDrawing();
    this.pendingSeatRow.set(null);
    this.seatRowDrawingElementId.set(id);
    this.seatRowDraftPoints.set([]);
    this.seatRowDraftRows.set([]);
    this.drawingElementId.set(null);
    this.draftPoints.set([]);
    this.selectedId.set(id);
    this.selectedSeatId.set(null);
  }

  addSeatRowDraftPoint(point: ElementPosition): void {
    this.seatRowDraftPoints.update((pts) => [...pts, point]);
  }

  completeSeatRowDraftRow(): void {
    const points = [...this.seatRowDraftPoints()];
    if (points.length < 2) {
      return;
    }
    this.seatRowDraftRows.update((rows) => [...rows, points]);
    this.seatRowDraftPoints.set([]);
  }

  finishSeatRowDrawing(): void {
    const id = this.seatRowDrawingElementId();
    const points = [...this.seatRowDraftPoints()];
    const rows = [...this.seatRowDraftRows()];
    this.seatRowDrawingElementId.set(null);
    this.seatRowDraftPoints.set([]);
    this.seatRowDraftRows.set([]);
    if (points.length >= 2) {
      rows.push(points);
    }
    if (!id || rows.length === 0) {
      return;
    }
    const el = this.getCenterpiece(id);
    if (!el) {
      return;
    }

    this.pendingSeatRow.set({ elementId: id, rowLines: rows });
    this.pendingBlockPreviewLengthM.set(el.physicalLengthM ?? 10);
    this.pendingBlockPreviewWidthM.set(el.physicalWidthM ?? 8);
    this.selectedId.set(id);
  }

  setPendingBlockPreviewLengthM(value: number): void {
    this.pendingBlockPreviewLengthM.set(Math.max(0.1, value));
  }

  setPendingBlockPreviewWidthM(value: number): void {
    this.pendingBlockPreviewWidthM.set(Math.max(0.1, value));
  }

  applyPendingSeatRowWithDims(id: string, dims: PhysicalDimsInput): void {
    const pending = this.pendingSeatRow();
    const el = this.getCenterpiece(id);
    if (!el || !pending || pending.elementId !== id || pending.rowLines.length === 0) {
      return;
    }
    const mergedDims: PhysicalDimsInput = {
      ...dims,
      seatGapM: dims.seatGapM ?? resolveSeatGapM(el),
      rowGapM: dims.rowGapM ?? resolveRowGapM(el),
    };
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const blockIndex = el.customSeatBlocks?.length ?? 0;
    const block = createSeatBlockFromDrawnZone(
      el,
      rect,
      this.canvas(),
      pending.rowLines,
      mergedDims,
      blockIndex,
    );
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const seatFacingDeg = resolveSeatFacingDegForShapeSeats(el, polygon);
    const blockPitch = block.seatLayout?.customShapeSeatPitchPx;
    this.pushHistory();
    this.applyPatch(id, {
      physicalLengthM: mergedDims.physicalLengthM,
      physicalWidthM: mergedDims.physicalWidthM,
      chairLengthM: mergedDims.chairLengthM,
      chairWidthM: mergedDims.chairWidthM,
      seatGapM: mergedDims.seatGapM,
      rowGapM: mergedDims.rowGapM,
      seatFacingDeg,
      customSeatBlocks: [...(el.customSeatBlocks ?? []), block],
      seatLayout:
        el.seatLayout || blockPitch != null
          ? {
              ...(el.seatLayout ?? {
                rows: block.rows,
                seatsPerRow: block.seatsPerRow,
                rowSeatCounts: block.seatLayout?.rowSeatCounts,
              }),
              ...(blockPitch != null && blockPitch > 0
                ? { customShapeSeatPitchPx: blockPitch }
                : {}),
            }
          : undefined,
      code: el.code?.trim() || el.name?.trim() || 'CUSTOM',
    });
    this.pendingSeatRow.set(null);
  }

  cancelPendingSeatRow(): void {
    this.pendingSeatRow.set(null);
  }

  cancelSeatRowDrawing(): void {
    this.seatRowDrawingElementId.set(null);
    this.seatRowDraftPoints.set([]);
    this.seatRowDraftRows.set([]);
    this.pendingSeatRow.set(null);
  }

  startLineSeatDrawing(id: string): void {
    const el = this.getCenterpiece(id);
    if (!el || !hasTracedBlockOutline(el)) {
      return;
    }
    this.cancelPerSeatPlacement();
    this.cancelArrangeByRow();
    this.cancelSeatRowDrawing();
    this.pendingSeatRow.set(null);
    this.lineSeatDrawingElementId.set(id);
    this.lineSeatDraftPoints.set([]);
    this.drawingElementId.set(null);
    this.draftPoints.set([]);
    this.selectedId.set(id);
    this.selectedSeatId.set(null);
  }

  addLineSeatDraftPoint(point: ElementPosition): void {
    this.lineSeatDraftPoints.update((pts) => [...pts, point]);
  }

  finishLineSeatDrawing(): void {
    const id = this.lineSeatDrawingElementId();
    const points = [...this.lineSeatDraftPoints()];
    this.lineSeatDrawingElementId.set(null);
    this.lineSeatDraftPoints.set([]);
    if (!id || points.length < 2) {
      return;
    }
    let el = this.getCenterpiece(id);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    if (!isCustomShapeSeatingEnabled(el)) {
      const dims: PhysicalDimsInput = {
        physicalLengthM: resolveBlockLengthM(el),
        physicalWidthM: resolveBlockWidthM(el),
        chairLengthM: resolveChairLengthM(el),
        chairWidthM: resolveChairWidthM(el),
      };
      const enablePatch = createEmptyCustomShapeSeating(el, rect, dims);
      this.pushHistory();
      this.applyPatch(id, enablePatch);
      el = this.getCenterpiece(id);
      if (!el) {
        return;
      }
    }
    const patch = addSeatRowFromLine(el, rect, this.canvas(), points);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.pushHistory();
    this.applyPatch(id, patch);
    this.selectedId.set(id);
  }

  cancelLineSeatDrawing(): void {
    this.lineSeatDrawingElementId.set(null);
    this.lineSeatDraftPoints.set([]);
  }

  startPerSeatPlacement(id: string): void {
    const el = this.getCenterpiece(id);
    if (!el || !hasTracedBlockOutline(el)) {
      return;
    }
    this.cancelSeatRowDrawing();
    this.cancelLineSeatDrawing();
    this.cancelArrangeByRow();
    this.pendingSeatRow.set(null);
    this.drawingElementId.set(null);
    this.draftPoints.set([]);
    this.perSeatPlacementElementId.set(id);
    this.selectedId.set(id);
    this.selectedSeatId.set(null);

    if (!isCustomShapeSeatingEnabled(el)) {
      const rect = rectFromPositionSize(el.position, el.size, this.canvas());
      const dims: PhysicalDimsInput = {
        physicalLengthM: resolveBlockLengthM(el),
        physicalWidthM: resolveBlockWidthM(el),
        chairLengthM: resolveChairLengthM(el),
        chairWidthM: resolveChairWidthM(el),
      };
      const enablePatch = {
        ...createEmptyCustomShapeSeating(el, rect, dims),
        perSeatPlacementMode: true,
      };
      this.pushHistory();
      this.applyPatch(id, enablePatch);
      return;
    }

    if (!el.perSeatPlacementMode) {
      this.pushHistory();
      this.applyPatch(id, { perSeatPlacementMode: true });
    }
  }

  placePerSeatAt(elementId: string, canvasPct: ElementPosition): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = addCustomShapeSeatAtPoint(el, rect, this.canvas(), canvasPct);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, patch);
    this.selectedId.set(elementId);
  }

  cancelPerSeatPlacement(): void {
    this.perSeatPlacementElementId.set(null);
  }

  startDrawAisle(aisleId: string, options?: { replace?: boolean }): void {
    const el = this.blockWorkspaceElement();
    if (!el || el.blockType !== 'seating') {
      this.autoFillError.set('Configure a seating block before drawing an aisle.');
      return;
    }
    this.perSeatPlacementElementId.set(null);
    this.tablePlacementElementId.set(null);
    const aisles = normalizeAutoFillAisles(
      this.autoFillSeatingConfig().aisles,
      this.autoFillSeatingConfig(),
    );
    const target = aisles.find((slot) => slot.id === aisleId);
    if (!target || target.type !== 'draw') {
      return;
    }
    if (options?.replace) {
      this.setAutoFillSeatingConfig({
        aisles: aisles.map((slot) =>
          slot.id === aisleId ? { ...slot, drawStart: undefined, drawEnd: undefined } : slot,
        ),
      });
    }
    this.drawAisleSession.set({ aisleId, blockId: el.id });
    this.autoFillError.set(null);
  }

  cancelDrawAisle(): void {
    this.drawAisleSession.set(null);
  }

  placeDrawAislePoint(elementId: string, canvasPct: ElementPosition): void {
    const session = this.drawAisleSession();
    const el = this.getCenterpiece(elementId);
    if (!session || !el || el.id !== session.blockId) {
      return;
    }
    const local = canvasPctToLocalPoint(el, canvasPct, this.canvas());
    const clamped = {
      xPct: Math.max(0, Math.min(100, local.xPct)),
      yPct: Math.max(0, Math.min(100, local.yPct)),
    };
    if (!session.pendingStart) {
      this.drawAisleSession.set({ ...session, pendingStart: clamped });
      return;
    }
    const aisles = normalizeAutoFillAisles(
      this.autoFillSeatingConfig().aisles,
      this.autoFillSeatingConfig(),
    );
    const nextAisles = aisles.map((slot) =>
      slot.id === session.aisleId
        ? { ...slot, type: 'draw' as const, drawStart: session.pendingStart, drawEnd: clamped }
        : slot,
    );
    this.drawAisleSession.set(null);
    this.setAutoFillSeatingConfig({ aisles: nextAisles });
    this.refillWorkspaceSeatsForDrawnAisle();
  }

  updateDrawAisleGeometry(
    aisleId: string,
    patch: Partial<Pick<AutoFillAisleSlot, 'drawStart' | 'drawEnd' | 'widthM'>>,
    options?: { refill?: boolean },
  ): void {
    const aisles = normalizeAutoFillAisles(
      this.autoFillSeatingConfig().aisles,
      this.autoFillSeatingConfig(),
    );
    const nextAisles = aisles.map((slot) =>
      slot.id === aisleId ? { ...slot, ...patch } : slot,
    );
    this.setAutoFillSeatingConfig({ aisles: nextAisles });
    if (options?.refill !== false) {
      this.refillWorkspaceSeatsForDrawnAisle();
    }
  }

  /** Re-pack seats around the current drawn aisle(s) when seats already exist. */
  refillWorkspaceSeatsForDrawnAisle(): void {
    const el = this.blockWorkspaceElement();
    if (!el || el.blockType !== 'seating') {
      return;
    }
    const hasSeats = Object.keys(el.seatPositionOverrides ?? {}).length > 0;
    if (!hasSeats) {
      return;
    }
    const config = this.autoFillSeatingConfig();
    const aisles = normalizeAutoFillAisles(config.aisles, config);
    if (!aisles.some((slot) => isCompleteDrawnAisle(slot))) {
      return;
    }
    const outcome = applyAutoFillToBlock(el, this.elements(), this.canvas(), config);
    if ('error' in outcome) {
      this.autoFillError.set(outcome.error);
      return;
    }
    this.applyPatch(el.id, outcome.patch);
    this.autoFillError.set(null);
  }

  startTablePlacement(id: string): boolean {
    const el = this.getCenterpiece(id);
    if (!el || !hasTracedBlockOutline(el)) {
      return false;
    }
    this.zoomBlockWorkspaceForTableEditing(id);
    this.cancelSeatRowDrawing();
    this.cancelLineSeatDrawing();
    this.cancelPerSeatPlacement();
    this.cancelArrangeByRow();
    this.pendingSeatRow.set(null);
    this.drawingElementId.set(null);
    this.draftPoints.set([]);
    this.tablePlacementElementId.set(id);
    this.selectedId.set(id);
    this.selectedTableId.set(null);
    this.selectedTableIds.set([]);
    if (!el.tablePlacementMode) {
      this.pushHistory();
      this.applyPatch(id, { tablePlacementMode: true, tableGridMode: undefined });
    }
    return true;
  }

  setTablePlacementDefaults(defaults: {
    shape: 'round' | 'rectangular';
    seats: number;
    widthM: number;
    depthM: number;
    gapM: number;
    chairWidthM: number;
    chairLengthM: number;
  } | null): void {
    this.tablePlacementDefaults.set(defaults);
  }

  placeTableAt(elementId: string, canvasPct: ElementPosition): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const draft = this.tablePlacementDefaults();
    const shape = draft?.shape ?? resolveDefaultTableShape(el);
    const seats = draft?.seats ?? resolveDefaultTableSeats(el);
    const widthM = draft?.widthM ?? resolveDefaultTableWidthM(el);
    const depthM = draft?.depthM ?? resolveDefaultTableDepthM(el);
    const gapM = draft?.gapM ?? resolveDefaultTableGapM(el);
    const patch = addTableAtPoint(el, rect, this.canvas(), canvasPct, {
      shape,
      seats,
      widthM,
      depthM,
    });
    if (Object.keys(patch).length === 0) {
      this.tableGapRuleAlert.set('Click inside the block to place a table.');
      return;
    }
    const tables = patch.diningTables ?? [];
    const last = tables[tables.length - 1];
    if (last) {
      const violation = findTableGapViolation(
        el,
        {
          tableId: last.id,
          xPct: last.xPct,
          yPct: last.yPct,
          shape: last.shape,
          widthM: last.widthM,
          depthM: last.depthM,
          seats: last.seats,
        },
        gapM,
      );
      if (violation) {
        this.tableGapRuleAlert.set(formatTableGapViolationMessage(violation));
        return;
      }
    }
    this.tableGapRuleAlert.set(null);
    this.pushHistory();
    this.applyPatch(elementId, {
      ...patch,
      defaultDiningTableShape: shape,
      defaultTableSeats: seats,
      defaultTableWidthM: widthM,
      defaultTableDepthM: depthM,
      defaultTableGapM: gapM,
      ...(draft
        ? { chairWidthM: draft.chairWidthM, chairLengthM: draft.chairLengthM }
        : {}),
    });
    this.selectedId.set(elementId);
    if (last) {
      this.selectedTableId.set(last.id);
    }
  }

  clearTableGapRuleAlert(): void {
    this.tableGapRuleAlert.set(null);
  }

  cancelTablePlacement(): void {
    this.tablePlacementElementId.set(null);
    this.tablePlacementDefaults.set(null);
  }

  setDiningAccessPointsLocked(locked: boolean): void {
    this.diningAccessPointsLocked.set(locked);
    if (locked) {
      this.cancelAccessPointPlacement();
    }
  }

  /** Drag an already-placed access point along block edges (step 2 only). */
  moveDiningAccessPointAt(
    elementId: string,
    kind: DiningAccessPointKind,
    canvasPct: ElementPosition,
  ): void {
    if (this.diningAccessPointsLocked()) {
      return;
    }
    const el = this.getCenterpiece(elementId);
    if (!el || el.type !== 'centerpiece') {
      return;
    }
    const existing =
      kind === 'shared'
        ? el.diningSharedAccessPoint
        : kind === 'entrance'
          ? el.diningEntrance
          : el.diningExit;
    if (!existing) {
      return;
    }

    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const canvasX = (canvasPct.xPct / 100) * this.canvas().width;
    const canvasY = (canvasPct.yPct / 100) * this.canvas().height;
    const preview = resolveDiningAccessPointAtCanvasPoint(el, rect, canvasX, canvasY, kind);
    if (!preview) {
      return;
    }

    const next: DiningAccessPointSpec = {
      ...preview.accessPoint,
      id: existing.id,
      widthM: resolveDiningAccessWidthM(existing),
      depthM: existing.depthM > 0 ? existing.depthM : preview.accessPoint.depthM,
    };

    if (kind === 'shared') {
      this.updateSilent(elementId, { diningSharedAccessPoint: next });
    } else if (kind === 'entrance') {
      this.updateSilent(elementId, { diningEntrance: next });
    } else {
      this.updateSilent(elementId, { diningExit: next });
    }
  }

  commitDiningAccessPointDrag(elementId: string): void {
    const el = this.getCenterpiece(elementId);
    if (el) {
      this.regridDiningLayoutAfterAccessChange(elementId, el);
    }
  }

  startAccessPointPlacement(id: string, kind: DiningAccessPointKind): void {
    if (this.diningAccessPointsLocked()) {
      return;
    }
    const el = this.getCenterpiece(id);
    if (!el || !hasTracedBlockOutline(el)) {
      return;
    }
    this.cancelSeatRowDrawing();
    this.cancelLineSeatDrawing();
    this.cancelPerSeatPlacement();
    this.cancelArrangeByRow();
    this.cancelTablePlacement();
    this.accessPointPlacementPreview.set(null);
    this.accessPointPlacementKind.set(kind);
    this.accessPointPlacementElementId.set(id);
    const hasExisting =
      kind === 'shared'
        ? el.diningSharedAccessPoint != null
        : kind === 'entrance'
          ? el.diningEntrance != null
          : el.diningExit != null;
    this.accessPointPlacementHint.set(
      hasExisting
        ? this.accessPointPlacementAdjustHint(kind)
        : this.accessPointPlacementStartHint(kind),
    );
    this.selectedId.set(id);
  }

  startExitPlacement(id: string): void {
    this.startAccessPointPlacement(id, 'exit');
  }

  startEntrancePlacement(id: string): void {
    this.startAccessPointPlacement(id, 'entrance');
  }

  cancelAccessPointPlacement(): void {
    this.accessPointPlacementElementId.set(null);
    this.accessPointPlacementPreview.set(null);
    this.accessPointPlacementHint.set(null);
  }

  cancelExitPlacement(): void {
    this.cancelAccessPointPlacement();
  }

  /** Update the dashed access-point ghost that follows the pointer during placement. */
  updateAccessPointPlacementPreview(elementId: string, pct: ElementPosition): void {
    if (this.accessPointPlacementElementId() !== elementId) {
      this.accessPointPlacementPreview.set(null);
      return;
    }
    const el = this.getCenterpiece(elementId);
    if (!el || el.type !== 'centerpiece') {
      this.accessPointPlacementPreview.set(null);
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const canvasX = (pct.xPct / 100) * this.canvas().width;
    const canvasY = (pct.yPct / 100) * this.canvas().height;
    this.accessPointPlacementPreview.set(
      resolveDiningAccessPointAtCanvasPoint(
        el,
        rect,
        canvasX,
        canvasY,
        this.accessPointPlacementKind(),
        this.accessPointEdgeHitPx(),
      ),
    );
  }

  updateExitPlacementPreview(elementId: string, pct: ElementPosition): void {
    this.updateAccessPointPlacementPreview(elementId, pct);
  }

  placeAccessPointAt(elementId: string, pct: ElementPosition): void {
    if (this.accessPointPlacementElementId() !== elementId) {
      return;
    }
    const el = this.getCenterpiece(elementId);
    if (!el || el.type !== 'centerpiece') return;

    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const canvasX = (pct.xPct / 100) * this.canvas().width;
    const canvasY = (pct.yPct / 100) * this.canvas().height;
    const kind = this.accessPointPlacementKind();
    const preview = resolveDiningAccessPointAtCanvasPoint(
      el,
      rect,
      canvasX,
      canvasY,
      kind,
      this.accessPointEdgeHitPx(),
    );
    if (!preview) {
      this.accessPointPlacementHint.set(this.accessPointPlacementMissHint());
      return;
    }

    this.pushHistory();
    if (kind === 'shared') {
      this.applyPatch(elementId, {
        diningAccessMode: 'shared',
        diningSharedAccessPoint: preview.accessPoint,
        diningEntrance: undefined,
        diningExit: undefined,
      });
    } else if (kind === 'entrance') {
      this.applyPatch(elementId, { diningEntrance: preview.accessPoint });
    } else {
      this.applyPatch(elementId, { diningExit: preview.accessPoint });
    }

    this.regridDiningLayoutAfterAccessChange(elementId, el);

    this.accessPointPlacementElementId.set(null);
    this.accessPointPlacementPreview.set(null);
    this.accessPointPlacementHint.set(null);
  }

  placeExitAt(elementId: string, pct: ElementPosition): void {
    this.accessPointPlacementKind.set('exit');
    this.placeAccessPointAt(elementId, pct);
  }

  private accessPointEdgeHitPx(): number {
    return diningAccessEdgeHitThresholdPx(this.zoom());
  }

  private accessPointPlacementStartHint(kind: DiningAccessPointKind): string {
    if (kind === 'entrance') {
      return 'Click on a block edge to place the entrance.';
    }
    if (kind === 'shared') {
      return 'Click on a block edge to place the shared access point.';
    }
    return 'Click on a block edge to place the exit.';
  }

  private accessPointPlacementAdjustHint(kind: DiningAccessPointKind): string {
    if (kind === 'entrance') {
      return 'Click on a block edge to adjust the entrance.';
    }
    if (kind === 'shared') {
      return 'Click on a block edge to adjust the access point.';
    }
    return 'Click on a block edge to adjust the exit.';
  }

  private accessPointPlacementMissHint(): string {
    return 'Please click on the block border to place the access point.';
  }

  removeDiningEntrance(elementId: string): void {
    const el = this.getCenterpiece(elementId);
    if (!el || el.type !== 'centerpiece') return;

    this.pushHistory();
    this.applyPatch(elementId, {
      diningEntrance: undefined,
    });

    this.regridDiningLayoutAfterAccessChange(elementId, el);
  }

  removeDiningExit(elementId: string): void {
    const el = this.getCenterpiece(elementId);
    if (!el || el.type !== 'centerpiece') return;

    this.pushHistory();
    this.applyPatch(elementId, {
      diningExit: undefined
    });

    this.regridDiningLayoutAfterAccessChange(elementId, el);
  }

  removeDiningSharedAccess(elementId: string): void {
    const el = this.getCenterpiece(elementId);
    if (!el || el.type !== 'centerpiece') {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, { diningSharedAccessPoint: undefined });
    this.regridDiningLayoutAfterAccessChange(elementId, el);
  }

  setDiningAccessMode(
    elementId: string,
    mode: DiningAccessMode,
    sharedSource?: 'entrance' | 'exit',
  ): void {
    const el = this.getCenterpiece(elementId);
    if (!el || el.type !== 'centerpiece') {
      return;
    }
    this.pushHistory();
    if (mode === 'shared') {
      const source =
        sharedSource === 'exit'
          ? el.diningExit
          : sharedSource === 'entrance'
            ? el.diningEntrance
            : el.diningEntrance ?? el.diningExit ?? null;
      this.applyPatch(elementId, {
        diningAccessMode: 'shared',
        diningSharedAccessPoint: source
          ? cloneAccessPointAsKind(source, 'shared')
          : el.diningSharedAccessPoint,
        diningEntrance: undefined,
        diningExit: undefined,
      });
    } else {
      const shared = el.diningSharedAccessPoint;
      this.applyPatch(elementId, {
        diningAccessMode: 'separate',
        diningEntrance: shared
          ? cloneAccessPointAsKind(shared, 'entrance')
          : el.diningEntrance,
        diningExit: shared ? undefined : el.diningExit,
        diningSharedAccessPoint: undefined,
      });
    }
    this.regridDiningLayoutAfterAccessChange(elementId, this.getCenterpiece(elementId) ?? el);
  }

  updateDiningAccessPointWidth(
    elementId: string,
    target: 'entrance' | 'exit' | 'shared',
    widthM: number,
  ): { appliedWidthM: number; maxWidthM: number | null; clamped: boolean } | null {
    const el = this.getCenterpiece(elementId);
    if (!el || el.type !== 'centerpiece') {
      return null;
    }
    const spec: DiningAccessPointSpec | undefined =
      target === 'shared'
        ? el.diningSharedAccessPoint
        : target === 'entrance'
          ? el.diningEntrance
          : el.diningExit;
    if (!spec) {
      return null;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const edgeLenM = diningAccessEdgeLengthM(el, rect, spec.sideEdgeId);
    const requested = Math.max(MIN_DINING_ACCESS_WIDTH_M, widthM);
    const next = clampDiningAccessPointToEdge(el, rect, {
      ...spec,
      widthM: requested,
    });
    const appliedWidthM = resolveDiningAccessWidthM(next);
    const clamped = edgeLenM != null && requested > edgeLenM + 1e-6;
    const prevWidth = resolveDiningAccessWidthM(spec);
    const sameWidth = Math.abs(prevWidth - appliedWidthM) < 1e-6;
    const sameOffset =
      Math.abs((spec.offsetAlongEdgeM ?? 0) - (next.offsetAlongEdgeM ?? 0)) < 1e-6;
    if (sameWidth && sameOffset) {
      return { appliedWidthM, maxWidthM: edgeLenM, clamped };
    }
    // Width-only edits must not rebuild tables, clear table selection, or refit the viewport.
    // One history entry per edit gesture (spinner burst / typing session).
    if (!this.accessWidthHistoryOpen) {
      this.pushHistory();
      this.accessWidthHistoryOpen = true;
    }
    if (target === 'shared') {
      this.applyPatch(elementId, { diningSharedAccessPoint: next });
    } else if (target === 'entrance') {
      this.applyPatch(elementId, { diningEntrance: next });
    } else {
      this.applyPatch(elementId, { diningExit: next });
    }
    return { appliedWidthM, maxWidthM: edgeLenM, clamped };
  }

  /** End a width-edit gesture so the next change starts a new undo entry. */
  commitAccessWidthEdit(): void {
    this.accessWidthHistoryOpen = false;
  }

  /** Max physical width that fits on a dining block edge (metres). */
  diningAccessMaxWidthM(elementId: string, sideEdgeId: number): number | null {
    const el = this.getCenterpiece(elementId);
    if (!el || el.type !== 'centerpiece') {
      return null;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    return diningAccessEdgeLengthM(el, rect, sideEdgeId);
  }

  setDiningAccessDefaultWidths(
    elementId: string,
    widths: {
      entranceM: number;
      exitM: number;
      sharedM: number;
    },
  ): void {
    const el = this.getCenterpiece(elementId);
    if (!el || el.type !== 'centerpiece') {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, {
      defaultDiningEntranceWidthM: Math.max(MIN_DINING_ACCESS_WIDTH_M, widths.entranceM),
      defaultDiningExitWidthM: Math.max(MIN_DINING_ACCESS_WIDTH_M, widths.exitM),
      defaultDiningSharedAccessWidthM: Math.max(MIN_DINING_ACCESS_WIDTH_M, widths.sharedM),
    });
  }

  private regridDiningLayoutAfterAccessChange(elementId: string, el: CenterpieceElement): void {
    const templateId = el.appliedDiningLayoutTemplateId;
    if (!templateId) {
      return;
    }
    // Generated layouts store real table geometry — never rebuild from a recipe id.
    if (el.diningLayoutGeneration || templateId.startsWith('gen-')) {
      return;
    }
    const recipe = DINING_LAYOUT_RECIPES.find((r) => r.id === templateId);
    if (!recipe) {
      return;
    }
    this.applyTableGrid(elementId, {
      shape: el.defaultDiningTableShape ?? 'round',
      seats: el.defaultTableSeats ?? DEFAULT_TABLE_SEATS,
      widthM: el.defaultTableWidthM ?? DEFAULT_TABLE_WIDTH_M,
      depthM: el.defaultTableDepthM ?? DEFAULT_TABLE_DEPTH_M,
      gapM: el.defaultTableGapM ?? DEFAULT_TABLE_GAP_M,
      template: recipe.template,
    });
  }

  beginDiningBackgroundAdjust(session: {
    elementId: string;
    source: DiningLayoutReferenceImage;
    blockAspect: number;
    clipSource: DiningBackgroundClipSource;
    initialFit: DiningBackgroundFit;
  }): void {
    this.diningBackgroundAdjust.set({ ...session });
  }

  cancelDiningBackgroundAdjust(): void {
    this.diningBackgroundAdjust.set(null);
  }

  commitDiningBackgroundAdjust(fit: DiningBackgroundFit): void {
    const session = this.diningBackgroundAdjust();
    if (!session) {
      return;
    }
    this.setDiningBackgroundImage(
      session.elementId,
      diningBackgroundImageFromFit(session.source, { ...fit, visible: true }, session.clipSource),
    );
    this.diningBackgroundAdjust.set(null);
  }

  setDiningBackgroundImage(elementId: string, image: DiningLayoutReferenceImage): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, { diningLayoutReferenceImage: { ...image } });
  }

  updateDiningBackgroundImage(
    elementId: string,
    patch: Partial<DiningLayoutReferenceImage>,
  ): void {
    const el = this.getCenterpiece(elementId);
    if (!el?.diningLayoutReferenceImage) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, {
      diningLayoutReferenceImage: {
        ...el.diningLayoutReferenceImage,
        ...patch,
      },
    });
  }

  removeDiningBackgroundImage(elementId: string): void {
    const el = this.getCenterpiece(elementId);
    if (!el?.diningLayoutReferenceImage) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, { diningLayoutReferenceImage: undefined });
  }

  applyTableGrid(elementId: string, options: TableGridOptions): string | null {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return 'Block not found.';
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const result = createAutoTableGrid(el, rect, options);
    if ('error' in result) {
      return result.error;
    }
    this.pushHistory();
    this.applyPatch(elementId, result);
    this.tablePlacementElementId.set(null);
    this.selectedTableId.set(null);
    this.selectedTableIds.set([]);
    return null;
  }

  applyTableCountGrid(elementId: string, options: TableCountGridOptions): string | null {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return 'Block not found.';
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const result = createTableCountGrid(el, rect, options);
    if ('error' in result) {
      return result.error;
    }
    this.pushHistory();
    this.applyPatch(elementId, result);
    this.tablePlacementElementId.set(null);
    this.selectedTableId.set(null);
    this.selectedTableIds.set([]);
    return null;
  }

  addDiningStage(elementId: string): void {
    this.startStageSidePick(elementId, false);
  }

  startStageSidePick(elementId: string, reorient: boolean): void {
    const el = this.getCenterpiece(elementId);
    if (!el || !hasTracedBlockOutline(el)) {
      return;
    }
    if (reorient && !el.diningStage) {
      return;
    }
    if (!reorient && el.diningStage) {
      return;
    }
    this.stageSidePickElementId.set(elementId);
    this.stageSidePickReorient.set(reorient);
    this.selectedId.set(elementId);
    this.zoomBlockWorkspaceForTableEditing(elementId);
  }

  cancelStageSidePick(): void {
    this.stageSidePickElementId.set(null);
    this.stageSidePickReorient.set(false);
  }

  isStageSidePickMode(): boolean {
    return this.stageSidePickElementId() != null;
  }

  applyStageOnSide(elementId: string, sideEdgeId: number): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    let stage: DiningStageSpec | null = null;
    if (this.stageSidePickReorient() && el.diningStage) {
      stage = reorientDiningStageToSide(el, rect, el.diningStage, sideEdgeId);
    } else {
      stage = createDiningStageOnSide(el, rect, sideEdgeId);
    }
    if (!stage) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, { diningStage: stage });
    this.cancelStageSidePick();
    this.diningStageSelected.set(true);
  }

  stageSideLabelFor(elementId: string, sideEdgeId: number): string {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return `Side ${sideEdgeId + 1}`;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    return stageSideLabel(el, rect, sideEdgeId);
  }

  removeDiningStage(elementId: string): void {
    const el = this.getCenterpiece(elementId);
    if (!el || !el.diningStage) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, { diningStage: undefined });
    this.diningStageSelected.set(false);
  }

  updateDiningStage(elementId: string, patch: Partial<DiningStageSpec>): void {
    const el = this.getCenterpiece(elementId);
    if (!el?.diningStage) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const merged: DiningStageSpec = {
      ...el.diningStage,
      ...patch,
      widthM: patch.widthM != null ? Math.max(0.5, patch.widthM) : el.diningStage.widthM,
      depthM: patch.depthM != null ? Math.max(0.3, patch.depthM) : el.diningStage.depthM,
    };
    if (patch.rotationDeg != null && Number.isFinite(patch.rotationDeg)) {
      merged.rotationDeg = normalizeDiningFeatureRotationDeg(patch.rotationDeg);
    }
    let positioned = merged;
    if (patch.sideEdgeId != null && patch.sideEdgeId !== el.diningStage.sideEdgeId) {
      positioned = reorientDiningStageToSide(el, rect, merged, patch.sideEdgeId) ?? merged;
    } else if (merged.alignment === 'edge' || !merged.alignment) {
      if (patch.offsetAlongEdgeM != null || patch.insetFromEdgeM != null) {
        positioned = syncStageSpecFromMetrics(el, rect, merged);
      } else if (patch.xPct != null || patch.yPct != null) {
        positioned = syncStageSpecFromPosition(el, rect, merged);
      }
    }
    positioned = clampDiningFeatureInsideBlock(el, rect, positioned, 'stage');
    this.pushHistory();
    this.applyPatch(elementId, { diningStage: positioned });
  }

  /** Live rotate while dragging the stage rotate handle (history on gesture commit). */
  rotateDiningStageSilent(elementId: string, rotationDeg: number): void {
    const el = this.getCenterpiece(elementId);
    if (!el?.diningStage) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const next = clampDiningFeatureInsideBlock(
      el,
      rect,
      {
        ...el.diningStage,
        rotationDeg: normalizeDiningFeatureRotationDeg(rotationDeg),
      },
      'stage',
    );
    this.updateSilent(elementId, { diningStage: next });
  }

  moveDiningStage(elementId: string, canvasPct: ElementPosition): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = moveStageToPoint(el, rect, this.canvas(), canvasPct);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.updateSilent(elementId, patch);
  }

  resizeDiningFeatureSilent(
    elementId: string,
    kind: 'stage' | 'foodprepare',
    handle: DiningFeatureResizeHandle,
    canvasPct: ElementPosition,
  ): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const canvasX = (canvasPct.xPct / 100) * this.canvas().width;
    const canvasY = (canvasPct.yPct / 100) * this.canvas().height;
    const patch = resizeDiningFeatureFromCanvasPointer(el, rect, kind, handle, canvasX, canvasY);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.updateSilent(elementId, patch);
  }

  selectDiningStage(selected: boolean): void {
    this.diningStageSelected.set(selected);
    if (selected) {
      this.diningFoodPrepareSelected.set(false);
      this.selectedTableId.set(null);
      this.selectedTableIds.set([]);
      this.selectedServiceRouteId.set(null);
    }
  }

  addDiningFoodPrepare(elementId: string): void {
    this.startFoodPrepareSidePick(elementId, false);
  }

  startFoodPrepareSidePick(elementId: string, reorient: boolean): void {
    const el = this.getCenterpiece(elementId);
    if (!el || !hasTracedBlockOutline(el)) {
      return;
    }
    if (reorient && !el.diningFoodPrepare) {
      return;
    }
    if (!reorient && el.diningFoodPrepare) {
      return;
    }
    this.foodPrepareSidePickElementId.set(elementId);
    this.foodPrepareSidePickReorient.set(reorient);
    this.selectedId.set(elementId);
    this.zoomBlockWorkspaceForTableEditing(elementId);
  }

  cancelFoodPrepareSidePick(): void {
    this.foodPrepareSidePickElementId.set(null);
    this.foodPrepareSidePickReorient.set(false);
  }

  isFoodPrepareSidePickMode(): boolean {
    return this.foodPrepareSidePickElementId() != null;
  }

  applyFoodPrepareOnSide(elementId: string, sideEdgeId: number): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    let foodPrepare: DiningFoodPrepareSpec | null = null;
    if (this.foodPrepareSidePickReorient() && el.diningFoodPrepare) {
      foodPrepare = reorientDiningFoodPrepareToSide(el, rect, el.diningFoodPrepare, sideEdgeId);
    } else {
      foodPrepare = createDiningFoodPrepareOnSide(el, rect, sideEdgeId);
    }
    if (!foodPrepare) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, { diningFoodPrepare: foodPrepare });
    this.cancelFoodPrepareSidePick();
    this.diningFoodPrepareSelected.set(true);
  }

  removeDiningFoodPrepare(elementId: string): void {
    const el = this.getCenterpiece(elementId);
    if (!el || !el.diningFoodPrepare) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, { diningFoodPrepare: undefined });
    this.diningFoodPrepareSelected.set(false);
  }

  updateDiningFoodPrepare(elementId: string, patch: Partial<DiningFoodPrepareSpec>): void {
    const el = this.getCenterpiece(elementId);
    if (!el?.diningFoodPrepare) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const merged: DiningFoodPrepareSpec = {
      ...el.diningFoodPrepare,
      ...patch,
      widthM: patch.widthM != null ? Math.max(0.5, patch.widthM) : el.diningFoodPrepare.widthM,
      depthM: patch.depthM != null ? Math.max(0.3, patch.depthM) : el.diningFoodPrepare.depthM,
    };
    if (patch.rotationDeg != null && Number.isFinite(patch.rotationDeg)) {
      merged.rotationDeg = normalizeDiningFeatureRotationDeg(patch.rotationDeg);
    }
    let positioned = merged;
    if (patch.sideEdgeId != null && patch.sideEdgeId !== el.diningFoodPrepare.sideEdgeId) {
      positioned = reorientDiningFoodPrepareToSide(el, rect, merged, patch.sideEdgeId) ?? merged;
    } else if (patch.offsetAlongEdgeM != null || patch.insetFromEdgeM != null) {
      positioned = syncStageSpecFromMetrics(el, rect, merged as DiningStageSpec) as DiningFoodPrepareSpec;
    } else if (patch.xPct != null || patch.yPct != null) {
      positioned = syncStageSpecFromPosition(el, rect, merged as DiningStageSpec) as DiningFoodPrepareSpec;
    }
    positioned = clampDiningFeatureInsideBlock(
      el,
      rect,
      positioned as DiningStageSpec,
      'foodprepare',
    ) as DiningFoodPrepareSpec;
    this.pushHistory();
    this.applyPatch(elementId, { diningFoodPrepare: positioned });
  }

  /** Live rotate while dragging the food-prep rotate handle (history on gesture commit). */
  rotateDiningFoodPrepareSilent(elementId: string, rotationDeg: number): void {
    const el = this.getCenterpiece(elementId);
    if (!el?.diningFoodPrepare) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const next = clampDiningFeatureInsideBlock(
      el,
      rect,
      {
        ...el.diningFoodPrepare,
        rotationDeg: normalizeDiningFeatureRotationDeg(rotationDeg),
      } as DiningStageSpec,
      'foodprepare',
    ) as DiningFoodPrepareSpec;
    this.updateSilent(elementId, { diningFoodPrepare: next });
  }

  moveDiningFoodPrepare(elementId: string, canvasPct: ElementPosition): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = moveFoodPrepareToPoint(el, rect, this.canvas(), canvasPct);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.updateSilent(elementId, patch);
  }

  selectDiningFoodPrepare(selected: boolean): void {
    this.diningFoodPrepareSelected.set(selected);
    if (selected) {
      this.diningStageSelected.set(false);
      this.selectedTableId.set(null);
      this.selectedTableIds.set([]);
      this.selectedServiceRouteId.set(null);
    }
  }

  startServiceRouteDrawing(elementId: string): void {
    const el = this.getCenterpiece(elementId);
    if (!el || !hasTracedBlockOutline(el)) {
      return;
    }
    this.cancelStageSidePick();
    this.cancelTablePlacement();
    this.serviceRouteDrawingElementId.set(elementId);
    this.serviceRouteDraftPoints.set([]);
    this.selectedId.set(elementId);
    this.selectedServiceRouteId.set(null);
    this.zoomBlockWorkspaceForTableEditing(elementId);
  }

  addServiceRouteDraftPoint(point: ElementPosition): void {
    this.serviceRouteDraftPoints.update((pts) => [...pts, point]);
  }

  finishServiceRouteDrawing(): void {
    const id = this.serviceRouteDrawingElementId();
    const points = [...this.serviceRouteDraftPoints()];
    this.serviceRouteDrawingElementId.set(null);
    this.serviceRouteDraftPoints.set([]);
    if (!id || points.length < 2) {
      return;
    }
    const el = this.getCenterpiece(id);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = addServiceRouteFromCanvasPoints(el, rect, this.canvas(), points);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.pushHistory();
    this.applyPatch(id, patch);
    this.selectedId.set(id);
    const routes = patch.diningServiceRoutes ?? el.diningServiceRoutes;
    const last = routes?.[routes.length - 1];
    if (last) {
      this.selectedServiceRouteId.set(last.id);
    }

    // Automatically trigger pending table generation once service route is defined
    if (this.serviceRouteTableGenPending()) {
      const clearance = this.serviceRouteTableGenClearance();
      const options = this.serviceRouteTableGenOptions();
      const genType = this.serviceRouteTableGenType();

      this.serviceRouteTableGenPending.set(false);
      this.serviceRouteTableGenOptions.set(null);
      this.serviceRouteTableGenType.set(null);

      this.applyPatch(id, { diningServiceRouteClearanceM: clearance });

      if (genType === 'count') {
        this.applyTableCountGrid(id, options);
      } else if (genType === 'grid') {
        this.applyTableGrid(id, options);
      }
    }
  }

  cancelServiceRouteDrawing(): void {
    this.serviceRouteDrawingElementId.set(null);
    this.serviceRouteDraftPoints.set([]);

    // Reset pending table generation
    this.serviceRouteTableGenPending.set(false);
    this.serviceRouteTableGenOptions.set(null);
    this.serviceRouteTableGenType.set(null);
  }

  deleteDiningServiceRoute(elementId: string, routeId: string): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    const patch = deleteServiceRoute(el, routeId);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, patch);
    if (this.selectedServiceRouteId() === routeId) {
      this.selectedServiceRouteId.set(null);
    }
  }

  removeDiningServiceRoutes(elementId: string): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, removeAllServiceRoutes(el));
    this.selectedServiceRouteId.set(null);
    this.cancelServiceRouteDrawing();
  }

  updateDiningServiceRouteWidth(elementId: string, routeId: string, widthM: number): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    const routes = (el.diningServiceRoutes ?? []).map((r) => {
      if (r.id === routeId) {
        return { ...r, widthM };
      }
      return r;
    });
    this.pushHistory();
    this.applyPatch(elementId, { diningServiceRoutes: routes });
  }

  selectDiningServiceRoute(routeId: string | null): void {
    this.selectedServiceRouteId.set(routeId);
    if (routeId) {
      this.selectedTableId.set(null);
      this.selectedTableIds.set([]);
      this.diningStageSelected.set(false);
      this.diningFoodPrepareSelected.set(false);
    }
  }

  removeDiningTables(id: string): void {
    const el = this.getCenterpiece(id);
    if (!el) {
      return;
    }
    this.pushHistory();
    this.applyPatch(id, removeAllTables(el));
    this.selectedTableId.set(null);
    this.selectedTableIds.set([]);
    this.tablePlacementElementId.set(null);
  }

  deleteDiningTable(elementId: string, tableId: string): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    const patch = deleteTable(el, tableId);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, patch);
    if (this.selectedTableId() === tableId) {
      this.selectedTableId.set(null);
    }
    this.selectedTableIds.update((ids) => ids.filter((id) => id !== tableId));
  }

  updateDiningTable(
    elementId: string,
    tableId: string,
    patch: Parameters<typeof updateTable>[2],
  ): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    const next = updateTable(el, tableId, patch);
    if (Object.keys(next).length === 0) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, next);
  }

  moveDiningTable(elementId: string, tableId: string, canvasPct: ElementPosition): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = moveTableToPoint(el, rect, this.canvas(), tableId, canvasPct);
    if (Object.keys(patch).length === 0) {
      return;
    }
    const moved = (patch.diningTables ?? []).find((t) => t.id === tableId);
    if (moved) {
      const violation = findTableGapViolation(
        el,
        {
          tableId: moved.id,
          xPct: moved.xPct,
          yPct: moved.yPct,
          shape: moved.shape,
          widthM: moved.widthM,
          depthM: moved.depthM,
          seats: moved.seats,
        },
        this.tablePlacementDefaults()?.gapM ?? resolveDefaultTableGapM(el),
      );
      if (violation) {
        this.tableGapRuleAlert.set(formatTableGapViolationMessage(violation));
        return;
      }
    }
    this.tableGapRuleAlert.set(null);
    this.updateSilent(elementId, patch);
  }

  selectDiningTable(tableId: string | null, options?: { additive?: boolean }): void {
    if (!tableId) {
      this.selectedTableId.set(null);
      this.selectedTableIds.set([]);
      return;
    }
    if (options?.additive) {
      const current = this.selectedTableIds();
      const exists = current.includes(tableId);
      const next = exists ? current.filter((id) => id !== tableId) : [...current, tableId];
      this.selectedTableIds.set(next);
      this.selectedTableId.set(next[next.length - 1] ?? tableId);
    } else {
      this.selectedTableId.set(tableId);
      this.selectedTableIds.set([tableId]);
    }
    this.diningStageSelected.set(false);
    this.diningFoodPrepareSelected.set(false);
    this.selectedServiceRouteId.set(null);
  }



  startDragFillSeats(id: string): void {
    const el = this.getCenterpiece(id);
    if (!el || !hasTracedBlockOutline(el)) {
      return;
    }
    this.cancelSeatRowDrawing();
    this.cancelLineSeatDrawing();
    this.cancelPerSeatPlacement();
    this.cancelArrangeByRow();
    this.pendingSeatRow.set(null);
    this.drawingElementId.set(null);
    this.draftPoints.set([]);
    this.selectedId.set(id);
    this.selectedSeatId.set(null);
    this.dragFillSeatsElementId.set(id);

    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = enableDragFillSeats(el, rect);
    if (Object.keys(patch).length === 0) {
      return;
    }
    if (!el.dragFillSeatsMode) {
      this.pushHistory();
    }
    this.applyPatch(id, patch);
  }

  cancelDragFillSeats(): void {
    this.dragFillSeatsElementId.set(null);
  }

  /** Exit drag-and-fill session and return to the seating tool picker (seats are kept). */
  finishDragFillSeats(): void {
    const id = this.dragFillSeatsElementId();
    this.dragFillSeatsElementId.set(null);
    if (!id) {
      return;
    }
    const el = this.getCenterpiece(id);
    if (el?.dragFillSeatsMode) {
      this.pushHistory();
      this.applyPatch(id, { dragFillSeatsMode: undefined });
    }
  }

  isDragFillSeatsActive(id: string): boolean {
    const el = this.getCenterpiece(id);
    return el != null && isDragFillSeatsElement(el);
  }

  placeDragFillSeedSeatAt(elementId: string, canvasPct: ElementPosition): boolean {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return false;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = placeDragFillSeedSeat(el, rect, this.canvas(), canvasPct);
    if (Object.keys(patch).length === 0) {
      return false;
    }
    this.pushHistory();
    this.applyPatch(elementId, patch);
    this.selectedId.set(elementId);
    return true;
  }

  expandDragFillRowSilent(
    elementId: string,
    rowIndex: number,
    endCanvasPx: { x: number; y: number },
  ): void {
    const el = this.getCenterpiece(elementId);
    if (!el || !isDragFillSeatsElement(el)) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = expandDragFillRowToCanvasPoint(el, rect, this.canvas(), rowIndex, endCanvasPx);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.applyPatch(elementId, patch);
  }

  expandDragFillAtSilent(
    elementId: string,
    seatIdStr: string,
    canvasPoint: { x: number; y: number },
  ): void {
    if (!this.canUseInteractiveSeatingPlacement(elementId)) {
      return;
    }
    const el = this.getCenterpiece(elementId);
    if (!el || !isDragFillSeatsElement(el)) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = expandDragFillAtCanvasPoint(el, rect, this.canvas(), seatIdStr, canvasPoint);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.applyPatch(elementId, patch);
  }

  removeDragFillSeatSilent(elementId: string, seatIdStr: string): void {
    const el = this.getCenterpiece(elementId);
    if (!el || !isDragFillSeatsElement(el)) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = removeDragFillSeat(el, rect, seatIdStr);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.applyPatch(elementId, patch);
    if (this.selectedSeatId() === seatIdStr) {
      this.selectedSeatId.set(null);
    }
  }

  canUseInteractiveSeatingPlacement(id: string): boolean {
    if (this.blockWorkspaceId() !== id) {
      return false;
    }
    const el = this.getCenterpiece(id);
    return el != null && !el.interactiveSeatingLocked;
  }

  startArrangeByRow(id: string): void {
    const el0 = this.getCenterpiece(id);
    if (!el0 || !hasTracedBlockOutline(el0)) {
      return;
    }
    if (!this.canUseInteractiveSeatingPlacement(id)) {
      return;
    }
    this.cancelSeatRowDrawing();
    this.cancelLineSeatDrawing();
    this.cancelPerSeatPlacement();
    this.cancelDragFillSeats();
    this.pendingSeatRow.set(null);
    this.drawingElementId.set(null);
    this.draftPoints.set([]);
    this.arrangeByRowRowIndex.set(null);
    this.arrangeByRowAnchor.set(null);
    this.arrangeByRowDragging.set(false);
    this.arrangeByRowWizardError.set(null);
    this.selectedId.set(id);
    this.selectedSeatId.set(null);
    this.blockMeasureContext.set('arrange-by-row');

    // Configure / first-layer measurements already live on gaConfiguredSides.
    // Sync them onto customSideLengthsM and skip Step 1 — never re-ask.
    if (this.allGaSidesConfigured(el0) && !this.elementSidesFullyConfigured(el0)) {
      this.syncGaConfiguredSidesToCustomSides(el0);
    }

    const el = this.getCenterpiece(id) ?? el0;
    const sideCount = el.customPoints?.length ?? 0;
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const defaultLengths = estimateDefaultSideLengthsM(el, rect);
    const existingLengths = el.customSideLengthsM ?? [];
    const sidesAlreadyMeasured =
      this.allGaSidesConfigured(el) || this.elementSidesFullyConfigured(el);
    const sideLengths =
      existingLengths.length === sideCount &&
      (sidesAlreadyMeasured || existingLengths.every((length) => length > 0))
        ? [...existingLengths]
        : defaultLengths.length === sideCount
          ? defaultLengths
          : defaultLengths;
    const defaultNames = Array.from({ length: sideCount }, (_, index) =>
      stadiumSideLabel(index, sideCount),
    );
    const sideNames =
      el.customSideNames?.length === sideCount ? [...el.customSideNames] : defaultNames;
    const measured = Array.from({ length: sideCount }, () => false);
    if (
      sidesAlreadyMeasured ||
      (existingLengths.length === sideCount && existingLengths.every((length) => length > 0))
    ) {
      for (let index = 0; index < sideCount; index += 1) {
        measured[index] = true;
      }
    }

    this.arrangeByRowDraftSideLengthsM.set(sideLengths);
    this.arrangeByRowDraftSideNames.set(sideNames);
    this.arrangeByRowMeasuredSides.set(measured);
    this.arrangeByRowPendingSideIds.set([]);
    this.arrangeByRowElementId.set(id);
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const logicalTotal = buildBlockMeasureEdges(polygon).length;
    const sidesReady =
      sidesAlreadyMeasured ||
      countMeasuredLogicalEdges(polygon, measured) >= logicalTotal;
    this.arrangeByRowWizardPhase.set(sidesReady ? 'layout' : 'measure');
  }

  selectArrangeByRowMeasureSide(logicalId: number): void {
    const id = this.arrangeByRowElementId();
    if (!id || this.arrangeByRowWizardPhase() !== 'measure') {
      return;
    }
    const el = this.getCenterpiece(id);
    if (!el || (el.customPoints?.length ?? 0) < 3) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const edge = logicalMeasureEdgeById(polygon, logicalId);
    if (!edge) {
      return;
    }
    const measured = this.arrangeByRowMeasuredSides();
    if (edge.sourceIndices.every((src) => measured[src])) {
      return;
    }
    const pending = this.arrangeByRowPendingSideIds();
    if (pending.includes(edge.id)) {
      return;
    }
    this.arrangeByRowPendingSideIds.set([...pending, edge.id]);
    this.arrangeByRowWizardError.set(null);
  }

  confirmAllArrangeByRowSideMeasurements(
    entries: { logicalId: number; lengthM: number; name: string }[],
  ): boolean {
    const id = this.arrangeByRowElementId();
    if (!id || this.arrangeByRowWizardPhase() !== 'measure') {
      return false;
    }
    const el = this.getCenterpiece(id);
    if (!el) {
      return false;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const logicalTotal = buildBlockMeasureEdges(polygon).length;
    if (entries.length < logicalTotal) {
      this.arrangeByRowWizardError.set('Click every faded line on the block, then confirm all at once.');
      return false;
    }

    const lengths = [...this.arrangeByRowDraftSideLengthsM()];
    const names = [...this.arrangeByRowDraftSideNames()];
    const measured = [...this.arrangeByRowMeasuredSides()];

    for (const entry of entries) {
      const logical = logicalMeasureEdgeById(polygon, entry.logicalId);
      if (!logical) {
        continue;
      }
      const safeLength = Math.max(0.1, entry.lengthM);
      const safeName = entry.name.trim() || logical.label;
      const pxPerSource = logical.sourceIndices.map((src) => {
        const seg = edgeSegment(polygon, src);
        if (!seg) {
          return 0;
        }
        return Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
      });
      const totalPx = pxPerSource.reduce((sum, px) => sum + px, 0) || logical.lengthPx;

      logical.sourceIndices.forEach((src, index) => {
        const share =
          totalPx > 0
            ? safeLength * (pxPerSource[index] / totalPx)
            : safeLength / logical.sourceIndices.length;
        lengths[src] = share;
        measured[src] = true;
        if (index === 0) {
          names[src] = safeName;
        }
      });
    }

    this.arrangeByRowDraftSideLengthsM.set(lengths);
    this.arrangeByRowDraftSideNames.set(names);
    this.arrangeByRowMeasuredSides.set(measured);
    this.arrangeByRowPendingSideIds.set([]);
    if (countMeasuredLogicalEdges(polygon, measured) >= logicalTotal) {
      if (this.blockMeasureContext() === 'workspace-setup') {
        this.finishBlockWorkspaceSideMeasurement(id, lengths, names);
      } else {
        this.arrangeByRowWizardPhase.set('layout');
      }
    }
    this.arrangeByRowWizardError.set(null);
    return true;
  }

  /** Block workspace — measure every side before VIEW POINT and seating tools. */
  startBlockWorkspaceMeasurement(id: string): void {
    const el = this.getCenterpiece(id);
    if (!el || !hasTracedBlockOutline(el)) {
      return;
    }
    this.cancelSeatRowDrawing();
    this.cancelLineSeatDrawing();
    this.cancelPerSeatPlacement();
    this.pendingSeatRow.set(null);
    this.drawingElementId.set(null);
    this.draftPoints.set([]);
    this.arrangeByRowRowIndex.set(null);
    this.arrangeByRowAnchor.set(null);
    this.arrangeByRowDragging.set(false);
    this.arrangeByRowWizardError.set(null);
    this.selectedId.set(id);
    this.selectedSeatId.set(null);
    this.blockMeasureContext.set('workspace-setup');

    const sideCount = el.customPoints?.length ?? 0;
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const defaultLengths = estimateDefaultSideLengthsM(el, rect);
    const existingLengths = el.customSideLengthsM ?? [];
    const sideLengths =
      existingLengths.length === sideCount && existingLengths.every((length) => length > 0)
        ? [...existingLengths]
        : defaultLengths.length === sideCount
          ? defaultLengths
          : defaultLengths;
    const defaultNames = Array.from({ length: sideCount }, (_, index) =>
      stadiumSideLabel(index, sideCount),
    );
    const sideNames =
      el.customSideNames?.length === sideCount ? [...el.customSideNames] : defaultNames;
    const measured = Array.from({ length: sideCount }, () => false);
    if (existingLengths.length === sideCount && existingLengths.every((length) => length > 0)) {
      for (let index = 0; index < sideCount; index += 1) {
        measured[index] = true;
      }
    }

    this.arrangeByRowDraftSideLengthsM.set(sideLengths);
    this.arrangeByRowDraftSideNames.set(sideNames);
    this.arrangeByRowMeasuredSides.set(measured);
    this.arrangeByRowElementId.set(id);
    this.arrangeByRowWizardPhase.set('measure');
  }

  private finishBlockWorkspaceSideMeasurement(
    id: string,
    lengths: number[],
    names: string[],
  ): void {
    const el = this.getCenterpiece(id);
    const blockDims = el
      ? blockMetresFromSideLengths(
          el.customPoints,
          lengths,
          rectFromPositionSize(el.position, el.size, this.canvas()),
        )
      : null;
    this.pushHistory();
    this.applyPatch(id, {
      customSideLengthsM: lengths,
      customSideNames: names,
      ...(blockDims ?? {}),
    });
    this.blockWorkspaceSidesConfigured.set(true);
    this.blockMeasureContext.set('none');
    this.arrangeByRowElementId.set(null);
    this.arrangeByRowWizardPhase.set('idle');
    this.arrangeByRowMeasuredSides.set([]);
    this.arrangeByRowDraftSideLengthsM.set([]);
    this.arrangeByRowDraftSideNames.set([]);
    this.arrangeByRowWizardError.set(null);
    this.maybeZoomForDiningTableEdit(this.getCenterpiece(id));
  }

  /** True when every logical edge has a positive stored length (metres). */
  elementSidesFullyConfigured(el: CenterpieceElement): boolean {
    const sideCount = el.customPoints?.length ?? 0;
    if (sideCount < 3) {
      return false;
    }
    const lengths = el.customSideLengthsM ?? [];
    if (lengths.length !== sideCount || !lengths.every((length) => length > 0)) {
      return false;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const measured = Array.from({ length: sideCount }, () => true);
    return countMeasuredLogicalEdges(polygon, measured) >= buildBlockMeasureEdges(polygon).length;
  }

  /** True when every logical side has a saved label and length in gaConfiguredSides. */
  allGaSidesConfigured(el: CenterpieceElement): boolean {
    const sideCount = el.customPoints?.length ?? 0;
    if (sideCount < 3) {
      return false;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const configured = el.gaConfiguredSides ?? [];
    return buildBlockMeasureEdges(polygon).every((edge) => {
      const conf = configured.find((side) => side.logicalId === edge.id);
      return Boolean(conf?.label?.trim()) && (conf?.lengthM ?? 0) > 0;
    });
  }

  private syncGaConfiguredSidesToCustomSides(el: CenterpieceElement): void {
    const sideCount = el.customPoints?.length ?? 0;
    if (sideCount < 3) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const configured = el.gaConfiguredSides ?? [];
    const lengths = Array.from({ length: sideCount }, () => 0);
    const names = Array.from({ length: sideCount }, (_, index) => stadiumSideLabel(index, sideCount));

    for (const conf of configured) {
      const logical = logicalMeasureEdgeById(polygon, conf.logicalId);
      if (!logical || (conf.lengthM ?? 0) <= 0) {
        continue;
      }
      const safeLength = Math.max(0.1, conf.lengthM!);
      const safeName = conf.label.trim() || logical.label;
      const pxPerSource = logical.sourceIndices.map((src) => {
        const seg = edgeSegment(polygon, src);
        if (!seg) {
          return 0;
        }
        return Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
      });
      const totalPx = pxPerSource.reduce((sum, px) => sum + px, 0) || logical.lengthPx;
      logical.sourceIndices.forEach((src, index) => {
        const share =
          totalPx > 0
            ? safeLength * (pxPerSource[index] / totalPx)
            : safeLength / logical.sourceIndices.length;
        lengths[src] = share;
        if (index === 0) {
          names[src] = safeName;
        }
      });
    }

    this.pushHistory();
    this.applyPatch(el.id, {
      customSideLengthsM: lengths,
      customSideNames: names,
      ...(blockMetresFromSideLengths(el.customPoints, lengths, rect) ?? {}),
    });
    this.blockWorkspaceSidesConfigured.set(true);
    this.blockMeasureContext.set('none');
    this.arrangeByRowElementId.set(null);
    this.arrangeByRowWizardPhase.set('idle');
    this.arrangeByRowMeasuredSides.set([]);
    this.arrangeByRowDraftSideLengthsM.set([]);
    this.arrangeByRowDraftSideNames.set([]);
    this.arrangeByRowPendingSideIds.set([]);
    this.arrangeByRowWizardError.set(null);
  }

  /**
   * Backfills block metres for outlines measured before the dimensions were derived from the
   * sides. Without real metres every metre-sized item on the canvas is drawn at the default
   * 10 m × 8 m scale, so a 3 m stage in a 4 m block comes out as a stub.
   */
  syncBlockPhysicalDimsFromMeasuredSides(id: string): void {
    const el = this.getCenterpiece(id);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const dims = blockMetresFromSideLengths(el.customPoints, el.customSideLengthsM ?? [], rect);
    if (!dims) {
      return;
    }
    const unchanged = (current: number | undefined, next: number) =>
      current != null && Math.abs(current - next) < 0.005;
    if (
      unchanged(el.physicalLengthM, dims.physicalLengthM) &&
      unchanged(el.physicalWidthM, dims.physicalWidthM)
    ) {
      return;
    }
    this.applyPatch(id, dims);
  }

  /** Seating / dining — finish side-label step and unlock edit tools. */
  completeSideLabelConfigureStep(): boolean {
    const el = this.blockWorkspaceElement();
    if (!el || !blockTypeHasCustomizationFlow(el.blockType)) {
      return false;
    }
    if (!this.allGaSidesConfigured(el)) {
      return false;
    }
    this.syncGaConfiguredSidesToCustomSides(el);
    this.maybeZoomForDiningTableEdit(el);
    return true;
  }

  refreshBlockWorkspaceSidesConfigured(): void {
    const id = this.blockWorkspaceId();
    const el = id ? this.getCenterpiece(id) : null;
    this.blockWorkspaceSidesConfigured.set(Boolean(el && this.allGaSidesConfigured(el)));
  }

  private syncBlockWorkspaceAfterTypeOrEnter(elementId: string): void {
    const el = this.getCenterpiece(elementId);
    if (!el || !blockTypeHasCustomizationFlow(el.blockType) || this.blockWorkspaceId() !== elementId) {
      return;
    }
    this.cancelArrangeByRow();
    this.cancelTablePlacement();
    this.blockWorkspaceSidesConfigured.set(false);
    if (el.blockViewpointAngleDeg != null) {
      this.blockWorkspaceViewpointAngleDeg.set(el.blockViewpointAngleDeg);
      this.blockWorkspaceViewpointConfirmed.set(true);
      if (!this.blockWorkspaceSidesConfigured()) {
        this.blockMeasureContext.set('none');
      } else {
        this.maybeZoomForDiningTableEdit(el);
      }
    }
  }

  applyArrangeByRowGrid(
    rowCount: number,
    dims: PhysicalDimsInput,
  ): boolean {
    const id = this.arrangeByRowElementId();
    const el = id ? this.getCenterpiece(id) : null;
    if (!el || this.arrangeByRowWizardPhase() !== 'layout') {
      return false;
    }
    const sideLengths = this.arrangeByRowDraftSideLengthsM();
    const sideNames = this.arrangeByRowDraftSideNames();
    if (sideLengths.length < 3) {
      this.arrangeByRowWizardError.set('Configure all block sides first.');
      return false;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const viewpointAngle =
      el.blockViewpointAngleDeg ??
      (this.blockWorkspaceViewpointConfirmed() ? this.blockWorkspaceViewpointAngleDeg() : null);
    const viewpointSide = this.blockWorkspaceViewpointLayout()?.sideIndex;
    const stadiumSideIndex =
      (viewpointAngle != null ? viewpointSide : null) ??
      el.dragSeatsStadiumSideIndex ??
      this.blockWorkspaceSeatingSideIndex() ??
      0;
    const result = createArrangeByRowGridSeating(
      el,
      rect,
      sideLengths,
      sideNames,
      dims,
      stadiumSideIndex,
      rowCount,
      undefined,
      viewpointAngle,
      undefined,
      undefined,
      { adjacentBlocks: collectAdjacentBlocks(el, this.elements(), this.canvas()) },
    );
    if ('error' in result) {
      this.arrangeByRowWizardError.set(result.error);
      return false;
    }
    this.pushHistory();
    this.applyPatch(id!, result.patch);
    this.arrangeByRowWizardPhase.set('idle');
    this.arrangeByRowPendingSideIds.set([]);
    this.arrangeByRowWizardError.set(null);
    this.arrangeByRowElementId.set(null);
    return true;
  }

  /** Update the shared Auto Fill master configuration. */
  setAutoFillSeatingConfig(patch: Partial<AutoFillSeatingConfig>): void {
    const rounded = { ...patch };
    for (const key of [
      'chairLengthM',
      'chairWidthM',
      'seatGapM',
      'rowGapM',
      'borderGapM',
      'aisleWidthM',
      'curveDeg',
    ] as const) {
      const value = rounded[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        rounded[key] =
          key === 'curveDeg'
            ? clampAutoFillCurveDeg(value)
            : Math.round(value * 1000) / 1000;
      }
    }
    const current = this.autoFillSeatingConfig();
    if (autoFillSeatingPatchIsNoop(current, rounded)) {
      return;
    }
    this.autoFillSeatingConfig.update((prev) => ({
      ...prev,
      ...rounded,
    }));
    if (this.shouldLiveSyncAutoFillSpacingToWorkspaceBlock()) {
      this.scheduleAutoFillSpacingSync(rounded);
    }
  }

  /**
   * During configure (no seats yet), spacing lives in autoFillSeatingConfig only so +/−
   * does not recreate the workspace element and shake sticky sidebars.
   */
  private shouldLiveSyncAutoFillSpacingToWorkspaceBlock(): boolean {
    if (!this.blockWorkspaceId()) {
      return false;
    }
    return this.blockWorkspaceSeatingEditMode() || this.blockWorkspaceSeatCount() > 0;
  }

  /** Push current Auto Fill spacing onto the workspace block before seat tools run. */
  flushAutoFillSpacingToWorkspaceBlock(): void {
    const config = this.autoFillSeatingConfig();
    this.syncAutoFillSpacingPatchToWorkspaceBlock({
      chairWidthM: config.chairWidthM,
      chairLengthM: config.chairLengthM,
      seatGapM: config.seatGapM,
      rowGapM: config.rowGapM,
      borderGapM: config.borderGapM,
    });
  }

  /** Apply the latest Auto Fill settings onto the workspace block on the next frame. */
  private scheduleAutoFillSpacingSync(patch: Partial<AutoFillSeatingConfig>): void {
    this.pendingAutoFillSpacingPatch = {
      ...this.pendingAutoFillSpacingPatch,
      ...patch,
    };
    if (this.autoFillSpacingSyncRaf != null) {
      return;
    }
    this.autoFillSpacingSyncRaf = requestAnimationFrame(() => {
      this.autoFillSpacingSyncRaf = null;
      const pending = this.pendingAutoFillSpacingPatch;
      this.pendingAutoFillSpacingPatch = null;
      if (pending) {
        this.syncAutoFillSpacingPatchToWorkspaceBlock(pending);
      }
    });
  }

  /** Apply any coalesced Auto Fill settings immediately (Create seats / exit). */
  private flushAutoFillSpacingSync(): void {
    if (this.autoFillSpacingSyncRaf != null) {
      cancelAnimationFrame(this.autoFillSpacingSyncRaf);
      this.autoFillSpacingSyncRaf = null;
    }
    const pending = this.pendingAutoFillSpacingPatch;
    this.pendingAutoFillSpacingPatch = null;
    if (pending) {
      this.syncAutoFillSpacingPatchToWorkspaceBlock(pending);
    }
  }

  /** Keep workspace block spacing fields aligned with Auto Fill settings edits. */
  private syncAutoFillSpacingPatchToWorkspaceBlock(patch: Partial<AutoFillSeatingConfig>): void {
    const el = this.blockWorkspaceElement();
    if (!el || el.blockType !== 'seating') {
      return;
    }

    const sameM = (a: number | undefined, b: number): boolean =>
      a != null && Number.isFinite(a) && Math.abs(a - b) < 0.0005;

    const spacingPatch: Partial<CenterpieceElement> = {};
    if (patch.chairWidthM != null && Number.isFinite(patch.chairWidthM) && !sameM(el.chairWidthM, patch.chairWidthM)) {
      spacingPatch.chairWidthM = patch.chairWidthM;
    }
    if (
      patch.chairLengthM != null &&
      Number.isFinite(patch.chairLengthM) &&
      !sameM(el.chairLengthM, patch.chairLengthM)
    ) {
      spacingPatch.chairLengthM = patch.chairLengthM;
    }
    if (patch.seatGapM != null && Number.isFinite(patch.seatGapM) && !sameM(el.seatGapM, patch.seatGapM)) {
      spacingPatch.seatGapM = patch.seatGapM;
    }
    if (patch.rowGapM != null && Number.isFinite(patch.rowGapM) && !sameM(el.rowGapM, patch.rowGapM)) {
      spacingPatch.rowGapM = patch.rowGapM;
    }
    if (
      patch.borderGapM != null &&
      Number.isFinite(patch.borderGapM) &&
      !sameM(el.borderGapM, Math.max(0, patch.borderGapM))
    ) {
      spacingPatch.borderGapM = Math.max(0, patch.borderGapM);
    }
    if (patch.curveDeg != null || patch.curveEnabled != null) {
      const baseline = el.autoFillStraightSeatPositions ?? el.seatPositionOverrides;
      if (baseline && Object.keys(baseline).length > 0) {
        const curveDeg = resolveEffectiveAutoFillCurveDeg(this.autoFillSeatingConfig());
        const currentCurve = clampAutoFillCurveDeg(
          el.seatLayout?.rowCurveDeg ?? el.seatLayout?.rowCurveDegs?.[0] ?? 0,
        );
        if (curveDeg !== currentCurve) {
          const rect = rectFromPositionSize(el.position, el.size, this.canvas());
          const baked = bakeAutoFillSeatPositions(el, rect, baseline, curveDeg);
          spacingPatch.autoFillStraightSeatPositions = baked.autoFillStraightSeatPositions;
          spacingPatch.seatPositionOverrides = baked.seatPositionOverrides;
          if (baked.seatLayout) {
            spacingPatch.seatLayout = baked.seatLayout;
          }
        }
      }
    }
    // Aisles are per-block — only persist when the shared config is bound to
    // this workspace block (avoids writing another block's draw aisle here).
    if (
      patch.aisles &&
      this.autoFillSeatingConfig().referenceBlockId === el.id &&
      !autoFillAislesEqual(el.autoFillAisles, patch.aisles)
    ) {
      spacingPatch.autoFillAisles = patch.aisles;
    }

    // Chair size / gaps changed while seats are already placed: re-grid the
    // block right away so the preview matches the numbers (a wider chair means
    // fewer seats per row, not a stretched chair on the old grid).
    const dimsChanged =
      spacingPatch.chairWidthM != null ||
      spacingPatch.chairLengthM != null ||
      spacingPatch.seatGapM != null ||
      spacingPatch.rowGapM != null ||
      spacingPatch.borderGapM != null;
    if (dimsChanged && this.hasAutoFillSeats(el)) {
      const merged: CenterpieceElement = { ...el, ...spacingPatch };
      const outcome = applyAutoFillToBlock(
        merged,
        this.elements().map((item) => (item.id === el.id ? merged : item)),
        this.canvas(),
        this.autoFillSeatingConfig(),
      );
      if ('error' in outcome) {
        // Keep the metre values so the sidebar reflects the input; the old
        // seats stay until a configuration fits again.
        this.autoFillError.set(outcome.error);
      } else {
        this.autoFillError.set(null);
        Object.assign(spacingPatch, outcome.patch);
      }
    }

    if (Object.keys(spacingPatch).length > 0) {
      this.updateSilent(el.id, spacingPatch);
    }
  }

  /** Seats placed straight on the block by Create seats / Auto Fill (no drawn sub-blocks). */
  private hasAutoFillSeats(el: CenterpieceElement): boolean {
    return (
      (el.customSeatBlocks?.length ?? 0) === 0 &&
      Object.keys(el.seatPositionOverrides ?? {}).length > 0 &&
      (el.arrangeByRowMode === true || el.autoFillStraightSeatPositions != null)
    );
  }

  /** Copy seat spacing from the first selected eligible block into the master config. */
  captureAutoFillConfigFromSelection(): boolean {
    const blocks = this.selectedAutoFillBlocks();
    if (blocks.length === 0) {
      this.autoFillError.set('Select a custom seating block to use as the reference.');
      return false;
    }
    const el = blocks[0];
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const baseline = estimateDefaultSideLengthsM(el, rect);
    const baselines: Record<string, number[]> = {};
    for (const block of blocks) {
      const blockRect = rectFromPositionSize(block.position, block.size, this.canvas());
      baselines[block.id] = estimateDefaultSideLengthsM(block, blockRect);
    }
    const blockAisles = this.cloneBlockAutoFillAisles(el);
    this.autoFillSeatingConfig.set({
      chairLengthM: resolveChairLengthM(el),
      chairWidthM: resolveChairWidthM(el),
      seatGapM: el.seatGapM ?? DEFAULT_AUTO_FILL_SEATING_CONFIG.seatGapM,
      rowGapM: el.rowGapM ?? el.seatGapM ?? DEFAULT_AUTO_FILL_SEATING_CONFIG.rowGapM,
      borderGapM: el.borderGapM ?? 0,
      curveDeg: clampAutoFillCurveDeg(
        el.seatLayout?.rowCurveDeg ?? el.seatLayout?.rowCurveDegs?.[0] ?? 0,
      ),
      curveEnabled:
        clampAutoFillCurveDeg(
          el.seatLayout?.rowCurveDeg ?? el.seatLayout?.rowCurveDegs?.[0] ?? 0,
        ) > 0,
      aislePlacementMode: DEFAULT_AUTO_FILL_SEATING_CONFIG.aislePlacementMode,
      aisleRows: DEFAULT_AUTO_FILL_SEATING_CONFIG.aisleRows,
      aisleColumns: DEFAULT_AUTO_FILL_SEATING_CONFIG.aisleColumns,
      aisleWidthM: DEFAULT_AUTO_FILL_SEATING_CONFIG.aisleWidthM,
      aisles: blockAisles,
      applyBlockMeasurementScale: true,
      referenceBlockId: el.id,
      referenceBaselineSideLengthsM: baseline,
      referenceSideLengthsM: [...baseline],
      blockMeasurementBaselines: baselines,
    });
    this.cancelDrawAisle();
    this.syncAutoFillScaledMeasurementsToSelection();
    this.autoFillError.set(null);
    return true;
  }

  /**
   * When reference measurements change, apply the same per-side increase/decrease
   * to every other shift-selected block using each block's geometric default as baseline.
   * Always writes polygon-edge `customSideLengthsM` via gaConfiguredSides (never logical
   * side arrays directly) so packing can compute px/m on every source edge.
   */
  private syncAutoFillScaledMeasurementsToSelection(): void {
    const config = this.autoFillSeatingConfig();
    const referenceBaseline = config.referenceBaselineSideLengthsM ?? [];
    const referenceCurrent = config.referenceSideLengthsM ?? [];
    if (
      config.applyBlockMeasurementScale === false ||
      !config.referenceBlockId ||
      referenceBaseline.length < 3 ||
      referenceCurrent.length < 3
    ) {
      return;
    }

    const referenceId = config.referenceBlockId;
    const deltas = computeSideLengthDeltasM(referenceBaseline, referenceCurrent);
    const baselines = { ...(config.blockMeasurementBaselines ?? {}) };
    const selected = this.selectedAutoFillBlocks();
    let baselinesChanged = false;

    for (const block of selected) {
      const sides = this.resolveLogicalSideLengths(block);
      if (sides.length < 3) {
        continue;
      }

      if (!baselines[block.id] || baselines[block.id].length < 3) {
        baselines[block.id] = sides.map((side) => side.lengthM);
        baselinesChanged = true;
      }

      let logicalLengths: number[];
      if (block.id === referenceId) {
        logicalLengths =
          referenceCurrent.length === sides.length
            ? referenceCurrent
            : sides.map((side, index) => referenceCurrent[index] ?? side.lengthM);
      } else {
        const baseline =
          baselines[block.id].length === sides.length
            ? baselines[block.id]
            : sides.map((side, index) => baselines[block.id][index] ?? side.lengthM);
        logicalLengths = applySideLengthDeltasM(baseline, deltas);
      }

      const gaConfiguredSides = sides.map((side, index) => ({
        logicalId: side.logicalId,
        label: side.label,
        lengthM: Math.max(0.1, logicalLengths[index] ?? side.lengthM),
      }));
      const customPatch = this.buildCustomSidesPatchFromGa(block, gaConfiguredSides);
      const current = block.customSideLengthsM ?? [];
      const lengths = customPatch.customSideLengthsM ?? [];
      const changed =
        lengths.length !== current.length ||
        lengths.some((length, index) => Math.abs(length - (current[index] ?? 0)) > 0.001);
      if (changed || (block.gaConfiguredSides?.length ?? 0) !== gaConfiguredSides.length) {
        this.updateSilent(block.id, {
          gaConfiguredSides,
          ...customPatch,
          blockType: block.blockType ?? 'seating',
        });
      }
    }

    if (baselinesChanged) {
      this.autoFillSeatingConfig.update((prev) => ({
        ...prev,
        blockMeasurementBaselines: baselines,
      }));
    }
  }

  /** Update a block side length from the Auto Fill inspector (always edits the selected block). */
  setAutoFillBlockSideLength(blockId: string, index: number, lengthM: number): void {
    const el = this.getCenterpiece(blockId);
    if (!el) {
      return;
    }
    const sides = this.resolveLogicalSideLengths(el);
    if (index < 0 || index >= sides.length) {
      return;
    }
    const gaConfiguredSides = sides.map((side, sideIndex) => ({
      logicalId: side.logicalId,
      label: side.label,
      lengthM: Math.max(0.1, sideIndex === index ? lengthM : side.lengthM),
    }));
    const customPatch = this.buildCustomSidesPatchFromGa(el, gaConfiguredSides);
    this.update(blockId, {
      gaConfiguredSides,
      ...customPatch,
    });
    const current = gaConfiguredSides.map((side) => side.lengthM);

    const config = this.autoFillSeatingConfig();
    if (blockId === config.referenceBlockId && config.applyBlockMeasurementScale !== false) {
      this.autoFillSeatingConfig.update((prev) => ({
        ...prev,
        referenceSideLengthsM: current,
        applyBlockMeasurementScale: true,
      }));
      this.syncAutoFillScaledMeasurementsToSelection();
    }
    this.autoFillError.set(null);
  }

  /** @deprecated Use setAutoFillBlockSideLength — kept for compatibility. */
  setAutoFillReferenceSideLength(index: number, lengthM: number): void {
    const id = this.autoFillSeatingConfig().referenceBlockId;
    if (id) {
      this.setAutoFillBlockSideLength(id, index, lengthM);
    }
  }

  setAutoFillBlockMeasurementScaleEnabled(enabled: boolean): void {
    this.autoFillSeatingConfig.update((prev) => ({
      ...prev,
      applyBlockMeasurementScale: enabled,
    }));
    if (enabled) {
      this.syncAutoFillScaledMeasurementsToSelection();
    }
  }

  /**
   * Geometry-based Auto Fill: apply master configuration to all selected eligible blocks.
   * Each block independently packs from its own updated measurements.
   */
  applyAutoFillToSelectedBlocks(): AutoFillBatchResult | null {
    const blocks = this.selectedAutoFillBlocks();
    if (blocks.length === 0) {
      this.autoFillError.set(
        'Select one or more custom seating blocks (Shift + click) before Auto Fill.',
      );
      return null;
    }

    const config = this.autoFillSeatingConfig();
    if (config.chairLengthM <= 0 || config.chairWidthM <= 0) {
      this.autoFillError.set('Chair dimensions must be greater than zero.');
      return null;
    }

    this.pushHistory();
    // Capture pre-fill seating (including aisles) so Cancel can fully undo Auto Fill.
    for (const block of blocks) {
      this.ensureAutoFillLayoutRevertSnapshot(block.id);
    }
    // Snapshot fill targets before measurement sync — never re-select here
    // (selectElements would rewrite side metres and can corrupt packing).
    const fillIds = blocks.map((block) => block.id);
    const referenceId =
      config.referenceBlockId ?? this.blockWorkspaceId() ?? blocks[0]?.id ?? null;
    if (referenceId) {
      this.syncBlockMeasurementsFromReference(referenceId);
    }

    const results: AutoFillBatchResult['results'] = [];
    let totalSeats = 0;
    let successCount = 0;
    const fillConfig = this.autoFillSeatingConfig();
    const blocksAfterSync = fillIds
      .map((id) => this.getCenterpiece(id))
      .filter((el): el is CenterpieceElement => !!el && isAutoFillEligibleBlock(el));
    let workingElements = [...this.elements()];
    for (const el of blocksAfterSync) {
      const label = el.name?.trim() || el.code?.trim() || el.id;
      const live = workingElements.find((item) => item.id === el.id);
      const target =
        live && live.type === 'centerpiece' ? (live as CenterpieceElement) : el;
      const outcome = applyAutoFillToBlock(target, workingElements, this.canvas(), fillConfig);
      if ('error' in outcome) {
        results.push({
          elementId: el.id,
          elementName: label,
          success: false,
          error: outcome.error,
        });
        continue;
      }
      this.applyPatch(el.id, outcome.patch);
      workingElements = workingElements.map((item) =>
        item.id === el.id ? ({ ...item, ...outcome.patch } as typeof item) : item,
      );
      results.push({
        elementId: el.id,
        elementName: label,
        success: true,
        seatCount: outcome.seatCount,
      });
      totalSeats += outcome.seatCount;
      successCount += 1;
    }

    const batch: AutoFillBatchResult = {
      results,
      totalSeats,
      successCount,
      failureCount: results.length - successCount,
    };

    this.autoFillLastResult.set(batch);
    if (batch.failureCount > 0 && batch.successCount === 0) {
      this.autoFillError.set(
        batch.results.find((r) => !r.success)?.error ??
          'Auto Fill could not place seats on the selected blocks.',
      );
    } else if (batch.failureCount > 0) {
      this.autoFillError.set(
        `Auto Fill applied to ${batch.successCount} of ${blocksAfterSync.length} selected blocks.`,
      );
    } else {
      this.autoFillError.set(null);
    }

    return batch;
  }

  /** All seating blocks on the canvas eligible for Auto Fill. */
  allAutoFillEligibleBlocks(): CenterpieceElement[] {
    return this.elements()
      .filter((el): el is CenterpieceElement => el.type === 'centerpiece')
      .filter(isAutoFillEligibleBlock);
  }

  /** Capture measurement baselines when entering block configure (seating). */
  initWorkspaceMeasurementBaselines(): void {
    const el = this.blockWorkspaceElement();
    if (!el || el.blockType !== 'seating') {
      return;
    }
    const refBaseline = this.logicalBaselineLengthsM(el);
    const configured = this.workspaceConfiguredSideLengthsM(el);
    const baselines: Record<string, number[]> = {};
    for (const block of this.allAutoFillEligibleBlocks()) {
      const blockConfigured = this.workspaceConfiguredSideLengthsM(block);
      baselines[block.id] =
        blockConfigured.length >= 3 ? blockConfigured : this.logicalBaselineLengthsM(block);
    }
    this.autoFillSeatingConfig.update((prev) => ({
      ...prev,
      applyBlockMeasurementScale: true,
      referenceBlockId: el.id,
      referenceBaselineSideLengthsM: configured.length >= 3 ? configured : refBaseline,
      referenceSideLengthsM: [...(configured.length >= 3 ? configured : refBaseline)],
      blockMeasurementBaselines: baselines,
    }));
  }

  /** Geometric logical-side lengths used as the 1× measurement baseline. */
  private logicalBaselineLengthsM(block: CenterpieceElement): number[] {
    const rect = rectFromPositionSize(block.position, block.size, this.canvas());
    const polygon = polygonCanvasPointsFromBlock(block.customPoints ?? [], rect);
    const geometric = estimateDefaultSideLengthsM(block, rect);
    const edges = buildBlockMeasureEdges(polygon);
    return edges.map((edge) => {
      const sum = edge.sourceIndices.reduce(
        (total, src) => total + Math.max(0, geometric[src] ?? 0),
        0,
      );
      return Math.round(Math.max(0.1, sum) * 100) / 100;
    });
  }

  /** Resolve ordered side lengths from GA configured sides on a block. */
  private workspaceConfiguredSideLengthsM(el: CenterpieceElement): number[] {
    const configured = el.gaConfiguredSides ?? [];
    if (configured.length < 3) {
      return [];
    }
    const sorted = [...configured].sort((a, b) => a.logicalId - b.logicalId);
    const lengths = sorted.map((side) => side.lengthM ?? 0).filter((len) => len > 0.05);
    return lengths.length >= 3 ? lengths : [];
  }

  /** Resolve logical side labels and lengths for a block (configure / sync). */
  private resolveLogicalSideLengths(
    el: CenterpieceElement,
  ): { logicalId: number; label: string; lengthM: number }[] {
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const edges = buildBlockMeasureEdges(polygon);
    const configured = el.gaConfiguredSides ?? [];
    const customLengths = el.customSideLengthsM ?? [];
    const geometric = estimateDefaultSideLengthsM(el, rect);

    return edges.map((edge) => {
      const conf = configured.find((side) => side.logicalId === edge.id);
      if (conf?.label?.trim() && (conf.lengthM ?? 0) > 0) {
        return {
          logicalId: edge.id,
          label: conf.label.trim(),
          lengthM: conf.lengthM!,
        };
      }
      const srcMeasured = edge.sourceIndices.map((index) => customLengths[index] ?? 0);
      if (srcMeasured.length > 0 && srcMeasured.every((length) => length > 0)) {
        return {
          logicalId: edge.id,
          label: conf?.label?.trim() || edge.label,
          lengthM: Math.round(srcMeasured.reduce((sum, length) => sum + length, 0) * 100) / 100,
        };
      }
      const srcGeometric = edge.sourceIndices.map((index) => geometric[index] ?? 0);
      const geoSum = srcGeometric.reduce((sum, length) => sum + length, 0);
      return {
        logicalId: edge.id,
        label: conf?.label?.trim() || edge.label,
        lengthM: Math.round(Math.max(0.1, geoSum) * 100) / 100,
      };
    });
  }

  /** Build customSideLengthsM / customSideNames patch from gaConfiguredSides. */
  private buildCustomSidesPatchFromGa(
    el: CenterpieceElement,
    configured: import('../models/layout-element.model').GaConfiguredSide[],
  ): Pick<CenterpieceElement, 'customSideLengthsM' | 'customSideNames'> {
    const sideCount = el.customPoints?.length ?? 0;
    const lengths = Array.from({ length: sideCount }, () => 0);
    const names = Array.from({ length: sideCount }, (_, index) => stadiumSideLabel(index, sideCount));
    if (sideCount < 3) {
      return { customSideLengthsM: lengths, customSideNames: names };
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);

    for (const conf of configured) {
      const logical = logicalMeasureEdgeById(polygon, conf.logicalId);
      if (!logical || (conf.lengthM ?? 0) <= 0) {
        continue;
      }
      const safeLength = Math.max(0.1, conf.lengthM!);
      const safeName = conf.label.trim() || logical.label;
      const pxPerSource = logical.sourceIndices.map((src) => {
        const seg = edgeSegment(polygon, src);
        if (!seg) {
          return 0;
        }
        return Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
      });
      const totalPx = pxPerSource.reduce((sum, px) => sum + px, 0) || logical.lengthPx;
      logical.sourceIndices.forEach((src, index) => {
        const share =
          totalPx > 0
            ? safeLength * (pxPerSource[index] / totalPx)
            : safeLength / logical.sourceIndices.length;
        lengths[src] = share;
        if (index === 0) {
          names[src] = safeName;
        }
      });
    }

    return { customSideLengthsM: lengths, customSideNames: names };
  }

  /**
   * When the workspace reference block measurements change, scale all other
   * eligible blocks from their saved baselines by the same perimeter factor
   * and persist gaConfiguredSides / customSideLengthsM so Create seats / Auto
   * Fill pack each block from its newly updated measurements.
   */
  syncWorkspaceMeasurementsToAllBlocks(): WorkspaceMeasurementSyncEntry[] {
    const el = this.blockWorkspaceElement();
    if (!el || el.blockType !== 'seating') {
      this.workspaceMeasurementSyncInfo.set([]);
      return [];
    }
    return this.syncBlockMeasurementsFromReference(el.id);
  }

  /**
   * Scale every eligible seating block from `blockMeasurementBaselines` using
   * the reference block's baseline → current perimeter factor. Writes updated
   * side metres onto each block (does not place seats — Create seats / Auto Fill do).
   */
  private syncBlockMeasurementsFromReference(
    referenceBlockId: string,
  ): WorkspaceMeasurementSyncEntry[] {
    const reference = this.getCenterpiece(referenceBlockId);
    if (
      !reference ||
      reference.blockType === 'dining-table' ||
      reference.blockType === 'general-admission'
    ) {
      this.workspaceMeasurementSyncInfo.set([]);
      return [];
    }

    const currentLengths = this.workspaceConfiguredSideLengthsM(reference);
    if (currentLengths.length < 3) {
      this.workspaceMeasurementSyncInfo.set([]);
      return [];
    }

    const config = this.autoFillSeatingConfig();
    let referenceBaseline = config.referenceBaselineSideLengthsM ?? [];
    const baselines: Record<string, number[]> = {
      ...(config.blockMeasurementBaselines ?? {}),
    };

    // Establish baselines once from geometric defaults — never lock in already-edited
    // current lengths as the 1× baseline (that would skip scaling other blocks).
    if (referenceBaseline.length < 3) {
      referenceBaseline = this.logicalBaselineLengthsM(reference);
    }
    for (const block of this.allAutoFillEligibleBlocks()) {
      if (baselines[block.id]?.length >= 3) {
        continue;
      }
      baselines[block.id] = this.logicalBaselineLengthsM(block);
    }
    if (!baselines[reference.id] || baselines[reference.id].length < 3) {
      baselines[reference.id] = [...referenceBaseline];
    }

    const factor = computeBlockMeasurementScaleFactor(referenceBaseline, currentLengths);
    if (!Number.isFinite(factor) || factor <= 0) {
      this.workspaceMeasurementSyncInfo.set([]);
      return [];
    }

    this.autoFillSeatingConfig.update((prev) => ({
      ...prev,
      referenceBlockId: reference.id,
      referenceBaselineSideLengthsM: referenceBaseline,
      referenceSideLengthsM: currentLengths,
      blockMeasurementBaselines: baselines,
      applyBlockMeasurementScale: true,
    }));

    // Keep the reference block's polygon-edge metres in sync with configure sides.
    const referenceConfigured = reference.gaConfiguredSides ?? [];
    if (referenceConfigured.length >= 3) {
      const refPatch = this.buildCustomSidesPatchFromGa(reference, referenceConfigured);
      this.updateSilent(reference.id, {
        ...refPatch,
        blockType: reference.blockType ?? 'seating',
      });
    }

    const summaries: WorkspaceMeasurementSyncEntry[] = [];
    for (const block of this.allAutoFillEligibleBlocks()) {
      if (block.id === reference.id) {
        continue;
      }

      const sides = this.resolveLogicalSideLengths(block);
      if (sides.length < 3) {
        continue;
      }

      const hasConfiguredSides = (block.gaConfiguredSides?.length ?? 0) >= 3;
      const hasCustomLengths = (block.customSideLengthsM?.length ?? 0) >= 3;
      // Scale ≈ 1 still writes baselines onto unmeasured blocks so every
      // selected Auto Fill target can pack seats.
      if (Math.abs(factor - 1) < 0.001 && hasConfiguredSides && hasCustomLengths) {
        continue;
      }

      const baselineLengths =
        baselines[block.id]?.length >= 3
          ? baselines[block.id]
          : sides.map((side) => side.lengthM);
      const alignedBaseline =
        baselineLengths.length === sides.length
          ? baselineLengths
          : sides.map((side, index) => baselineLengths[index] ?? side.lengthM);
      const scaledLengths = scaleSideLengthsM(alignedBaseline, factor);
      const gaConfiguredSides = sides.map((side, index) => ({
        logicalId: side.logicalId,
        label: side.label,
        lengthM: scaledLengths[index],
      }));
      const customPatch = this.buildCustomSidesPatchFromGa(block, gaConfiguredSides);

      this.updateSilent(block.id, {
        gaConfiguredSides,
        ...customPatch,
        blockType: block.blockType ?? 'seating',
      });

      summaries.push({
        blockId: block.id,
        blockName: block.name?.trim() || block.label?.trim() || block.code?.trim() || 'Block',
        sides: gaConfiguredSides.map((side) => ({
          label: side.label,
          lengthM: side.lengthM ?? 0,
        })),
      });
    }

    this.workspaceMeasurementSyncInfo.set(summaries);
    return summaries;
  }

  /** Per-block aisle slots cloned for the shared Auto Fill editor / overlay. */
  private cloneBlockAutoFillAisles(
    el: CenterpieceElement | null | undefined,
  ): AutoFillAisleSlot[] {
    if (el?.autoFillAisles?.length) {
      return el.autoFillAisles.map((slot) => ({ ...slot }));
    }
    return [...(DEFAULT_AUTO_FILL_SEATING_CONFIG.aisles ?? [])];
  }

  /**
   * Bind the shared aisle editor to this block only — clears leftover draw
   * aisles from a previously opened block so overlays never bleed across.
   */
  private loadBlockAislesIntoSharedAutoFillConfig(
    el: CenterpieceElement | null | undefined,
  ): void {
    const aisles = this.cloneBlockAutoFillAisles(el);
    this.cancelDrawAisle();
    this.autoFillSeatingConfig.update((prev) => ({
      ...prev,
      aisles,
      referenceBlockId: el?.id ?? prev.referenceBlockId,
    }));
  }

  /** Copy workspace block seating settings into the shared Auto Fill config. */
  captureAutoFillConfigFromWorkspaceBlock(options?: { preserveSeatDimensions?: boolean }): boolean {
    const el = this.blockWorkspaceElement();
    if (!el || el.blockType !== 'seating') {
      this.autoFillError.set('Configure a seating block before Auto Fill.');
      return false;
    }
    const configuredLengths = this.workspaceConfiguredSideLengthsM(el);
    const configuredOrLogical =
      configuredLengths.length >= 3
        ? configuredLengths
        : this.logicalBaselineLengthsM(el);

    // Always load THIS block's aisles — never keep another block's draw aisle.
    const blockAisles = this.cloneBlockAutoFillAisles(el);

    if (options?.preserveSeatDimensions) {
      // Keep measurement baselines intact so later edits still scale every block
      // from the original configure-time lengths — refresh current lengths and
      // keep THIS block's live aisle options (never another block's).
      this.autoFillSeatingConfig.update((prev) => ({
        ...prev,
        aisles:
          prev.referenceBlockId === el.id && prev.aisles != null
            ? prev.aisles.map((slot) => ({ ...slot }))
            : blockAisles,
        referenceBlockId: el.id,
        referenceSideLengthsM:
          configuredOrLogical.length >= 3
            ? configuredOrLogical
            : prev.referenceSideLengthsM,
        applyBlockMeasurementScale: true,
      }));
    } else {
      const baselines: Record<string, number[]> = {};
      for (const block of this.allAutoFillEligibleBlocks()) {
        const blockConfigured = this.workspaceConfiguredSideLengthsM(block);
        baselines[block.id] =
          blockConfigured.length >= 3
            ? blockConfigured
            : this.logicalBaselineLengthsM(block);
      }
      const baselineLengths =
        configuredOrLogical.length >= 3
          ? configuredOrLogical
          : this.logicalBaselineLengthsM(el);
      this.autoFillSeatingConfig.set({
        chairLengthM: resolveChairLengthM(el),
        chairWidthM: resolveChairWidthM(el),
        seatGapM: el.seatGapM ?? DEFAULT_AUTO_FILL_SEATING_CONFIG.seatGapM,
        rowGapM: el.rowGapM ?? el.seatGapM ?? DEFAULT_AUTO_FILL_SEATING_CONFIG.rowGapM,
        borderGapM: el.borderGapM ?? 0,
        curveDeg: clampAutoFillCurveDeg(
          el.seatLayout?.rowCurveDeg ?? el.seatLayout?.rowCurveDegs?.[0] ?? 0,
        ),
        curveEnabled:
          clampAutoFillCurveDeg(
            el.seatLayout?.rowCurveDeg ?? el.seatLayout?.rowCurveDegs?.[0] ?? 0,
          ) > 0,
        aislePlacementMode: DEFAULT_AUTO_FILL_SEATING_CONFIG.aislePlacementMode,
        aisleRows: DEFAULT_AUTO_FILL_SEATING_CONFIG.aisleRows,
        aisleColumns: DEFAULT_AUTO_FILL_SEATING_CONFIG.aisleColumns,
        aisleWidthM: DEFAULT_AUTO_FILL_SEATING_CONFIG.aisleWidthM,
        aisles: blockAisles,
        applyBlockMeasurementScale: true,
        referenceBlockId: el.id,
        referenceBaselineSideLengthsM: baselineLengths,
        referenceSideLengthsM: [
          ...(configuredOrLogical.length >= 3 ? configuredOrLogical : baselineLengths),
        ],
        blockMeasurementBaselines: baselines,
      });
    }
    this.cancelDrawAisle();
    this.autoFillError.set(null);
    return true;
  }

  /** Finish configure step and open the manual seat/table editing tools. */
  proceedToEditBlockFromWorkspace(): boolean {
    if (!this.completeSideLabelConfigureStep()) {
      return false;
    }
    const el = this.blockWorkspaceElement();
    if (el?.blockType === 'seating') {
      this.syncWorkspaceMeasurementsToAllBlocks();
    }
    this.flushAutoFillSpacingToWorkspaceBlock();
    this.blockWorkspaceSeatingEditMode.set(true);
    return true;
  }

  /**
   * Preview Auto Fill seats on the workspace block only. Measurements are synced
   * to every eligible block so the later front-layout Auto Fill packs from those
   * updated side lengths after the user selects/unselects blocks.
   */
  createSeatsForWorkspaceBlock(): { seatCount: number; blockCount: number } | null {
    const el = this.blockWorkspaceElement();
    if (!el || el.blockType !== 'seating') {
      this.autoFillError.set('Configure a seating block before creating seats.');
      return null;
    }
    if (!this.completeSideLabelConfigureStep()) {
      this.autoFillError.set('Label and save every side before creating seats.');
      return null;
    }
    // Ensure aisle edits sync onto THIS workspace block before packing.
    this.autoFillSeatingConfig.update((prev) => ({
      ...prev,
      referenceBlockId: el.id,
    }));
    this.flushAutoFillSpacingSync();
    if (!this.captureAutoFillConfigFromWorkspaceBlock({ preserveSeatDimensions: true })) {
      return null;
    }

    const config = this.autoFillSeatingConfig();
    if (config.chairLengthM <= 0 || config.chairWidthM <= 0) {
      this.autoFillError.set('Chair dimensions must be greater than zero.');
      return null;
    }

    // When Curve is on, Create seats always uses a default curve if none is set yet.
    const createCurveDeg = resolveCreateAutoFillCurveDeg(config);
    if (config.curveEnabled === true && clampAutoFillCurveDeg(config.curveDeg) !== createCurveDeg) {
      this.setAutoFillSeatingConfig({ curveDeg: createCurveDeg, curveEnabled: true });
    }
    const fillConfig = this.autoFillSeatingConfig();

    this.ensureAutoFillLayoutRevertSnapshot(el.id);
    this.pushHistory();

    // Sync updated measurements to all blocks first (no seating yet), then preview
    // seats on this workspace block only.
    this.syncBlockMeasurementsFromReference(el.id);
    this.syncAutoFillSpacingPatchToWorkspaceBlock({
      chairWidthM: fillConfig.chairWidthM,
      chairLengthM: fillConfig.chairLengthM,
      seatGapM: fillConfig.seatGapM,
      rowGapM: fillConfig.rowGapM,
      borderGapM: fillConfig.borderGapM,
      curveDeg: fillConfig.curveDeg,
      curveEnabled: fillConfig.curveEnabled,
      aisles: fillConfig.aisles ?? [],
    });

    const workspaceEl = this.blockWorkspaceElement();
    if (!workspaceEl) {
      return null;
    }
    // Lock in the seat-1 side the sidebar showed, so later re-creates stay stable.
    if (workspaceEl.seatStartSide == null) {
      this.applyPatch(workspaceEl.id, {
        seatStartSide: resolveSeatStartSide(
          workspaceEl,
          rectFromPositionSize(workspaceEl.position, workspaceEl.size, this.canvas()),
        ),
      });
    }
    const packSource = this.blockWorkspaceElement() ?? workspaceEl;

    const outcome = applyAutoFillToBlock(
      packSource,
      this.elements(),
      this.canvas(),
      this.autoFillSeatingConfig(),
    );
    if ('error' in outcome) {
      this.autoFillError.set(outcome.error);
      return null;
    }

    this.applyPatch(el.id, outcome.patch);
    this.autoFillError.set(null);
    return { seatCount: outcome.seatCount, blockCount: 1 };
  }

  /**
   * Finish configure, exit to 2D layout with all eligible blocks selected for
   * select/unselect — does NOT place seats. Seats are applied only when the user
   * clicks Auto Fill on the front layout inspector.
   */
  startAutoFillLayoutModeFromWorkspace(): boolean {
    if (!this.completeSideLabelConfigureStep()) {
      return false;
    }
    this.autoFillSeatingConfig.update((prev) => ({
      ...prev,
      referenceBlockId: this.blockWorkspaceId() ?? prev.referenceBlockId,
    }));
    this.flushAutoFillSpacingSync();
    if (!this.captureAutoFillConfigFromWorkspaceBlock({ preserveSeatDimensions: true })) {
      return false;
    }
    // Sync updated measurements onto every block, but do not seat yet.
    this.syncWorkspaceMeasurementsToAllBlocks();
    const eligibleIds = this.allAutoFillEligibleBlocks().map((block) => block.id);
    if (eligibleIds.length === 0) {
      this.autoFillError.set('No seating blocks found on the layout.');
      return false;
    }
    for (const blockId of eligibleIds) {
      this.ensureAutoFillLayoutRevertSnapshot(blockId);
    }
    const workspaceId = this.blockWorkspaceId();
    this.exitBlockWorkspace({ restoreCamera: false, preserveAutoFillAisles: true });
    this.fitCameraToLayoutWorkspace();
    this.selectElements(eligibleIds, workspaceId ?? eligibleIds[0]);
    this.autoFillLayoutMode.set(true);
    this.autoFillColorDeselectHint.set(null);
    this.autoFillLastResult.set(null);
    this.autoFillError.set(null);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.fitCameraToLayoutWorkspace());
    });
    return true;
  }

  exitAutoFillLayoutMode(): void {
    this.cancelAutoFillAnimation();
    this.revertAutoFillLayoutSeating();
    this.autoFillLayoutMode.set(false);
    this.autoFillColorDeselectHint.set(null);
    this.autoFillError.set(null);
    this.autoFillLastResult.set(null);
    // Drop shared Auto Fill aisles so a cancelled session cannot leak onto the
    // next block configure / draw-aisle edit.
    this.cancelDrawAisle();
    this.autoFillSeatingConfig.update((prev) => ({
      ...prev,
      aisles: [...(DEFAULT_AUTO_FILL_SEATING_CONFIG.aisles ?? [])],
    }));
    this.selectElement(null);
  }

  /**
   * Leave 2D Auto Fill layout and reopen the reference block's configure view
   * with the existing Auto Fill settings loaded for continued editing.
   */
  openBlockWorkspaceForAutoFillEdit(): boolean {
    const blockId = this.resolveAutoFillReferenceBlockId();
    if (!blockId) {
      this.autoFillError.set('No reference block found for Auto Fill configuration.');
      return false;
    }

    const el = this.getCenterpiece(blockId);
    if (!el || el.blockType !== 'seating') {
      this.autoFillError.set('The Auto Fill reference must be a seating block.');
      return false;
    }
    if (!this.allGaSidesConfigured(el)) {
      this.autoFillError.set('This block has no saved side measurements to edit.');
      return false;
    }

    this.cancelAutoFillAnimation();
    this.revertAutoFillLayoutSeating();
    this.autoFillLayoutMode.set(false);
    this.autoFillColorDeselectHint.set(null);

    this.blockWorkspaceReturnView = {
      zoom: this.zoom(),
      cameraX: this.cameraX(),
      cameraY: this.cameraY(),
    };

    this.syncReferenceBlockFromAutoFillConfig(blockId);

    this.colorDetectMode.set(false);
    this.blockWorkspaceId.set(blockId);
    this.selectElement(blockId);
    this.captureBlockWorkspaceLabelSnapshot(blockId);
    // Rebind aisle editor/overlay to this reference block only.
    this.loadBlockAislesIntoSharedAutoFillConfig(el);

    if (el.blockViewpointAngleDeg != null) {
      this.blockWorkspaceViewpointAngleDeg.set(el.blockViewpointAngleDeg);
    } else {
      this.initBlockWorkspaceViewpoint(blockId);
    }
    this.blockWorkspaceViewpointDistancePx.set(null);
    this.blockWorkspaceViewpointConfirmed.set(true);
    this.blockWorkspaceSeatingEditMode.set(false);
    this.blockWorkspaceForceEditStep.set(false);
    this.blockWorkspaceSidesConfigured.set(true);
    this.blockWorkspaceSeatingSideIndex.set(el.dragSeatsStadiumSideIndex ?? 0);
    this.blockWorkspaceConfigSaved.set(false);
    this.blockMeasureContext.set('none');
    this.gaWorkspacePendingSideId.set(null);
    this.gaWorkspaceMaxParticipantsStep.set(false);
    this.workspaceMeasurementSyncInfo.set([]);
    this.cancelArrangeByRow();

    this.fitCameraToElement(blockId, { blockWorkspace: true });
    setTimeout(() => {
      if (this.blockWorkspaceId() === blockId) {
        this.fitCameraToElement(blockId, { blockWorkspace: true });
      }
    }, 0);

    this.autoFillError.set(null);
    return true;
  }

  private resolveAutoFillReferenceBlockId(): string | null {
    const config = this.autoFillSeatingConfig();
    if (config.referenceBlockId && this.getCenterpiece(config.referenceBlockId)) {
      return config.referenceBlockId;
    }
    const focusedId = this.selectedId();
    if (focusedId) {
      const focused = this.getCenterpiece(focusedId);
      if (focused?.blockType === 'seating') {
        return focusedId;
      }
    }
    const selected = this.selectedAutoFillBlocks();
    return selected[0]?.id ?? null;
  }

  /** Apply stored Auto Fill settings onto the reference block for configure UI. */
  private syncReferenceBlockFromAutoFillConfig(blockId: string): void {
    const el = this.getCenterpiece(blockId);
    if (!el) {
      return;
    }
    const config = this.autoFillSeatingConfig();
    const baseline = el.autoFillStraightSeatPositions ?? el.seatPositionOverrides;
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const curveDeg = resolveEffectiveAutoFillCurveDeg(config);
    const spacingPatch: Partial<CenterpieceElement> = {
      chairWidthM: config.chairWidthM,
      chairLengthM: config.chairLengthM,
      seatGapM: config.seatGapM,
      rowGapM: config.rowGapM,
      borderGapM: config.borderGapM,
      ...(el.seatLayout
        ? { seatLayout: applyAutoFillCurveToSeatLayout(el.seatLayout, curveDeg) }
        : {}),
      ...(baseline && Object.keys(baseline).length > 0
        ? (() => {
            const baked = bakeAutoFillSeatPositions(el, rect, baseline, curveDeg);
            return {
              autoFillStraightSeatPositions: baked.autoFillStraightSeatPositions,
              seatPositionOverrides: baked.seatPositionOverrides,
              ...(baked.seatLayout ? { seatLayout: baked.seatLayout } : {}),
            };
          })()
        : {}),
    };

    const referenceLengths = config.referenceSideLengthsM ?? [];
    const configured = el.gaConfiguredSides ?? [];
    if (referenceLengths.length >= 3 && configured.length >= 3) {
      const rect = rectFromPositionSize(el.position, el.size, this.canvas());
      const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
      const edges = buildBlockMeasureEdges(polygon);
      const sortedEdges = [...edges].sort((a, b) => a.id - b.id);
      const updatedSides = sortedEdges.map((edge, index) => {
        const existing = configured.find((side) => side.logicalId === edge.id);
        const lengthM = referenceLengths[index] ?? existing?.lengthM ?? 1;
        return {
          logicalId: edge.id,
          label: existing?.label?.trim() || edge.label,
          lengthM: Math.max(0.1, lengthM),
        };
      });
      const customPatch = this.buildCustomSidesPatchFromGa(el, updatedSides);
      this.updateSilent(blockId, {
        ...spacingPatch,
        gaConfiguredSides: updatedSides,
        ...customPatch,
      });
      return;
    }

    this.updateSilent(blockId, spacingPatch);
  }

  /** Normalized fill colour key for matching blocks (style.fillColor). */
  blockFillColorKey(el: CenterpieceElement): string {
    return normalizeBlockFillColor(el.style.fillColor);
  }

  /** Called when a block is toggled off selection during Auto Fill layout mode. */
  notifyAutoFillBlockDeselected(blockId: string): void {
    if (!this.autoFillLayoutMode()) {
      return;
    }
    const el = this.getCenterpiece(blockId);
    if (!el) {
      return;
    }
    this.autoFillColorDeselectHint.set(this.blockFillColorKey(el));
  }

  /** Remove every still-selected block that shares the hinted fill colour. */
  deselectAutoFillBlocksWithSameColor(): void {
    const hint = this.autoFillColorDeselectHint();
    if (!hint || !this.autoFillLayoutMode()) {
      return;
    }
    const removeIds = new Set(
      this.selectedAutoFillBlocks()
        .filter((block) => this.blockFillColorKey(block) === hint)
        .map((block) => block.id),
    );
    if (removeIds.size === 0) {
      this.autoFillColorDeselectHint.set(null);
      return;
    }
    const next = this.selectedIds().filter((id) => !removeIds.has(id));
    this.selectElements(next, next[0] ?? null);
    this.autoFillColorDeselectHint.set(null);
  }

  cancelAutoFillAnimation(): void {
    this.autoFillAnimationToken += 1;
    this.autoFillAnimating.set(false);
  }

  /** Remember seating state before Auto Fill writes seats (first capture wins). */
  private ensureAutoFillLayoutRevertSnapshot(blockId: string): void {
    if (this.autoFillLayoutRevertSnapshots.has(blockId)) {
      return;
    }
    const el = this.getCenterpiece(blockId);
    if (!el) {
      return;
    }
    this.autoFillLayoutRevertSnapshots.set(blockId, {
      ...extractSeatingSnapshot(el),
      interactiveSeatingLocked: el.interactiveSeatingLocked,
      borderGapM: el.borderGapM,
      seatFacingDeg: el.seatFacingDeg,
    });
  }

  /** Restore blocks to their pre–Auto Fill seating state (including aisles). */
  private revertAutoFillLayoutSeating(): void {
    if (this.autoFillLayoutRevertSnapshots.size === 0) {
      return;
    }
    this.pushHistory();
    for (const [blockId, snapshot] of this.autoFillLayoutRevertSnapshots) {
      this.applyPatch(blockId, {
        ...seatingSnapshotToPatch(snapshot),
        // Explicitly restore/clear aisles Auto Fill may have written onto the block.
        autoFillAisles: snapshot.autoFillAisles,
        interactiveSeatingLocked: snapshot.interactiveSeatingLocked,
        borderGapM: snapshot.borderGapM,
        seatFacingDeg: snapshot.seatFacingDeg,
      });
    }
    this.autoFillLayoutRevertSnapshots.clear();
  }

  /**
   * Animate Auto Fill across selected blocks — batched per animation frame for speed.
   */
  async applyAutoFillToSelectedBlocksAnimated(): Promise<AutoFillBatchResult | null> {
    const blocks = this.selectedAutoFillBlocks();
    if (blocks.length === 0) {
      this.autoFillError.set('Select one or more seating blocks before Auto Fill.');
      return null;
    }

    const config = this.autoFillSeatingConfig();
    if (config.chairLengthM <= 0 || config.chairWidthM <= 0) {
      this.autoFillError.set('Chair dimensions must be greater than zero.');
      return null;
    }

    this.cancelAutoFillAnimation();
    const token = ++this.autoFillAnimationToken;
    this.autoFillAnimating.set(true);
    this.autoFillError.set(null);
    this.autoFillLastResult.set(null);

    const blocksForSnapshots = this.selectedAutoFillBlocks();
    for (const block of blocksForSnapshots) {
      this.ensureAutoFillLayoutRevertSnapshot(block.id);
    }

    this.pushHistory();
    // Snapshot fill targets before measurement sync — never re-select here
    // (selectElements would rewrite side metres and can corrupt packing).
    const fillIds = blocks.map((block) => block.id);
    const referenceId =
      config.referenceBlockId ?? this.blockWorkspaceId() ?? blocks[0]?.id ?? null;
    if (referenceId) {
      this.syncBlockMeasurementsFromReference(referenceId);
    }

    const results: AutoFillBatchResult['results'] = [];
    let totalSeats = 0;
    let successCount = 0;
    const blocksAfterSync = fillIds
      .map((id) => this.getCenterpiece(id))
      .filter((el): el is CenterpieceElement => !!el && isAutoFillEligibleBlock(el));
    const allElements = this.elements();
    const canvas = this.canvas();
    const fillConfig = this.autoFillSeatingConfig();
    const animationMode = blocksAfterSync.length > 1 ? 'block' : 'row';

    type AnimationJob = AutoFillAnimationStep & { blockLabel: string };
    const jobs: AnimationJob[] = [];
    const blockTotals = new Map<string, number>();

    let workingElements = [...allElements];
    for (const el of blocksAfterSync) {
      const label = el.name?.trim() || el.code?.trim() || el.id;
      const live = workingElements.find((item) => item.id === el.id);
      const target =
        live && live.type === 'centerpiece' ? (live as CenterpieceElement) : el;
      const built = buildAutoFillAnimationSteps(target, workingElements, canvas, fillConfig, {
        mode: animationMode,
      });
      if ('error' in built) {
        results.push({
          elementId: el.id,
          elementName: label,
          success: false,
          error: built.error,
        });
        continue;
      }
      blockTotals.set(el.id, built.totalSeats);
      const finalStep = built.steps[built.steps.length - 1];
      if (finalStep) {
        workingElements = workingElements.map((item) =>
          item.id === el.id ? ({ ...item, ...finalStep.patch } as typeof item) : item,
        );
      }
      for (const step of built.steps) {
        jobs.push({ ...step, blockLabel: label });
      }
    }

    const waitFrame = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

    const batchSize = Math.max(1, Math.ceil(jobs.length / AUTO_FILL_ANIMATION_MAX_FRAMES));

    for (let index = 0; index < jobs.length; index += batchSize) {
      if (token !== this.autoFillAnimationToken) {
        this.autoFillAnimating.set(false);
        return null;
      }

      const batch = jobs.slice(index, index + batchSize);
      const latestPatchByBlock = new Map<string, Partial<CenterpieceElement>>();
      for (const job of batch) {
        latestPatchByBlock.set(job.elementId, job.patch);
      }
      for (const [elementId, patch] of latestPatchByBlock) {
        this.applyPatch(elementId, patch);
      }

      await waitFrame();
    }

    for (const el of blocksAfterSync) {
      const label = el.name?.trim() || el.code?.trim() || el.id;
      const seatCount = blockTotals.get(el.id);
      if (seatCount == null) {
        continue;
      }
      results.push({
        elementId: el.id,
        elementName: label,
        success: true,
        seatCount,
      });
      totalSeats += seatCount;
      successCount += 1;
    }

    const batch: AutoFillBatchResult = {
      results,
      totalSeats,
      successCount,
      failureCount: results.length - successCount,
    };

    this.autoFillLastResult.set(batch);
    this.autoFillAnimating.set(false);
    if (batch.failureCount > 0 && batch.successCount === 0) {
      this.autoFillError.set(
        batch.results.find((r) => !r.success)?.error ??
          'Auto Fill could not place seats on the selected blocks.',
      );
    } else if (batch.failureCount > 0) {
      this.autoFillError.set(
        `Auto Fill applied to ${batch.successCount} of ${blocksAfterSync.length} selected blocks.`,
      );
    } else {
      this.autoFillError.set(null);
    }

    return batch;
  }

  /**
   * Commit Auto Fill seats on selected blocks (lock + clear revert snapshots).
   * Caller must persist exportLayoutConfig() to Supabase / draft storage.
   */
  saveAutoFillSeatedBlocks(): { savedCount: number; totalSeats: number } | null {
    const blocks = this.selectedAutoFillBlocks();
    if (blocks.length === 0) {
      this.autoFillError.set('No seating blocks selected.');
      return null;
    }

    let savedCount = 0;
    let totalSeats = 0;
    this.pushHistory();
    for (const block of blocks) {
      const rect = rectFromPositionSize(block.position, block.size, this.canvas());
      const seatCount = getCustomShapeVisibleSeatCount(block, rect);
      if (seatCount <= 0) {
        continue;
      }
      this.applyPatch(block.id, {
        interactiveSeatingLocked: true,
        dragSeatsMode: undefined,
        dragSeatsFirstRowSeatCount: undefined,
        dragFillSeatsMode: undefined,
      });
      savedCount += 1;
      totalSeats += seatCount;
    }

    if (savedCount === 0) {
      this.autoFillError.set('Auto Fill seats first, then save.');
      return null;
    }

    this.autoFillLayoutRevertSnapshots.clear();
    this.autoFillLayoutMode.set(false);
    this.autoFillColorDeselectHint.set(null);
    this.autoFillError.set(null);
    this.selectElement(null);
    return { savedCount, totalSeats };
  }

  /** Re-place arrange-by-row seats after chair size or gap changes. */
  reapplyArrangeByRowGrid(id: string, dims: PhysicalDimsInput): boolean {
    const el = this.getCenterpiece(id);
    if (!el?.arrangeByRowMode || (el.customSideLengthsM?.length ?? 0) < 3) {
      return false;
    }
    const sideLengths = el.customSideLengthsM ?? [];
    const sideNames = el.customSideNames ?? [];
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const stadiumSideIndex =
      el.dragSeatsStadiumSideIndex ??
      this.blockWorkspaceSeatingSideIndex() ??
      0;
    const viewpointAngle =
      el.blockViewpointAngleDeg ??
      (this.blockWorkspaceViewpointConfirmed() ? this.blockWorkspaceViewpointAngleDeg() : null);
    const cap = estimateArrangeByRowCapacity(
      el,
      rect,
      sideLengths,
      dims,
      stadiumSideIndex,
      viewpointAngle,
    );
    const rows = Math.max(1, el.seatLayout?.rows ?? el.rows ?? 1);
    const rowTarget = Math.min(rows, cap.maxRows);
    const result = createArrangeByRowGridSeating(
      el,
      rect,
      sideLengths,
      sideNames,
      dims,
      stadiumSideIndex,
      rowTarget,
      undefined,
      viewpointAngle,
      undefined,
      undefined,
      { adjacentBlocks: collectAdjacentBlocks(el, this.elements(), this.canvas()) },
    );
    if ('error' in result) {
      this.arrangeByRowWizardError.set(result.error);
      return false;
    }
    this.pushHistory();
    this.applyPatch(id, result.patch);
    this.arrangeByRowWizardError.set(null);
    return true;
  }

  /** Save chair size and gaps, rebuilding seats when a grid layout is active. */
  saveSeatSpacingConfig(id: string, dims: PhysicalDimsInput): boolean {
    const el = this.getCenterpiece(id);
    if (!el) {
      return false;
    }
    if (el.arrangeByRowMode && (el.customSideLengthsM?.length ?? 0) >= 3) {
      return this.reapplyArrangeByRowGrid(id, dims);
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    if (el.dragSeatsMode) {
      const spacingPatch = updateDragSeatsSpacing(el, rect, dims);
      if (Object.keys(spacingPatch).length === 0) {
        return false;
      }
      this.pushHistory();
      this.applyPatch(id, {
        chairLengthM: dims.chairLengthM,
        chairWidthM: dims.chairWidthM,
        seatGapM: dims.seatGapM,
        rowGapM: dims.rowGapM,
        ...spacingPatch,
      });
      this.arrangeByRowWizardError.set(null);
      return true;
    }
    this.pushHistory();
    this.applyPatch(id, {
      chairLengthM: dims.chairLengthM,
      chairWidthM: dims.chairWidthM,
      seatGapM: dims.seatGapM,
      rowGapM: dims.rowGapM,
    });
    this.arrangeByRowWizardError.set(null);
    return true;
  }

  /** Apply parsed seating-chart spec (Azure OCR) — sides, gaps, rows, seats. */
  applyAutoSeatingSpec(elementId: string, spec: SeatingChartSpec): boolean {
    const el = this.getCenterpiece(elementId);
    const rawCount = el?.customPoints?.length ?? 0;
    if (!el || rawCount < 3) {
      this.arrangeByRowWizardError.set('Draw a custom block outline with at least 3 points first.');
      return false;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const logicalEdges = buildBlockMeasureEdges(polygon);
    const lengths = [...(el.customSideLengthsM ?? [])];
    const names = [...(el.customSideNames ?? [])];
    while (lengths.length < rawCount) {
      lengths.push(0);
    }
    while (names.length < rawCount) {
      names.push('');
    }

    for (let i = 0; i < logicalEdges.length && i < spec.sideLengthsM.length; i += 1) {
      const logical = logicalEdges[i];
      const safeLength = Math.max(0.1, spec.sideLengthsM[i]);
      const safeName = spec.sideLabels?.[i]?.trim() || logical.label;
      const pxPerSource = logical.sourceIndices.map((src) => {
        const seg = edgeSegment(polygon, src);
        if (!seg) {
          return 0;
        }
        return Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
      });
      const totalPx = pxPerSource.reduce((sum, px) => sum + px, 0) || logical.lengthPx;
      logical.sourceIndices.forEach((src, index) => {
        const share =
          totalPx > 0
            ? safeLength * (pxPerSource[index] / totalPx)
            : safeLength / logical.sourceIndices.length;
        lengths[src] = share;
        if (index === 0) {
          names[src] = safeName;
        }
      });
    }

    const filledSides = lengths.filter((len) => len > 0.05).length;
    if (filledSides < 3) {
      this.arrangeByRowWizardError.set('Could not map blueprint side lengths onto this block outline.');
      return false;
    }

    const viewpointConfirmed =
      this.blockWorkspaceViewpointConfirmed() || el.blockViewpointAngleDeg != null;
    const resolvedAngle =
      el.blockViewpointAngleDeg ??
      (this.blockWorkspaceViewpointConfirmed()
        ? this.blockWorkspaceViewpointAngleDeg()
        : null);

    if (!viewpointConfirmed && resolvedAngle == null) {
      this.arrangeByRowWizardError.set('Confirm VIEW POINT on the block before creating seats.');
      return false;
    }

    const safeAngle = resolvedAngle ?? DEFAULT_VIEWPOINT_ANGLE_DEG;
    const stadiumSideIndex = viewpointConfirmed
      ? (el.dragSeatsStadiumSideIndex ?? this.blockWorkspaceSeatingSideIndex() ?? 0)
      : (() => {
          const viewpointLogical = Math.max(
            0,
            Math.min(logicalEdges.length - 1, spec.viewpointSideIndex ?? 0),
          );
          const stadiumEdge = logicalEdges[viewpointLogical];
          return (
            stadiumEdge?.index ??
            el.dragSeatsStadiumSideIndex ??
            this.blockWorkspaceSeatingSideIndex() ??
            0
          );
        })();

    const blockDims = deriveBlockDimsFromSides(polygon, lengths);
    const dims: PhysicalDimsInput = {
      physicalLengthM: blockDims.physicalLengthM,
      physicalWidthM: blockDims.physicalWidthM,
      chairLengthM: Math.max(0.1, spec.chairLengthM),
      chairWidthM: Math.max(0.1, spec.chairWidthM),
      seatGapM: Math.max(0, spec.seatGapM),
      rowGapM: Math.max(0, spec.rowGapM),
    };

    const layoutSides = this.blockWorkspaceViewpointLayout()?.sideIndices ?? [];
    const dualIndices =
      layoutSides.length > 1
        ? layoutSides
        : (el.dragSeatsStadiumSideIndices?.length ?? 0) > 1
          ? el.dragSeatsStadiumSideIndices
          : undefined;

    const elForSeating: CenterpieceElement = {
      ...el,
      ...blockDims,
      customSideLengthsM: lengths,
      customSideNames: names,
      blockViewpointAngleDeg: safeAngle,
      dragSeatsStadiumSideIndex: stadiumSideIndex,
      dragSeatsStadiumSideIndices: dualIndices,
      chairLengthM: dims.chairLengthM,
      chairWidthM: dims.chairWidthM,
      seatGapM: dims.seatGapM,
      rowGapM: dims.rowGapM,
    };

    const stadiumLogical =
      logicalEdges.find((edge) => edge.sourceIndices.includes(stadiumSideIndex)) ??
      logicalEdges[0];
    const stadiumEdgeLengthM = Math.max(
      0.1,
      stadiumLogical.sourceIndices.reduce((sum, idx) => sum + (lengths[idx] ?? 0), 0),
    );
    const blueprintScale: ArrangeByRowBlueprintScale = {
      stadiumEdgeLengthM,
      stadiumEdgeLengthPx: Math.max(1, stadiumLogical.lengthPx),
      depthLengthM: Math.max(0.1, blockDims.physicalLengthM),
    };

    const result = createArrangeByRowGridSeating(
      elForSeating,
      rect,
      lengths,
      names,
      dims,
      stadiumSideIndex,
      spec.rowCount,
      undefined,
      safeAngle,
      blueprintScale,
      undefined,
      { adjacentBlocks: collectAdjacentBlocks(elForSeating, this.elements(), this.canvas()) },
    );
    if ('error' in result) {
      this.arrangeByRowWizardError.set(result.error);
      return false;
    }

    const labelPatch = hasCustomLabelOffset(el)
      ? {}
      : defaultLabelOffsetOutsideViewpoint(safeAngle);

    this.pushHistory();
    this.applyPatch(elementId, {
      ...result.patch,
      customSideLengthsM: lengths,
      customSideNames: names,
      dragSeatsStadiumSideIndex: stadiumSideIndex,
      dragSeatsStadiumSideIndices: dualIndices,
      blockViewpointAngleDeg: safeAngle,
      ...(spec.blockName?.trim() ? { label: spec.blockName.trim() } : {}),
      ...labelPatch,
    });
    this.arrangeByRowWizardPhase.set('idle');
    this.arrangeByRowPendingSideIds.set([]);
    this.arrangeByRowElementId.set(null);
    this.arrangeByRowWizardError.set(null);
    return true;
  }

  /** Apply parsed dining-table spec — sides, stage, exit, table count and measurements. */
  applyAutoDiningSpec(elementId: string, spec: DiningTableChartSpec): boolean {
    const el = this.getCenterpiece(elementId);
    const rawCount = el?.customPoints?.length ?? 0;
    if (!el || rawCount < 3) {
      this.autoDiningSpecError.set('Draw a custom block outline with at least 3 points first.');
      return false;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const logicalEdges = buildBlockMeasureEdges(polygon);
    const lengths = [...(el.customSideLengthsM ?? [])];
    const names = [...(el.customSideNames ?? [])];
    while (lengths.length < rawCount) {
      lengths.push(0);
    }
    while (names.length < rawCount) {
      names.push('');
    }

    for (let i = 0; i < logicalEdges.length && i < spec.sideLengthsM.length; i += 1) {
      const logical = logicalEdges[i];
      const safeLength = Math.max(0.1, spec.sideLengthsM[i]);
      const safeName = spec.sideLabels?.[i]?.trim() || logical.label;
      const pxPerSource = logical.sourceIndices.map((src) => {
        const seg = edgeSegment(polygon, src);
        if (!seg) {
          return 0;
        }
        return Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
      });
      const totalPx = pxPerSource.reduce((sum, px) => sum + px, 0) || logical.lengthPx;
      logical.sourceIndices.forEach((src, index) => {
        const share =
          totalPx > 0
            ? safeLength * (pxPerSource[index] / totalPx)
            : safeLength / logical.sourceIndices.length;
        lengths[src] = share;
        if (index === 0) {
          names[src] = safeName;
        }
      });
    }

    const filledSides = lengths.filter((len) => len > 0.05).length;
    if (filledSides < 3) {
      this.autoDiningSpecError.set('Could not map specification side lengths onto this block outline.');
      return false;
    }

    const blockDims = deriveBlockDimsFromSides(polygon, lengths);
    let elPrepared: CenterpieceElement = {
      ...el,
      ...blockDims,
      customSideLengthsM: lengths,
      customSideNames: names,
      chairLengthM: Math.max(0.1, spec.chairLengthM),
      chairWidthM: Math.max(0.1, spec.chairWidthM),
      diningTables: undefined,
      diningStage: undefined,
      diningFoodPrepare: undefined,
      diningEntrance: undefined,
      diningExit: undefined,
      diningServiceRoutes: undefined,
      appliedDiningLayoutTemplateId: undefined,
    };

    const stageSide =
      spec.stageSideIndex != null
        ? Math.max(0, Math.min(logicalEdges.length - 1, spec.stageSideIndex))
        : undefined;
    if (stageSide != null) {
      const stageSpec = createDiningStageOnSide(elPrepared, rect, stageSide, {
        widthM: spec.stageWidthM,
        depthM: spec.stageDepthM,
      });
      if (stageSpec) {
        elPrepared = { ...elPrepared, diningStage: stageSpec };
      }
    }

    if (spec.exitSideIndex != null) {
      const exitSide = Math.max(0, Math.min(logicalEdges.length - 1, spec.exitSideIndex));
      const exitSpec = createDiningExitOnSide(elPrepared, rect, exitSide);
      if (exitSpec) {
        elPrepared = { ...elPrepared, diningExit: exitSpec };
      }
    }

    const viewpointAngle = resolveDiningViewpointAngleDeg(
      elPrepared,
      rect,
      stageSide ?? elPrepared.diningStage?.sideEdgeId,
    );

    const gridOptions: TableCountGridOptions = {
      shape: spec.tableShape,
      widthM: Math.max(0.1, spec.tableWidthM),
      depthM: Math.max(0.1, spec.tableDepthM),
      gapM: Math.max(0, spec.tableGapM),
      tableCount: Math.max(1, Math.round(spec.tableCount)),
      seats: Math.max(1, Math.round(spec.chairsPerTable)),
    };

    const maxFill = computeMaxFillTableCount(elPrepared, gridOptions);
    if (gridOptions.tableCount > maxFill) {
      this.autoDiningSpecError.set(
        `No spaces — this block fits at most ${maxFill} table${maxFill === 1 ? '' : 's'} with the given measurements, but the document asks for ${gridOptions.tableCount}.`,
      );
      return false;
    }

    const result = createTableCountGrid(
      { ...elPrepared, blockViewpointAngleDeg: viewpointAngle },
      rect,
      gridOptions,
    );
    if ('error' in result) {
      this.autoDiningSpecError.set(
        result.error.includes('fit')
          ? `No spaces — ${result.error}`
          : result.error,
      );
      return false;
    }

    const labelPatch = hasCustomLabelOffset(el)
      ? {}
      : defaultLabelOffsetOutsideViewpoint(viewpointAngle);

    this.pushHistory();
    this.applyPatch(elementId, {
      ...elPrepared,
      ...result,
      customSideLengthsM: lengths,
      customSideNames: names,
      blockViewpointAngleDeg: viewpointAngle,
      defaultDiningTableShape: spec.tableShape,
      defaultTableSeats: gridOptions.seats,
      defaultTableWidthM: result.defaultTableWidthM ?? gridOptions.widthM,
      defaultTableDepthM: result.defaultTableDepthM ?? gridOptions.depthM,
      defaultTableGapM: gridOptions.gapM,
      appliedDiningLayoutTemplateId: 'measurement-spec',
      ...(spec.blockName?.trim() ? { label: spec.blockName.trim() } : {}),
      ...labelPatch,
    });
    this.autoDiningSpecError.set(null);
    return true;
  }

  /**
   * Pitch / venue-centre canvas point used to aim imported VIEW POINTs — every
   * imported block's first row faces this point.
   */
  private findPitchCanvasPoint(): { x: number; y: number } {
    const canvas = this.canvas();
    const centerpieces = this.elements().filter(isCenterpiece);
    const pitch = centerpieces.find(
      (el) =>
        el.id.startsWith('cv-pitch') ||
        /\b(pitch|field|ground|court|arena|stage)\b/i.test(`${el.label} ${el.name}`),
    );
    if (pitch) {
      const rect = rectFromPositionSize(pitch.position, pitch.size, canvas);
      return { x: rect.cx, y: rect.cy };
    }
    const blocks = centerpieces.filter((el) => (el.customPoints?.length ?? 0) >= 3);
    if (blocks.length > 0) {
      let sx = 0;
      let sy = 0;
      for (const el of blocks) {
        const rect = rectFromPositionSize(el.position, el.size, canvas);
        sx += rect.cx;
        sy += rect.cy;
      }
      return { x: sx / blocks.length, y: sy / blocks.length };
    }
    return { x: canvas.width / 2, y: canvas.height / 2 };
  }

  /**
   * Match import rows to canvas blocks. Matched entries are sorted clockwise
   * around the pitch so an animated fill sweeps around the stadium; unmatched
   * rows come last with the reason.
   */
  private resolveSeatingImportTargets(rows: SeatingImportRow[]): {
    pitch: { x: number; y: number };
    matched: { row: SeatingImportRow; pool: CenterpieceElement[]; angle: number }[];
    unmatched: SeatingImportReportEntry[];
    /**
     * User-calibrated metres-per-pixel, when set. Uncalibrated imports leave
     * this undefined so CSV chair/aisle metres become each block's measurements.
     */
    venueScale: number | undefined;
  } {
    const canvas = this.canvas();
    const pitch = this.findPitchCanvasPoint();

    const candidates = new Map<string, CenterpieceElement[]>();
    for (const el of this.elements()) {
      if (!isCenterpiece(el)) {
        continue;
      }
      const keys = new Set(
        [el.code, el.label, el.name].map(normalizeBlockCode).filter(Boolean),
      );
      for (const key of keys) {
        const list = candidates.get(key) ?? [];
        list.push(el);
        candidates.set(key, list);
      }
    }

    // Largest block first — when codes repeat (two "31" blocks), the row's
    // grid is most likely meant for (and to fit in) the bigger block.
    const areaOf = (el: CenterpieceElement): number => {
      const rect = rectFromPositionSize(el.position, el.size, canvas);
      return rect.width * rect.height;
    };
    for (const pool of candidates.values()) {
      pool.sort((a, b) => areaOf(b) - areaOf(a));
    }

    const claimed = new Set<string>();
    const matched: { row: SeatingImportRow; pool: CenterpieceElement[]; angle: number }[] = [];
    const unmatched: SeatingImportReportEntry[] = [];

    for (const row of rows) {
      const key = normalizeBlockCode(row.blockCode);
      const pool = (candidates.get(key) ?? []).filter((el) => !claimed.has(el.id));
      if (pool.length === 0) {
        unmatched.push({
          blockCode: row.blockCode,
          status: 'not-found',
          message:
            (candidates.get(key)?.length ?? 0) > 0
              ? 'Duplicate code — matching blocks were already claimed by earlier rows.'
              : 'No block with this code on the canvas.',
        });
        continue;
      }
      // Reserve the primary candidate so a later duplicate row takes the next one.
      claimed.add(pool[0].id);
      const rect = rectFromPositionSize(pool[0].position, pool[0].size, canvas);
      matched.push({
        row,
        pool,
        angle: viewpointAngleFromCanvasPoint(pitch.x, pitch.y, rect.cx, rect.cy),
      });
    }

    matched.sort((a, b) => a.angle - b.angle);

    // Only an explicit venue calibration ("this edge is N metres") may override
    // CSV metres. A derived shared scale made bigger blocks report larger side
    // / aisle measurements even when every CSV row used the same 0.2 m aisles.
    const calibrated = this.venueMetresPerPx();
    return {
      pitch,
      matched,
      unmatched,
      venueScale: calibrated != null && calibrated > 0 ? calibrated : undefined,
    };
  }

  /**
   * Pick the block and seat plan for one import row. Tries each same-code
   * candidate (largest first); a candidate that fits the documented seats per
   * row exactly wins, otherwise the closest plan is returned with its
   * shortfall so the caller can ask the user to continue or skip.
   */
  private planSeatingImportRow(
    row: SeatingImportRow,
    pool: CenterpieceElement[],
    pitch: { x: number; y: number },
    filled: Set<string>,
    venueScale: number | undefined,
  ):
    | { el: CenterpieceElement; plan: ImportSeatingPlan }
    | { entry: SeatingImportReportEntry } {
    let lastError = 'No block with this code on the canvas.';
    let best: { el: CenterpieceElement; plan: ImportSeatingPlan } | null = null;
    for (const el of pool) {
      if (filled.has(el.id)) {
        continue;
      }
      const rect = rectFromPositionSize(el.position, el.size, this.canvas());
      const plan = computeImportSeatingPlan(el, rect, row, pitch, venueScale, {
        elements: this.elements(),
        canvas: this.canvas(),
      });
      if ('error' in plan) {
        lastError = plan.error;
        continue;
      }
      if (!plan.shortfall) {
        return { el, plan };
      }
      if (!best || plan.seatsPlaced > best.plan.seatsPlaced) {
        best = { el, plan };
      }
    }
    if (best) {
      return best;
    }
    return { entry: { blockCode: row.blockCode, status: 'error', message: lastError } };
  }

  private applySeatingImportPlan(
    row: SeatingImportRow,
    el: CenterpieceElement,
    plan: ImportSeatingPlan,
    filled: Set<string>,
  ): SeatingImportReportEntry {
    filled.add(el.id);
    this.applyPatch(el.id, plan.patch);
    this.syncAutoFillConfigFromImport(row, plan);
    return {
      blockCode: row.blockCode,
      status: 'filled',
      seats: plan.seatsPlaced,
      rows: plan.rowsPlaced,
      message:
        plan.shortfall ??
        plan.warning ??
        (plan.trimmedSeats > 0
          ? `${plan.trimmedSeats} seat${plan.trimmedSeats === 1 ? '' : 's'} trimmed to match the capacity.`
          : undefined),
    };
  }

  /**
   * Mirror imported CSV spacing onto the Auto Fill form so the sidebar shows
   * the same chair/gap/border/curve/aisle values that were just applied.
   */
  private syncAutoFillConfigFromImport(row: SeatingImportRow, plan: ImportSeatingPlan): void {
    const curveDeg = clampAutoFillCurveDeg(
      row.curveDeg ?? plan.patch.seatLayout?.rowCurveDeg ?? 0,
    );
    this.autoFillSeatingConfig.update((prev) => ({
      ...prev,
      chairWidthM: plan.patch.chairWidthM ?? prev.chairWidthM,
      chairLengthM: plan.patch.chairLengthM ?? prev.chairLengthM,
      seatGapM: plan.patch.seatGapM ?? prev.seatGapM,
      rowGapM: plan.patch.rowGapM ?? prev.rowGapM,
      borderGapM: plan.patch.borderGapM ?? prev.borderGapM,
      curveDeg,
      curveEnabled: curveDeg > 0,
      aisles: row.aisles?.length ? [...row.aisles] : [],
    }));
  }

  /**
   * Bulk seat fill from an imported file: match each row's block code against
   * canvas blocks, auto-set the VIEW POINT toward the pitch, and place seats.
   * Records one undo step for the whole import.
   */
  importSeatingFromRows(rows: SeatingImportRow[]): SeatingImportReportEntry[] {
    const { pitch, matched, unmatched, venueScale } = this.resolveSeatingImportTargets(rows);
    if (matched.length > 0) {
      this.pushHistory();
    }
    const filled = new Set<string>();
    const report = matched.map(({ row, pool }) => {
      const planned = this.planSeatingImportRow(row, pool, pitch, filled, venueScale);
      return 'entry' in planned
        ? planned.entry
        : this.applySeatingImportPlan(row, planned.el, planned.plan, filled);
    });
    return [...report, ...unmatched];
  }

  /**
   * Animated variant — fills one block at a time, sweeping clockwise around the
   * pitch, pausing `stepDelayMs` between blocks so the user sees seats appear.
   * The block being filled is selected so the highlight travels with the sweep.
   * When a block cannot fit the documented seats per row, the sweep pauses on
   * that block and `onConflict` decides: continue (fill what fits) or skip.
   */
  async importSeatingFromRowsAnimated(
    rows: SeatingImportRow[],
    options: {
      stepDelayMs?: number;
      onProgress?: (done: number, total: number, entry: SeatingImportReportEntry) => void;
      onConflict?: (conflict: SeatingImportConflict) => Promise<SeatingImportConflictDecision>;
    } = {},
  ): Promise<SeatingImportReportEntry[]> {
    const { pitch, matched, unmatched, venueScale } = this.resolveSeatingImportTargets(rows);
    const stepDelayMs = options.stepDelayMs ?? 0;
    const report: SeatingImportReportEntry[] = [];

    this.selectSeat(null);
    if (matched.length > 0) {
      this.pushHistory();
    }
    const filled = new Set<string>();
    let stopped = false;
    let autoContinue = false;
    for (let index = 0; index < matched.length && !stopped; index += 1) {
      const { row, pool } = matched[index];
      const planned = this.planSeatingImportRow(row, pool, pitch, filled, venueScale);

      let entry: SeatingImportReportEntry;
      if ('entry' in planned) {
        entry = planned.entry;
      } else if (planned.plan.shortfall && options.onConflict && !autoContinue) {
        // Pause the sweep on the problem block and let the user decide.
        this.selectElement(planned.el.id);
        const decision = await options.onConflict({
          blockCode: row.blockCode,
          detail: planned.plan.shortfall,
          placeableSeats: planned.plan.seatsPlaced,
          requestedSeats: planned.plan.requestedSeats ?? planned.plan.seatsPlaced,
          shortfallRows: planned.plan.shortfallRows ?? [],
          index: index + 1,
          total: matched.length,
        });
        if (decision === 'continue' || decision === 'continue-all') {
          autoContinue = decision === 'continue-all';
          entry = this.applySeatingImportPlan(row, planned.el, planned.plan, filled);
        } else if (decision === 'skip') {
          entry = {
            blockCode: row.blockCode,
            status: 'skipped',
            message: `Skipped — ${planned.plan.shortfall}`,
          };
        } else {
          stopped = true;
          entry = {
            blockCode: row.blockCode,
            status: 'skipped',
            message: 'Import stopped here.',
          };
        }
      } else {
        this.selectElement(planned.el.id);
        entry = this.applySeatingImportPlan(row, planned.el, planned.plan, filled);
      }

      report.push(entry);
      options.onProgress?.(index + 1, matched.length, entry);

      if (stopped) {
        for (let rest = index + 1; rest < matched.length; rest += 1) {
          report.push({
            blockCode: matched[rest].row.blockCode,
            status: 'skipped',
            message: 'Not filled — import stopped.',
          });
        }
        break;
      }
      if (stepDelayMs > 0 && index < matched.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, stepDelayMs));
      }
    }
    this.selectElement(null);
    return [...report, ...unmatched];
  }

  beginArrangeByRowAnchorAt(elementId: string, anchorPct: ElementPosition): boolean {
    if (!this.canUseInteractiveSeatingPlacement(elementId)) {
      return false;
    }
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return false;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const result = beginArrangeByRowAnchor(el, rect, this.canvas(), anchorPct);
    if (!result) {
      return false;
    }
    this.applyPatch(elementId, result.patch);
    this.arrangeByRowRowIndex.set(result.rowIndex);
    this.arrangeByRowAnchor.set(anchorPct);
    this.arrangeByRowDragging.set(true);
    return true;
  }

  updateArrangeByRowExtentSilent(elementId: string, endCanvasPx: { x: number; y: number }): void {
    if (!this.canUseInteractiveSeatingPlacement(elementId)) {
      return;
    }
    const el = this.getCenterpiece(elementId);
    const rowIndex = this.arrangeByRowRowIndex();
    const anchor = this.arrangeByRowAnchor();
    if (!el || rowIndex == null || !anchor) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const endPct = {
      xPct: (endCanvasPx.x / this.canvas().width) * 100,
      yPct: (endCanvasPx.y / this.canvas().height) * 100,
    };
    const patch = expandArrangeByRowRow(el, rect, this.canvas(), rowIndex, anchor, endPct);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.applyPatch(elementId, patch);
  }

  expandArrangeByRowLastSeatSilent(
    elementId: string,
    rowIndex: number,
    endCanvasPx: { x: number; y: number },
  ): void {
    if (!this.canUseInteractiveSeatingPlacement(elementId)) {
      return;
    }
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const endPct = canvasPxToPct(endCanvasPx, this.canvas());
    const patch = expandArrangeByRowLastSeat(el, rect, this.canvas(), rowIndex, endPct);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.applyPatch(elementId, patch);
  }

  commitArrangeByRowRow(): void {
    this.arrangeByRowDragging.set(false);
    this.arrangeByRowRowIndex.set(null);
    this.arrangeByRowAnchor.set(null);
    this.commitGesture();
  }

  applyDefineByRowColumn(id: string, rows: number, columns: number): void {
    const el = this.getCenterpiece(id);
    if (!el || !hasTracedBlockOutline(el)) {
      return;
    }
    this.cancelSeatRowDrawing();
    this.cancelLineSeatDrawing();
    this.cancelPerSeatPlacement();
    this.cancelArrangeByRow();
    this.pendingSeatRow.set(null);
    this.drawingElementId.set(null);
    this.draftPoints.set([]);

    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    this.pushHistory();
    this.applyPatch(id, createDefineByRowColumnSeating(el, rect, rows, columns));
    this.selectedId.set(id);
    this.selectedSeatId.set(null);
  }

  cancelArrangeByRow(): void {
    this.cancelGesture();
    this.arrangeByRowElementId.set(null);
    this.arrangeByRowRowIndex.set(null);
    this.arrangeByRowAnchor.set(null);
    this.arrangeByRowDragging.set(false);
    this.arrangeByRowWizardPhase.set('idle');
    this.arrangeByRowPendingSideIds.set([]);
    this.arrangeByRowMeasuredSides.set([]);
    this.arrangeByRowDraftSideLengthsM.set([]);
    this.arrangeByRowDraftSideNames.set([]);
    this.arrangeByRowWizardError.set(null);
    if (this.blockMeasureContext() === 'arrange-by-row') {
      this.blockMeasureContext.set('none');
    }
  }

  isArrangeByRowElement(id: string): boolean {
    const el = this.getCenterpiece(id);
    return el != null && isArrangeByRowElement(el);
  }

  isArrangeByRowDragging(): boolean {
    return this.arrangeByRowDragging();
  }

  applyCustomSeatLayout(id: string, next: SeatLayoutSpec): void {
    const el = this.getCenterpiece(id);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = applySeatLayoutWithCapacity(el, rect, next);
    this.pushHistory();
    this.applyPatch(id, patch);
  }

  updateCustomSeatBlock(
    elementId: string,
    blockId: string,
    patch: Omit<Partial<CustomShapeSeatBlock>, 'seatLayout'> & { seatLayout?: Partial<SeatLayoutSpec> },
  ): void {
    const el = this.getCenterpiece(elementId);
    if (!el || !el.customSeatBlocks) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const blockIndex = el.customSeatBlocks.findIndex((b) => b.id === blockId);
    if (blockIndex === -1) {
      return;
    }
    const currentBlock = el.customSeatBlocks[blockIndex];
    const mergedBlock: CustomShapeSeatBlock = {
      ...currentBlock,
      ...patch,
      seatLayout: patch.seatLayout
        ? { ...(currentBlock.seatLayout ?? { rows: currentBlock.rows, seatsPerRow: currentBlock.seatsPerRow }), ...patch.seatLayout }
        : currentBlock.seatLayout,
    };

    if (isCurveOnlyBlockPatch(patch)) {
      const updatedBlocks = [...el.customSeatBlocks];
      updatedBlocks[blockIndex] = {
        ...currentBlock,
        seatLayout: {
          ...(currentBlock.seatLayout ?? { rows: currentBlock.rows, seatsPerRow: currentBlock.seatsPerRow }),
          ...patch.seatLayout,
        },
      };
      this.pushHistory();
      this.applyPatch(elementId, { customSeatBlocks: updatedBlocks });
      return;
    }

    const tempBlocks = [...el.customSeatBlocks];
    tempBlocks[blockIndex] = mergedBlock;
    const tempElement = { ...el, customSeatBlocks: tempBlocks };

    const regeneratedBlock = regenerateBlockSeats(tempElement, blockIndex, rect, this.canvas());

    const updatedBlocks = [...el.customSeatBlocks];
    updatedBlocks[blockIndex] = regeneratedBlock;

    this.pushHistory();
    this.applyPatch(elementId, { customSeatBlocks: updatedBlocks });
  }

  addCustomShapeSeats(id: string, count: number): void {
    const el = this.getCenterpiece(id);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = addIndependentCustomShapeSeats(el, rect, count);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.pushHistory();
    this.applyPatch(id, patch);
  }

  /** Highlight a raw polygon edge while editing drag-seats side lengths in the inspector. */
  setDragSeatsHighlightSideIndex(index: number | null): void {
    if (index == null) {
      this.dragSeatsHighlightSideIndex.set(null);
      return;
    }
    this.dragSeatsHighlightSideIndex.set(Math.max(0, Math.round(index)));
  }

  clearDragSeatsHighlightSideIndex(): void {
    this.dragSeatsHighlightSideIndex.set(null);
  }

  enableDragSeats(
    id: string,
    sideLengthsM: number[],
    dims: PhysicalDimsInput,
    stadiumSideIndex: number,
    firstRowSeatCount?: number,
  ): void {
    let el = this.getCenterpiece(id);
    if (!el || !hasTracedBlockOutline(el)) {
      return;
    }
    if (!this.canUseInteractiveSeatingPlacement(id)) {
      return;
    }
    // Prefer configure-step / GA measurements so seat pitch (px/m) matches Arrange by row.
    if (this.allGaSidesConfigured(el) && !this.elementSidesFullyConfigured(el)) {
      this.syncGaConfiguredSidesToCustomSides(el);
      el = this.getCenterpiece(id) ?? el;
    }
    const sideCount = el.customPoints?.length ?? 0;
    const existing = el.customSideLengthsM ?? [];
    const configuredLengths =
      this.elementSidesFullyConfigured(el) ||
      (existing.length === sideCount && existing.every((length) => length > 0))
        ? [...existing]
        : sideLengthsM;
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = createDragSeatsSeating(
      el,
      rect,
      configuredLengths,
      {
        ...dims,
        rowGapM: dims.rowGapM ?? dims.seatGapM ?? resolveSeatGapM(el),
      },
      stadiumSideIndex,
      firstRowSeatCount,
    );
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.pushHistory();
    this.applyPatch(id, patch);
    this.seatRowDrawingElementId.set(null);
    this.seatRowDraftPoints.set([]);
    this.pendingSeatRow.set(null);
    this.selectedId.set(id);
  }

  updateDragSeatsExtentSilent(
    elementId: string,
    canvasPoint: { x: number; y: number },
  ): void {
    if (!this.canUseInteractiveSeatingPlacement(elementId)) {
      return;
    }
    const el = this.getCenterpiece(elementId);
    if (!el || !isDragSeatsElement(el)) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = expandDragSeatsToCanvasPoint(el, rect, canvasPoint);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.applyPatch(elementId, patch);
  }

  isDragSeatsElement(id: string): boolean {
    const el = this.getCenterpiece(id);
    return el != null && isDragSeatsElement(el);
  }

  fillDragSeatsFullShape(id: string): void {
    const el = this.getCenterpiece(id);
    if (!el || !isDragSeatsElement(el)) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = fillDragSeatsFullShape(el, rect);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.pushHistory();
    this.applyPatch(id, patch);
  }

  updateDragSeatsFirstRowSeatCount(id: string, seatCount: number): void {
    const el = this.getCenterpiece(id);
    if (!el || !isDragSeatsElement(el)) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = updateDragSeatsFirstRowSeatCount(el, rect, seatCount);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.pushHistory();
    this.applyPatch(id, patch);
  }

  updateDragSeatsSeatGap(id: string, seatGapM: number): void {
    const el = this.getCenterpiece(id);
    if (!el || !isDragSeatsElement(el)) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = updateDragSeatsSeatGap(el, rect, seatGapM);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.pushHistory();
    this.applyPatch(id, patch);
  }

  updateLineSeatRowCount(elementId: string, rowIndex: number, seatCount: number): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = updateLineSeatRowCount(el, rect, this.canvas(), rowIndex, seatCount);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, patch);
  }

  adjustLineSeatRowCount(elementId: string, rowIndex: number, delta: number): void {
    const el = this.getCenterpiece(elementId);
    if (!el?.seatLayout) {
      return;
    }
    const counts = el.seatLayout.rowSeatCounts ?? [];
    const current = counts[rowIndex] ?? 0;
    this.updateLineSeatRowCount(elementId, rowIndex, Math.max(0, current + delta));
  }

  removeCustomShapeSeatFromElement(id: string, seatId: string): void {
    const el = this.getCenterpiece(id);
    if (!el) {
      return;
    }
    const patch = removeCustomShapeSeat(el, seatId);
    if (Object.keys(patch).length === 0) {
      return;
    }
    this.pushHistory();
    this.applyPatch(id, patch);
    if (this.selectedSeatId() === seatId) {
      this.selectedSeatId.set(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Custom row-pair / seat-pair gaps (Auto Fill seating blocks)
  // ---------------------------------------------------------------------------

  /** Blocks whose seats live on the element itself (VIEW POINT → Create seats flow). */
  canEditSeatSpacing(el: CenterpieceElement | null | undefined): el is CenterpieceElement {
    return Boolean(
      el &&
        (el.blockType ?? 'seating') === 'seating' &&
        el.seatLayout &&
        (el.customSeatBlocks?.length ?? 0) === 0 &&
        Object.keys(el.autoFillStraightSeatPositions ?? el.seatPositionOverrides ?? {}).length > 0,
    );
  }

  /** Effective gap (m) between `rowIndex - 1` and `rowIndex` — uniform gap plus the row's extra. */
  seatRowGapM(elementId: string, rowIndex: number): number {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return 0;
    }
    return roundGapM(resolveRowGapM(el) + getRowGapExtraM(el.seatLayout, rowIndex));
  }

  /** Effective gap (m) between `seatIndex` and `seatIndex + 1` in `rowIndex`. */
  seatPairGapM(elementId: string, rowIndex: number, seatIndex: number): number {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return 0;
    }
    return roundGapM(resolveSeatGapM(el) + getSeatGapExtraM(el.seatLayout, rowIndex, seatIndex));
  }

  /**
   * Set the gap before `rowIndex` (between it and the previous row). Rows from
   * `rowIndex` onward move deeper into the block; chairs that leave the outline
   * are hidden until the gap shrinks again.
   */
  setSeatRowGapM(
    elementId: string,
    rowIndex: number,
    gapM: number,
    scope: SeatRowGapScope = 'row',
  ): void {
    const el = this.getCenterpiece(elementId);
    if (!this.canEditSeatSpacing(el) || rowIndex <= 0 || !Number.isFinite(gapM)) {
      return;
    }
    const spec = el.seatLayout!;
    const base = resolveRowGapM(el);
    const extra = roundGapM(Math.min(MAX_GAP_EXTRA_M, Math.max(0, gapM) - base));
    const rows = Math.max(spec.rows, rowIndex + 1);
    const rowGapExtraM = Array.from({ length: rows }, (_, i) => {
      if (i === 0) {
        return 0;
      }
      // "all" = every row pair in the block takes this gap.
      return scope === 'all' || i === rowIndex ? extra : (spec.rowGapExtraM?.[i] ?? 0);
    });
    const unchanged = rowGapExtraM.every(
      (v, i) => Math.abs(v - (spec.rowGapExtraM?.[i] ?? 0)) < 0.0005,
    );
    if (unchanged) {
      return;
    }
    this.commitSeatSpacing(el, { ...spec, rowGapExtraM });
  }

  /**
   * Set the gap after `seatIndex` in `rowIndex` (between it and the next seat).
   * The seats after it slide along the row; any chair pushed past the outline
   * is hidden until the gap shrinks again.
   *
   * `scope` widens the edit: `row` applies the same gap to every seat pair in
   * that row, `all` to every seat pair in the block.
   */
  setSeatPairGapM(
    elementId: string,
    rowIndex: number,
    seatIndex: number,
    gapM: number,
    scope: SeatPairGapScope = 'pair',
  ): void {
    const el = this.getCenterpiece(elementId);
    if (!this.canEditSeatSpacing(el) || rowIndex < 0 || seatIndex < 0 || !Number.isFinite(gapM)) {
      return;
    }
    const spec = el.seatLayout!;
    const base = resolveSeatGapM(el);
    const extra = roundGapM(Math.min(MAX_GAP_EXTRA_M, Math.max(0, gapM) - base));
    const seatGapExtraM = { ...(spec.seatGapExtraM ?? {}) };
    const assign = (r: number, s: number) => {
      const key = seatGapExtraKey(r, s);
      if (extra === 0) {
        delete seatGapExtraM[key];
      } else {
        seatGapExtraM[key] = extra;
      }
    };
    const rowSeatCounts = getSeatLayoutRowSeatCounts(
      getSeatLayoutSpec({
        rows: el.rows,
        seatsPerRow: el.seatsPerRow,
        rowLabelStyle: el.rowLabelStyle,
        seatLayout: spec,
      }),
    );
    if (scope === 'pair') {
      assign(rowIndex, seatIndex);
    } else {
      const rowsToEdit = scope === 'all' ? rowSeatCounts.map((_, i) => i) : [rowIndex];
      for (const r of rowsToEdit) {
        const count = rowSeatCounts[r] ?? 0;
        for (let s = 0; s < count - 1; s += 1) {
          assign(r, s);
        }
      }
    }
    const before = spec.seatGapExtraM ?? {};
    const keys = new Set([...Object.keys(before), ...Object.keys(seatGapExtraM)]);
    const unchanged = [...keys].every(
      (key) => Math.abs((before[key] ?? 0) - (seatGapExtraM[key] ?? 0)) < 0.0005,
    );
    if (unchanged) {
      return;
    }
    this.commitSeatSpacing(el, { ...spec, seatGapExtraM });
  }

  /** Where seat 1 sits in each row (spectator facing the VIEW POINT). */
  seatStartSide(elementId: string): SeatStartSide {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return 'left';
    }
    return resolveSeatStartSide(el, rectFromPositionSize(el.position, el.size, this.canvas()));
  }

  /**
   * Choose which end of every row gets seat 1. Placed seats keep their
   * positions and are renumbered in place (custom seat gaps follow their
   * chairs); the choice is also used by every later Create seats / Auto Fill.
   */
  setSeatStartSide(elementId: string, side: SeatStartSide): void {
    const el = this.getCenterpiece(elementId);
    if (!el || (el.blockType ?? 'seating') !== 'seating') {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const current = resolveSeatStartSide(el, rect);
    if (el.seatStartSide === side) {
      return;
    }
    this.pushHistory();
    if (current === side || !this.canEditSeatSpacing(el)) {
      this.applyPatch(el.id, { seatStartSide: side });
      return;
    }
    const baseline = el.autoFillStraightSeatPositions ?? el.seatPositionOverrides ?? {};
    const mirrored = mirrorSeatNumbering(baseline, el.seatLayout);
    const nextSpec: SeatLayoutSpec = { ...el.seatLayout!, ...mirrored.specPatch };
    const hasStraightBaseline = Boolean(el.autoFillStraightSeatPositions);
    const curveDeg = hasStraightBaseline
      ? clampAutoFillCurveDeg(nextSpec.rowCurveDeg ?? nextSpec.rowCurveDegs?.[0] ?? 0)
      : 0;
    const working: CenterpieceElement = { ...el, seatStartSide: side };
    const baked = bakeAutoFillSeatPositions(working, rect, mirrored.positions, curveDeg, nextSpec);
    this.applyPatch(el.id, {
      seatStartSide: side,
      autoFillStraightSeatPositions: baked.autoFillStraightSeatPositions,
      seatPositionOverrides: baked.seatPositionOverrides,
      seatLayout: {
        ...(baked.seatLayout ?? nextSpec),
        ...(hasStraightBaseline
          ? {}
          : { rowCurveDeg: nextSpec.rowCurveDeg, rowCurveDegs: nextSpec.rowCurveDegs }),
      },
    });
    this.selectedSeatId.set(null);
  }

  /** Drop every custom gap in one row (seat pairs) or the gap before that row. */
  resetSeatRowSpacing(elementId: string, rowIndex: number): void {
    const el = this.getCenterpiece(elementId);
    if (!this.canEditSeatSpacing(el)) {
      return;
    }
    const spec = el.seatLayout!;
    const rowGapExtraM = (spec.rowGapExtraM ?? []).map((v, i) => (i === rowIndex ? 0 : v));
    const seatGapExtraM = Object.fromEntries(
      Object.entries(spec.seatGapExtraM ?? {}).filter(
        ([key]) => parseSeatGapExtraKey(key)?.rowIndex !== rowIndex,
      ),
    );
    this.commitSeatSpacing(el, { ...spec, rowGapExtraM, seatGapExtraM });
  }

  /** Back to uniform gaps everywhere in the block. */
  resetSeatSpacing(elementId: string): void {
    const el = this.getCenterpiece(elementId);
    if (!this.canEditSeatSpacing(el) || !hasSeatSpacingAdjustments(el.seatLayout)) {
      return;
    }
    this.commitSeatSpacing(el, {
      ...el.seatLayout!,
      rowGapExtraM: undefined,
      seatGapExtraM: undefined,
    });
  }

  /** Seats currently hidden because a custom gap pushed them out of the outline. */
  seatSpacingHiddenIds(elementId: string): string[] {
    return this.getCenterpiece(elementId)?.seatLayout?.spacingHiddenSeatIds ?? [];
  }

  private commitSeatSpacing(el: CenterpieceElement, nextSpec: SeatLayoutSpec): void {
    const baseline = el.autoFillStraightSeatPositions ?? el.seatPositionOverrides ?? {};
    if (Object.keys(baseline).length === 0) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    // Without a straight baseline the stored positions already carry the curve —
    // re-applying it would bend the rows twice, so only shift in that case.
    const hasStraightBaseline = Boolean(el.autoFillStraightSeatPositions);
    const curveDeg = hasStraightBaseline
      ? clampAutoFillCurveDeg(nextSpec.rowCurveDeg ?? nextSpec.rowCurveDegs?.[0] ?? 0)
      : 0;
    const baked = bakeAutoFillSeatPositions(el, rect, baseline, curveDeg, nextSpec);
    const seatLayout: SeatLayoutSpec = {
      ...(baked.seatLayout ?? nextSpec),
      ...(hasStraightBaseline
        ? {}
        : { rowCurveDeg: nextSpec.rowCurveDeg, rowCurveDegs: nextSpec.rowCurveDegs }),
    };
    this.pushHistory();
    this.applyPatch(el.id, {
      autoFillStraightSeatPositions: baked.autoFillStraightSeatPositions,
      seatPositionOverrides: baked.seatPositionOverrides,
      seatLayout,
    });
    const hidden = new Set(baked.seatLayout?.spacingHiddenSeatIds ?? []);
    const selectedSeat = this.selectedSeatId();
    if (selectedSeat && this.selectedSeatElementId() === el.id && hidden.has(selectedSeat)) {
      this.selectedSeatId.set(null);
    }
  }

  updateCustomSeatPositionSilent(
    elementId: string,
    seatId: string,
    canvasPx: { x: number; y: number },
  ): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = updateSeatOverride(el, rect, seatId, canvasPx);
    this.applyPatch(elementId, patch);
  }

  onPhysicalDimsChange(id: string): void {
    const el = this.getCenterpiece(id);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const patch = recalcSeatPitchOnDimChange(el, rect);
    if (Object.keys(patch).length > 0) {
      this.applyPatch(id, patch);
    }
  }

  removeCustomShapeSeating(id: string): void {
    this.pushHistory();
    this.applyPatch(id, {
      rows: undefined,
      seatsPerRow: undefined,
      seatLayout: undefined,
      seatPositionOverrides: undefined,
      customSeatBlocks: undefined,
      dragSeatsMode: undefined,
      dragSeatsFirstRowSeatCount: undefined,
      customLineSeatRows: undefined,
      perSeatPlacementMode: undefined,
      arrangeByRowMode: undefined,
      arrangeByRowRows: undefined,
      interactiveSeatingLocked: undefined,
      dragFillSeatsMode: undefined,
      defineByRowColumnMode: undefined,
      defineByRowColumnRows: undefined,
      defineByRowColumnColumns: undefined,
      code: undefined,
    });
    this.selectedSeatId.set(null);
    this.selectedCustomRow.set(null);
    this.cancelSeatRowDrawing();
    this.cancelLineSeatDrawing();
    this.cancelPerSeatPlacement();
    this.cancelDragFillSeats();
    this.cancelArrangeByRow();
    this.cancelPendingSeatRow();
  }

  // --- History ---

  undo(): void {
    if (this.past.length === 0) {
      return;
    }
    const previous = this.past.pop()!;
    this.future.push(this.snapshot());
    this.elements.set(previous);
    this.syncSelectionAfterHistory();
    this.syncHistoryFlags();
  }

  redo(): void {
    if (this.future.length === 0) {
      return;
    }
    const next = this.future.pop()!;
    this.past.push(this.snapshot());
    this.elements.set(next);
    this.syncSelectionAfterHistory();
    this.syncHistoryFlags();
  }

  /** Builds the JSON document stored in Supabase layout_config. */
  exportLayoutConfig(): VenueLayoutConfig {
    const ref = this.referenceImage();
    const canvas = this.canvas();
    const elements = structuredClone(this.elements()).map((el) => {
      if (el.type === 'centerpiece') {
        return syncCenterpieceGeometry(el, canvas);
      }
      if (el.type === 'block-grid') {
        return syncBlockGridGeometry(el, canvas);
      }
      return el;
    });
    return {
      version: 1,
      canvas: { ...canvas },
      elements,
      ...(ref ? { referenceImage: { ...ref } } : {}),
    };
  }

  /** Replaces the canvas from a saved layout_config payload. */
  loadLayoutConfig(config: VenueLayoutConfig): void {
    this.canvasState.set({ ...config.canvas });
    const elements = structuredClone(config.elements).map((el) => {
      if (el.type === 'centerpiece') {
        return hydrateCenterpieceFromGeometry(el, config.canvas);
      }
      if (el.type === 'block-grid') {
        return hydrateBlockGridFromGeometry(el, config.canvas);
      }
      return el;
    });
    this.elements.set(elements);
    this.referenceImage.set(config.referenceImage ? { ...config.referenceImage } : null);
    this.syncBlockCounterFromElements();
    this.clearHistoryAndSelection();
    this.blockWorkspaceId.set(null);
    this.blockWorkspaceReturnView = null;
    this.parkingWorkspaceId.set(null);
    this.parkingWorkspaceStep.set('draw-area');
    this.parkingMeasureEdgeIndex.set(null);
    this.cameraX.set(config.canvas.width / 2);
    this.cameraY.set(config.canvas.height / 2);
  }

  /** Restores a browser draft (elements, reference, camera, selection). */
  restoreSessionState(state: {
    layoutConfig: VenueLayoutConfig;
    zoom: number;
    cameraX: number;
    cameraY: number;
    selectedId: string | null;
    blockWorkspaceId?: string | null;
  }): void {
    this.canvasState.set({ ...state.layoutConfig.canvas });
    this.elements.set(structuredClone(state.layoutConfig.elements));
    const ref = state.layoutConfig.referenceImage;
    this.referenceImage.set(ref?.dataUrl || ref?.storagePath ? { ...ref } : null);
    this.zoom.set(state.zoom);
    this.cameraX.set(state.cameraX);
    this.cameraY.set(state.cameraY);
    this.past = [];
    this.future = [];
    this.gestureBaseline = null;
    this.drawingElementId.set(null);
    this.draftPoints.set([]);
    this.syncHistoryFlags();
    this.blockWorkspaceId.set(null);
    this.blockWorkspaceReturnView = null;
    const id = state.selectedId;
    this.selectedId.set(id && this.elements().some((el) => el.id === id) ? id : null);
    this.selectedIds.set(this.selectedId() ? [this.selectedId()!] : []);
    this.syncBlockCounterFromElements();

    const workspaceId = state.blockWorkspaceId;
    if (workspaceId && this.elements().some((el) => el.id === workspaceId)) {
      // Re-enter the same block workspace the user was editing before refresh.
      queueMicrotask(() => this.enterBlockWorkspace(workspaceId));
    }
  }

  setReferenceImage(image: ReferenceImageConfig | null): void {
    this.referenceImage.set(image);
    if (!image) {
      this.referenceOcrTokens.set([]);
    }
  }

  /** Whether the blueprint reference image is currently shown behind the blocks. */
  readonly referenceImageVisible = computed(() => this.referenceImage()?.visible !== false);

  /** Shows/hides the blueprint background; hiding also leaves trace mode. */
  toggleReferenceImageVisible(): void {
    const ref = this.referenceImage();
    if (!ref) {
      return;
    }
    const nextVisible = ref.visible === false;
    this.referenceImage.set({ ...ref, visible: nextVisible });
    if (!nextVisible) {
      this.colorDetectMode.set(false);
      this.traceTargetRect.set(null);
    }
  }

  /** Opens the block customization workspace for a traced / custom block. */
  enterBlockWorkspace(elementId: string): boolean {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isCustomizableBlock(el)) {
      return false;
    }
    if (this.blockWorkspaceId() === elementId) {
      return true;
    }
    this.completeSeatHydration();
    // Persist aisle edits on the previous block before switching, then bind
    // shared aisle UI/overlay to the newly opened block only.
    if (this.blockWorkspaceId()) {
      this.flushAutoFillSpacingSync();
    }
    this.blockWorkspaceReturnView = {
      zoom: this.zoom(),
      cameraX: this.cameraX(),
      cameraY: this.cameraY(),
    };
    this.colorDetectMode.set(false);
    this.blockWorkspaceViewpointAngleDeg.set(DEFAULT_VIEWPOINT_ANGLE_DEG);
    this.blockWorkspaceViewpointDistancePx.set(null);
    this.blockWorkspaceViewpointConfirmed.set(false);
    this.blockWorkspaceSeatingSideIndex.set(0);
    this.blockWorkspaceSidesConfigured.set(false);
    this.blockWorkspaceSeatingEditMode.set(false);
    this.blockWorkspaceForceEditStep.set(false);
    this.blockWorkspaceConfigSaved.set(false);
    this.blockMeasureContext.set('none');
    this.gaWorkspacePendingSideId.set(null);
    this.gaWorkspaceMaxParticipantsStep.set(false);
    this.cancelArrangeByRow();
    this.blockWorkspaceId.set(elementId);
    this.selectElement(elementId);
    this.captureBlockWorkspaceLabelSnapshot(elementId);
    const entered = this.elements().find((item) => item.id === elementId);
    if (entered?.type === 'centerpiece' && entered.blockType === 'seating') {
      this.loadBlockAislesIntoSharedAutoFillConfig(entered as CenterpieceElement);
    } else {
      this.loadBlockAislesIntoSharedAutoFillConfig(null);
    }
    this.fitCameraToElement(elementId, { blockWorkspace: true });
    if (entered && isCustomizableBlock(entered) && blockTypeHasCustomizationFlow(entered.blockType)) {
      this.initBlockWorkspaceViewpoint(elementId);
      this.syncBlockWorkspaceAfterTypeOrEnter(elementId);
      this.syncBlockPhysicalDimsFromMeasuredSides(elementId);
    }
    setTimeout(() => {
      if (this.blockWorkspaceId() === elementId) {
        this.fitCameraToElement(elementId, { blockWorkspace: true });
      }
    }, 0);
    return true;
  }

  goBackBlockWorkspaceStep(): void {
    const target = this.blockWorkspaceProgress().backTarget;
    if (!target) {
      return;
    }
    switch (target) {
      case 'block-type':
        this.goBackBlockWorkspaceToBlockType();
        break;
      case 'viewpoint':
        this.goBackBlockWorkspaceToViewpoint();
        break;
      case 'configure':
        this.goBackBlockWorkspaceToConfigure();
        break;
      case 'edit':
        this.goBackBlockWorkspaceToEdit();
        break;
      default:
        break;
    }
  }

  // ── General Admission workspace methods ──────────────────────────────────

  /** Select a side by logical id — it turns yellow on canvas. */
  gaSelectSide(logicalId: number): void {
    this.gaWorkspacePendingSideId.set(logicalId);
  }

  /** Confirm every side from draft inputs — used when seating/dining lengths scale together. */
  gaConfirmAllSidesFromDrafts(
    draftLabels: Record<number, string | undefined>,
    draftLengths: Record<number, number | undefined>,
  ): boolean {
    const el = this.blockWorkspaceElement();
    if (!el || el.type !== 'centerpiece') {
      return false;
    }
    const edges = this.gaWorkspaceEdges();
    if (!edges || edges.length < 3) {
      return false;
    }

    const updated: import('../models/layout-element.model').GaConfiguredSide[] = [];
    for (const edge of edges) {
      const label = (draftLabels[edge.id] ?? edge.sideLabel).trim();
      const lengthM = draftLengths[edge.id];
      if (!label || lengthM == null || lengthM <= 0) {
        return false;
      }
      updated.push({ logicalId: edge.id, label, lengthM });
    }

    this.pushHistory();
    this.applyPatch(el.id, { gaConfiguredSides: updated });
    this.gaWorkspacePendingSideId.set(null);

    if (blockTypeHasCustomizationFlow(el.blockType)) {
      const customPatch = this.buildCustomSidesPatchFromGa(el, updated);
      this.applyPatch(el.id, customPatch);
      if (el.blockType === 'seating') {
        const sorted = [...updated].sort((a, b) => a.logicalId - b.logicalId);
        const currentLengths = sorted.map((side) => side.lengthM ?? 0);
        this.autoFillSeatingConfig.update((prev) => ({
          ...prev,
          referenceSideLengthsM: currentLengths,
        }));
        this.syncWorkspaceMeasurementsToAllBlocks();
      }
    }

    return true;
  }

  /** Confirm the pending side with a label and optional physical length — saves to element and turns it green. */
  gaConfirmSide(label: string, lengthM?: number): void {
    const el = this.blockWorkspaceElement();
    if (!el || el.type !== 'centerpiece') {
      return;
    }
    const logicalId = this.gaWorkspacePendingSideId();
    if (logicalId == null) {
      return;
    }
    const current = el.gaConfiguredSides ?? [];
    const updated = current.filter((s) => s.logicalId !== logicalId);
    if (label.trim()) {
      const entry: import('../models/layout-element.model').GaConfiguredSide = {
        logicalId,
        label: label.trim(),
      };
      if (lengthM != null && lengthM > 0) {
        entry.lengthM = lengthM;
      }
      updated.push(entry);
    }
    this.pushHistory();
    this.applyPatch(el.id, { gaConfiguredSides: updated });
    this.gaWorkspacePendingSideId.set(null);
    if (el.blockType === 'seating') {
      this.syncWorkspaceMeasurementsToAllBlocks();
    }
  }

  /** Clear the yellow selection without saving. */
  gaClearPendingSide(): void {
    this.gaWorkspacePendingSideId.set(null);
  }

  /** Move to the max-participants step. */
  gaEnterMaxParticipantsStep(): void {
    this.gaWorkspaceMaxParticipantsStep.set(true);
    this.gaWorkspacePendingSideId.set(null);
  }

  /** Back from max-participants step to side-label step. */
  gaBackToSidesStep(): void {
    this.gaWorkspaceMaxParticipantsStep.set(false);
  }

  /** Save max participants on the element, mark config saved, and exit workspace. */
  gaConfirmMaxParticipants(count: number): void {
    const el = this.blockWorkspaceElement();
    if (!el || el.type !== 'centerpiece') {
      return;
    }
    this.pushHistory();
    this.applyPatch(el.id, { gaMaxParticipants: count });
    this.markBlockWorkspaceConfigSaved();
    this.exitBlockWorkspace();
  }

  goBackBlockWorkspaceToBlockType(): void {
    const el = this.blockWorkspaceElement();
    if (!el) {
      return;
    }
    this.setBlockType(el.id, null);
  }

  goBackBlockWorkspaceToViewpoint(): void {
    const el = this.blockWorkspaceElement();
    if (!el) {
      return;
    }
    this.blockWorkspaceForceEditStep.set(false);
    this.blockWorkspaceConfigSaved.set(false);
    this.cancelArrangeByRow();
    this.blockMeasureContext.set('none');
    this.blockWorkspaceSidesConfigured.set(false);
    this.blockWorkspaceViewpointConfirmed.set(false);
    this.pushHistory();
    this.applyPatch(el.id, {
      blockViewpointAngleDeg: undefined,
      blockViewpointManuallySet: undefined,
      dragSeatsStadiumSideIndex: undefined,
    });
    this.initBlockWorkspaceViewpoint(el.id);
  }

  goBackBlockWorkspaceToConfigure(): void {
    const el = this.blockWorkspaceElement();
    if (!el) {
      return;
    }
    this.blockWorkspaceForceEditStep.set(false);
    this.blockWorkspaceConfigSaved.set(false);
    this.cancelArrangeByRow();
    this.cancelTablePlacement();
    this.gaWorkspacePendingSideId.set(null);
    this.blockMeasureContext.set('none');

    // Seating / dining with saved measurements: return to configure choice (keep side data).
    if (blockTypeHasCustomizationFlow(el.blockType) && this.allGaSidesConfigured(el)) {
      this.blockWorkspaceSeatingEditMode.set(false);
      return;
    }

    this.blockWorkspaceSeatingEditMode.set(false);
    this.pushHistory();
    this.applyPatch(el.id, {
      customSideLengthsM: undefined,
      customSideNames: undefined,
      gaConfiguredSides: undefined,
    });
    this.blockWorkspaceSidesConfigured.set(false);
  }

  goBackBlockWorkspaceToEdit(): void {
    this.blockWorkspaceForceEditStep.set(true);
    this.blockWorkspaceConfigSaved.set(false);
  }

  markBlockWorkspaceConfigSaved(): void {
    this.blockWorkspaceConfigSaved.set(true);
    this.blockWorkspaceForceEditStep.set(false);
  }

  proceedBlockWorkspaceToSave(): void {
    this.blockWorkspaceForceEditStep.set(false);
  }

  private finalizeInteractiveSeatingOnWorkspaceExit(elementId: string | null): void {
    if (!elementId) {
      return;
    }
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const seatCount = getCustomShapeVisibleSeatCount(el, rect);
    const patch: Partial<CenterpieceElement> = {};
    if (el.dragSeatsMode) {
      patch.dragSeatsMode = undefined;
      patch.dragSeatsFirstRowSeatCount = undefined;
    }
    if (el.dragFillSeatsMode) {
      patch.dragFillSeatsMode = undefined;
    }
    if (seatCount > 0) {
      patch.interactiveSeatingLocked = true;
    }
    if (Object.keys(patch).length > 0) {
      this.pushHistory();
      this.applyPatch(elementId, patch);
    }
  }

  /** Returns to the main layout workspace, restoring the previous camera view by default. */
  exitBlockWorkspace(options?: {
    restoreCamera?: boolean;
    /** Keep shared Auto Fill aisles (needed when entering layout Auto Fill). */
    preserveAutoFillAisles?: boolean;
  }): void {
    this.flushAutoFillSpacingSync();
    this.revertBlockWorkspaceLabelIfNeeded();
    const workspaceId = this.blockWorkspaceId();
    const returnView = this.blockWorkspaceReturnView;
    const restoreCamera = options?.restoreCamera ?? true;
    this.finalizeInteractiveSeatingOnWorkspaceExit(workspaceId);
    this.blockWorkspaceId.set(null);
    this.blockWorkspaceReturnView = null;
    this.blockWorkspaceViewpointAngleDeg.set(DEFAULT_VIEWPOINT_ANGLE_DEG);
    this.blockWorkspaceViewpointDistancePx.set(null);
    this.blockWorkspaceViewpointConfirmed.set(false);
    this.blockWorkspaceSeatingSideIndex.set(0);
    this.blockWorkspaceSidesConfigured.set(false);
    this.blockWorkspaceSeatingEditMode.set(false);
    this.blockWorkspaceForceEditStep.set(false);
    this.blockWorkspaceConfigSaved.set(false);
    this.blockMeasureContext.set('none');
    this.gaWorkspacePendingSideId.set(null);
    this.gaWorkspaceMaxParticipantsStep.set(false);
    this.workspaceMeasurementSyncInfo.set([]);
    this.cancelSeatRowDrawing();
    this.cancelLineSeatDrawing();
    this.cancelPerSeatPlacement();
    this.cancelDrawAisle();
    // Clear shared aisle overlay when leaving configure — unless Auto Fill layout
    // mode needs those aisles applied to every selected block.
    if (!options?.preserveAutoFillAisles) {
      this.autoFillSeatingConfig.update((prev) => ({
        ...prev,
        aisles: [...(DEFAULT_AUTO_FILL_SEATING_CONFIG.aisles ?? [])],
      }));
    }
    this.cancelTablePlacement();
    this.cancelExitPlacement();
    this.cancelDragFillSeats();
    this.cancelArrangeByRow();
    this.cancelPendingSeatRow();
    if (returnView && restoreCamera) {
      this.zoom.set(returnView.zoom);
      this.cameraX.set(returnView.cameraX);
      this.cameraY.set(returnView.cameraY);
    }
    this.revealOverviewSeatsGradually();
  }

  /** After leaving a block, fill chairs in batches so the overview does not freeze. */
  private revealOverviewSeatsGradually(): void {
    const total = this.seatCount();
    if (total <= 1200) {
      this.completeSeatHydration();
      return;
    }
    this.beginSeatHydration(total);
  }

  /** Frame the full layout in the main workspace (overview, zoom capped at 100%). */
  fitCameraToLayoutWorkspace(): void {
    const canvas = this.canvas();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let found = false;

    const includeRect = (x: number, y: number, w: number, h: number): void => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0) {
        return;
      }
      found = true;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    };

    for (const el of this.elements()) {
      const rect = rectFromPositionSize(el.position, el.size, canvas);
      includeRect(rect.x, rect.y, rect.width, rect.height);
    }

    if (this.referenceImage()) {
      includeRect(0, 0, canvas.width, canvas.height);
    }

    if (!found) {
      this.resetView();
      return;
    }

    const padding = 48;
    const fitW = Math.max(maxX - minX, 1);
    const fitH = Math.max(maxY - minY, 1);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const zoomW = ((canvas.width - padding * 2) / fitW) * 100;
    const zoomH = ((canvas.height - padding * 2) / fitH) * 100;
    const fitted = Math.floor(Math.min(zoomW, zoomH));
    const targetZoom = Math.min(100, Math.max(40, fitted));

    this.zoom.set(targetZoom);
    this.cameraX.set(cx);
    this.cameraY.set(cy);
  }

  setBlockType(elementId: string, blockType: BlockTypeId | null): void {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isCustomizableBlock(el)) {
      return;
    }
    this.pushHistory();
    this.applyPatch(elementId, {
      blockType: blockType ?? undefined,
      appliedConfigId: undefined,
      appliedConfigName: undefined,
    });
    this.blockWorkspaceViewpointConfirmed.set(false);
    this.blockWorkspaceSidesConfigured.set(false);
    this.blockWorkspaceSeatingEditMode.set(false);
    this.blockWorkspaceForceEditStep.set(false);
    this.blockWorkspaceConfigSaved.set(false);
    this.gaWorkspacePendingSideId.set(null);
    this.gaWorkspaceMaxParticipantsStep.set(false);
    this.cancelArrangeByRow();
    if (blockTypeHasCustomizationFlow(blockType)) {
      this.initBlockWorkspaceViewpoint(elementId);
      this.syncBlockWorkspaceAfterTypeOrEnter(elementId);
    } else if (blockTypeHasGaFlow(blockType)) {
      this.blockMeasureContext.set('none');
    } else {
      this.blockMeasureContext.set('none');
    }
  }

  setBlockWorkspaceViewpointAngle(degrees: number): void {
    this.blockWorkspaceViewpointAngleDeg.set(Math.round(degrees));
    this.syncSeatingSideFromViewpoint();
  }

  setBlockWorkspaceViewpointFromCanvasPoint(x: number, y: number): void {
    const el = this.blockWorkspaceElement();
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const cx = rect.cx;
    const cy = rect.cy;
    const angle = viewpointAngleFromCanvasPoint(cx, cy, x, y);
    const rawDist = Math.hypot(x - cx, y - cy);
    const safeDist = clampViewpointDistance(polygon, cx, cy, rawDist);
    this.blockWorkspaceViewpointAngleDeg.set(Math.round(angle));
    this.blockWorkspaceViewpointDistancePx.set(Math.round(safeDist));
    this.syncSeatingSideFromViewpoint();
  }

  resetBlockWorkspaceViewpoint(): void {
    const el = this.blockWorkspaceElement();
    const towardGround =
      el != null ? this.resolveDefaultViewpointTowardGround(el) : null;
    this.blockWorkspaceViewpointAngleDeg.set(
      towardGround ?? DEFAULT_VIEWPOINT_ANGLE_DEG,
    );
    this.blockWorkspaceViewpointDistancePx.set(null);
    this.syncSeatingSideFromViewpoint();
  }

  private resolveDefaultViewpointTowardGround(el: CenterpieceElement): number | null {
    const ground = findStadiumGroundCenterpiece(this.elements());
    return resolveViewpointAngleTowardGround(el, ground, this.canvas());
  }

  private syncSeatingSideFromViewpoint(): void {
    const layout = this.blockWorkspaceViewpointLayout();
    if (!layout) {
      return;
    }
    this.blockWorkspaceSeatingSideIndex.set(layout.sideIndex);
  }

  setBlockWorkspaceSeatingSideIndex(index: number): void {
    const el = this.blockWorkspaceElement();
    const count = el?.customPoints?.length ?? 0;
    if (count < 3) {
      return;
    }
    const safe = Math.max(0, Math.min(count - 1, Math.round(index)));
    this.blockWorkspaceSeatingSideIndex.set(safe);
  }

  confirmBlockWorkspaceViewpoint(): void {
    const el = this.blockWorkspaceElement();
    if (!el) {
      return;
    }
    const layout = this.blockWorkspaceViewpointLayout();
    const sideIndex = layout?.sideIndex ?? this.blockWorkspaceSeatingSideIndex();
    const sideIndices = layout?.sideIndices?.length ? layout.sideIndices : [sideIndex];
    const angle = this.blockWorkspaceViewpointAngleDeg();
    const labelOffsets = hasCustomLabelOffset(el)
      ? {}
      : defaultLabelOffsetOutsideViewpoint(angle);
    this.applyPatch(el.id, {
      dragSeatsStadiumSideIndex: sideIndex,
      dragSeatsStadiumSideIndices: sideIndices.length > 1 ? sideIndices : undefined,
      blockViewpointAngleDeg: angle,
      blockViewpointManuallySet: true,
      ...labelOffsets,
    });
    this.blockWorkspaceSeatingSideIndex.set(sideIndex);
    this.blockWorkspaceViewpointConfirmed.set(true);
    if (el.blockType === 'seating') {
      this.initWorkspaceMeasurementBaselines();
    }
    this.blockMeasureContext.set('none');
  }

  updateBlockLabelOffset(elementId: string, offsetXPct: number, offsetYPct: number): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    this.update(elementId, {
      labelOffsetXPct: Math.round(offsetXPct * 10) / 10,
      labelOffsetYPct: Math.round(offsetYPct * 10) / 10,
    });
  }

  updateBlockLabelOffsetSilent(elementId: string, offsetXPct: number, offsetYPct: number): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    this.updateSilent(elementId, {
      labelOffsetXPct: Math.round(offsetXPct * 10) / 10,
      labelOffsetYPct: Math.round(offsetYPct * 10) / 10,
    });
  }

  resetBlockLabelOutsideViewpoint(elementId: string): void {
    const el = this.getCenterpiece(elementId);
    if (!el) {
      return;
    }
    const angle =
      el.blockViewpointAngleDeg ??
      this.blockWorkspaceViewpointAngleDeg() ??
      DEFAULT_VIEWPOINT_ANGLE_DEG;
    const offsets = defaultLabelOffsetOutsideViewpoint(angle);
    this.update(elementId, offsets);
  }

  private captureBlockWorkspaceLabelSnapshot(elementId: string): void {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || el.type !== 'centerpiece') {
      this.blockWorkspaceLabelSnapshot = null;
      return;
    }
    this.blockWorkspaceLabelSnapshot = {
      labelOffsetXPct: el.labelOffsetXPct,
      labelOffsetYPct: el.labelOffsetYPct,
    };
  }

  private revertBlockWorkspaceLabelIfNeeded(): void {
    const workspaceId = this.blockWorkspaceId();
    const snapshot = this.blockWorkspaceLabelSnapshot;
    this.blockWorkspaceLabelSnapshot = null;
    if (!workspaceId || this.blockWorkspaceConfigSaved() || !snapshot) {
      return;
    }
    this.updateSilent(workspaceId, {
      labelOffsetXPct: snapshot.labelOffsetXPct,
      labelOffsetYPct: snapshot.labelOffsetYPct,
    });
  }

  refitBlockWorkspaceView(): void {
    const id = this.blockWorkspaceId();
    if (id) {
      this.fitCameraToElement(id, { blockWorkspace: true });
    }
  }

  /** Zooms to the maximum block-workspace level and centres on the block for table editing. */
  zoomBlockWorkspaceForTableEditing(elementId?: string): void {
    const id = elementId ?? this.blockWorkspaceId();
    if (!id) {
      return;
    }
    const el = this.elements().find((item) => item.id === id);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    this.cameraX.set(rect.cx);
    this.cameraY.set(rect.cy);
    this.zoom.set(BLOCK_WORKSPACE_MAX_ZOOM);
  }

  private maybeZoomForDiningTableEdit(el: CenterpieceElement | null): void {
    if (el?.blockType === 'dining-table' && this.blockWorkspaceId() === el.id) {
      this.zoomBlockWorkspaceForTableEditing(el.id);
    }
  }

  private initBlockWorkspaceViewpoint(elementId: string): void {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isCustomizableBlock(el)) {
      return;
    }
    if (el.blockViewpointAngleDeg != null) {
      this.blockWorkspaceViewpointAngleDeg.set(el.blockViewpointAngleDeg);
      this.syncSeatingSideFromViewpoint();
      return;
    }
    if (el.dragSeatsStadiumSideIndex != null) {
      const angle = this.angleForStadiumSide(el, el.dragSeatsStadiumSideIndex);
      this.blockWorkspaceViewpointAngleDeg.set(angle);
      this.syncSeatingSideFromViewpoint();
      return;
    }
    const inferred = inferGroundViewpointForBlock(el, this.groundFocalPoint(), this.canvas());
    this.blockWorkspaceViewpointAngleDeg.set(inferred.blockViewpointAngleDeg);
    this.blockWorkspaceSeatingSideIndex.set(inferred.dragSeatsStadiumSideIndex);
    this.syncSeatingSideFromViewpoint();
  }

  private angleForStadiumSide(el: CenterpieceElement, sideIndex: number): number {
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    if (polygon.length < 3) {
      return DEFAULT_VIEWPOINT_ANGLE_DEG;
    }
    const safe = Math.max(0, Math.min(polygon.length - 1, sideIndex));
    const a = polygon[safe];
    const b = polygon[(safe + 1) % polygon.length];
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    return viewpointAngleFromCanvasPoint(rect.cx, rect.cy, midX, midY);
  }

  exportBlockSeatingConfig(elementId: string): BlockSeatingConfigSnapshot | null {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isCustomizableBlock(el)) {
      return null;
    }
    return extractSeatingSnapshot(el);
  }

  exportBlockDiningConfig(elementId: string): BlockDiningConfigSnapshot | null {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isCustomizableBlock(el)) {
      return null;
    }
    return extractDiningSnapshot(el);
  }

  exportBlockGaConfig(elementId: string): BlockGaConfigSnapshot | null {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isCustomizableBlock(el)) {
      return null;
    }
    return extractGaSnapshot(el);
  }

  applyBlockConfigTemplate(
    elementId: string,
    configId: string,
    configName: string,
    seating?: BlockSeatingConfigSnapshot,
    dining?: BlockDiningConfigSnapshot,
    ga?: BlockGaConfigSnapshot,
  ): void {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el || !isCustomizableBlock(el)) {
      return;
    }
    this.pushHistory();
    const patch: Partial<CenterpieceElement> = {
      appliedConfigId: configId,
      appliedConfigName: configName,
    };
    if (seating) {
      Object.assign(patch, seatingSnapshotToPatch(seating));
    }
    if (dining) {
      Object.assign(patch, diningSnapshotToPatch(dining));
    }
    if (ga) {
      Object.assign(patch, gaSnapshotToPatch(ga));
    }
    this.applyPatch(elementId, patch);
    this.selectElement(elementId);
  }

  linkBlockToSavedConfig(elementId: string, configId: string, configName: string): void {
    this.update(elementId, {
      appliedConfigId: configId,
      appliedConfigName: configName,
    });
  }

  findSimilarSeatingBlocks(sourceId: string): SimilarBlockCandidate[] {
    return findSimilarSeatingBlockCandidates(sourceId, this.elements(), this.canvas(), {
      referenceImageDataUrl: this.referenceImage()?.dataUrl ?? null,
      focal: this.groundFocalPoint(),
    });
  }

  openBulkApplyPrompt(prompt: BulkApplySeatingPrompt): void {
    this.bulkApplyPrompt.set(prompt);
  }

  closeBulkApplyPrompt(): void {
    this.bulkApplyPrompt.set(null);
  }

  bulkApplySeatingConfig(
    sourceId: string,
    targetIds: string[],
    snapshot: BlockSeatingConfigSnapshot,
    configId: string,
    configName: string,
  ): number {
    const source = this.elements().find((item) => item.id === sourceId);
    if (!source || !isCustomizableBlock(source)) {
      return 0;
    }
    const focal: GroundFocalPoint = this.groundFocalPoint();

    this.pushHistory();
    let applied = 0;
    for (const targetId of targetIds) {
      const target = this.elements().find((item) => item.id === targetId);
      if (!target || !isCustomizableBlock(target)) {
        continue;
      }
      const patch = regenerateSeatingOnTarget({
        source,
        target,
        snapshot,
        canvas: this.canvas(),
        focal,
        elements: this.elements(),
      });
      if (!patch) {
        continue;
      }
      const mergedPatch: Partial<CenterpieceElement> = {
        ...patch,
        appliedConfigId: configId,
        appliedConfigName: configName,
      };
      if (!target.customSideLengthsM?.length && patch.customSideLengthsM?.length) {
        mergedPatch.customSideLengthsM = [...patch.customSideLengthsM];
      }
      if (!target.customSideNames?.length && patch.customSideNames?.length) {
        mergedPatch.customSideNames = [...patch.customSideNames];
      }
      this.applyPatch(targetId, mergedPatch);
      applied += 1;
    }
    if (applied > 0) {
      this.selectElement(targetIds[targetIds.length - 1]);
    }
    return applied;
  }

  fitCameraToElement(
    elementId: string,
    options?: {
      blockWorkspace?: boolean;
      viewportWidth?: number;
      viewportHeight?: number;
    },
  ): void {
    const el = this.elements().find((item) => item.id === elementId);
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas());
    const canvas = this.canvas();
    const blockWorkspace = options?.blockWorkspace ?? false;
    const polygon = isCustomizableBlock(el)
      ? polygonCanvasPointsFromBlock(el.customPoints ?? [], rect)
      : [];
    // The VIEW POINT marker orbits outside the block, but on small blocks its
    // full distance dwarfs the block itself — keep the ring inside a fraction
    // of the block span so the seats stay the dominant thing on screen.
    const vpPadRaw =
      blockWorkspace && polygon.length >= 3
        ? defaultViewpointDistance(polygon, rect.cx, rect.cy)
        : 0;
    const vpPad =
      vpPadRaw > 0 ? Math.min(vpPadRaw, Math.max(rect.width, rect.height) * 0.22) : 0;
    const padding = blockWorkspace ? 24 : 48;
    const seatingOrDining =
      el.type === 'centerpiece' &&
      (el.blockType === 'seating' || el.blockType === 'dining-table');
    const maxZoom = blockWorkspace
      ? BLOCK_WORKSPACE_MAX_ZOOM
      : seatingOrDining
        ? OVERVIEW_SEAT_READABLE_MAX_ZOOM
        : 200;
    const fill = blockWorkspace ? 0.88 : 1;
    const fitW = Math.max(rect.width, 1) + vpPad * 2;
    const fitH = Math.max(rect.height, 1) + vpPad * 2;
    const zoomW = ((canvas.width - padding * 2) * fill / fitW) * 100;
    const zoomH = ((canvas.height - padding * 2) * fill / fitH) * 100;
    let targetZoom = Math.min(
      maxZoom,
      Math.max(blockWorkspace ? 100 : 60, Math.floor(Math.min(zoomW, zoomH))),
    );
    if (seatingOrDining && el.type === 'centerpiece') {
      const pitch = isCustomShapeSeatingEnabled(el)
        ? resolveCustomShapeSeatPitchPx(el, rect)
        : Math.max(4, Math.min(rect.width, rect.height) / 10);
      const scales = chairScalesFromSeatPitch(
        pitch,
        resolveChairWidthM(el),
        resolveChairLengthM(el),
        resolveSeatGapM(el),
        resolveRowGapM(el),
      );
      const chairCanvasPx = Math.max(
        0.8,
        Math.max(scales.chairScale, scales.chairScaleY) * SEAT_GRAPHIC_SIZE,
      );
      // The viewBox stretches to the stage box (preserveAspectRatio="none"), so
      // one canvas unit is worth a different number of screen px per axis.
      const live = this.viewportPx();
      const viewportW = Math.max(1, options?.viewportWidth || live.width || canvas.width);
      const viewportH = Math.max(1, options?.viewportHeight || live.height || canvas.height);
      const unitScale = Math.max(
        0.05,
        Math.min(viewportW / canvas.width, viewportH / canvas.height),
      );
      const seatZoom = Math.ceil((TARGET_CHAIR_SCREEN_PX * 100) / (chairCanvasPx * unitScale));
      // Zoom in for readable chairs, but never past the point where the block
      // itself would be cropped out of the viewport.
      const wholeBlockZoom = Math.floor(
        Math.min(
          ((canvas.width - padding * 2) / Math.max(rect.width, 1)) * 100,
          ((canvas.height - padding * 2) / Math.max(rect.height, 1)) * 100,
        ),
      );
      targetZoom = Math.min(maxZoom, Math.max(targetZoom, Math.min(seatZoom, wholeBlockZoom)));
    }
    this.zoom.set(targetZoom);
    this.cameraX.set(rect.cx);
    this.cameraY.set(rect.cy);
  }

  /** Temporary pulsing highlight used by the blueprint audit panel. */
  readonly auditHighlight = signal<AuditHighlight | null>(null);
  private auditHighlightTimer: ReturnType<typeof setTimeout> | null = null;

  /** Shows an audit highlight; auto-clears after `autoClearMs` (0 = keep until replaced). */
  setAuditHighlight(value: AuditHighlight | null, autoClearMs = 5000): void {
    if (this.auditHighlightTimer !== null) {
      clearTimeout(this.auditHighlightTimer);
      this.auditHighlightTimer = null;
    }
    this.auditHighlight.set(value);
    if (value && autoClearMs > 0) {
      this.auditHighlightTimer = setTimeout(() => {
        this.auditHighlight.set(null);
        this.auditHighlightTimer = null;
      }, autoClearMs);
    }
  }

  /** Fit camera to an arbitrary canvas-px rect (mirrors fitCameraToElement). */
  focusCanvasRect(rect: { x: number; y: number; width: number; height: number }): void {
    const canvas = this.canvas();
    const padding = 48;
    const fitW = Math.max(rect.width, 1);
    const fitH = Math.max(rect.height, 1);
    const zoomW = ((canvas.width - padding * 2) / fitW) * 100;
    const zoomH = ((canvas.height - padding * 2) / fitH) * 100;
    const targetZoom = Math.min(200, Math.max(60, Math.floor(Math.min(zoomW, zoomH))));
    this.zoom.set(targetZoom);
    this.cameraX.set(rect.x + rect.width / 2);
    this.cameraY.set(rect.y + rect.height / 2);
  }

  /**
   * Applies AI-generated elements to the canvas. By default it replaces the
   * current layout (recording an undo step) so the user can revert; pass
   * `{ replace: false }` to append onto an existing design instead.
   */
  applyGeneratedElements(
    elements: LayoutElement[],
    options: { replace?: boolean } = {},
  ): void {
    const replace = options.replace ?? true;
    this.pushHistory();
    this.elements.update((items) =>
      replace ? structuredClone(elements) : [...items, ...structuredClone(elements)],
    );
    this.syncBlockCounterFromElements();
    this.selectedId.set(null);
    this.selectedIds.set([]);
    this.selectedRingBlock.set(null);
    this.drawingElementId.set(null);
    this.draftPoints.set([]);
  }

  /** Fresh blank layout — clears elements, undo/redo, and view state. */
  resetSession(): void {
    this.completeSeatHydration();
    this.canvasState.set({ ...DEFAULT_CANVAS });
    this.elements.set([]);
    this.referenceImage.set(null);
    this.setAuditHighlight(null);
    this.colorDetectMode.set(false);
    this.traceTargetRect.set(null);
    this.blockWorkspaceId.set(null);
    this.blockWorkspaceReturnView = null;
    this.parkingWorkspaceId.set(null);
    this.parkingWorkspaceStep.set('draw-area');
    this.parkingMeasureEdgeIndex.set(null);
    this.parkingWorkspaceReturnView = null;
    this.clearHistoryAndSelection();
    this.zoom.set(100);
    this.cameraX.set(DEFAULT_CANVAS.width / 2);
    this.cameraY.set(DEFAULT_CANVAS.height / 2);
  }

  private clearHistoryAndSelection(): void {
    this.selectedId.set(null);
    this.selectedIds.set([]);
    this.selectedRingBlock.set(null);
    this.drawingElementId.set(null);
    this.draftPoints.set([]);
    this.past = [];
    this.future = [];
    this.gestureBaseline = null;
    this.syncHistoryFlags();
  }

  private pushHistory(): void {
    this.past.push(this.snapshot());
    if (this.past.length > MAX_HISTORY) {
      this.past.shift();
    }
    this.future = [];
    this.syncHistoryFlags();
  }

  private snapshot(): LayoutElement[] {
    return structuredClone(this.elements());
  }

  private syncSelectionAfterHistory(): void {
    const survivingIds = this.selectedIds().filter((itemId) =>
      this.elements().some((el) => el.id === itemId),
    );
    this.selectedIds.set(survivingIds);
    const id = this.selectedId();
    if (id && !this.elements().some((el) => el.id === id)) {
      this.selectedId.set(survivingIds[0] ?? null);
      this.selectedRingBlock.set(null);
      return;
    }
    const blockSel = this.selectedRingBlock();
    if (!blockSel) {
      return;
    }
    const host = this.elements().find((el) => el.id === blockSel.elementId);
    if (
      !host ||
      (host.type !== 'layer-ring' && host.type !== 'layer-rect') ||
      !host.blocks.some((b) => b.id === blockSel.blockId)
    ) {
      this.selectedRingBlock.set(null);
    }
  }

  private syncHistoryFlags(): void {
    this.canUndo.set(this.past.length > 0);
    this.canRedo.set(this.future.length > 0);
  }
}

function snapshotsEqual(a: LayoutElement[], b: LayoutElement[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function countSeats(el: LayoutElement): number {
  if (!hasSeats(el)) {
    return 0;
  }
  switch (el.type) {
    case 'block-grid':
      return Math.max(0, el.rows) * Math.max(0, el.seatsPerRow);
    case 'seat-section':
      return el.rows.reduce((sum, row) => sum + Math.max(0, row.seatCount), 0);
    case 'layer-ring':
      return el.blocks.reduce(
        (sum, block) => sum + visibleSeatCount(block, el.rowLabelStyle),
        0,
      );
    case 'layer-rect':
      return el.blocks.reduce((sum, b) => sum + Math.max(0, b.rows) * Math.max(0, b.seatsPerRow), 0);
    case 'centerpiece':
      return getCustomShapeVisibleSeatCount(el);
    default:
      return 0;
  }
}
