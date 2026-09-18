import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, isDevMode, output, signal, untracked } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';

import {
  AisleElement,
  BlockGridElement,
  CenterpieceElement,
  CustomShapeSeatBlock,
  DEFAULT_BLOCK_LENGTH_M,
  DEFAULT_BLOCK_WIDTH_M,
  DEFAULT_CHAIR_LENGTH_M,
  DEFAULT_CHAIR_WIDTH_M,
  DEFAULT_SEAT_GAP_M,
  DEFAULT_TABLE_DEPTH_M,
  DEFAULT_TABLE_GAP_M,
  DEFAULT_TABLE_SEATS,
  DEFAULT_TABLE_WIDTH_M,
  DEFAULT_DINING_STAGE_DEPTH_M,
  DEFAULT_DINING_STAGE_WIDTH_M,
  DEFAULT_DINING_FOOD_PREPARE_DEPTH_M,
  DEFAULT_DINING_FOOD_PREPARE_WIDTH_M,
  DiningTableShape,
  DiningTableAccessCategory,
  LabelElement,
  LayerRectElement,
  LayerRingElement,
  LayoutElement,
  RectBlock,
  RectSide,
  SeatLayoutSpec,
  SeatSectionElement,
  SectorBlock,
  SeatSectionRow,
  ShapeId,
  isCustomShapeSeatingEnabled,
  isCustomizableBlock,
  hasTracedBlockOutline,
} from '../../models/layout-element.model';
import {
  getSeatLayoutRowSeatCounts,
  getSeatLayoutSpec,
  hasSeatSpacingAdjustments,
  resizeSeatLayoutRows,
  updateDefaultSeatsPerRow,
  updateRowSeatCount,
} from '../../lib/block-seat-layout';
import {
  getCustomShapeRowInsideSeatCounts,
  getCustomShapeVisibleSeatCount,
  maxSeatsForLineSeatRow,
  parseBlockSeatId,
  parseOverrideSeatId,
} from '../../lib/custom-shape-seats';
import { computePhysicalCapacity, buildRowSeatCountsFromTotal, resolveBlockLengthM, resolveBlockWidthM, resolveChairLengthM, resolveChairWidthM, resolveRowGapM, resolveSeatGapM, totalSeatsInRowCounts } from '../../lib/physical-dims';
import {
  buildBlockMeasureEdges,
  countMeasuredLogicalEdges,
  logicalMeasureEdgeById,
  storedNameForEdge,
  sumStoredLengthsForEdge,
} from '../../lib/block-measure-edges';
import { polygonCanvasPointsFromBlock, viewpointAngleFromCanvasPoint } from '../../lib/block-viewpoint';
import {
  estimateArrangeByRowCapacity,
  estimateDefaultSideLengthsM,
  estimateDefaultStadiumSideIndex,
  estimateDragSeatsFirstRowCapacity,
  getDragSeatsMaxFirstRowSeatCount,
  previewArrangeByRowLayout,
  stadiumSideLabel,
} from '../../lib/drag-seats';
import { estimateDefineByRowColumnDefaults } from '../../lib/define-by-row-column';
import { resolveAutoFillDisplaySideLengthsM, computeSideLengthDeltasM } from '../../lib/auto-fill-measurements';
import {
  computeMaxFillTableCount,
  computeMaxChairsAroundTable,
  computeTableGridCapacity,
  previewTableCountGrid,
  resolveDefaultTableDepthM,
  resolveDefaultTableGapM,
  resolveDefaultTableSeats,
  resolveDefaultTableShape,
  resolveDefaultTableWidthM,
  resolveMaxTableSeats,
  clampTableSeats,
  diningWizardInputMaxes,
  resolveDiningWizardPack,
  countDiningTablesThatFit,
  MIN_DINING_TABLE_SIZE_M,
  MIN_DINING_CHAIR_LENGTH_M,
  MIN_DINING_CHAIR_WIDTH_M,
  type DiningTableCapacityDimsOptions,
  type DiningWizardPackPrefer,
  type TableCountGridPreview,
} from '../../lib/dining-tables';
import {
  clampDiningTableMixCounts,
  computeDiningTableMixCapacity,
  diningTableShapeLabel,
  DINING_TABLE_MIX_SHAPES,
  type DiningTableMixCapacity,
  type DiningTableMixEntry,
  type DiningTableMixShapeCapacity,
  type DiningTableMixSharedOptions,
} from '../../lib/dining-table-mix';

import {
  getDiningTableCount,
  hasDiningStage,
  hasDiningFoodPrepare,
  hasDiningExit,
  DiningFoodPrepareSpec,
  DiningStageSpec,
  DiningServiceRouteSpec,
  DiningLayoutReferenceImage,
  DiningAccessMode,
  MIN_DINING_ACCESS_WIDTH_M,
  resolveDiningAccessMode,
  resolveDiningAccessWidthM,
} from '../../models/layout-element.model';
import { getDiningServiceRouteCount } from '../../lib/dining-service-routes';
import {
  createDiningStageOnSide,
  createDiningFoodPrepareOnSide,
  diningFeatureRotationDeg,
  fitDiningFeatureDimsToBlock,
  normalizeDiningFeatureRotationDeg,
  resolveDiningFeatureRotationDeg,
  syncStageSpecFromMetrics,
} from '../../lib/dining-stage';
import {
  buildDiningLayoutPatchFromTemplate,
  diningFeaturesPatchFromDraft,
  getDiningLayoutTemplateName,
  type DiningLayoutDraftInputs,
  type DiningLayoutTemplateDescriptor,
} from '../../lib/dining-layout-templates';
import {
  detectDiningLayoutFromImageData,
  isDiningImageFile,
  rasterizeDiningImageFile,
  type DiningLayoutDetectionResult,
} from '../../lib/detect-dining-layout';
import { buildDiningLayoutFromImageDetection } from '../../lib/dining-image-to-layout';
import { TableCategoryTemplate } from '../../models/table-category-template.model';
import { rectFromPositionSize } from '../../lib/geometry';
import { loadImageDimensions } from '../../lib/canvas-image';
import {
  defaultDiningBackgroundFit,
  diningBackgroundFitFromRef,
  diningBackgroundNeedsReadjustment,
  type DiningBackgroundClipSource,
} from '../../lib/dining-background-image';
import { rowLabel } from '../../lib/seat-layout';
import { parseSeatingSpecFromRawText } from '../../lib/parse-seating-spec';
import { parseDiningSpecFromRawText } from '../../lib/parse-dining-spec';
import type { SeatingChartSpec } from '../../models/seating-spec.model';
import type { DiningTableChartSpec } from '../../models/dining-spec.model';
import {
  LayoutCanvasService,
  type SeatPairGapScope,
  type SeatRowGapScope,
} from '../../services/layout-canvas.service';
import { TableCategoryService } from '../../services/table-category.service';
import { DiningLayoutSuggestionService } from '../../services/dining-layout-suggestion.service';
import { buildDiningLayoutGenerationRequest } from '../../lib/build-dining-layout-generation-request';
import { mapGeneratedLayoutToDescriptor } from '../../lib/map-generated-dining-layout';
import {
  canIncreaseDiningTableCount,
  clampDiningTableCount,
  diningCapacityFootKind,
  diningTableCountAdjustedMessage,
  resolveEffectiveMaximumTableCount,
  selectedCountFeasibilityMessage,
} from '../../lib/dining-effective-capacity';
import { diningWizardPhysicalCapacityKey } from '../../lib/dining-capacity-signature';
import {
  DINING_FAMILY_DISPLAY,
  DEFAULT_DINING_LAYOUT_RULES,
  metricLabel,
  type DiningLayoutFamily,
} from '../../models/dining-layout-generation.model';
import {
  diningSnapshotToPatch,
  extractDiningSnapshot,
} from '../../services/block-config-template.service';
import {
  SeatingSpecAnalysisError,
  SeatingSpecAnalyzerService,
} from '../../services/seating-spec-analyzer.service';
import {
  DiningSpecAnalysisError,
  DiningSpecAnalyzerService,
} from '../../services/dining-spec-analyzer.service';
import { SectorBlockSeatPanelComponent } from '../sector-block-seat-panel/sector-block-seat-panel.component';
import {
  createDefaultSeatLayout,
  mergeSeatLayoutPatch,
  seatLayoutToBlockFields,
  visibleSeatCount,
} from '../../lib/sector-seat-layout';

let nestedCounter = 0;
function nestedId(prefix: string): string {
  nestedCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${nestedCounter.toString(36)}`;
}

const SHAPES: { id: ShapeId; label: string }[] = [
  { id: 'oval', label: 'Oval' },
  { id: 'circle', label: 'Circle' },
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'square', label: 'Square' },
  { id: 'hexagon', label: 'Hexagon' },
  { id: 'octagon', label: 'Octagon' },
  { id: 'd-end', label: 'D-End' },
];

/** Dropdown value when the user chooses to enter custom table measurements. */
const TABLE_CATEGORY_CUSTOM = '__custom__';
const DINING_WIZARD_TOTAL_STEPS = 5;

@Component({
  selector: 'app-inspector-panel',
  imports: [FormsModule, SectorBlockSeatPanelComponent],
  templateUrl: './inspector-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'insp-host',
  },
})
export class InspectorPanelComponent {
  /** `seating-sidebar` / `dining-sidebar` = left tools only; `block-workspace` = right properties only. */
  readonly variant = input<'full' | 'seating-sidebar' | 'dining-sidebar' | 'block-workspace' | 'block-measure'>('full');

  /** Persist Auto Fill seats to the venue template (parent handles DB write). */
  readonly saveAutoFillLayout = output<void>();

  protected readonly canvas = inject(LayoutCanvasService);
  private readonly seatingSpecAnalyzer = inject(SeatingSpecAnalyzerService);
  private readonly diningSpecAnalyzer = inject(DiningSpecAnalyzerService);
  private readonly tableCategoryService = inject(TableCategoryService);
  private readonly diningSuggestions = inject(DiningLayoutSuggestionService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private capacityProbeTimer: ReturnType<typeof setTimeout> | null = null;
  private capacityProbeKey = '';
  private feasibilityTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly shapes = SHAPES;
  protected readonly quickSegments = signal(4);
  protected readonly seatsToAdd = signal(1);
  /** Wizard step after clicking "Add seats inside shape". */
  protected readonly seatSetupOpen = signal(false);
  /** Wizard for drag-seats mode (side lengths + chair dims). */
  protected readonly dragSeatsWizardOpen = signal(false);
  protected readonly dragSeatsWizardStep = signal<1 | 2 | 3>(1);
  /** Wizard for define-by-row-column grid fill. */
  protected readonly defineByRowColumnWizardOpen = signal(false);
  /** Wizard for auto seat create (blueprint upload + Azure OCR). */
  protected readonly autoSeatWizardOpen = signal(false);
  protected readonly autoSeatAnalyzing = signal(false);
  protected readonly autoSeatError = signal<string | null>(null);
  protected readonly autoSeatParsed = signal<SeatingChartSpec | null>(null);
  protected readonly autoSeatParseNotes = signal<string[]>([]);
  protected readonly autoTableWizardOpen = signal(false);
  protected readonly autoTableAnalyzing = signal(false);
  protected readonly autoTableError = signal<string | null>(null);
  protected readonly autoTableParsed = signal<DiningTableChartSpec | null>(null);
  protected readonly autoTableParseNotes = signal<string[]>([]);
  protected readonly autoTableNoSpaceMessage = signal<string | null>(null);
  /** True after tables were committed — Cancel clears them and returns to Select Tool. */
  protected readonly autoTableLayoutApplied = signal(false);
  /** Block label before auto-table create (restored on Cancel). */
  private readonly autoTableRestoreLabel = signal<string | null>(null);
  protected readonly draftDefineRows = signal(4);
  protected readonly draftDefineColumns = signal(8);
  protected readonly draftSideLengths = signal<number[]>([]);
  protected readonly draftStadiumSideIndex = signal(0);
  protected readonly draftFirstRowSeatCount = signal(1);
  protected readonly pendingSeatRow = computed(() => this.canvas.pendingSeatRow());
  protected readonly awaitingSeatDims = computed(() => this.pendingSeatRow() != null);
  protected readonly pendingRowLineCount = computed(() => this.pendingSeatRow()?.rowLines?.length ?? 0);
  protected readonly dimsWizardStep = signal<1 | 2>(1);
  protected readonly customBlockCount = computed(() => this.center()?.customSeatBlocks?.length ?? 0);

  protected readonly draftBlockLength = signal(DEFAULT_BLOCK_LENGTH_M);
  protected readonly draftBlockWidth = signal(DEFAULT_BLOCK_WIDTH_M);
  protected readonly draftChairLength = signal(DEFAULT_CHAIR_LENGTH_M);
  protected readonly draftChairWidth = signal(DEFAULT_CHAIR_WIDTH_M);
  protected readonly draftSeatGap = signal(DEFAULT_SEAT_GAP_M);
  protected readonly draftRowGap = signal(DEFAULT_SEAT_GAP_M);
  protected readonly seatSpacingConfigOpen = signal(false);
  protected readonly draftArrangeRows = signal(4);
  protected readonly pendingSideDrafts = signal<Record<number, { lengthM: number; name: string }>>({});

  private lastCenterpieceId: string | null = null;

  constructor() {
    effect(() => {
      const pending = this.canvas.pendingSeatRow();
      const c = this.center();
      if (!pending || !c || pending.elementId !== c.id) {
        return;
      }
      this.dimsWizardStep.set(1);
      this.draftBlockLength.set(resolveBlockLengthM(c));
      this.draftBlockWidth.set(resolveBlockWidthM(c));
      this.draftChairLength.set(resolveChairLengthM(c));
      this.draftChairWidth.set(resolveChairWidthM(c));
      this.draftSeatGap.set(resolveSeatGapM(c));
      this.draftRowGap.set(resolveRowGapM(c));
      this.canvas.setPendingBlockPreviewLengthM(resolveBlockLengthM(c));
      this.canvas.setPendingBlockPreviewWidthM(resolveBlockWidthM(c));
    });

    effect(() => {
      const pendingIds = this.canvas.arrangeByRowPendingSideIds();

      const c = this.measureTargetElement();
      if (!c || (c.customPoints?.length ?? 0) < 3) {
        return;
      }
      const rect = rectFromPositionSize(c.position, c.size, this.canvas.canvas());
      const polygon = polygonCanvasPointsFromBlock(c.customPoints ?? [], rect);
      const lengths = this.canvas.arrangeByRowDraftSideLengthsM();
      const names = this.canvas.arrangeByRowDraftSideNames();
      const drafts = { ...this.pendingSideDrafts() };
      let changed = false;
      for (const logicalId of pendingIds) {
        if (drafts[logicalId]) {
          continue;
        }
        const edge = logicalMeasureEdgeById(polygon, logicalId);
        if (!edge) {
          continue;
        }
        const storedLength = sumStoredLengthsForEdge(edge, lengths);
        drafts[logicalId] = {
          lengthM:
            storedLength > 0.01
              ? Math.round(storedLength * 10) / 10
              : 10,
          name: storedNameForEdge(edge, names),
        };
        changed = true;
      }
      for (const key of Object.keys(drafts)) {
        const logicalId = Number(key);
        if (!pendingIds.includes(logicalId)) {
          delete drafts[logicalId];
          changed = true;
        }
      }
      if (changed) {
        this.pendingSideDrafts.set(drafts);
      }
    });

    effect(() => {
      if (this.customSeatTotal() <= 0) {
        this.seatSpacingConfigOpen.set(false);
      }
    });

    effect(() => {
      const workspaceId = this.canvas.blockWorkspaceId();
      const locked = this.interactiveSeatingLocked();
      if (!workspaceId || locked) {
        this.dragSeatsWizardOpen.set(false);
        this.dragSeatsWizardStep.set(1);
        this.canvas.clearDragSeatsHighlightSideIndex();
      }
    });

    effect(() => {
      // Track only block id + feature presence booleans (via computeds that
      // return primitives). Width/position patches must not re-sync chips.
      const id = this.canvas.selectedId();
      if (!id) {
        this.lastCenterpieceId = null;
        return;
      }
      const list: string[] = [];
      if (this.hasDiningStage() || this.stageSidePickActive()) {
        list.push('stage');
      }
      if (this.hasDiningFoodPrepare() || this.foodPrepareSidePickActive()) {
        list.push('foodprepare');
      }
      if (this.diningServiceRouteCount() > 0 || this.isServiceRouteDrawing()) {
        list.push('serviceroute');
      }
      untracked(() => {
        if (this.lastCenterpieceId !== id) {
          this.lastCenterpieceId = id;
          this.draftDiningFeatures.set(list);
        }
        const current = this.enabledDiningFeatures();
        const hasChanged =
          current.length !== list.length || !list.every((item) => current.includes(item));
        if (hasChanged) {
          this.enabledDiningFeatures.set(list);
        }
      });
    });

    effect(() => {
      this.canvas.workspaceMeasurementSyncInfo();
      this.measurementSyncPageIndex.set(0);
    });

    effect(() => {
      if (!this.tableCreateWizardOpen() || this.diningWizardStep() !== 3) {
        return;
      }
      this.canvas.elements();
      const el = this.center();
      if (!el) {
        return;
      }
      untracked(() => {
        if (el.diningStage && this.isDraftDiningFeatureEnabled('stage')) {
          this.draftStageWidthM.set(el.diningStage.widthM);
          this.draftStageDepthM.set(el.diningStage.depthM);
          this.draftStageSide.set(el.diningStage.sideEdgeId ?? 0);
        }
        if (el.diningFoodPrepare && this.isDraftDiningFeatureEnabled('foodprepare')) {
          this.draftFoodPrepWidthM.set(el.diningFoodPrepare.widthM);
          this.draftFoodPrepDepthM.set(el.diningFoodPrepare.depthM);
          this.draftFoodPrepareSide.set(el.diningFoodPrepare.sideEdgeId ?? 0);
        }
      });
    });

    // Table create wizard: never keep a count above what currently fits.
    // Increases stay blocked until operational capacity is ready.
    effect(() => {
      if (!this.tableCreateWizardOpen() || this.isMultiShapeMode()) {
        return;
      }
      this.draftTableWidthM();
      this.draftTableDepthM();
      this.draftTableGapM();
      this.draftChairLength();
      this.draftTableShape();
      this.diningSuggestions.capacityStatus();
      this.diningSuggestions.provenMaximumTableCount();
      this.diningSuggestions.basicGeometricUpperBound();
      this.diningSuggestions.maximumProven();
      const packMax = this.tableCreateMaxFillCount();
      // Use effective max as-is (may already lift above local pack when validated
      // operational capacity proves more tables fit with a free-rotated stage).
      // Re-minning with packMax here undoes that lift and blocks the + control.
      const operationalMax = this.effectiveMaximumTableCount();
      const downMax =
        operationalMax != null ? operationalMax : packMax >= 1 ? packMax : null;
      const current = this.draftTableCount();
      if (downMax != null && downMax >= 1 && current > downMax) {
        untracked(() => {
          this.draftTableCount.set(downMax);
          this.tableCountAdjustedMessage.set(
            diningTableCountAdjustedMessage(downMax, this.diningSuggestions.maximumProven()),
          );
        });
      }
    });

    effect(() => {
      if (this.variant() !== 'dining-sidebar') {
        return;
      }
      // A mixed-shape block is gated by the local mix budget; the single-shape
      // operational probe cannot describe a mix, so skip it.
      if (!this.tableCreateWizardOpen() || this.diningWizardStep() < 4 || this.isMultiShapeMode()) {
        return;
      }
      const key = this.diningPhysicalCapacitySignature();
      untracked(() => this.scheduleOperationalCapacityProbe(key));
    });

    effect(() => {
      if (!this.tableCreateWizardOpen() || this.diningWizardStep() < 4 || this.isMultiShapeMode()) {
        return;
      }
      this.draftTableCount();
      this.diningSuggestions.capacityStatus();
      this.diningSuggestions.validatedFeasibleTableCount();
      this.diningSuggestions.maximumProven();
      this.diningSuggestions.provenMaximumTableCount();
      untracked(() => this.scheduleSelectedCountFeasibility());
    });

    // Chair count: clamp when chair/table measurements reduce how many chairs fit.
    effect(() => {
      if (!this.tableCreateWizardOpen() || this.isMultiShapeMode()) {
        return;
      }
      const maxSeats = this.maxDraftTableSeats();
      const current = this.draftTableSeats();
      if (maxSeats > 0 && current > maxSeats) {
        this.draftTableSeats.set(maxSeats);
      }
    });

    this.destroyRef.onDestroy(() => {
      if (this.capacityProbeTimer) {
        clearTimeout(this.capacityProbeTimer);
        this.capacityProbeTimer = null;
      }
      if (this.feasibilityTimer) {
        clearTimeout(this.feasibilityTimer);
        this.feasibilityTimer = null;
      }
    });
  }

  protected readonly isSeatRowDrawing = computed(() =>
    Boolean(this.canvas.seatRowDrawingElementId()),
  );
  protected readonly isLineSeatDrawing = computed(() =>
    Boolean(this.canvas.lineSeatDrawingElementId()),
  );
  protected readonly isServiceRouteDrawing = computed(() =>
    Boolean(this.canvas.serviceRouteDrawingElementId()),
  );
  protected readonly isPerSeatPlacing = computed(() =>
    Boolean(this.canvas.perSeatPlacementElementId()),
  );
  protected readonly isTablePlacing = computed(() =>
    Boolean(this.canvas.tablePlacementElementId()),
  );
  /** True from “Add tables one by one” until Cancel/Done — including the measurement step before canvas clicks are armed. */
  protected readonly manualTablePlacementOpen = signal(false);
  protected readonly tablePlacementPhase = signal<'measure' | 'place'>('measure');
  protected readonly showManualTablePlacement = computed(
    () => this.manualTablePlacementOpen() || Boolean(this.canvas.tablePlacementElementId()),
  );
  protected readonly tableCreateWizardOpen = signal(false);
  /** Stable Dining block for this wizard run. Background patches must not change it. */
  protected readonly diningWizardBlockId = signal<string | null>(null);
  protected readonly tableGridWizardOpen = signal(false);
  protected readonly diningImageUploadOpen = signal(false);
  protected readonly diningImageUploadAnalyzing = signal(false);
  protected readonly diningImageUploadError = signal<string | null>(null);
  protected readonly diningImageUploadAnalyzed = signal(false);
  protected readonly diningImageUploadPreviewUrl = signal<string | null>(null);
  protected readonly diningImageDetection = signal<DiningLayoutDetectionResult | null>(null);
  protected readonly diningWizardStep = signal<number>(1);
  protected readonly accessPointsError = signal<string | null>(null);
  protected readonly accessModeSwitchPrompt = signal<boolean>(false);
  protected readonly minAccessWidthM = MIN_DINING_ACCESS_WIDTH_M;
  protected readonly diningBackgroundError = signal<string | null>(null);
  protected readonly visibleTemplates = computed(() => this.generatedTemplates());
  protected readonly tableGridWizardError = signal<string | null>(null);
  protected readonly draftTableShape = signal<DiningTableShape>('round');
  protected readonly draftTableSeats = signal(DEFAULT_TABLE_SEATS);
  protected readonly draftTableWidthM = signal(DEFAULT_TABLE_WIDTH_M);
  protected readonly draftTableDepthM = signal(DEFAULT_TABLE_DEPTH_M);
  protected readonly draftTableGapM = signal(DEFAULT_TABLE_GAP_M);
  protected readonly draftTableCount = signal(6);
  protected readonly draftTableTemplate = signal<'grid' | 'staggered' | 'banquet'>('grid');
  protected readonly diningTableMixShapes = DINING_TABLE_MIX_SHAPES;
  protected readonly multiShapeSelectValue = 'multiple';
  /** `multiple` swaps the single table spec for one lane per selected shape. */
  protected readonly draftTableShapeMode = signal<'single' | 'multiple'>('single');
  protected readonly draftTableMix = signal<DiningTableMixEntry[]>([]);
  protected readonly isMultiShapeMode = computed(() => this.draftTableShapeMode() === 'multiple');
  protected readonly tableShapeSelectValue = computed(() =>
    this.isMultiShapeMode() ? this.multiShapeSelectValue : (this.draftTableShape() as string),
  );
  protected readonly selectedTableCategoryId = signal('');
  protected readonly tableCategorySaveName = signal('');
  protected readonly tableCategoryError = signal<string | null>(null);
  protected readonly tableCategories = computed(() => this.tableCategoryService.list());
  protected readonly tableCategoryCustomValue = TABLE_CATEGORY_CUSTOM;
  protected readonly diningWizardTotalSteps = DINING_WIZARD_TOTAL_STEPS;
  protected readonly showTableCategoryDelete = computed(() => {
    const id = this.selectedTableCategoryId();
    return id !== '' && id !== TABLE_CATEGORY_CUSTOM;
  });
  protected readonly draftServiceRouteRequired = signal<'yes' | 'no'>('no');
  protected readonly draftServiceRouteClearanceM = signal<number>(
    DEFAULT_DINING_LAYOUT_RULES.serviceRouteClearanceM,
  );
  protected readonly draftStageClearanceM = signal<number>(DEFAULT_DINING_LAYOUT_RULES.stageClearanceM);
  protected readonly draftFoodPrepClearanceM = signal<number>(
    DEFAULT_DINING_LAYOUT_RULES.foodPrepClearanceM,
  );
  protected readonly draftAccessClearanceM = signal<number>(
    DEFAULT_DINING_LAYOUT_RULES.entranceClearanceM,
  );
  protected readonly draftWallClearanceM = signal<number>(DEFAULT_DINING_LAYOUT_RULES.wallClearanceM);
  protected readonly tableGridPreview = computed(() => {
    const el = this.center();
    if (!el) {
      return null;
    }
    const gapM = this.draftChairLength() * 2 + 0.5;
    return computeTableGridCapacity(el, {
      shape: this.draftTableShape(),
      widthM: this.draftTableWidthM(),
      depthM: this.draftTableDepthM(),
      gapM: gapM,
      template: this.draftTableTemplate(),
    });
  });
  protected readonly tableCreatePreview = computed((): TableCountGridPreview | { error: string } | null => {
    const el = this.center();
    if (!el) {
      return null;
    }
    return previewTableCountGrid(el, {
      shape: this.draftTableShape(),
      widthM: this.draftTableWidthM(),
      depthM: this.draftTableDepthM(),
      gapM: this.draftTableGapM(),
      tableCount: this.draftTableCount(),
      seats: this.draftTableSeats(),
    });
  });
  protected readonly canApplyTableCreate = computed(() => {
    const preview = this.tableCreatePreview();
    return preview != null && !('error' in preview) && preview.tableCount > 0;
  });
  protected readonly tableCreateMaxFillCount = computed(() => {
    const el = this.diningWizardCapacityElement();
    if (!el) {
      return 0;
    }
    return countDiningTablesThatFit(el, this.diningWizardCapacityOptions());
  });
  /**
   * Live interconnected ceilings for the selected shapes. Every lane is measured
   * against the same block, so raising one lane's count immediately lowers what
   * the other lanes may still take (and lowering it hands the space back).
   */
  protected readonly diningTableMixCapacity = computed<DiningTableMixCapacity | null>(() => {
    if (!this.isMultiShapeMode()) {
      return null;
    }
    const el = this.diningWizardCapacityElement();
    const entries = this.draftTableMix();
    if (!el || entries.length === 0) {
      return null;
    }
    return computeDiningTableMixCapacity(el, entries, this.diningMixSharedOptions());
  });
  protected readonly diningTableMixTotalCount = computed(
    () => this.diningTableMixCapacity()?.totalCount ?? 0,
  );
  protected readonly diningTableMixTotalSeats = computed(
    () => this.diningTableMixCapacity()?.totalSeats ?? 0,
  );
  protected readonly diningTableMixSpaceUsedPct = computed(() =>
    Math.round(Math.min(1, this.diningTableMixCapacity()?.utilisation ?? 0) * 100),
  );
  protected readonly diningTableMixError = computed(() => {
    if (!this.isMultiShapeMode()) {
      return null;
    }
    if (this.draftTableMix().length === 0) {
      return 'Select at least one table shape.';
    }
    const capacity = this.diningTableMixCapacity();
    if (!capacity) {
      return null;
    }
    if (capacity.totalCount < 1) {
      return 'Set a table count of at least 1 for one of the selected shapes.';
    }
    const over = capacity.shapes.find((shape) => shape.overBudget);
    if (over) {
      return `${diningTableShapeLabel(over.shape)} tables do not fit alongside the other shapes. Lower it to ${over.maxCount} or reduce another shape.`;
    }
    return null;
  });
  protected readonly canContinueFromMultiShape = computed(
    () => this.isMultiShapeMode() && this.diningTableMixError() == null,
  );
  protected readonly diningCapacityProbeError = computed(() =>
    this.diningSuggestions.capacityStatus() === 'error' ? this.diningSuggestions.lastError() : null,
  );
  protected readonly operationalCapacityStatus = computed(
    () => this.diningSuggestions.capacityStatus(),
  );
  protected readonly operationalMaximumKnown = computed(
    () => this.diningSuggestions.capacityStatus() === 'ready' && this.diningSuggestions.maximumProven(),
  );
  protected readonly operationalCapacityChecking = computed(
    () => this.diningSuggestions.capacityStatus() === 'checking',
  );
  protected readonly operationalMaximumDisplay = computed(
    () => this.diningSuggestions.provenMaximumTableCount(),
  );
  protected readonly validatedFeasibleDisplay = computed(
    () => this.diningSuggestions.validatedFeasibleTableCount(),
  );
  protected readonly geometricUpperBoundDisplay = computed(
    () => this.diningSuggestions.basicGeometricUpperBound(),
  );
  protected readonly effectiveMaximumTableCount = computed(() => {
    const packMax = this.tableCreateMaxFillCount();
    const operational = resolveEffectiveMaximumTableCount({
      status: this.diningSuggestions.capacityStatus(),
      maximumProven: this.diningSuggestions.maximumProven(),
      provenMaximum: this.diningSuggestions.provenMaximumTableCount(),
      geometricUpperBound: this.diningSuggestions.basicGeometricUpperBound(),
    });
    const validated = this.diningSuggestions.validatedFeasibleTableCount();
    if (operational != null) {
      // Local AABB pack can under-count when the stage is free-rotated; a validated
      // operational witness must not be capped below that count.
      let max = packMax >= 1 ? Math.min(operational, packMax) : operational;
      if (validated != null && validated > max) {
        max = validated;
      }
      return max;
    }
    // Unknown / checking / error: do not allow raising count above the last
    // committed value. Pack still lowers count when diameter/gap/chairs grow.
    return null;
  });

  /** Displayed “Maximum that fits” — prefer validated witness over conservative local pack. */
  protected readonly displayedMaximumThatFits = computed(() => {
    const pack = this.tableCreateMaxFillCount();
    const validated = this.diningSuggestions.validatedFeasibleTableCount();
    if (
      this.diningSuggestions.capacityStatus() === 'ready' &&
      validated != null &&
      validated > pack
    ) {
      return validated;
    }
    return pack;
  });
  protected readonly canIncreaseDraftTableCount = computed(() =>
    canIncreaseDiningTableCount(
      this.draftTableCount(),
      this.effectiveMaximumTableCount(),
      this.diningSuggestions.capacityStatus(),
    ),
  );
  protected readonly tableCountContinueLabel = computed(() =>
    this.operationalCapacityChecking() || this.diningSuggestions.feasibilityLoading()
      ? 'Checking available table capacity...'
      : 'Continue to Step 5',
  );
  protected readonly tableCountAdjustedMessage = signal<string | null>(null);

  /**
   * Continue to Step 5 only with a valid table count.
   * Invalid counts cannot be committed; capacity must be ready (or frozen for
   * the same physical key after a background-only patch).
   */
  protected readonly canContinueFromTableMeasurements = computed(() => {
    if (this.isMultiShapeMode()) {
      return this.canContinueFromMultiShape();
    }
    const count = this.draftTableCount();
    const lastError = this.diningSuggestions.lastError();
    if (lastError && /version mismatch/i.test(lastError)) {
      return false;
    }
    const key = this.diningPhysicalCapacitySignature();
    const frozenReady = this.diningSuggestions.hasReadyKnowledgeFor(key);
    const status = this.diningSuggestions.capacityStatus();
    if ((status === 'checking' || status === 'unknown') && !frozenReady) {
      return false;
    }
    if (status === 'error' && !frozenReady) {
      return false;
    }
    const packMax = this.tableCreateMaxFillCount();
    const max = this.effectiveMaximumTableCount() ?? (frozenReady && packMax >= 1 ? packMax : null);
    if (max == null || max < 1 || count < 1 || count > max) {
      return false;
    }
    if (this.diningSuggestions.selectedCountIsValidated(count)) {
      return true;
    }
    const feasible = this.diningSuggestions.validatedFeasibleTableCount();
    if (feasible != null && count <= feasible) {
      return true;
    }
    return (
      this.diningSuggestions.lastFeasibilityCount() === count &&
      this.diningSuggestions.lastFeasibilityResult() === 'found'
    );
  });
  /** @deprecated alias — HTML and tests should use canContinueFromTableMeasurements */
  protected readonly canContinueDiningTableWizard = this.canContinueFromTableMeasurements;
  protected readonly selectedCountFeasibilityNote = computed(() =>
    selectedCountFeasibilityMessage(
      this.draftTableCount(),
      this.diningSuggestions.lastFeasibilityCount() === this.draftTableCount()
        ? this.diningSuggestions.lastFeasibilityResult()
        : null,
      this.diningSuggestions.provenMaximumTableCount(),
    ),
  );
  protected readonly capacityFootKind = computed(() =>
    diningCapacityFootKind({
      status: this.diningSuggestions.capacityStatus(),
      maximumProven: this.diningSuggestions.maximumProven(),
      provenMaximum: this.diningSuggestions.provenMaximumTableCount(),
      validatedFeasible: this.diningSuggestions.validatedFeasibleTableCount(),
    }),
  );
  protected readonly showCapacityCandidateDebug = isDevMode();
  protected readonly capacityPhysicalExplanation = computed(() =>
    this.diningSuggestions.lastPhysicalExplanation(),
  );
  protected readonly capacityCandidateDebugSvg = computed(() => {
    const svg = this.diningSuggestions.lastCapacityDebugSvg();
    return svg ? this.sanitizer.bypassSecurityTrustHtml(svg) : null;
  });

  protected readonly minDraftTableSizeM = MIN_DINING_TABLE_SIZE_M;
  protected readonly minDraftChairLengthM = MIN_DINING_CHAIR_LENGTH_M;
  protected readonly minDraftChairWidthM = MIN_DINING_CHAIR_WIDTH_M;

  private diningWizardInputLimits() {
    const el = this.diningWizardCapacityElement();
    if (!el) {
      return null;
    }
    return diningWizardInputMaxes(el, {
      ...this.diningWizardCapacityOptions(),
      tableCount: this.draftTableCount(),
    });
  }

  /**
   * While count > 1 this is the 1-table size at current chairs (growing it drops count).
   * After count is 1 this opens to the true 1-table size at minimum chairs.
   */
  protected readonly maxDraftTableWidthM = computed(() => {
    return this.diningWizardInputLimits()?.maxWidthM ?? DEFAULT_TABLE_WIDTH_M;
  });
  protected readonly maxDraftTableDepthM = computed(() => {
    return this.diningWizardInputLimits()?.maxDepthM ?? DEFAULT_TABLE_DEPTH_M;
  });
  /** Inter-table gap cannot exceed the longer room side (otherwise 2+ tables are impossible). */
  protected readonly maxDraftTableGapM = computed(() => {
    const el = this.diningWizardCapacityElement() ?? this.center();
    if (!el) {
      return 20;
    }
    return Math.max(0.1, Math.max(resolveBlockWidthM(el), resolveBlockLengthM(el)));
  });
  protected readonly maxDraftChairLengthM = computed(() => {
    return this.diningWizardInputLimits()?.maxChairLengthM ?? DEFAULT_CHAIR_LENGTH_M;
  });
  protected readonly maxDraftChairWidthM = computed(() => {
    return this.diningWizardInputLimits()?.maxChairWidthM ?? DEFAULT_CHAIR_WIDTH_M;
  });
  protected readonly selectedTableId = computed(() => this.canvas.selectedTableId());
  protected readonly selectedTableIds = computed(() => this.canvas.selectedTableIds());

  protected readonly diningTableCount = computed(() => {
    const c = this.center();
    return c ? getDiningTableCount(c) : 0;
  });

  /** Alert when a manual drag/place breaks the configured table-gap rule. */
  protected readonly tableGapRuleAlert = computed(() => this.canvas.tableGapRuleAlert());

  /** Active min clear gap (m) used while manually arranging tables. */
  protected readonly currentTableGapRuleM = computed(() => {
    const el = this.center();
    return el ? resolveDefaultTableGapM(el) : this.draftTableGapM();
  });
  protected readonly selectedTable = computed(() => {
    const c = this.center();
    const id = this.selectedTableId();
    if (!c || !id) {
      return null;
    }
    return c.diningTables?.find((t) => t.id === id) ?? null;
  });
  protected readonly tableGridActive = computed(() => this.center()?.tableGridMode === true);
  protected readonly maxDraftTableSeats = computed(() => {
    const el = this.center();
    if (!el) {
      return 1;
    }
    const shape = this.draftTableShape();
    const tableWidthM = this.draftTableWidthM();
    const tableDepthM = shape === 'rectangular' ? this.draftTableDepthM() : tableWidthM;
    return computeMaxChairsAroundTable({
      shape,
      tableWidthM,
      tableDepthM,
      chairWidthM: this.draftChairWidth(),
      chairDepthM: this.draftChairLength(),
    });
  });
  protected readonly maxSelectedTableSeats = computed(() => {
    const el = this.center();
    const table = this.selectedTable();
    if (!el || !table) {
      return 1;
    }
    const tableDepthM =
      table.shape === 'rectangular'
        ? table.depthM ?? resolveDefaultTableDepthM(el)
        : table.widthM;
    if (this.tableCreateWizardOpen()) {
      return computeMaxChairsAroundTable({
        shape: table.shape,
        tableWidthM: table.widthM,
        tableDepthM,
        chairWidthM: this.draftChairWidth(),
        chairDepthM: this.draftChairLength(),
      });
    }
    return resolveMaxTableSeats(el, table);
  });
  /** True when a selected table’s chair count can be edited (placement, or after templates generate / layout fixed). */
  protected readonly canEditSelectedTableChairs = computed(
    () =>
      Boolean(this.selectedTable()) &&
      (this.tablePlacementActive() ||
        (!this.tableCreateWizardOpen() || this.templatesGenerated())) &&
      !this.tableGridWizardOpen(),
  );

  protected readonly hasDiningStage = computed(() => {
    const c = this.center();
    return c ? hasDiningStage(c) : false;
  });
  protected readonly diningStageSpec = computed(() => this.center()?.diningStage ?? null);
  protected readonly stageSidePickActive = computed(() => this.canvas.isStageSidePickMode());
  protected readonly stageSidePickReorient = computed(() => this.canvas.stageSidePickReorient());
  protected readonly currentStageSideLabel = computed(() => {
    const el = this.center();
    const stage = el?.diningStage;
    if (!el || stage?.sideEdgeId == null) {
      return stage ? 'Selected side' : null;
    }
    return this.canvas.stageSideLabelFor(el.id, stage.sideEdgeId);
  });
  protected readonly hasDiningFoodPrepare = computed(() => {
    const el = this.center();
    return el ? hasDiningFoodPrepare(el) : false;
  });
  protected readonly diningFoodPrepareSpec = computed(() => this.center()?.diningFoodPrepare ?? null);
  protected readonly foodPrepareSidePickActive = computed(() => this.canvas.isFoodPrepareSidePickMode());
  protected readonly foodPrepareSidePickReorient = computed(() => this.canvas.foodPrepareSidePickReorient());
  protected readonly currentFoodPrepareSideLabel = computed(() => {
    const el = this.center();
    const fp = el?.diningFoodPrepare;
    if (!el || fp?.sideEdgeId == null) {
      return fp ? 'Selected side' : null;
    }
    return this.canvas.stageSideLabelFor(el.id, fp.sideEdgeId);
  });
  protected readonly diningServiceRouteCount = computed(() => {
    const c = this.center();
    return c ? getDiningServiceRouteCount(c) : 0;
  });
  protected readonly serviceRouteDraftCount = computed(() => this.canvas.serviceRouteDraftPoints().length);
  protected readonly selectedServiceRouteId = computed(() => this.canvas.selectedServiceRouteId());
  protected readonly selectedServiceRoute = computed(() => {
    const c = this.center();
    const id = this.selectedServiceRouteId();
    if (!c || !id) {
      return null;
    }
    return c.diningServiceRoutes?.find((r) => r.id === id) ?? null;
  });
  protected readonly tablePlacementActive = computed(() => this.center()?.tablePlacementMode === true);
  protected readonly enabledDiningFeatures = signal<string[]>([]);
  protected readonly diningFeaturesDropdownOpen = signal(false);
  protected readonly draftDiningFeatures = signal<string[]>([]);

  // Per-feature side selectors (applied from chosen template)
  protected readonly draftStageSide = signal(0);
  protected readonly draftFoodPrepareSide = signal(2);
  protected readonly draftExitSide = signal(1);

  // Feature dimension drafts (used when generating layouts)
  protected readonly draftStageWidthM = signal(DEFAULT_DINING_STAGE_WIDTH_M);
  protected readonly draftStageDepthM = signal(DEFAULT_DINING_STAGE_DEPTH_M);
  protected readonly draftFoodPrepWidthM = signal(DEFAULT_DINING_FOOD_PREPARE_WIDTH_M);
  protected readonly draftFoodPrepDepthM = signal(DEFAULT_DINING_FOOD_PREPARE_DEPTH_M);
  protected readonly draftServiceRouteWidthM = signal(1.2);

  // Template generation state
  protected readonly templatesGenerated = signal(false);

  /** Dynamically generated layout options from current inputs */
  protected readonly generatedTemplates = signal<DiningLayoutTemplateDescriptor[]>([]);

  /** Template currently previewed on the canvas (click to preview, Fix Layout to commit). */
  protected readonly selectedPreviewTemplateId = signal<string | null>(null);

  /** True when swapping an already-fixed auto layout for a different template. */
  protected readonly replacingFixedLayout = signal(false);

  /** Dining snapshot restored when canceling a layout template change. */
  private readonly diningLayoutRestoreSnapshot = signal<ReturnType<typeof extractDiningSnapshot> | null>(null);

  protected readonly appliedLayoutTemplateLabel = computed(() => {
    const el = this.center();
    const family = el?.diningLayoutGeneration?.family as DiningLayoutFamily | undefined;
    if (family && DINING_FAMILY_DISPLAY[family]) {
      return DINING_FAMILY_DISPLAY[family].name;
    }
    const id = el?.appliedDiningLayoutTemplateId;
    return id ? getDiningLayoutTemplateName(id) : null;
  });

  protected readonly diningSuggestionLoading = computed(() => this.diningSuggestions.loading());
  protected readonly metricQuality = metricLabel;
  protected readonly diningGenerationHint = computed(() => {
    const d = this.diningSuggestions.lastDiagnostics();
    if (!d || this.generatedTemplates().length > 0) {
      return null;
    }
    if (d.failureKind === 'OPERATIONAL_MAX_BELOW_REQUEST' && d.requestedTableCount != null && d.maximumProven) {
      return `${d.requestedTableCount} tables cannot fit under the current operational rules. Operational maximum: ${d.provenMaximumTableCount ?? '?'}.`;
    }
    if (d.failureKind === 'NOT_FOUND_YET' && d.requestedTableCount != null) {
      return `No valid ${d.requestedTableCount}-table arrangement was found within the current search.`;
    }
    if (d.failureKind === 'SEARCH_EXHAUSTED' && d.requestedTableCount != null) {
      return `No valid ${d.requestedTableCount}-table arrangement was found within the current search.`;
    }
    return d.message ?? null;
  });

  /** True when a layout pattern was fixed on this dining block. */
  protected readonly hasFixedDiningLayout = computed(() => {
    const el = this.center();
    return Boolean(el?.appliedDiningLayoutTemplateId && (el.diningTables?.length ?? 0) > 0);
  });

  protected isDraftDiningFeatureEnabled(feature: string): boolean {
    return this.draftDiningFeatures().includes(feature);
  }

  protected toggleDraftDiningFeature(feature: string): void {
    const list = [...this.draftDiningFeatures()];
    const index = list.indexOf(feature);
    const enabling = index < 0;
    if (index >= 0) {
      list.splice(index, 1);
      if (feature === 'stage') {
        this.canvas.selectDiningStage(false);
      } else if (feature === 'foodprepare') {
        this.canvas.selectDiningFoodPrepare(false);
      }
    } else {
      list.push(feature);
    }
    this.draftDiningFeatures.set(list);
    this.capDraftTableCountToMax();
    if (feature === 'stage' || feature === 'foodprepare') {
      this.syncWizardDiningFeaturesToCanvas(false);
      if (enabling) {
        if (feature === 'stage') {
          this.canvas.selectDiningStage(true);
        } else {
          this.canvas.selectDiningFoodPrepare(true);
        }
      }
    }
  }

  protected toggleDiningFeature(feature: string): void {
    const isEnabled = this.enabledDiningFeatures().includes(feature);
    const el = this.center();
    if (!el) {
      return;
    }
    if (isEnabled) {
      if (feature === 'stage') {
        this.removeDiningStage();
      } else if (feature === 'foodprepare') {
        this.removeDiningFoodPrepare();
      } else if (feature === 'serviceroute') {
        this.removeAllServiceRoutes();
      }
    } else {
      if (feature === 'stage') {
        const defaultSide = el.diningFoodPrepare?.sideEdgeId === 0 ? 1 : 0;
        this.canvas.applyStageOnSide(el.id, defaultSide);
      } else if (feature === 'foodprepare') {
        const defaultSide = el.diningStage?.sideEdgeId === 0 ? 1 : 0;
        this.canvas.applyFoodPrepareOnSide(el.id, defaultSide);
      } else if (feature === 'serviceroute') {
        this.startServiceRouteDrawing();
      }
    }
  }

  protected isDiningFeatureEnabled(feature: string): boolean {
    return this.enabledDiningFeatures().includes(feature);
  }

  protected readonly isAccessPointPlacing = computed(() =>
    Boolean(this.canvas.accessPointPlacementElementId()),
  );
  protected readonly accessPointPlacementKind = computed(() =>
    this.canvas.accessPointPlacementKind(),
  );
  protected readonly accessPointPlacementHint = computed(() =>
    this.canvas.accessPointPlacementHint(),
  );
  protected readonly isExitPlacing = this.isAccessPointPlacing;

  protected readonly hasDiningExit = computed(() => {
    const el = this.center();
    return el ? el.diningExit != null : false;
  });

  protected readonly hasDiningEntrance = computed(() => {
    const el = this.center();
    return el ? el.diningEntrance != null : false;
  });

  protected readonly hasDiningSharedAccess = computed(() => {
    const el = this.center();
    return el ? el.diningSharedAccessPoint != null : false;
  });

  /** Soft validation under Width inputs — reserved space so it does not jump layout. */
  protected readonly accessWidthHint = signal<string | null>(null);

  protected readonly entranceWidthM = computed(() =>
    this.accessWidthValue(this.center()?.diningEntrance),
  );
  protected readonly exitWidthM = computed(() =>
    this.accessWidthValue(this.center()?.diningExit),
  );
  protected readonly sharedAccessWidthM = computed(() =>
    this.accessWidthValue(this.center()?.diningSharedAccessPoint),
  );

  protected readonly entranceMaxWidthM = computed(() =>
    this.maxAccessWidthForSpec(this.center()?.diningEntrance ?? null),
  );
  protected readonly exitMaxWidthM = computed(() =>
    this.maxAccessWidthForSpec(this.center()?.diningExit ?? null),
  );
  protected readonly sharedMaxWidthM = computed(() =>
    this.maxAccessWidthForSpec(this.center()?.diningSharedAccessPoint ?? null),
  );

  protected readonly diningBackgroundImage = computed(() => this.center()?.diningLayoutReferenceImage ?? null);

  protected readonly diningBackgroundBlockAspect = computed(() => {
    const el = this.center();
    if (!el) {
      return 1;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    return rect.width / Math.max(1, rect.height);
  });

  protected readonly diningBackgroundClipSource = computed((): DiningBackgroundClipSource => {
    const el = this.center();
    return {
      shape: el?.shape,
      customPoints: el?.customPoints,
      polygonSides: el?.polygonSides,
      curveDeg: el?.curveDeg,
    };
  });

  protected readonly diningBackgroundNeedsAdjust = computed(() => {
    const el = this.center();
    return diningBackgroundNeedsReadjustment(
      el?.diningLayoutReferenceImage,
      this.diningBackgroundClipSource(),
    );
  });

  protected readonly diningAccessMode = computed((): DiningAccessMode => {
    const el = this.center();
    return el ? resolveDiningAccessMode(el) : 'separate';
  });

  protected accessWidthLabel(spec: { widthM?: number } | null | undefined): string {
    return `${resolveDiningAccessWidthM(spec).toFixed(1)} m`;
  }

  protected accessWidthValue(spec: { widthM?: number } | null | undefined): number {
    return resolveDiningAccessWidthM(spec);
  }

  private maxAccessWidthForSpec(spec: { sideEdgeId?: number } | null): number | null {
    const el = this.center();
    if (!el || !spec || spec.sideEdgeId == null) {
      return null;
    }
    return this.canvas.diningAccessMaxWidthM(el.id, spec.sideEdgeId);
  }

  protected startAccessPointPlacement(kind: 'entrance' | 'exit' | 'shared'): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.accessPointsError.set(null);
    this.accessWidthHint.set(null);
    this.canvas.startAccessPointPlacement(el.id, kind);
  }

  protected startExitPlacement(): void {
    this.startAccessPointPlacement('exit');
  }

  protected startEntrancePlacement(): void {
    this.startAccessPointPlacement('entrance');
  }

  protected startSharedAccessPlacement(): void {
    this.startAccessPointPlacement('shared');
  }

  protected cancelAccessPointPlacement(): void {
    this.canvas.cancelAccessPointPlacement();
  }

  protected cancelExitPlacement(): void {
    this.cancelAccessPointPlacement();
  }

  protected removeDiningExit(): void {
    const el = this.center();
    if (el) {
      this.canvas.removeDiningExit(el.id);
      this.accessPointsError.set(null);
    }
  }

  protected removeDiningEntrance(): void {
    const el = this.center();
    if (el) {
      this.canvas.removeDiningEntrance(el.id);
      this.accessPointsError.set(null);
    }
  }

  protected accessPointSideLabel(sideEdgeId: number | undefined | null): string {
    return `Side ${(sideEdgeId ?? 0) + 1}`;
  }

  protected continueFromAccessPoints(): void {
    this.canvas.cancelAccessPointPlacement();
    const el = this.center();
    if (!el) {
      return;
    }
    if (resolveDiningAccessMode(el) === 'shared') {
      if (!el.diningSharedAccessPoint) {
        this.accessPointsError.set('Please place the shared entrance and exit point before continuing.');
        return;
      }
    } else if (!el.diningEntrance || !el.diningExit) {
      this.accessPointsError.set('Please place both an entrance and an exit before continuing.');
      return;
    }
    this.accessPointsError.set(null);
    this.canvas.setDiningAccessPointsLocked(true);
    this.goToStep(3);
  }

  protected selectDiningAccessMode(mode: DiningAccessMode): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.accessPointsError.set(null);
    if (resolveDiningAccessMode(el) === mode) {
      this.accessModeSwitchPrompt.set(false);
      return;
    }
    if (mode === 'shared' && el.diningEntrance && el.diningExit) {
      this.accessModeSwitchPrompt.set(true);
      return;
    }
    this.accessModeSwitchPrompt.set(false);
    if (mode === 'shared') {
      this.canvas.setDiningAccessMode(
        el.id,
        'shared',
        el.diningEntrance ? 'entrance' : el.diningExit ? 'exit' : undefined,
      );
      return;
    }
    this.canvas.setDiningAccessMode(el.id, 'separate');
  }

  protected confirmSharedFrom(source: 'entrance' | 'exit'): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.accessModeSwitchPrompt.set(false);
    this.canvas.setDiningAccessMode(el.id, 'shared', source);
  }

  protected cancelAccessModeSwitch(): void {
    this.accessModeSwitchPrompt.set(false);
  }

  protected removeDiningSharedAccess(): void {
    const el = this.center();
    if (el) {
      this.canvas.removeDiningSharedAccess(el.id);
      this.accessPointsError.set(null);
    }
  }

  protected updatePlacedAccessWidth(target: 'entrance' | 'exit' | 'shared', raw: string | number): void {
    const el = this.center();
    if (!el) {
      return;
    }
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }
    const result = this.canvas.updateDiningAccessPointWidth(el.id, target, value);
    if (!result) {
      return;
    }
    if (result.clamped && result.maxWidthM != null) {
      this.accessWidthHint.set(
        `Maximum available width on this edge is ${result.maxWidthM.toFixed(1)} m.`,
      );
    } else {
      this.accessWidthHint.set(null);
    }
  }

  protected commitAccessWidthEdit(): void {
    this.canvas.commitAccessWidthEdit();
  }

  protected async onDiningBackgroundFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file) {
      await this.openDiningBackgroundAdjust(file);
    }
  }

  protected async onDiningBackgroundDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer?.files?.[0] ?? null;
    if (file) {
      await this.openDiningBackgroundAdjust(file);
    }
  }

  private async openDiningBackgroundAdjust(file: File): Promise<void> {
    const el = this.center();
    if (!el) {
      return;
    }
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowed.includes(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
      this.diningBackgroundError.set('Please upload a PNG, JPG, or WEBP image.');
      return;
    }
    this.diningBackgroundError.set(null);
    try {
      const dataUrl = await this.readFileAsDataUrl(file);
      if (!dataUrl.startsWith('data:image/')) {
        this.diningBackgroundError.set('Could not read that image. Try a PNG, JPG, or WEBP file.');
        return;
      }
      const dims = await loadImageDimensions(dataUrl);
      if (dims.width < 1 || dims.height < 1) {
        this.diningBackgroundError.set('That image has no usable dimensions. Try a different file.');
        return;
      }
      this.canvas.beginDiningBackgroundAdjust({
        elementId: el.id,
        source: {
          dataUrl,
          name: file.name,
          imageWidth: dims.width,
          imageHeight: dims.height,
          visible: true,
        },
        blockAspect: this.diningBackgroundBlockAspect(),
        clipSource: this.diningBackgroundClipSource(),
        initialFit: defaultDiningBackgroundFit(),
      });
    } catch {
      this.diningBackgroundError.set('Could not read that image. Try a different file.');
    }
  }

  protected async startDiningBackgroundAdjust(): Promise<void> {
    const el = this.center();
    const ref = el?.diningLayoutReferenceImage;
    if (!el || !ref?.dataUrl) {
      return;
    }
    this.diningBackgroundError.set(null);
    let source: DiningLayoutReferenceImage = { ...ref };
    if (!(source.imageWidth && source.imageHeight)) {
      try {
        const dims = await loadImageDimensions(source.dataUrl);
        source = { ...source, imageWidth: dims.width, imageHeight: dims.height };
      } catch {
        this.diningBackgroundError.set('Could not load the saved background image.');
        return;
      }
    }
    this.canvas.beginDiningBackgroundAdjust({
      elementId: el.id,
      source,
      blockAspect: this.diningBackgroundBlockAspect(),
      clipSource: this.diningBackgroundClipSource(),
      initialFit: diningBackgroundFitFromRef(source),
    });
  }

  protected toggleDiningBackgroundVisible(): void {
    const el = this.center();
    const ref = el?.diningLayoutReferenceImage;
    if (!el || !ref) {
      return;
    }
    this.canvas.updateDiningBackgroundImage(el.id, { visible: ref.visible === false });
  }

  protected removeDiningBackground(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.removeDiningBackgroundImage(el.id);
    this.diningBackgroundError.set(null);
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    });
  }

  protected getEnabledFeaturesLabel(): string {
    const list: string[] = [];
    if (this.isDiningFeatureEnabled('stage')) {
      list.push('Stage');
    }
    if (this.isDiningFeatureEnabled('foodprepare')) {
      list.push('Food Prep');
    }
    if (this.isDiningFeatureEnabled('serviceroute')) {
      list.push('Service Route');
    }
    return list.join(', ');
  }
  protected readonly canCustomizeBlock = computed(() => {
    const el = this.center();
    return Boolean(el && !this.canvas.blockWorkspaceId() && isCustomizableBlock(el));
  });
  protected readonly isArrangeByRowActive = computed(() =>
    Boolean(this.canvas.arrangeByRowElementId()),
  );
  protected readonly arrangeByRowMeasureMode = computed(() => this.canvas.isArrangeByRowMeasureMode());
  protected readonly showBlockMeasurePanel = computed(() => {
    if (!this.arrangeByRowMeasureMode()) {
      return false;
    }
    if (this.variant() === 'block-measure') {
      return true;
    }
    return this.variant() === 'seating-sidebar' && this.canvas.blockMeasureContext() === 'arrange-by-row';
  });
  protected readonly isDiningSidebar = computed(() => this.variant() === 'dining-sidebar');
  protected readonly measureTargetElement = computed(() => {
    const measureId = this.canvas.arrangeByRowElementId();
    if (measureId) {
      const el = this.canvas.elements().find((item) => item.id === measureId);
      if (el?.type === 'centerpiece') {
        return el;
      }
    }
    return this.variant() === 'block-measure'
      ? this.canvas.blockWorkspaceElement()
      : this.center();
  });
  protected readonly arrangeByRowLayoutMode = computed(
    () => this.canvas.arrangeByRowWizardPhase() === 'layout' && this.isArrangeByRowActive(),
  );
  protected readonly arrangeByRowPendingSideIds = computed(() =>
    this.canvas.arrangeByRowPendingSideIds(),
  );
  protected readonly arrangeByRowHasPendingSides = computed(
    () => this.canvas.arrangeByRowPendingSideIds().length > 0,
  );
  protected readonly arrangeByRowPendingSideEntries = computed(() => {
    const c = this.measureTargetElement();
    const pendingIds = this.canvas.arrangeByRowPendingSideIds();
    if (!c || pendingIds.length === 0 || (c.customPoints?.length ?? 0) < 3) {
      return [];
    }
    const rect = rectFromPositionSize(c.position, c.size, this.canvas.canvas());
    const polygon = polygonCanvasPointsFromBlock(c.customPoints ?? [], rect);
    const drafts = this.pendingSideDrafts();
    return pendingIds
      .map((logicalId) => {
        const edge = logicalMeasureEdgeById(polygon, logicalId);
        if (!edge) {
          return null;
        }
        return {
          logicalId,
          label: edge.label,
          draft: drafts[logicalId] ?? { lengthM: 10, name: edge.label },
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry != null);
  });
  protected readonly canConfirmAllArrangeByRowSides = computed(() => {
    const total = this.arrangeByRowSideCount();
    const pending = this.canvas.arrangeByRowPendingSideIds();
    if (total === 0 || pending.length < total) {
      return false;
    }
    const drafts = this.pendingSideDrafts();
    return pending.every((logicalId) => (drafts[logicalId]?.lengthM ?? 0) >= 0.1);
  });
  protected readonly arrangeByRowMeasuredSides = computed(() =>
    this.canvas.arrangeByRowMeasuredSides(),
  );
  protected readonly arrangeByRowWizardError = computed(() => this.canvas.arrangeByRowWizardError());
  protected readonly arrangeByRowSideCount = computed(() => {
    const c = this.measureTargetElement();
    if (!c || (c.customPoints?.length ?? 0) < 3) {
      return 0;
    }
    const rect = rectFromPositionSize(c.position, c.size, this.canvas.canvas());
    const polygon = polygonCanvasPointsFromBlock(c.customPoints ?? [], rect);
    return buildBlockMeasureEdges(polygon).length;
  });
  protected readonly arrangeByRowMeasuredCount = computed(() => {
    const c = this.measureTargetElement();
    if (!c || (c.customPoints?.length ?? 0) < 3) {
      return 0;
    }
    const rect = rectFromPositionSize(c.position, c.size, this.canvas.canvas());
    const polygon = polygonCanvasPointsFromBlock(c.customPoints ?? [], rect);
    return countMeasuredLogicalEdges(polygon, this.canvas.arrangeByRowMeasuredSides());
  });
  protected readonly arrangeByRowCapacity = computed(() => {
    const c = this.center();
    if (!c || (c.customPoints?.length ?? 0) < 3) {
      return null;
    }
    const draftLengths = this.canvas.arrangeByRowDraftSideLengthsM();
    const sideLengths =
      draftLengths.length >= 3 ? draftLengths : (c.customSideLengthsM ?? []);
    if (sideLengths.length < 3) {
      return null;
    }
    const rect = rectFromPositionSize(c.position, c.size, this.canvas.canvas());
    const stadiumSide =
      c.dragSeatsStadiumSideIndex ?? this.canvas.blockWorkspaceSeatingSideIndex() ?? 0;
    const viewpointAngle =
      c.blockViewpointAngleDeg ??
      (this.canvas.blockWorkspaceViewpointConfirmed()
        ? this.canvas.blockWorkspaceViewpointAngleDeg()
        : null);
    return estimateArrangeByRowCapacity(
      c,
      rect,
      sideLengths,
      this.buildArrangeByRowDims(c),
      stadiumSide,
      viewpointAngle,
    );
  });
  protected readonly arrangeByRowLayoutPreview = computed(() => {
    const c = this.center();
    if (!c || (c.customPoints?.length ?? 0) < 3) {
      return null;
    }
    const draftLengths = this.canvas.arrangeByRowDraftSideLengthsM();
    const sideLengths =
      draftLengths.length >= 3 ? draftLengths : (c.customSideLengthsM ?? []);
    if (sideLengths.length < 3) {
      return null;
    }
    const rect = rectFromPositionSize(c.position, c.size, this.canvas.canvas());
    const stadiumSide =
      c.dragSeatsStadiumSideIndex ?? this.canvas.blockWorkspaceSeatingSideIndex() ?? 0;
    const viewpointAngle =
      c.blockViewpointAngleDeg ??
      (this.canvas.blockWorkspaceViewpointConfirmed()
        ? this.canvas.blockWorkspaceViewpointAngleDeg()
        : null);
    return previewArrangeByRowLayout(
      c,
      rect,
      sideLengths,
      this.buildArrangeByRowDims(c),
      stadiumSide,
      this.draftArrangeRows(),
      viewpointAngle,
    );
  });
  protected readonly lineSeatDraftCount = computed(() => this.canvas.lineSeatDraftPoints().length);
  protected readonly seatRowDraftCount = computed(() => this.canvas.seatRowDraftPoints().length);
  protected readonly seatRowCompletedCount = computed(() => this.canvas.seatRowDraftRows().length);

  protected readonly selected = this.canvas.selected;
  protected readonly isDrawing = computed(
    () =>
      Boolean(this.canvas.drawingElementId()) ||
      this.isSeatRowDrawing() ||
      this.isLineSeatDrawing() ||
      this.isServiceRouteDrawing() ||
      this.isPerSeatPlacing() ||
      this.isArrangeByRowActive(),
  );
  protected readonly draftCount = computed(() => this.canvas.draftPoints().length);

  protected readonly center = computed(() => this.typed<CenterpieceElement>('centerpiece'));
  protected readonly isCustom = computed(() => {
    const c = this.center();
    return Boolean(c && hasTracedBlockOutline(c));
  });
  protected readonly hasCustomShape = computed(() => (this.center()?.customPoints?.length ?? 0) >= 3);
  protected readonly seatingEnabled = computed(() => {
    const c = this.center();
    if (!c) {
      return false;
    }
    return (c.customSeatBlocks?.length ?? 0) > 0 || isCustomShapeSeatingEnabled(c);
  });
  protected readonly dragSeatsActive = computed(() => this.center()?.dragSeatsMode === true);
  protected readonly dragFillSeatsActive = computed(() => this.center()?.dragFillSeatsMode === true);
  protected readonly isDragFillSeatsSession = computed(() =>
    Boolean(this.canvas.dragFillSeatsElementId()),
  );
  protected readonly showSeatingToolPicker = computed(() => {
    if (this.isDragFillSeatsSession()) {
      return false;
    }
    if (this.dragSeatsWizardOpen()) {
      return false;
    }
    if (this.defineByRowColumnWizardOpen()) {
      return false;
    }
    if (this.awaitingSeatDims()) {
      return false;
    }
    if (this.autoSeatWizardOpen()) {
      return false;
    }
    return true;
  });
  protected readonly perSeatsActive = computed(() => this.center()?.perSeatPlacementMode === true);
  protected readonly arrangeByRowSeatsActive = computed(() => this.center()?.arrangeByRowMode === true);
  protected readonly interactiveSeatingLocked = computed(
    () => this.center()?.interactiveSeatingLocked === true,
  );
  protected readonly canUseDragSeatsOrArrangeByRow = computed(
    () => this.hasCustomShape() && !this.interactiveSeatingLocked(),
  );
  protected readonly defineByRowColumnSeatsActive = computed(() => this.center()?.defineByRowColumnMode === true);
  protected readonly lineSeatsActive = computed(() => {
    const c = this.center();
    if (
      !c ||
      c.dragSeatsMode ||
      c.dragFillSeatsMode ||
      c.perSeatPlacementMode ||
      c.arrangeByRowMode ||
      c.defineByRowColumnMode ||
      (c.customSeatBlocks?.length ?? 0) > 0
    ) {
      return false;
    }
    return c.seatLayout != null;
  });
  protected readonly lineSeatRowCount = computed(() => {
    const counts = this.center()?.seatLayout?.rowSeatCounts ?? [];
    return counts.filter((count) => count > 0).length;
  });
  protected readonly lineSeatRowEntries = computed(() => {
    const c = this.center();
    if (!c?.customLineSeatRows || !c.seatLayout) {
      return [];
    }
    const counts = c.seatLayout.rowSeatCounts ?? [];
    return c.customLineSeatRows
      .map((line, index) => ({
        index,
        seatCount: counts[index] ?? 0,
        hasLine: (line?.length ?? 0) >= 2,
      }))
      .filter((entry) => entry.hasLine);
  });
  protected readonly arrangeByRowRowEntries = computed(() => {
    const c = this.center();
    if (!c?.arrangeByRowRows || !c.seatLayout) {
      return [];
    }
    const counts = c.seatLayout.rowSeatCounts ?? [];
    return c.arrangeByRowRows
      .map((_, index) => ({
        index,
        seatCount: counts[index] ?? 0,
      }))
      .filter((entry) => entry.seatCount > 0);
  });
  protected readonly arrangeByRowRowCounts = computed(() =>
    this.arrangeByRowRowEntries().map((entry) => entry.seatCount),
  );
  protected readonly draftMaxFirstRowSeats = computed(() => {
    const el = this.center();
    if (!el) {
      return 1;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    return estimateDragSeatsFirstRowCapacity(
      el,
      rect,
      this.draftSideLengths(),
      this.draftChairWidth(),
      this.draftChairLength(),
      this.draftSeatGap(),
      this.draftStadiumSideIndex(),
    );
  });
  protected readonly activeSeatGap = computed(() => {
    const c = this.center();
    return c ? resolveSeatGapM(c) : DEFAULT_SEAT_GAP_M;
  });
  protected readonly activeFirstRowSeatCount = computed(() => {
    const c = this.center();
    if (!c) {
      return 1;
    }
    return c.dragSeatsFirstRowSeatCount ?? c.seatLayout?.rowSeatCounts?.[0] ?? 1;
  });
  protected readonly activeMaxFirstRowSeats = computed(() => {
    const c = this.center();
    if (!c) {
      return 1;
    }
    const rect = rectFromPositionSize(c.position, c.size, this.canvas.canvas());
    return getDragSeatsMaxFirstRowSeatCount(c, rect);
  });
  protected readonly customSideCount = computed(() => this.center()?.customPoints?.length ?? 0);
  protected readonly draftSideLabels = computed(() => {
    const count = this.customSideCount();
    return Array.from({ length: count }, (_, index) => stadiumSideLabel(index, count));
  });
  protected readonly stadiumSideLabel = stadiumSideLabel;
  protected readonly physicalCapacity = computed(() => {
    const c = this.center();
    return c ? computePhysicalCapacity(c) : null;
  });
  protected readonly customSeatTotal = computed(() => {
    const c = this.center();
    if (!c || !this.seatingEnabled()) {
      return 0;
    }
    return getCustomShapeVisibleSeatCount(c);
  });
  protected readonly seatLayout = computed(() => {
    const c = this.center();
    if (!c?.seatLayout) {
      return null;
    }
    return getSeatLayoutSpec({
      rows: c.rows,
      seatsPerRow: c.seatsPerRow,
      rowLabelStyle: c.rowLabelStyle,
      seatLayout: c.seatLayout,
    });
  });
  protected readonly rowInsideCounts = computed(() => {
    const c = this.center();
    if (!c || !this.seatingEnabled()) {
      return [];
    }
    return getCustomShapeRowInsideSeatCounts(c);
  });
  protected readonly customSeatBlocksList = computed(
    () => this.center()?.customSeatBlocks ?? [],
  );
  protected readonly selectedCustomRow = computed(() => this.canvas.selectedCustomRow());
  protected readonly selectedSeatId = computed(() => this.canvas.selectedSeatId());
  protected readonly selectedBlock = computed(() => {
    const seatId = this.selectedSeatId();
    const el = this.center();
    if (!seatId || !el || !el.customSeatBlocks) {
      return null;
    }
    const blockCode = seatId.split('-')[0];
    return el.customSeatBlocks.find((b) => b.code === blockCode) ?? null;
  });

  protected readonly selectedRowIndex = computed(() => {
    const seatId = this.canvas.selectedSeatId();
    if (!seatId) {
      return -1;
    }
    const parts = seatId.split('-');
    if (parts.length < 2) {
      return -1;
    }
    const rowPart = parts[1];
    const block = this.selectedBlock();
    if (!block) {
      return -1;
    }
    const style = block.rowLabelStyle ?? 'letter';
    for (let i = 0; i < block.rows; i++) {
      if (rowLabel(i, style) === rowPart.replace(/[0-9]/g, '')) {
        return i;
      }
    }
    return -1;
  });


  protected blockForId(blockId: string): CustomShapeSeatBlock | null {
    return this.center()?.customSeatBlocks?.find((b) => b.id === blockId) ?? null;
  }

  protected isBlockRowSelected(blockId: string, rowIndex: number): boolean {
    const row = this.selectedCustomRow();
    if (row) {
      return row.blockId === blockId && row.rowIndex === rowIndex;
    }
    const block = this.blockForId(blockId);
    if (!block) {
      return false;
    }
    return this.rowIndexFromSelectedSeat(block) === rowIndex;
  }

  protected rowIndexFromSelectedSeat(block: CustomShapeSeatBlock): number {
    const seatId = this.selectedSeatId();
    if (!seatId) {
      return -1;
    }
    const style = block.rowLabelStyle ?? 'letter';
    const parsed = parseBlockSeatId(seatId, block.code, style);
    return parsed?.rowIndex ?? -1;
  }

  protected selectBlockRow(blockId: string, rowIndex: number): void {
    this.canvas.selectCustomRow(blockId, rowIndex);
  }

  protected deleteSelectedSeat(): void {
    const el = this.center();
    const seatId = this.selectedSeatId();
    if (el && seatId) {
      this.canvas.removeCustomShapeSeatFromElement(el.id, seatId);
    }
  }

  protected rowCurveFor(block: CustomShapeSeatBlock, rowIndex: number): number {
    return block.seatLayout?.rowCurveDegs?.[rowIndex] ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Custom row / seat gaps (block workspace)
  // ---------------------------------------------------------------------------

  /** Step used by the −/+ buttons on the gap editors (metres). */
  protected readonly SEAT_GAP_STEP_M = 0.05;

  /** The workspace block whose seats can take per-row / per-seat gaps. */
  protected readonly seatSpacingBlock = computed(() => {
    const c = this.center();
    return c && this.canvas.canEditSeatSpacing(c) ? c : null;
  });

  /** Selected row of the workspace block (row letters are clickable on the canvas). */
  protected readonly seatSpacingRow = computed(() => {
    const c = this.seatSpacingBlock();
    const row = this.selectedCustomRow();
    if (!c || !row || row.blockId !== c.id) {
      return null;
    }
    const style = c.seatLayout?.rowLabelStyle ?? c.rowLabelStyle ?? 'letter';
    const rowIndex = row.rowIndex;
    return {
      rowIndex,
      label: rowLabel(rowIndex, style),
      prevLabel: rowIndex > 0 ? rowLabel(rowIndex - 1, style) : null,
      gapM: this.canvas.seatRowGapM(c.id, rowIndex),
      defaultGapM: resolveRowGapM(c),
    };
  });

  /** Selected chair of the workspace block plus the gap to its right-hand neighbour. */
  protected readonly seatSpacingSeat = computed(() => {
    const c = this.seatSpacingBlock();
    const seatId = this.selectedSeatId();
    if (!c || !seatId || this.canvas.selectedSeatElementId() !== c.id) {
      return null;
    }
    const parsed = parseOverrideSeatId(seatId);
    if (!parsed) {
      return null;
    }
    const spec = getSeatLayoutSpec({
      rows: c.rows,
      seatsPerRow: c.seatsPerRow,
      rowLabelStyle: c.rowLabelStyle,
      seatLayout: c.seatLayout,
    });
    const rowCount = getSeatLayoutRowSeatCounts(spec)[parsed.rowIndex] ?? 0;
    return {
      seatId,
      rowIndex: parsed.rowIndex,
      seatIndex: parsed.seatIndex,
      number: parsed.seatIndex + 1,
      rowLabel: rowLabel(parsed.rowIndex, spec.rowLabelStyle ?? 'letter'),
      hasNext: parsed.seatIndex + 1 < rowCount,
      gapM: this.canvas.seatPairGapM(c.id, parsed.rowIndex, parsed.seatIndex),
      defaultGapM: resolveSeatGapM(c),
    };
  });

  protected readonly seatSpacingHiddenCount = computed(
    () => this.seatSpacingBlock()?.seatLayout?.spacingHiddenSeatIds?.length ?? 0,
  );

  protected readonly seatSpacingHasAdjustments = computed(() =>
    hasSeatSpacingAdjustments(this.seatSpacingBlock()?.seatLayout),
  );

  /** Row-gap edit scope: only the selected row pair, or every row pair in the block. */
  protected readonly seatRowGapScope = signal<SeatRowGapScope>('row');
  /** Seat-gap edit scope: the selected pair, the whole row, or every row. */
  protected readonly seatPairGapScope = signal<SeatPairGapScope>('pair');

  protected commitSeatRowGap(raw: string | number): void {
    const c = this.seatSpacingBlock();
    const row = this.seatSpacingRow();
    if (!c || !row) {
      return;
    }
    this.canvas.setSeatRowGapM(c.id, row.rowIndex, this.num(String(raw)), this.seatRowGapScope());
  }

  protected stepSeatRowGap(direction: 1 | -1): void {
    const row = this.seatSpacingRow();
    if (!row) {
      return;
    }
    this.commitSeatRowGap(Math.max(0, row.gapM + direction * this.SEAT_GAP_STEP_M));
  }

  protected commitSeatPairGap(raw: string | number): void {
    const c = this.seatSpacingBlock();
    const seat = this.seatSpacingSeat();
    if (!c || !seat) {
      return;
    }
    this.canvas.setSeatPairGapM(
      c.id,
      seat.rowIndex,
      seat.seatIndex,
      this.num(String(raw)),
      this.seatPairGapScope(),
    );
  }

  protected stepSeatPairGap(direction: 1 | -1): void {
    const seat = this.seatSpacingSeat();
    if (!seat) {
      return;
    }
    this.commitSeatPairGap(Math.max(0, seat.gapM + direction * this.SEAT_GAP_STEP_M));
  }

  protected resetSeatRowSpacing(): void {
    const c = this.seatSpacingBlock();
    const row = this.seatSpacingRow();
    if (c && row) {
      this.canvas.resetSeatRowSpacing(c.id, row.rowIndex);
    }
  }

  protected resetAllSeatSpacing(): void {
    const c = this.seatSpacingBlock();
    if (c) {
      this.canvas.resetSeatSpacing(c.id);
    }
  }

  protected readonly draftCapacity = computed(() =>
    computePhysicalCapacity({
      type: 'centerpiece',
      shape: 'custom',
      name: '',
      label: '',
      curveDeg: 0,
      position: { xPct: 50, yPct: 50 },
      size: { wPct: 10, hPct: 10 },
      rotation: 0,
      style: {},
      id: '',
      physicalLengthM: this.draftBlockLength(),
      physicalWidthM: this.draftBlockWidth(),
      chairLengthM: this.draftChairLength(),
      chairWidthM: this.draftChairWidth(),
    }),
  );
  /** CV-detected pitch/block polygons (id prefix cv-). */
  protected readonly isCvOutline = computed(() => (this.center()?.id ?? '').startsWith('cv-'));

  protected readonly grid = computed(() => this.typed<BlockGridElement>('block-grid'));
  protected readonly section = computed(() => this.typed<SeatSectionElement>('seat-section'));
  protected readonly ring = computed(() => this.typed<LayerRingElement>('layer-ring'));
  protected readonly centerpieces = computed(() =>
    this.canvas.elements().filter((el): el is CenterpieceElement => el.type === 'centerpiece'),
  );
  protected readonly ringTotalSeats = computed(() => {
    const ringEl = this.ring();
    if (!ringEl) {
      return 0;
    }
    return ringEl.blocks.reduce(
      (total, block) => total + visibleSeatCount(block, ringEl.rowLabelStyle),
      0,
    );
  });
  protected readonly selectedSector = computed(() => {
    const ringEl = this.ring();
    const sel = this.canvas.selectedRingBlock();
    if (!ringEl || !sel || sel.elementId !== ringEl.id) {
      return null;
    }
    return ringEl.blocks.find((block) => block.id === sel.blockId) ?? null;
  });
  protected readonly rectLayer = computed(() => this.typed<LayerRectElement>('layer-rect'));
  protected readonly aisle = computed(() => this.typed<AisleElement>('aisle'));
  protected readonly label = computed(() => this.typed<LabelElement>('label'));

  /** Manually expanded sector cards in the block list (selected sectors auto-expand). */
  private readonly expandedSectors = signal<Set<string>>(new Set());

  protected readonly selectedCount = computed(() => this.canvas.selectedIds().length);

  protected readonly selectedAutoFillBlocks = computed(() => this.canvas.selectedAutoFillBlocks());

  private static readonly MEASUREMENT_SYNC_PAGE_SIZE = 3;

  protected readonly measurementSyncInfo = computed(() => this.canvas.workspaceMeasurementSyncInfo());

  private readonly measurementSyncPageIndex = signal(0);

  protected readonly showMeasurementSyncPanel = computed(
    () =>
      this.variant() === 'block-workspace' &&
      this.measurementSyncInfo().length > 0,
  );

  protected readonly measurementSyncPageCount = computed(() => {
    const total = this.measurementSyncInfo().length;
    return Math.max(1, Math.ceil(total / InspectorPanelComponent.MEASUREMENT_SYNC_PAGE_SIZE));
  });

  protected readonly measurementSyncVisible = computed(() => {
    const page = this.measurementSyncPageIndex();
    const start = page * InspectorPanelComponent.MEASUREMENT_SYNC_PAGE_SIZE;
    return this.measurementSyncInfo().slice(start, start + InspectorPanelComponent.MEASUREMENT_SYNC_PAGE_SIZE);
  });

  protected readonly measurementSyncHasPrev = computed(() => this.measurementSyncPageIndex() > 0);

  protected readonly measurementSyncHasNext = computed(
    () =>
      (this.measurementSyncPageIndex() + 1) * InspectorPanelComponent.MEASUREMENT_SYNC_PAGE_SIZE <
      this.measurementSyncInfo().length,
  );

  protected readonly measurementSyncPageLabel = computed(() => {
    const total = this.measurementSyncInfo().length;
    const page = this.measurementSyncPageIndex();
    const start = page * InspectorPanelComponent.MEASUREMENT_SYNC_PAGE_SIZE + 1;
    const end = Math.min(start + InspectorPanelComponent.MEASUREMENT_SYNC_PAGE_SIZE - 1, total);
    return `${start}–${end} of ${total}`;
  });

  protected showPrevMeasurementSync(): void {
    this.measurementSyncPageIndex.update((page) => Math.max(0, page - 1));
  }

  protected showNextMeasurementSync(): void {
    this.measurementSyncPageIndex.update((page) => page + 1);
  }

  protected readonly showAutoFillLayoutPanel = computed(
    () =>
      this.variant() === 'full' &&
      !this.canvas.blockWorkspaceId() &&
      !this.canvas.drawingElementId() &&
      this.canvas.autoFillLayoutMode(),
  );

  protected readonly autoFillAnimating = computed(() => this.canvas.autoFillAnimating());

  protected readonly autoFillHasSeatedBlocks = computed(() => {
    const canvas = this.canvas.canvas();
    return this.selectedAutoFillBlocks().some((block) => {
      const rect = rectFromPositionSize(block.position, block.size, canvas);
      return getCustomShapeVisibleSeatCount(block, rect) > 0;
    });
  });

  protected readonly showAutoFillSameColorDeselect = computed(
    () => this.canvas.showAutoFillSameColorDeselect(),
  );

  protected readonly autoFillSameColorSelectedCount = computed(
    () => this.canvas.autoFillSameColorSelectedCount(),
  );

  protected readonly autoFillColorDeselectHint = computed(
    () => this.canvas.autoFillColorDeselectHint(),
  );

  protected deselectAutoFillSameColorBlocks(): void {
    this.canvas.deselectAutoFillBlocksWithSameColor();
  }

  protected readonly autoFillConfig = computed(() => this.canvas.autoFillSeatingConfig());

  protected readonly autoFillLastResult = computed(() => this.canvas.autoFillLastResult());

  protected readonly autoFillFailedBlocks = computed(() => {
    const result = this.autoFillLastResult();
    if (!result) {
      return [];
    }
    return result.results.filter((entry) => !entry.success);
  });

  protected readonly autoFillError = computed(() => this.canvas.autoFillError());

  protected readonly autoFillPrimaryBlock = computed(() => {
    const blocks = this.selectedAutoFillBlocks();
    if (blocks.length === 0) {
      return null;
    }
    const focusedId = this.canvas.selectedId();
    if (focusedId) {
      const focused = blocks.find((block) => block.id === focusedId);
      if (focused) {
        return focused;
      }
    }
    return blocks[0];
  });

  protected readonly canEditAutoFillConfiguration = computed(() => {
    const config = this.autoFillConfig();
    const referenceId = config.referenceBlockId;
    if (referenceId) {
      const reference = this.canvas.elements().find((el) => el.id === referenceId);
      if (reference?.type === 'centerpiece' && reference.blockType === 'seating') {
        return true;
      }
    }
    return this.autoFillPrimaryBlock() != null;
  });

  protected readonly autoFillMeasurementView = computed(() => {
    const block = this.autoFillPrimaryBlock();
    if (!block) {
      return null;
    }
    const rect = rectFromPositionSize(block.position, block.size, this.canvas.canvas());
    const defaults = estimateDefaultSideLengthsM(block, rect);
    const config = this.autoFillConfig();
    const lengths = resolveAutoFillDisplaySideLengthsM(
      block.id,
      block.customSideLengthsM,
      defaults,
      config,
    );
    const isReference = block.id === config.referenceBlockId;
    return {
      blockId: block.id,
      label: block.name || block.label || block.code || 'Block',
      lengths,
      isReference,
    };
  });

  protected readonly autoFillReferenceSideLengths = computed(() => {
    const view = this.autoFillMeasurementView();
    if (!view) {
      return [];
    }
    return view.lengths.map((lengthM, index) => ({ index, lengthM }));
  });

  protected readonly autoFillShowBlockMeasurements = computed(() => {
    return this.autoFillMeasurementView() != null;
  });

  protected readonly autoFillMeasurementEditorIsReference = computed(() => {
    return this.autoFillMeasurementView()?.isReference === true;
  });

  protected readonly autoFillMeasurementDeltaLabel = computed(() => {
    const config = this.autoFillConfig();
    if (!config.applyBlockMeasurementScale) {
      return null;
    }
    const baseline = config.referenceBaselineSideLengthsM ?? [];
    const current = config.referenceSideLengthsM ?? [];
    if (baseline.length < 3 || current.length < 3) {
      return null;
    }
    const deltas = computeSideLengthDeltasM(baseline, current);
    if (deltas.every((delta) => Math.abs(delta) < 0.001)) {
      return null;
    }
    return deltas
      .map((delta, index) => {
        const sign = delta >= 0 ? '+' : '';
        return `S${index + 1} ${sign}${delta.toFixed(2)} m`;
      })
      .join(', ');
  });

  protected readonly inspectorTitle = computed(() => {
    if (this.canvas.drawingElementId()) {
      return 'Custom Piece';
    }
    if (this.isSeatRowDrawing()) {
      return 'Draw seat area manually';
    }
    if (this.isLineSeatDrawing()) {
      return 'Draw seat rows manually';
    }
    if (this.isPerSeatPlacing()) {
      return 'Add Seats One by One';
    }
    if (this.isTablePlacing()) {
      return 'Add Tables One by One';
    }
    if (this.isArrangeByRowActive()) {
      return 'Arrange by Row';
    }
    const c = this.center();
    if (c && hasTracedBlockOutline(c)) {
      return 'Custom Piece';
    }
    const count = this.selectedCount();
    if (count > 1) {
      return `${count} elements selected`;
    }
    const el = this.selected();
    if (!el) {
      return 'Inspector';
    }
    return el.name || el.type;
  });

  private typed<T extends LayoutElement>(type: T['type']): T | null {
    const el = this.selected();
    return el && el.type === type ? (el as T) : null;
  }

  protected patch(patch: Partial<LayoutElement>): void {
    const el = this.selected();
    if (el) {
      this.canvas.update(el.id, patch);
    }
  }

  protected patchSilent(patch: Partial<LayoutElement>): void {
    const el = this.selected();
    if (el) {
      this.canvas.updateSilent(el.id, patch);
    }
  }

  protected setStyle(key: 'fillColor' | 'strokeColor' | 'labelColor', value: string): void {
    const el = this.selected();
    if (el) {
      this.canvas.update(el.id, { style: { ...el.style, [key]: value } });
    }
  }

  protected remove(): void {
    this.canvas.removeSelected();
  }

  protected duplicate(): void {
    this.canvas.duplicateSelected();
  }

  protected finishDraw(): void {
    this.canvas.finishDrawing();
  }

  protected cancelDraw(): void {
    this.canvas.cancelDrawing();
  }

  protected startDrawOnCanvas(): void {
    const el = this.center();
    if (el) {
      this.canvas.startCustomDrawOnElement(el.id);
    } else {
      this.canvas.startCustomPieceDrawing();
    }
  }

  protected clearCustomShape(): void {
    const el = this.center();
    if (el) {
      this.canvas.clearCustomShape(el.id);
    }
  }

  protected setAdjustEdges(enabled: boolean): void {
    this.patch({ adjustEdges: enabled });
  }

  protected adjustQuickSegments(delta: number): void {
    const next = Math.max(1, Math.min(12, this.quickSegments() + delta));
    this.quickSegments.set(next);
    const el = this.center();
    if (el) {
      this.canvas.generateQuickShape(el.id, next);
    }
  }

  protected startSeatsInsideShape(): void {
    const el = this.center();
    if (!el || !this.hasCustomShape()) {
      return;
    }
    this.dragSeatsWizardOpen.set(false);
    this.defineByRowColumnWizardOpen.set(false);
    this.autoSeatWizardOpen.set(false);
    this.canvas.startSeatRowDrawing(el.id);
  }

  protected startDefineByRowColumnWizard(): void {
    const el = this.center();
    if (!el || !this.hasCustomShape()) {
      return;
    }
    this.dragSeatsWizardOpen.set(false);
    this.autoSeatWizardOpen.set(false);
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const defaults = estimateDefineByRowColumnDefaults(el, rect);
    this.draftDefineRows.set(el.defineByRowColumnRows ?? defaults.rows);
    this.draftDefineColumns.set(el.defineByRowColumnColumns ?? defaults.columns);
    this.defineByRowColumnWizardOpen.set(true);
  }

  protected cancelDefineByRowColumnWizard(): void {
    this.defineByRowColumnWizardOpen.set(false);
  }

  protected setDraftDefineRows(value: number): void {
    this.draftDefineRows.set(Math.max(1, Math.min(100, Math.round(value))));
  }

  protected setDraftDefineColumns(value: number): void {
    this.draftDefineColumns.set(Math.max(1, Math.min(100, Math.round(value))));
  }

  protected applyDefineByRowColumn(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.applyDefineByRowColumn(el.id, this.draftDefineRows(), this.draftDefineColumns());
    this.defineByRowColumnWizardOpen.set(false);
  }

  protected adjustDefineByRowColumn(axis: 'rows' | 'columns', delta: number): void {
    const el = this.center();
    if (!el) {
      return;
    }
    const rows = Math.max(1, Math.min(100, (el.defineByRowColumnRows ?? 1) + (axis === 'rows' ? delta : 0)));
    const columns = Math.max(1, Math.min(100, (el.defineByRowColumnColumns ?? 1) + (axis === 'columns' ? delta : 0)));
    this.canvas.applyDefineByRowColumn(el.id, rows, columns);
  }

  protected startDragFillSeats(): void {
    const el = this.center();
    if (!el || !this.hasCustomShape()) {
      return;
    }
    this.defineByRowColumnWizardOpen.set(false);
    this.autoSeatWizardOpen.set(false);
    this.dragSeatsWizardOpen.set(false);
    this.canvas.startDragFillSeats(el.id);
  }

  protected startDragSeatsWizard(): void {
    const el = this.center();
    if (!el || !this.hasCustomShape() || !this.canUseDragSeatsOrArrangeByRow()) {
      return;
    }
    this.defineByRowColumnWizardOpen.set(false);
    this.autoSeatWizardOpen.set(false);
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const sideCount = el.customPoints?.length ?? 0;
    const existingLengths = el.customSideLengthsM ?? [];
    // Same metre scale as Arrange by row — never replace measured sides with geometry estimates.
    const sideLengths =
      existingLengths.length === sideCount && existingLengths.every((length) => length > 0)
        ? [...existingLengths]
        : estimateDefaultSideLengthsM(el, rect);
    this.draftSideLengths.set(sideLengths);
    this.draftStadiumSideIndex.set(
      el.dragSeatsStadiumSideIndex ??
        (this.canvas.blockWorkspaceViewpointConfirmed()
          ? this.canvas.blockWorkspaceSeatingSideIndex()
          : this.canvas.blockWorkspaceViewpointLayout()?.sideIndex) ??
        estimateDefaultStadiumSideIndex(
          (el.customPoints ?? []).map((p) => ({
            x: rect.x + (p.xPct / 100) * rect.width,
            y: rect.y + (p.yPct / 100) * rect.height,
          })),
        ),
    );
    this.draftChairLength.set(resolveChairLengthM(el));
    this.draftChairWidth.set(resolveChairWidthM(el));
    this.draftSeatGap.set(resolveSeatGapM(el));
    this.draftRowGap.set(resolveRowGapM(el));
    this.dragSeatsWizardStep.set(1);
    this.canvas.clearDragSeatsHighlightSideIndex();
    this.dragSeatsWizardOpen.set(true);
  }

  protected cancelDragSeatsWizard(): void {
    this.dragSeatsWizardOpen.set(false);
    this.dragSeatsWizardStep.set(1);
    this.canvas.clearDragSeatsHighlightSideIndex();
  }

  protected nextDragSeatsStep(): void {
    const step = this.dragSeatsWizardStep();
    if (step < 3) {
      const next = (step + 1) as 1 | 2 | 3;
      if (next === 3) {
        this.draftFirstRowSeatCount.set(this.draftMaxFirstRowSeats());
      }
      if (step === 1) {
        this.canvas.clearDragSeatsHighlightSideIndex();
      }
      this.dragSeatsWizardStep.set(next);
    }
  }

  protected backDragSeatsStep(): void {
    const step = this.dragSeatsWizardStep();
    if (step > 1) {
      this.dragSeatsWizardStep.set((step - 1) as 1 | 2 | 3);
    }
  }

  protected setDraftSideLength(index: number, value: number): void {
    const next = [...this.draftSideLengths()];
    next[index] = Math.max(0.1, value);
    this.draftSideLengths.set(next);
  }

  protected setDragSeatsSideHighlight(index: number | null): void {
    this.canvas.setDragSeatsHighlightSideIndex(index);
  }

  protected onDragSeatsSideFieldBlur(event: FocusEvent, index: number): void {
    const related = event.relatedTarget;
    if (related instanceof HTMLElement && related.closest('.drag-seats-side-field')) {
      return;
    }
    if (this.canvas.dragSeatsHighlightSideIndex() === index) {
      this.canvas.clearDragSeatsHighlightSideIndex();
    }
  }

  protected setDraftStadiumSideIndex(index: number): void {
    const count = this.customSideCount();
    this.draftStadiumSideIndex.set(Math.max(0, Math.min(count - 1, Math.round(index))));
  }

  protected setDraftFirstRowSeatCount(value: number): void {
    const max = this.draftMaxFirstRowSeats();
    this.draftFirstRowSeatCount.set(Math.max(1, Math.min(max, Math.round(value))));
  }

  protected updateDragSeatsFirstRowCount(value: number): void {
    const el = this.center();
    if (!el) {
      return;
    }
    const max = this.activeMaxFirstRowSeats();
    const safe = Math.max(1, Math.min(max, Math.round(value)));
    this.canvas.updateDragSeatsFirstRowSeatCount(el.id, safe);
  }

  protected adjustDragSeatsSeatCount(delta: number): void {
    this.updateDragSeatsFirstRowCount(this.activeFirstRowSeatCount() + delta);
  }

  protected updateDragSeatsSeatGap(value: number): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.updateDragSeatsSeatGap(el.id, Math.max(0, value));
  }

  protected setDraftSeatGap(value: number): void {
    this.draftSeatGap.set(Math.max(0, value));
  }

  protected applyDragSeats(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    const sides = this.draftSideLengths().map((length) => Math.max(0.1, length));
    if (sides.length < 3) {
      return;
    }
    this.canvas.enableDragSeats(
      el.id,
      sides,
      {
        physicalLengthM: Math.max(0.1, this.draftBlockLength()),
        physicalWidthM: Math.max(0.1, this.draftBlockWidth()),
        chairLengthM: Math.max(0.1, this.draftChairLength()),
        chairWidthM: Math.max(0.1, this.draftChairWidth()),
        seatGapM: Math.max(0, this.draftSeatGap()),
        rowGapM: Math.max(0, this.draftRowGap()),
      },
      this.draftStadiumSideIndex(),
    );
    this.dragSeatsWizardOpen.set(false);
    this.dragSeatsWizardStep.set(1);
    this.canvas.clearDragSeatsHighlightSideIndex();
  }

  protected fillDragSeatsShape(): void {
    const el = this.center();
    if (el) {
      this.canvas.fillDragSeatsFullShape(el.id);
    }
  }

  protected cancelSeatSetup(): void {
    this.seatSetupOpen.set(false);
    this.dimsWizardStep.set(1);
    this.canvas.cancelPendingSeatRow();
  }

  protected nextDimsStep(): void {
    this.dimsWizardStep.set(2);
    this.canvas.setPendingBlockPreviewLengthM(this.draftBlockLength());
    this.canvas.setPendingBlockPreviewWidthM(this.draftBlockWidth());
  }

  protected backDimsStep(): void {
    this.dimsWizardStep.set(1);
  }

  protected applySeatDimensions(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.applyPendingSeatRowWithDims(el.id, {
      physicalLengthM: Math.max(0.1, this.draftBlockLength()),
      physicalWidthM: Math.max(0.1, this.draftBlockWidth()),
      chairLengthM: Math.max(0.1, this.draftChairLength()),
      chairWidthM: Math.max(0.1, this.draftChairWidth()),
      seatGapM: Math.max(0, this.draftSeatGap()),
      rowGapM: Math.max(0, this.draftRowGap()),
    });
    this.seatSetupOpen.set(false);
    this.dimsWizardStep.set(1);
  }

  protected startPerSeatPlacement(): void {
    const el = this.center();
    if (!el || !this.hasCustomShape()) {
      return;
    }
    this.dragSeatsWizardOpen.set(false);
    this.defineByRowColumnWizardOpen.set(false);
    this.autoSeatWizardOpen.set(false);
    this.canvas.startPerSeatPlacement(el.id);
  }

  protected startAutoSeatCreate(): void {
    const el = this.center();
    if (!el || !this.hasCustomShape()) {
      return;
    }
    this.dragSeatsWizardOpen.set(false);
    this.defineByRowColumnWizardOpen.set(false);
    this.seatSetupOpen.set(false);
    this.autoSeatError.set(null);
    this.autoSeatParsed.set(null);
    this.autoSeatParseNotes.set([]);
    this.autoSeatWizardOpen.set(true);
  }

  protected cancelAutoSeatCreate(): void {
    this.autoSeatWizardOpen.set(false);
    this.autoSeatAnalyzing.set(false);
    this.autoSeatError.set(null);
    this.autoSeatParsed.set(null);
    this.autoSeatParseNotes.set([]);
  }

  protected async onAutoSeatFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    await this.analyzeAutoSeatFile(file);
    input.value = '';
  }

  protected async analyzeAutoSeatFile(file: File): Promise<void> {
    this.autoSeatAnalyzing.set(true);
    this.autoSeatError.set(null);
    this.autoSeatParsed.set(null);
    this.autoSeatParseNotes.set([]);
    try {
      const result = await this.seatingSpecAnalyzer.analyzeFile(file);
      this.autoSeatParsed.set(result.spec);
      this.autoSeatParseNotes.set(result.parseNotes ?? []);
      if (!result.spec) {
        this.autoSeatError.set(result.error ?? 'Could not read seating specification from the file.');
      }
    } catch (err) {
      this.autoSeatParsed.set(null);
      this.autoSeatError.set(
        err instanceof SeatingSpecAnalysisError ? err.message : 'Seating spec analysis failed.',
      );
    } finally {
      this.autoSeatAnalyzing.set(false);
    }
  }

  protected async loadAutoSeatSample(): Promise<void> {
    this.autoSeatAnalyzing.set(true);
    this.autoSeatError.set(null);
    this.autoSeatParsed.set(null);
    this.autoSeatParseNotes.set([]);
    try {
      const res = await fetch('/samples/auto-seat-spec-example.txt');
      if (!res.ok) {
        throw new Error('Sample specification file not found.');
      }
      const text = await res.text();
      const { spec, notes } = parseSeatingSpecFromRawText(text);
      this.autoSeatParsed.set(spec);
      this.autoSeatParseNotes.set(notes);
      if (!spec) {
        this.autoSeatError.set('Could not parse the sample specification.');
      }
    } catch (err) {
      this.autoSeatParsed.set(null);
      this.autoSeatError.set(err instanceof Error ? err.message : 'Could not load sample.');
    } finally {
      this.autoSeatAnalyzing.set(false);
    }
  }

  protected applyAutoSeatSpec(): void {
    const el = this.canvas.blockWorkspaceElement() ?? this.center();
    const spec = this.autoSeatParsed();
    if (!el || !spec) {
      return;
    }
    const ok = this.canvas.applyAutoSeatingSpec(el.id, spec);
    if (ok) {
      this.autoSeatError.set(null);
      this.cancelAutoSeatCreate();
    } else {
      this.autoSeatError.set(
        this.canvas.arrangeByRowWizardError() ??
          'Could not place seats. Try fewer rows/seats or confirm VIEW POINT first.',
      );
    }
  }

  protected startAutoTableCreate(): void {
    const el = this.center();
    if (!el || !this.hasCustomShape()) {
      return;
    }
    this.seedTableCreateWizardDrafts(el);
    this.diningLayoutRestoreSnapshot.set(extractDiningSnapshot(el));
    this.autoTableRestoreLabel.set(el.label ?? '');
    this.tableCreateWizardOpen.set(false);
    this.diningImageUploadOpen.set(false);
    this.autoTableError.set(null);
    this.autoTableParsed.set(null);
    this.autoTableParseNotes.set([]);
    this.autoTableNoSpaceMessage.set(null);
    this.autoTableLayoutApplied.set(false);
    this.resetManualTablePlacementUi();
    this.canvas.cancelTablePlacement();
    this.autoTableWizardOpen.set(true);
    this.diningWizardStep.set(1);
  }

  protected cancelAutoTableCreate(): void {
    const el = this.center();
    const snapshot = this.diningLayoutRestoreSnapshot();
    const restoreLabel = this.autoTableRestoreLabel();
    if (el) {
      if (snapshot) {
        this.canvas.update(el.id, {
          ...diningSnapshotToPatch(snapshot),
          ...(restoreLabel != null ? { label: restoreLabel } : {}),
          tablePlacementMode: undefined,
          tableGridMode: undefined,
        });
      } else if (this.autoTableLayoutApplied()) {
        this.canvas.update(el.id, {
          diningTables: undefined,
          diningStage: undefined,
          diningFoodPrepare: undefined,
          diningEntrance: undefined,
          diningExit: undefined,
          diningSharedAccessPoint: undefined,
          diningServiceRoutes: undefined,
          diningLayoutReferenceImage: undefined,
          appliedDiningLayoutTemplateId: undefined,
          tableGridMode: undefined,
          tableGridRows: undefined,
          tableGridColumns: undefined,
          tablePlacementMode: undefined,
          ...(restoreLabel != null ? { label: restoreLabel } : {}),
        });
      } else if (restoreLabel != null && el.label !== restoreLabel) {
        this.canvas.update(el.id, { label: restoreLabel });
      }
    }
    this.closeAutoTableCreateToSelectTools();
  }

  /** Return to Step 1 Select Tool. */
  private closeAutoTableCreateToSelectTools(): void {
    this.diningLayoutRestoreSnapshot.set(null);
    this.autoTableRestoreLabel.set(null);
    this.autoTableWizardOpen.set(false);
    this.autoTableAnalyzing.set(false);
    this.autoTableError.set(null);
    this.autoTableParsed.set(null);
    this.autoTableParseNotes.set([]);
    this.autoTableNoSpaceMessage.set(null);
    this.autoTableLayoutApplied.set(false);
    this.tableCreateWizardOpen.set(false);
    this.diningWizardStep.set(1);
    this.resetManualTablePlacementUi();
    this.canvas.cancelTablePlacement();
    this.canvas.selectedTableId.set(null);
    this.canvas.selectedTableIds.set([]);
  }

  protected dismissAutoTableNoSpace(): void {
    this.autoTableNoSpaceMessage.set(null);
  }

  protected async onAutoTableFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    await this.analyzeAutoTableFile(file);
    input.value = '';
  }

  protected async analyzeAutoTableFile(file: File): Promise<void> {
    this.autoTableAnalyzing.set(true);
    this.autoTableError.set(null);
    this.autoTableParsed.set(null);
    this.autoTableParseNotes.set([]);
    try {
      const result = await this.diningSpecAnalyzer.analyzeFile(file);
      this.autoTableParsed.set(result.spec);
      this.autoTableParseNotes.set(result.parseNotes ?? []);
      if (!result.spec) {
        this.autoTableError.set(result.error ?? 'Could not read dining table specification from the file.');
      }
    } catch (err) {
      this.autoTableParsed.set(null);
      this.autoTableError.set(
        err instanceof DiningSpecAnalysisError ? err.message : 'Dining table spec analysis failed.',
      );
    } finally {
      this.autoTableAnalyzing.set(false);
    }
  }

  protected async loadAutoTableSample(): Promise<void> {
    this.autoTableAnalyzing.set(true);
    this.autoTableError.set(null);
    this.autoTableParsed.set(null);
    this.autoTableParseNotes.set([]);
    try {
      const res = await fetch('/samples/block21auto-table-spec-example.txt');
      if (!res.ok) {
        throw new Error('Block 21 sample specification file not found.');
      }
      const text = await res.text();
      const { spec, notes } = parseDiningSpecFromRawText(text);
      this.autoTableParsed.set(spec);
      this.autoTableParseNotes.set(notes);
      if (!spec) {
        this.autoTableError.set('Could not parse the sample specification.');
      }
    } catch (err) {
      this.autoTableParsed.set(null);
      this.autoTableError.set(err instanceof Error ? err.message : 'Could not load sample.');
    } finally {
      this.autoTableAnalyzing.set(false);
    }
  }

  protected applyAutoTableSpec(): void {
    const el = this.center();
    const spec = this.autoTableParsed();
    if (!el || !spec) {
      return;
    }
    const ok = this.canvas.applyAutoDiningSpec(el.id, spec);
    if (ok) {
      this.autoTableError.set(null);
      this.autoTableLayoutApplied.set(true);
    } else {
      const err =
        this.canvas.autoDiningSpecError() ??
        'Could not place tables. Try fewer tables or smaller measurements.';
      if (/no spaces/i.test(err)) {
        this.autoTableNoSpaceMessage.set(err);
      } else {
        this.autoTableError.set(err);
      }
    }
  }

  protected startArrangeByRow(): void {
    const el = this.center();
    if (!el || !this.hasCustomShape() || !this.canUseDragSeatsOrArrangeByRow()) {
      return;
    }
    this.dragSeatsWizardOpen.set(false);
    this.defineByRowColumnWizardOpen.set(false);
    this.autoSeatWizardOpen.set(false);
    this.draftChairLength.set(resolveChairLengthM(el));
    this.draftChairWidth.set(resolveChairWidthM(el));
    this.draftSeatGap.set(resolveSeatGapM(el));
    this.draftRowGap.set(resolveRowGapM(el));
    this.seatSpacingConfigOpen.set(false);
    this.canvas.startArrangeByRow(el.id);
    const cap = this.arrangeByRowCapacity();
    if (cap) {
      this.draftArrangeRows.set(Math.min(4, cap.maxRows));
    }
  }

  protected confirmAllArrangeByRowSides(): void {
    const entries = this.arrangeByRowPendingSideEntries().map((entry) => ({
      logicalId: entry.logicalId,
      lengthM: entry.draft.lengthM,
      name: entry.draft.name,
    }));
    this.canvas.confirmAllArrangeByRowSideMeasurements(entries);
  }

  protected updatePendingSideDraft(
    logicalId: number,
    patch: Partial<{ lengthM: number; name: string }>,
  ): void {
    const drafts = { ...this.pendingSideDrafts() };
    const current = drafts[logicalId] ?? { lengthM: 10, name: '' };
    drafts[logicalId] = { ...current, ...patch };
    this.pendingSideDrafts.set(drafts);
  }

  protected selectArrangeByRowSide(index: number): void {
    this.canvas.selectArrangeByRowMeasureSide(index);
  }

  protected applyArrangeByRowGrid(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    const ok = this.canvas.applyArrangeByRowGrid(
      this.draftArrangeRows(),
      this.buildArrangeByRowDims(el),
    );
    if (ok) {
      const cap = this.arrangeByRowCapacity();
      if (cap) {
        this.draftArrangeRows.set(Math.min(this.draftArrangeRows(), cap.maxRows));
      }
    }
  }

  protected setDraftArrangeRows(value: number): void {
    const cap = this.arrangeByRowCapacity();
    const max = cap?.maxRows ?? 100;
    this.draftArrangeRows.set(Math.max(1, Math.min(max, Math.round(value))));
  }

  protected arrangeByRowPreviewLabel(index: number): string {
    return rowLabel(index, 'letter');
  }

  protected cancelArrangeByRow(): void {
    this.canvas.cancelArrangeByRow();
    this.seatSpacingConfigOpen.set(false);
  }

  protected toggleSeatSpacingConfig(): void {
    const opening = !this.seatSpacingConfigOpen();
    if (opening) {
      const el = this.center();
      if (el) {
        this.draftChairLength.set(resolveChairLengthM(el));
        this.draftChairWidth.set(resolveChairWidthM(el));
        this.draftSeatGap.set(resolveSeatGapM(el));
        this.draftRowGap.set(resolveRowGapM(el));
      }
    }
    this.seatSpacingConfigOpen.set(opening);
  }

  protected saveSeatSpacingConfig(): void {
    this.draftChairLength.set(Math.max(0.1, this.draftChairLength()));
    this.draftChairWidth.set(Math.max(0.1, this.draftChairWidth()));
    this.draftSeatGap.set(Math.max(0, this.draftSeatGap()));
    this.draftRowGap.set(Math.max(0, this.draftRowGap()));
    this.clampDraftArrangeToCapacity();
    const el = this.center();
    if (!el || this.customSeatTotal() <= 0) {
      return;
    }
    const ok = this.canvas.saveSeatSpacingConfig(el.id, this.buildArrangeByRowDims(el));
    if (ok) {
      this.seatSpacingConfigOpen.set(false);
    }
  }

  protected formatMetres(value: number): string {
    return (Math.round(value * 1000) / 1000).toFixed(2);
  }

  private buildArrangeByRowDims(c: CenterpieceElement) {
    return {
      physicalLengthM: resolveBlockLengthM(c),
      physicalWidthM: resolveBlockWidthM(c),
      chairLengthM: Math.max(0.1, this.draftChairLength()),
      chairWidthM: Math.max(0.1, this.draftChairWidth()),
      seatGapM: Math.max(0, this.draftSeatGap()),
      rowGapM: Math.max(0, this.draftRowGap()),
    };
  }

  private clampDraftArrangeToCapacity(): void {
    const cap = this.arrangeByRowCapacity();
    if (!cap) {
      return;
    }
    this.draftArrangeRows.set(Math.min(this.draftArrangeRows(), cap.maxRows));
  }

  protected cancelPerSeatPlacement(): void {
    this.canvas.cancelPerSeatPlacement();
  }

  protected finishDragFillSeats(): void {
    this.canvas.finishDragFillSeats();
  }

  protected startCustomLineSeat(): void {
    const el = this.center();
    if (!el || !this.hasCustomShape()) {
      return;
    }
    this.dragSeatsWizardOpen.set(false);
    this.defineByRowColumnWizardOpen.set(false);
    this.autoSeatWizardOpen.set(false);
    this.canvas.startLineSeatDrawing(el.id);
  }

  protected finishLineSeatDraw(): void {
    this.canvas.finishLineSeatDrawing();
  }

  protected cancelLineSeatDraw(): void {
    this.canvas.cancelLineSeatDrawing();
  }

  protected maxSeatsForLineRow(rowIndex: number): number {
    const el = this.center();
    if (!el) {
      return 1;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    return maxSeatsForLineSeatRow(el, rect, this.canvas.canvas(), rowIndex);
  }

  protected adjustLineSeatRow(rowIndex: number, delta: number): void {
    const el = this.center();
    if (el) {
      this.canvas.adjustLineSeatRowCount(el.id, rowIndex, delta);
    }
  }

  protected setLineSeatRowCount(rowIndex: number, value: number): void {
    const el = this.center();
    if (el) {
      this.canvas.updateLineSeatRowCount(el.id, rowIndex, value);
    }
  }

  protected startCustomSeatRowTool(): void {
    const el = this.center();
    if (el) {
      this.canvas.startSeatRowDrawing(el.id);
    }
  }

  protected completeSeatRowDraftRow(): void {
    this.canvas.completeSeatRowDraftRow();
  }

  protected finishSeatRowDraw(): void {
    const c = this.center();
    if (c) {
      this.draftBlockLength.set(resolveBlockLengthM(c));
      this.draftBlockWidth.set(resolveBlockWidthM(c));
      this.draftChairLength.set(resolveChairLengthM(c));
      this.draftChairWidth.set(resolveChairWidthM(c));
      this.draftSeatGap.set(resolveSeatGapM(c));
      this.draftRowGap.set(resolveRowGapM(c));
    }
    this.canvas.finishSeatRowDrawing();
  }

  protected cancelSeatRowDraw(): void {
    this.canvas.cancelSeatRowDrawing();
  }

  protected addSeatsInside(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.addCustomShapeSeats(el.id, this.seatsToAdd());
  }

  protected removeSeating(): void {
    const el = this.center();
    if (el) {
      this.canvas.removeCustomShapeSeating(el.id);
      this.seatSetupOpen.set(false);
      this.dragSeatsWizardOpen.set(false);
      this.defineByRowColumnWizardOpen.set(false);
    }
  }

  protected setDraftDim(
    key: 'draftBlockLength' | 'draftBlockWidth' | 'draftChairLength' | 'draftChairWidth',
    value: number,
  ): void {
    const safe = Math.max(0.1, value);
    this[key].set(safe);
    if (key === 'draftBlockLength') {
      this.canvas.setPendingBlockPreviewLengthM(safe);
    }
    if (key === 'draftBlockWidth') {
      this.canvas.setPendingBlockPreviewWidthM(safe);
    }
  }

  protected clearAllSeats(): void {
    const el = this.center();
    const spec = this.seatLayout();
    if (!el || !spec) {
      return;
    }
    this.canvas.update(el.id, {
      seatLayout: {
        ...spec,
        rowSeatCounts: Array.from({ length: spec.rows }, () => 0),
        hiddenSeatIds: [],
      },
      seatPositionOverrides: {},
    });
  }

  protected applySeatLayout(patch: Partial<SeatLayoutSpec>): void {
    const el = this.center();
    const spec = this.seatLayout();
    if (!el || !spec) {
      return;
    }
    this.canvas.applyCustomSeatLayout(el.id, { ...spec, ...patch });
  }

  protected setSeatRows(rows: number): void {
    const spec = this.seatLayout();
    if (!spec) {
      return;
    }
    const capacity = this.physicalCapacity();
    const capped = Math.min(rows, capacity?.maxRows ?? rows);
    this.applySeatLayout(resizeSeatLayoutRows(spec, capped));
  }

  protected setDefaultSeatsPerRow(seats: number): void {
    const spec = this.seatLayout();
    if (!spec) {
      return;
    }
    const capacity = this.physicalCapacity();
    const capped = Math.min(seats, capacity?.maxSeatsPerRow ?? seats);
    this.applySeatLayout(updateDefaultSeatsPerRow(spec, capped));
  }

  protected setRowSeatCount(rowIndex: number, count: number): void {
    const spec = this.seatLayout();
    if (!spec) {
      return;
    }
    const capacity = this.physicalCapacity();
    const capped = Math.min(count, capacity?.maxSeatsPerRow ?? count);
    this.applySeatLayout(updateRowSeatCount(spec, rowIndex, capped));
  }

  protected rowLabelFor(index: number): string {
    const style = this.seatLayout()?.rowLabelStyle ?? 'letter';
    return rowLabel(index, style);
  }

  protected setSeatsToAdd(value: number): void {
    this.seatsToAdd.set(Math.max(1, Math.min(50, value)));
  }

  // --- Seat section rows ---

  protected addSeatRow(): void {
    const el = this.section();
    if (!el) {
      return;
    }
    const row: SeatSectionRow = {
      id: nestedId('srow'),
      seatCount: 10,
      rotationDeg: 0,
      curveDeg: 0,
      seatSpacingPct: 4,
      offsetXPct: 0,
      offsetYPct: el.rows.length * 2,
    };
    this.canvas.update(el.id, { rows: [...el.rows, row] });
  }

  protected removeSeatRow(rowId: string): void {
    const el = this.section();
    if (el) {
      this.canvas.update(el.id, { rows: el.rows.filter((r) => r.id !== rowId) });
    }
  }

  protected updateSeatRow(rowId: string, patch: Partial<SeatSectionRow>): void {
    const el = this.section();
    if (el) {
      this.canvas.update(el.id, {
        rows: el.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
      });
    }
  }

  protected setRingSeats(rows: number, seatsPerRow: number): void {
    const el = this.ring();
    if (el) {
      const safeRows = Math.max(0, Math.round(rows));
      const safeSeats = Math.max(0, Math.round(seatsPerRow));
      this.canvas.update(el.id, {
        blocks: el.blocks.map((b) => {
          const layout = mergeSeatLayoutPatch(b, el.rowLabelStyle, {
            rows: safeRows,
            seatsPerRow: safeSeats,
            rowSeatCounts: Array.from({ length: safeRows }, () => safeSeats),
          });
          return { ...b, ...seatLayoutToBlockFields(layout), seatLayout: layout };
        }),
      });
    }
  }

  protected selectSectorBlock(blockId: string): void {
    const el = this.ring() ?? this.rectLayer();
    if (el) {
      this.canvas.selectRingBlock(el.id, blockId);
      this.expandedSectors.update((ids) => new Set(ids).add(blockId));
    }
  }

  protected toggleSectorExpanded(blockId: string): void {
    this.expandedSectors.update((ids) => {
      const next = new Set(ids);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  }

  protected isSectorExpanded(blockId: string): boolean {
    return this.isSectorSelected(blockId) || this.expandedSectors().has(blockId);
  }

  protected centerpieceLabel(id: string | undefined): string {
    if (!id) {
      return 'None';
    }
    const cp = this.centerpieces().find((item) => item.id === id);
    return cp?.name || cp?.label || 'Untitled centerpiece';
  }

  protected ringGapPct(): number {
    return this.ring()?.gapPct ?? 1;
  }

  protected isSectorSelected(blockId: string): boolean {
    const sel = this.canvas.selectedRingBlock();
    const host = this.ring() ?? this.rectLayer();
    return Boolean(host && sel && sel.elementId === host.id && sel.blockId === blockId);
  }

  protected updateSectorBlock(blockId: string, patch: Partial<SectorBlock>): void {
    const el = this.ring();
    if (!el) {
      return;
    }
    this.canvas.update(el.id, {
      blocks: el.blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block)),
    });
  }

  protected setSectorBlockColor(blockId: string, fillColor: string): void {
    this.updateSectorBlock(blockId, { fillColor });
  }

  protected removeSectorBlock(blockId: string): void {
    const el = this.ring();
    if (!el) {
      return;
    }
    const remaining = el.blocks.filter((block) => block.id !== blockId);
    if (remaining.length === 0) {
      return;
    }
    const step = 360 / remaining.length;
    const blocks = remaining.map((block, index) => ({
      ...block,
      startAngleDeg: -90 + step * index,
      endAngleDeg: -90 + step * (index + 1),
    }));
    this.canvas.update(el.id, { blocks });
    this.canvas.selectElement(el.id);
  }

  protected redistributeRingBlocks(): void {
    const el = this.ring();
    if (!el || el.blocks.length < 2) {
      return;
    }
    const step = 360 / el.blocks.length;
    this.canvas.update(el.id, {
      blocks: el.blocks.map((block, index) => ({
        ...block,
        startAngleDeg: -90 + step * index,
        endAngleDeg: -90 + step * (index + 1),
      })),
    });
  }

  protected addRingBlock(): void {
    const el = this.ring();
    if (!el || el.blocks.length >= 24) {
      return;
    }
    const sample = el.blocks[0];
    const nextCount = el.blocks.length + 1;
    const step = 360 / nextCount;
    const block: SectorBlock = {
      id: nestedId('sector'),
      code: `B${String(nextCount).padStart(2, '0')}`,
      startAngleDeg: 0,
      endAngleDeg: 0,
      rows: sample?.rows ?? 4,
      seatsPerRow: sample?.seatsPerRow ?? 12,
      seatLayout: sample?.seatLayout
        ? { ...sample.seatLayout }
        : createDefaultSeatLayout(sample?.rows ?? 4, sample?.seatsPerRow ?? 12, el.rowLabelStyle),
    };
    const blocks = [...el.blocks, block].map((item, index) => ({
      ...item,
      startAngleDeg: -90 + step * index,
      endAngleDeg: -90 + step * (index + 1),
    }));
    this.canvas.update(el.id, { blocks });
  }

  protected sectorSeatTotal(block: SectorBlock): number {
    const ring = this.ring();
    return visibleSeatCount(block, ring?.rowLabelStyle ?? 'letter');
  }

  protected defaultSectorFill(): string {
    return this.ring()?.style.fillColor ?? '#f3e8ff';
  }

  protected setSectorCount(count: number): void {
    const el = this.ring();
    if (!el) {
      return;
    }
    const safe = Math.max(1, Math.min(24, Math.round(count)));
    const sample = el.blocks[0];
    const rows = sample?.rows ?? 4;
    const seatsPerRow = sample?.seatsPerRow ?? 12;
    const step = 360 / safe;
    const blocks: SectorBlock[] = Array.from({ length: safe }, (_, i) => {
      const existing = el.blocks[i];
      return {
        id: existing?.id ?? nestedId('sector'),
        code: existing?.code ?? `B${String(i + 1).padStart(2, '0')}`,
        label: existing?.label,
        fillColor: existing?.fillColor,
        rowLabelStyle: existing?.rowLabelStyle,
        seatLayout: existing?.seatLayout,
        startAngleDeg: -90 + step * i,
        endAngleDeg: -90 + step * (i + 1),
        rows: existing?.rows ?? rows,
        seatsPerRow: existing?.seatsPerRow ?? seatsPerRow,
      };
    });
    this.canvas.update(el.id, { blocks });
    this.canvas.selectElement(el.id);
    this.expandedSectors.set(new Set());
  }

  protected ringRows(): number {
    return this.ring()?.blocks[0]?.rows ?? 0;
  }

  protected ringSeats(): number {
    return this.ring()?.blocks[0]?.seatsPerRow ?? 0;
  }

  protected setRectSeats(rows: number, seatsPerRow: number): void {
    const el = this.rectLayer();
    if (el) {
      this.canvas.update(el.id, {
        blocks: el.blocks.map((b) => ({ ...b, rows, seatsPerRow })),
      });
    }
  }

  protected addRectBlock(side: RectSide): void {
    const el = this.rectLayer();
    if (!el) {
      return;
    }
    const sample = el.blocks[0];
    const block: RectBlock = {
      id: nestedId('rblock'),
      code: `B${String(el.blocks.length + 1).padStart(2, '0')}`,
      side,
      rows: sample?.rows ?? 3,
      seatsPerRow: sample?.seatsPerRow ?? 10,
    };
    this.canvas.update(el.id, { blocks: [...el.blocks, block] });
  }

  protected removeRectBlock(blockId: string): void {
    const el = this.rectLayer();
    if (el) {
      this.canvas.update(el.id, { blocks: el.blocks.filter((b) => b.id !== blockId) });
    }
  }

  protected rectRows(): number {
    return this.rectLayer()?.blocks[0]?.rows ?? 0;
  }

  protected rectSeats(): number {
    return this.rectLayer()?.blocks[0]?.seatsPerRow ?? 0;
  }

  protected readonly rectSides: RectSide[] = ['top', 'bottom', 'left', 'right'];

  protected num(value: string): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  protected autoLabelSize(): number {
    const c = this.center();
    if (!c) {
      return 12;
    }
    const { width, height } = this.canvas.canvas();
    const w = (c.size.wPct / 100) * width;
    const h = (c.size.hPct / 100) * height;
    return Math.round(Math.min(w, h) * 0.18);
  }

  // --- Custom block seating controls ---

  protected rowLabelForBlock(block: CustomShapeSeatBlock, index: number): string {
    const style = block.rowLabelStyle ?? 'letter';
    return rowLabel(index, style);
  }

  protected blockTotalSeats(block: CustomShapeSeatBlock): number {
    return totalSeatsInRowCounts(block.seatLayout?.rowSeatCounts ?? []);
  }

  protected spreadPreview(block: CustomShapeSeatBlock): string {
    const counts = buildRowSeatCountsFromTotal(this.blockTotalSeats(block), block.seatsPerRow);
    return counts.join(' + ');
  }

  protected updateBlockTotalSeats(blockId: string, total: number): void {
    const el = this.center();
    if (!el || !el.customSeatBlocks) {
      return;
    }
    const block = el.customSeatBlocks.find((b) => b.id === blockId);
    if (!block) {
      return;
    }
    const safeTotal = Math.max(1, Math.min(500, Math.round(total)));
    const nextCounts = buildRowSeatCountsFromTotal(safeTotal, block.seatsPerRow);
    const nextCurves = Array.from(
      { length: nextCounts.length },
      (_, i) => block.seatLayout?.rowCurveDegs?.[i] ?? 0,
    );

    this.canvas.updateCustomSeatBlock(el.id, blockId, {
      rows: nextCounts.length,
      seatLayout: {
        rows: nextCounts.length,
        rowSeatCounts: nextCounts,
        rowCurveDegs: nextCurves,
      },
    });
  }

  protected updateBlockSeatsPerRow(blockId: string, seatsPerRow: number): void {
    const el = this.center();
    if (!el || !el.customSeatBlocks) {
      return;
    }
    const block = el.customSeatBlocks.find((b) => b.id === blockId);
    if (!block) {
      return;
    }
    const safeSeats = Math.max(1, Math.min(100, seatsPerRow));
    const total = this.blockTotalSeats(block);
    const nextCounts = buildRowSeatCountsFromTotal(total, safeSeats);
    const nextCurves = Array.from(
      { length: nextCounts.length },
      (_, i) => block.seatLayout?.rowCurveDegs?.[i] ?? 0,
    );

    this.canvas.updateCustomSeatBlock(el.id, blockId, {
      seatsPerRow: safeSeats,
      rows: nextCounts.length,
      seatLayout: {
        seatsPerRow: safeSeats,
        rows: nextCounts.length,
        rowSeatCounts: nextCounts,
        rowCurveDegs: nextCurves,
      },
    });
  }

  protected updateBlockRowSeatCount(blockId: string, rowIndex: number, count: number): void {
    const el = this.center();
    if (!el || !el.customSeatBlocks) {
      return;
    }
    const block = el.customSeatBlocks.find((b) => b.id === blockId);
    if (!block || !block.seatLayout) {
      return;
    }
    const safeCount = Math.max(1, Math.min(100, count));
    const currentCounts = block.seatLayout.rowSeatCounts ?? [];
    const currentTotal = totalSeatsInRowCounts(currentCounts);
    const oldRow = currentCounts[rowIndex] ?? 0;
    const newTotal = currentTotal - oldRow + safeCount;
    const nextCounts = buildRowSeatCountsFromTotal(newTotal, block.seatsPerRow);
    const nextCurves = Array.from(
      { length: nextCounts.length },
      (_, i) => block.seatLayout?.rowCurveDegs?.[i] ?? 0,
    );

    this.canvas.updateCustomSeatBlock(el.id, blockId, {
      rows: nextCounts.length,
      seatLayout: {
        rows: nextCounts.length,
        rowSeatCounts: nextCounts,
        rowCurveDegs: nextCurves,
      },
    });
  }

  protected updateBlockRowCurve(blockId: string, rowIndex: number, curve: number): void {
    const el = this.center();
    if (!el || !el.customSeatBlocks) {
      return;
    }
    const block = el.customSeatBlocks.find((b) => b.id === blockId);
    if (!block?.seatLayout) {
      return;
    }
    const safeCurve = Math.max(-50, Math.min(50, curve));
    const currentCurves = Array.from({ length: block.rows }, (_, i) => block.seatLayout!.rowCurveDegs?.[i] ?? 0);
    currentCurves[rowIndex] = safeCurve;

    this.canvas.updateCustomSeatBlock(el.id, blockId, {
      seatLayout: {
        rowCurveDegs: currentCurves,
      },
    });
  }

  protected startTablePlacement(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.seedTableCreateWizardDrafts(el);
    this.selectedTableCategoryId.set('');
    this.diningLayoutRestoreSnapshot.set(extractDiningSnapshot(el));
    this.resetDiningImageUploadState();
    this.resetManualTablePlacementUi();
    this.canvas.cancelTablePlacement();
    this.autoTableWizardOpen.set(false);
    this.tableGridWizardOpen.set(false);
    this.tableCreateWizardOpen.set(false);
    this.diningWizardStep.set(1);
    this.syncManualPlacementDefaults();
    this.manualTablePlacementOpen.set(true);
    this.tablePlacementPhase.set('measure');
  }

  /** After measurements: arm canvas clicks so the next click inside the block drops a table. */
  protected continueTablePlacementToCanvas(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.syncManualPlacementDefaults();
    this.manualTablePlacementOpen.set(true);
    if (!this.canvas.startTablePlacement(el.id)) {
      this.tablePlacementPhase.set('measure');
      this.canvas.tableGapRuleAlert.set(
        'This block outline is not valid for placing tables. Finish drawing the block first.',
      );
      return;
    }
    this.tablePlacementPhase.set('place');
  }

  private resetManualTablePlacementUi(): void {
    this.manualTablePlacementOpen.set(false);
    this.tablePlacementPhase.set('measure');
  }

  /**
   * Keep placement drafts in a canvas signal only — do not rewrite the centerpiece
   * on every keystroke (that recreates the sidebar DOM and jumps the page up).
   */
  private syncManualPlacementDefaults(): void {
    this.canvas.setTablePlacementDefaults({
      shape: this.draftTableShape(),
      widthM: this.draftTableWidthM(),
      depthM: this.draftTableDepthM(),
      seats: this.draftTableSeats(),
      gapM: this.draftTableGapM(),
      chairWidthM: this.draftChairWidth(),
      chairLengthM: this.draftChairLength(),
    });
  }

  protected onManualPlacementCategoryChange(categoryId: string): void {
    this.onTableCategoryChange(categoryId);
    this.syncManualPlacementDefaults();
  }

  protected onManualPlacementShapeChange(shape: DiningTableShape): void {
    this.draftTableShape.set(shape);
    this.switchToCustomTableCategoryIfNeeded();
    this.capDraftTableSeatsToMax();
    this.syncManualPlacementDefaults();
  }

  protected onManualPlacementDimChange(field: 'width' | 'depth', value: string | number): void {
    const n = this.num(String(value));
    if (field === 'width') {
      this.draftTableWidthM.set(n);
    } else {
      this.draftTableDepthM.set(n);
    }
    this.switchToCustomTableCategoryIfNeeded();
    this.syncManualPlacementDefaults();
  }

  /** Clamp seats after the user leaves the size field — avoids mid-typing jump. */
  protected onManualPlacementDimBlur(): void {
    this.capDraftTableSeatsToMax();
    this.syncManualPlacementDefaults();
  }

  protected onManualPlacementSeatsChange(value: string | number): void {
    const maxVal = this.maxDraftTableSeats();
    this.draftTableSeats.set(Math.max(1, Math.min(maxVal, Math.round(this.num(String(value))))));
    this.switchToCustomTableCategoryIfNeeded();
    this.syncManualPlacementDefaults();
  }

  protected adjustManualPlacementSeats(delta: number): void {
    const maxVal = this.maxDraftTableSeats();
    this.draftTableSeats.update((v) => Math.max(1, Math.min(maxVal, v + delta)));
    this.switchToCustomTableCategoryIfNeeded();
    this.syncManualPlacementDefaults();
  }

  protected onManualPlacementGapChange(value: string | number): void {
    this.draftTableGapM.set(Math.max(0, this.num(String(value))));
    this.switchToCustomTableCategoryIfNeeded();
    this.syncManualPlacementDefaults();
    this.canvas.clearTableGapRuleAlert();
  }

  protected updateTableGapRule(value: string | number): void {
    const el = this.center();
    if (!el) {
      return;
    }
    const gapM = Math.max(0, this.num(String(value)));
    this.draftTableGapM.set(gapM);
    this.canvas.update(el.id, { defaultTableGapM: gapM });
    this.canvas.clearTableGapRuleAlert();
  }

  protected dismissTableGapRuleAlert(): void {
    this.canvas.clearTableGapRuleAlert();
  }

  protected finishTablePlacementFlow(): void {
    const el = this.center();
    if (el) {
      const draft = this.canvas.tablePlacementDefaults();
      this.canvas.update(el.id, {
        tablePlacementMode: undefined,
        ...(draft
          ? {
              defaultDiningTableShape: draft.shape,
              defaultTableWidthM: draft.widthM,
              defaultTableDepthM: draft.depthM,
              defaultTableSeats: draft.seats,
              defaultTableGapM: draft.gapM,
              chairWidthM: draft.chairWidthM,
              chairLengthM: draft.chairLengthM,
            }
          : {}),
      });
    }
    this.diningLayoutRestoreSnapshot.set(null);
    this.resetManualTablePlacementUi();
    this.canvas.cancelTablePlacement();
    this.diningWizardStep.set(1);
  }

  protected cancelTablePlacementFlow(): void {
    const el = this.center();
    const snapshot = this.diningLayoutRestoreSnapshot();
    if (el && snapshot) {
      this.canvas.update(el.id, {
        ...diningSnapshotToPatch(snapshot),
        tablePlacementMode: undefined,
      });
    } else if (el) {
      this.canvas.update(el.id, { tablePlacementMode: undefined });
    }
    this.diningLayoutRestoreSnapshot.set(null);
    this.resetManualTablePlacementUi();
    this.canvas.cancelTablePlacement();
  }

  protected startDiningImageUpload(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.seedTableCreateWizardDrafts(el);
    this.diningLayoutRestoreSnapshot.set(extractDiningSnapshot(el));
    this.tableGridWizardOpen.set(false);
    this.tableCreateWizardOpen.set(false);
    this.autoTableWizardOpen.set(false);
    this.diningWizardStep.set(1);
    this.resetDiningImageUploadState();
    this.resetManualTablePlacementUi();
    this.canvas.cancelTablePlacement();
    this.canvas.update(el.id, {
      diningTables: undefined,
      diningStage: undefined,
      diningFoodPrepare: undefined,
      diningServiceRoutes: undefined,
      appliedDiningLayoutTemplateId: undefined,
      tablePlacementMode: undefined,
      tableGridMode: undefined,
    });
    this.diningImageUploadOpen.set(true);
  }

  protected async onDiningImageFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    await this.analyzeDiningImageFile(file);
  }

  protected async onDiningImageDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    if (!isDiningImageFile(file)) {
      this.diningImageUploadError.set('Please drop a PNG, JPG, WEBP, or SVG floor plan image.');
      return;
    }
    await this.analyzeDiningImageFile(file);
  }

  private async analyzeDiningImageFile(file: File): Promise<void> {
    const el = this.center();
    if (!el) {
      return;
    }

    this.diningImageUploadAnalyzing.set(true);
    this.diningImageUploadError.set(null);
    this.diningImageUploadAnalyzed.set(false);

    try {
      if (!isDiningImageFile(file)) {
        throw new Error('Please choose an image file (PNG, JPG, WEBP, or SVG).');
      }

      // Rasterize first (SVG → PNG) so analysis + in-block overlay both work reliably.
      const raster = await rasterizeDiningImageFile(file);
      const detection = detectDiningLayoutFromImageData(raster.imageData, raster.width, raster.height);
      if (detection.tables.length === 0 && detection.features.length === 0) {
        throw new Error(
          'Could not detect tables or features in this image. Try a clearer floor plan with distinct table shapes.',
        );
      }

      const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
      const patch = buildDiningLayoutFromImageDetection(el, rect, detection, {
        shape: this.draftTableShape(),
        seats: this.draftTableSeats(),
        widthM: this.draftTableWidthM(),
        depthM: this.draftTableDepthM(),
        stageWidthM: this.draftStageWidthM(),
        stageDepthM: this.draftStageDepthM(),
        foodPrepWidthM: this.draftFoodPrepWidthM(),
        foodPrepDepthM: this.draftFoodPrepDepthM(),
        gapM: this.draftTableGapM(),
        referenceImageDataUrl: raster.dataUrl,
        referenceImageName: file.name,
      });

      this.canvas.update(el.id, patch);

      if (this.canvas.blockWorkspaceId() === el.id) {
        queueMicrotask(() => this.canvas.refitBlockWorkspaceView());
      }

      // Sync draft seats to detected chair-dot counts so Save won't re-inflate defaults.
      if (typeof patch.defaultTableSeats === 'number') {
        this.draftTableSeats.set(patch.defaultTableSeats);
      }

      const prev = this.diningImageUploadPreviewUrl();
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      this.diningImageUploadPreviewUrl.set(raster.dataUrl);
      this.diningImageDetection.set(detection);
      this.diningImageUploadAnalyzed.set(true);

      const activeFeatures: string[] = [];
      if (patch.diningStage) {
        activeFeatures.push('stage');
      }
      if (patch.diningFoodPrepare) {
        activeFeatures.push('foodprepare');
      }
      if (patch.diningExit) {
        activeFeatures.push('exit');
      }
      if ((patch.diningServiceRoutes?.length ?? 0) > 0) {
        activeFeatures.push('serviceroute');
      }
      if (activeFeatures.length > 0) {
        this.enabledDiningFeatures.set(activeFeatures);
        this.draftDiningFeatures.set(activeFeatures);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Image analysis failed.';
      this.diningImageUploadError.set(message);
      this.diningImageDetection.set(null);
      this.diningImageUploadAnalyzed.set(false);
    } finally {
      this.diningImageUploadAnalyzing.set(false);
    }
  }

  protected cancelDiningImageUpload(): void {
    const el = this.center();
    const snapshot = this.diningLayoutRestoreSnapshot();
    if (el && snapshot) {
      this.canvas.update(el.id, {
        ...diningSnapshotToPatch(snapshot),
        tablePlacementMode: undefined,
      });
    }
    this.diningLayoutRestoreSnapshot.set(null);
    this.resetDiningImageUploadState();
    this.canvas.cancelTablePlacement();
  }

  protected saveDiningImageLayout(): void {
    const el = this.center();
    if (!el || !this.diningImageUploadAnalyzed()) {
      this.diningImageUploadError.set('Upload and analyze a floor plan image before saving.');
      return;
    }

    this.canvas.update(el.id, {
      appliedDiningLayoutTemplateId: 'image-upload',
      tablePlacementMode: undefined,
      tableGridMode: undefined,
      chairWidthM: this.draftChairWidth(),
      chairLengthM: this.draftChairLength(),
      defaultTableSeats: this.draftTableSeats(),
      defaultDiningTableShape: this.draftTableShape(),
      defaultTableWidthM: this.draftTableWidthM(),
      defaultTableDepthM: this.draftTableDepthM(),
      defaultTableGapM: this.draftTableGapM(),
    });

    this.diningLayoutRestoreSnapshot.set(null);
    this.resetDiningImageUploadState();
  }

  private resetDiningImageUploadState(): void {
    const prev = this.diningImageUploadPreviewUrl();
    if (prev) {
      URL.revokeObjectURL(prev);
    }
    this.diningImageUploadOpen.set(false);
    this.diningImageUploadAnalyzing.set(false);
    this.diningImageUploadError.set(null);
    this.diningImageUploadAnalyzed.set(false);
    this.diningImageUploadPreviewUrl.set(null);
    this.diningImageDetection.set(null);
  }

  protected openBlockWorkspace(): void {
    const el = this.center();
    if (!el || !isCustomizableBlock(el)) {
      return;
    }
    this.canvas.enterBlockWorkspace(el.id);
  }

  protected startTableGridWizard(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.syncBlockPhysicalDimsFromMeasuredSides(el.id);
    this.canvas.zoomBlockWorkspaceForTableEditing(el.id);
    this.resetManualTablePlacementUi();
    this.canvas.cancelTablePlacement();
    this.tableCreateWizardOpen.set(false);
    this.tableGridWizardError.set(null);
    this.draftTableShape.set(resolveDefaultTableShape(el));
    this.draftTableSeats.set(
      clampTableSeats(resolveDefaultTableSeats(el), el, {
        shape: resolveDefaultTableShape(el),
        widthM: resolveDefaultTableWidthM(el),
        depthM: resolveDefaultTableDepthM(el),
      }),
    );
    this.draftTableWidthM.set(resolveDefaultTableWidthM(el));
    this.draftTableDepthM.set(resolveDefaultTableDepthM(el));
    this.draftTableGapM.set(resolveDefaultTableGapM(el));
    this.draftServiceRouteRequired.set('no');
    this.draftServiceRouteClearanceM.set(
      el.diningServiceRouteClearanceM ?? DEFAULT_DINING_LAYOUT_RULES.serviceRouteClearanceM,
    );
    this.tableGridWizardOpen.set(true);
  }

  protected startTableCreateWizard(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.seedTableCreateWizardDrafts(el);
    this.replacingFixedLayout.set(false);
    this.diningLayoutRestoreSnapshot.set(extractDiningSnapshot(el));
    this.resetDiningImageUploadState();
    this.resetManualTablePlacementUi();
    this.canvas.cancelTablePlacement();
    this.autoTableWizardOpen.set(false);

    // Clear centerpiece tables for Step 1
    this.canvas.update(el.id, {
      diningTables: undefined
    });

    this.templatesGenerated.set(false);
    this.generatedTemplates.set([]);
    this.selectedPreviewTemplateId.set(null);
    this.selectedTableCategoryId.set('');
    this.tableCategorySaveName.set('');
    this.tableCategoryError.set(null);
    this.draftTableShapeMode.set('single');
    this.draftTableMix.set([]);
    this.tableCreateWizardOpen.set(true);
    this.diningWizardStep.set(2);
    this.canvas.setDiningAccessPointsLocked(false);
    this.accessPointsError.set(null);
  }

  /** Remove the fixed dining layout completely (tables, stage, food prep, exit, routes). */
  protected clearFixedDiningLayout(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.update(el.id, {
      diningTables: undefined,
      diningStage: undefined,
      diningFoodPrepare: undefined,
      diningEntrance: undefined,
      diningExit: undefined,
      diningSharedAccessPoint: undefined,
      diningServiceRoutes: undefined,
      diningLayoutReferenceImage: undefined,
      appliedDiningLayoutTemplateId: undefined,
      tableGridMode: undefined,
      tableGridRows: undefined,
      tableGridColumns: undefined,
      tablePlacementMode: undefined,
    });
    this.enabledDiningFeatures.set([]);
    this.replacingFixedLayout.set(false);
    this.diningLayoutRestoreSnapshot.set(null);
    this.tableCreateWizardOpen.set(false);
    this.diningWizardStep.set(1);
    this.templatesGenerated.set(false);
    this.generatedTemplates.set([]);
    this.selectedPreviewTemplateId.set(null);
    this.tableGridWizardError.set(null);
    this.canvas.clearTableGapRuleAlert();
    this.resetManualTablePlacementUi();
    this.canvas.cancelTablePlacement();
    this.canvas.selectDiningStage(false);
    this.canvas.selectDiningFoodPrepare(false);
  }

  /** Open the layout template picker to replace an already-fixed auto layout. */
  protected startLayoutTemplateChange(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.seedTableCreateWizardDrafts(el);
    this.replacingFixedLayout.set(true);
    this.diningLayoutRestoreSnapshot.set(extractDiningSnapshot(el));
    this.tableGridWizardError.set(null);
    this.tableCreateWizardOpen.set(true);
    this.diningWizardStep.set(DINING_WIZARD_TOTAL_STEPS);
    this.generateDiningTemplates();
    if (this.generatedTemplates().length === 0) {
      return;
    }
    const appliedId = el.appliedDiningLayoutTemplateId;
    if (appliedId && this.generatedTemplates().some((template) => template.id === appliedId)) {
      // Re-preview the currently fixed pattern so Fix Layout stays on that card.
      this.previewDiningTemplate(appliedId);
    }
  }

  private seedTableCreateWizardDrafts(target: CenterpieceElement): void {
    // Metre-sized items (stage, entrance, tables) are only drawn to scale once the block itself
    // knows its real metres, so recover them from the measured sides before seeding the drafts.
    this.canvas.syncBlockPhysicalDimsFromMeasuredSides(target.id);
    const current = this.center();
    const el = current?.id === target.id ? current : target;
    this.canvas.zoomBlockWorkspaceForTableEditing(el.id);
    this.diningWizardBlockId.set(el.id);
    this.tableGridWizardOpen.set(false);
    this.tableGridWizardError.set(null);
    this.draftTableShape.set(resolveDefaultTableShape(el));
    this.draftTableSeats.set(
      clampTableSeats(resolveDefaultTableSeats(el), el, {
        shape: resolveDefaultTableShape(el),
        widthM: resolveDefaultTableWidthM(el),
        depthM: resolveDefaultTableDepthM(el),
      }),
    );
    this.draftTableWidthM.set(resolveDefaultTableWidthM(el));
    this.draftTableDepthM.set(resolveDefaultTableDepthM(el));
    this.draftChairLength.set(resolveChairLengthM(el));
    this.draftChairWidth.set(resolveChairWidthM(el));
    this.draftTableGapM.set(resolveDefaultTableGapM(el));
    this.draftStageClearanceM.set(
      el.diningStageClearanceM ?? DEFAULT_DINING_LAYOUT_RULES.stageClearanceM,
    );
    this.draftFoodPrepClearanceM.set(
      el.diningFoodPrepClearanceM ?? DEFAULT_DINING_LAYOUT_RULES.foodPrepClearanceM,
    );
    this.draftAccessClearanceM.set(
      el.diningAccessClearanceM ?? DEFAULT_DINING_LAYOUT_RULES.entranceClearanceM,
    );
    this.draftServiceRouteClearanceM.set(
      el.diningServiceRouteClearanceM ?? DEFAULT_DINING_LAYOUT_RULES.serviceRouteClearanceM,
    );
    this.draftWallClearanceM.set(DEFAULT_DINING_LAYOUT_RULES.wallClearanceM);
    {
      const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
      if (el.diningStage) {
        this.draftStageWidthM.set(el.diningStage.widthM);
        this.draftStageDepthM.set(el.diningStage.depthM);
      } else {
        const fitted = fitDiningFeatureDimsToBlock(
          el,
          rect,
          { widthM: DEFAULT_DINING_STAGE_WIDTH_M, depthM: DEFAULT_DINING_STAGE_DEPTH_M },
          0,
        );
        this.draftStageWidthM.set(fitted.widthM);
        this.draftStageDepthM.set(fitted.depthM);
      }
      if (el.diningFoodPrepare) {
        this.draftFoodPrepWidthM.set(el.diningFoodPrepare.widthM);
        this.draftFoodPrepDepthM.set(el.diningFoodPrepare.depthM);
      } else {
        const fitted = fitDiningFeatureDimsToBlock(
          el,
          rect,
          {
            widthM: DEFAULT_DINING_FOOD_PREPARE_WIDTH_M,
            depthM: DEFAULT_DINING_FOOD_PREPARE_DEPTH_M,
          },
          2,
        );
        this.draftFoodPrepWidthM.set(fitted.widthM);
        this.draftFoodPrepDepthM.set(fitted.depthM);
      }
    }
    this.draftServiceRouteWidthM.set(el.diningServiceRoutes?.[0]?.widthM ?? 1.2);

    const maxVal = this.effectiveMaximumTableCount();
    const currentTableCount = el.diningTables?.length ?? 10;
    this.draftTableCount.set(clampDiningTableCount(currentTableCount, maxVal));

    const active: string[] = [];
    if (hasDiningStage(el)) {
      active.push('stage');
      this.draftStageSide.set(el.diningStage?.sideEdgeId ?? 0);
    } else {
      this.draftStageSide.set(0);
    }
    if (hasDiningFoodPrepare(el)) {
      active.push('foodprepare');
      this.draftFoodPrepareSide.set(el.diningFoodPrepare?.sideEdgeId ?? 2);
    } else {
      this.draftFoodPrepareSide.set(2);
    }
    if (hasDiningExit(el)) {
      active.push('exit');
      this.draftExitSide.set(el.diningExit?.sideEdgeId ?? 1);
    } else {
      this.draftExitSide.set(1);
    }
    if (el.diningServiceRoutes && el.diningServiceRoutes.length > 0) {
      active.push('serviceroute');
    }
    this.draftDiningFeatures.set(active);
  }

  protected useMaxTableCreateCount(): void {
    const maxFill = this.effectiveMaximumTableCount();
    if (maxFill != null && maxFill > 0) {
      this.draftTableCount.set(maxFill);
      this.tableCountAdjustedMessage.set(null);
      this.tableGridWizardError.set(null);
    }
  }

  protected cancelTableGridWizard(): void {
    this.tableGridWizardOpen.set(false);
    this.tableGridWizardError.set(null);
  }

  protected cancelTableCreateWizard(): void {
    const el = this.center();
    const snapshot = this.diningLayoutRestoreSnapshot();
    if (el && snapshot) {
      this.canvas.update(el.id, {
        ...diningSnapshotToPatch(snapshot),
        tablePlacementMode: undefined,
      });
    }
    this.replacingFixedLayout.set(false);
    this.diningLayoutRestoreSnapshot.set(null);
    this.tableCreateWizardOpen.set(false);
    this.diningWizardBlockId.set(null);
    this.diningWizardStep.set(1);
    this.draftTableShapeMode.set('single');
    this.draftTableMix.set([]);
    this.tableGridWizardError.set(null);
    this.accessPointsError.set(null);
    this.templatesGenerated.set(false);
    this.generatedTemplates.set([]);
    this.selectedPreviewTemplateId.set(null);
    this.resetManualTablePlacementUi();
    this.canvas.cancelTablePlacement();
    this.canvas.cancelAccessPointPlacement();
    this.canvas.setDiningAccessPointsLocked(false);
    this.diningSuggestions.clearSession();
  }

  protected reconfigureInputs(): void {
    const el = this.center();
    if (el) {
      this.canvas.update(el.id, {
        diningTables: undefined,
      });
    }
    this.templatesGenerated.set(false);
    this.selectedPreviewTemplateId.set(null);
  }

  protected goToStep(step: number): void {
    if (this.diningWizardStep() === 2 && step !== 2) {
      this.canvas.cancelAccessPointPlacement();
      if (step > 2) {
        this.canvas.setDiningAccessPointsLocked(true);
      }
    }
    if (step === 2) {
      this.canvas.setDiningAccessPointsLocked(false);
    }
    // Before leaving the table/chair step, force sizes into a valid fit.
    if (this.tableCreateWizardOpen() && (this.diningWizardStep() === 4 || step >= 4)) {
      if (this.isMultiShapeMode()) {
        this.rebalanceMixCounts();
      } else {
        this.enforceDiningWizardFitConstraints('table');
      }
    }
    if (step >= 5 && !this.canContinueFromTableMeasurements()) {
      if (this.isMultiShapeMode()) {
        this.tableGridWizardError.set(this.diningTableMixError());
        return;
      }
      this.tableGridWizardError.set(
        this.diningSuggestions.lastError() ?? 'Checking available table capacity...',
      );
      void this.flushOperationalCapacityProbe();
      return;
    }
    if (step === DINING_WIZARD_TOTAL_STEPS) {
      this.generateDiningTemplates();
    }
    this.diningWizardStep.set(step);
  }

  private syncWizardDiningFeaturesToCanvas(silent: boolean): void {
    const el = this.center();
    if (!el) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const patch = diningFeaturesPatchFromDraft(el, rect, this.diningLayoutDraftInputs(el));
    // Reflect fitted sizes in the inputs when the block is smaller than the defaults.
    if (patch.diningStage) {
      this.draftStageWidthM.set(patch.diningStage.widthM);
      this.draftStageDepthM.set(patch.diningStage.depthM);
    }
    if (patch.diningFoodPrepare) {
      this.draftFoodPrepWidthM.set(patch.diningFoodPrepare.widthM);
      this.draftFoodPrepDepthM.set(patch.diningFoodPrepare.depthM);
    }
    if (silent) {
      this.canvas.updateSilent(el.id, patch);
    } else {
      this.canvas.update(el.id, patch);
    }
  }

  private diningLayoutDraftInputs(el: CenterpieceElement): DiningLayoutDraftInputs {
    // A mixed block has no single default table, so the busiest lane supplies the
    // block defaults that later manually-added tables inherit.
    const dominant = this.isMultiShapeMode()
      ? [...this.draftTableMix()].sort((a, b) => b.count - a.count)[0]
      : null;
    return {
      shape: dominant?.shape ?? this.draftTableShape(),
      tableWidthM: dominant?.widthM ?? this.draftTableWidthM(),
      tableDepthM: dominant
        ? dominant.shape === 'round'
          ? dominant.widthM
          : dominant.depthM
        : this.draftTableDepthM(),
      tableGapM: this.draftTableGapM(),
      seats: dominant?.seats ?? this.draftTableSeats(),
      chairWidthM: dominant?.chairWidthM ?? this.draftChairWidth(),
      chairLengthM: dominant?.chairLengthM ?? this.draftChairLength(),
      hasStage: this.isDraftDiningFeatureEnabled('stage'),
      stageWidthM: this.draftStageWidthM(),
      stageDepthM: this.draftStageDepthM(),
      hasFoodPrep: this.isDraftDiningFeatureEnabled('foodprepare'),
      foodPrepWidthM: this.draftFoodPrepWidthM(),
      foodPrepDepthM: this.draftFoodPrepDepthM(),
      hasExit: el.diningExit != null,
      exitSideEdgeId: el.diningExit?.sideEdgeId ?? null,
      exitOffsetAlongEdgeM: el.diningExit?.offsetAlongEdgeM ?? 0,
      tableCount: this.draftTableCount(),
      hasServiceRoute: this.isDraftDiningFeatureEnabled('serviceroute'),
      serviceRouteWidthM: this.draftServiceRouteWidthM(),
      serviceRouteClearanceM: this.draftServiceRouteClearanceM(),
      stageClearanceM: this.draftStageClearanceM(),
      foodPrepClearanceM: this.draftFoodPrepClearanceM(),
      accessClearanceM: this.draftAccessClearanceM(),
    };
  }

  private diningWizardGenerationDraft(tableCount = this.draftTableCount()) {
    const mixLanes = this.isMultiShapeMode()
      ? this.draftTableMix()
          .filter((entry) => entry.count > 0)
          .map((entry) => ({
            shape: entry.shape,
            tableWidthM: entry.widthM,
            tableDepthM: entry.shape === 'round' ? entry.widthM : entry.depthM,
            seats: entry.seats,
            chairWidthM: entry.chairWidthM,
            chairLengthM: entry.chairLengthM,
            count: entry.count,
          }))
      : undefined;
    return {
      mix: mixLanes && mixLanes.length > 0 ? mixLanes : undefined,
      shape: this.draftTableShape(),
      tableWidthM: this.draftTableWidthM(),
      tableDepthM: this.draftTableDepthM(),
      tableGapM: this.draftTableGapM(),
      seats: this.draftTableSeats(),
      chairWidthM: this.draftChairWidth(),
      chairLengthM: this.draftChairLength(),
      tableCount,
      hasStage: this.isDraftDiningFeatureEnabled('stage'),
      hasFoodPrep: this.isDraftDiningFeatureEnabled('foodprepare'),
      stageWidthM: this.draftStageWidthM(),
      stageDepthM: this.draftStageDepthM(),
      stageSide: this.draftStageSide(),
      foodPrepWidthM: this.draftFoodPrepWidthM(),
      foodPrepDepthM: this.draftFoodPrepDepthM(),
      foodPrepSide: this.draftFoodPrepareSide(),
      stageClearanceM: this.draftStageClearanceM(),
      foodPrepClearanceM: this.draftFoodPrepClearanceM(),
      accessClearanceM: this.draftAccessClearanceM(),
      serviceRouteClearanceM: this.draftServiceRouteClearanceM(),
      wallClearanceM: this.draftWallClearanceM(),
    };
  }

  protected generateDiningTemplates(): void {
    void this.runDiningLayoutGeneration({ refresh: false, relocateFeatures: false });
  }

  protected refreshDiningDesigns(): void {
    void this.runDiningLayoutGeneration({ refresh: true, relocateFeatures: false });
  }

  protected redesignDiningLayout(): void {
    void this.runDiningLayoutGeneration({ refresh: true, relocateFeatures: false });
  }

  protected retryDiningDesigns(): void {
    void this.runDiningLayoutGeneration({
      refresh: this.templatesGenerated(),
      relocateFeatures: false,
    });
  }

  private async runDiningLayoutGeneration(opts: {
    refresh: boolean;
    relocateFeatures: boolean;
  }): Promise<void> {
    const startEl = this.center();
    if (!startEl) {
      return;
    }

    if (this.isMultiShapeMode()) {
      this.rebalanceMixCounts();
      this.syncWizardDiningFeaturesToCanvas(true);
    } else {
      this.enforceDiningWizardFitConstraints('table');
      this.syncWizardDiningFeaturesToCanvas(true);
      await this.flushOperationalCapacityProbe();
      this.draftTableCount.set(
        clampDiningTableCount(this.draftTableCount(), this.effectiveMaximumTableCount()),
      );
    }
    const el = this.center();
    if (!el) {
      return;
    }

    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    this.tableGridWizardError.set(null);
    if (!opts.refresh) {
      this.templatesGenerated.set(false);
      this.selectedPreviewTemplateId.set(null);
      this.diningSuggestions.clearSuggestions();
    }

    const request = buildDiningLayoutGenerationRequest({
      element: el,
      rect,
      draft: this.diningWizardGenerationDraft(),
      seed: this.diningSuggestions.nextSeed(),
      excludeFingerprints: opts.refresh ? this.diningSuggestions.excludedFingerprints() : [],
      categories: this.tableCategoryService.list(),
      selectedCategoryId: this.selectedTableCategoryId(),
      relocateFeatures: opts.relocateFeatures,
    });

    const result = await this.diningSuggestions.generate(request);
    if (result.ok && result.layouts.length > 0) {
      const cards = result.layouts.map(mapGeneratedLayoutToDescriptor);
      this.generatedTemplates.set(cards);
      this.templatesGenerated.set(true);
      this.tableGridWizardError.set(null);
      this.previewDiningTemplate(cards[0].id);
      return;
    }

    if (result.transportFailed) {
      this.tableGridWizardError.set(
        opts.refresh && this.templatesGenerated()
          ? 'Could not generate new designs. Retry.'
          : 'Layout generation service is unavailable.',
      );
      if (!opts.refresh) {
        this.generatedTemplates.set([]);
        this.templatesGenerated.set(false);
      }
      return;
    }

    const hints = result.diagnostics?.hints?.filter(Boolean).join(' ') ?? '';
    this.tableGridWizardError.set(
      opts.refresh && this.templatesGenerated()
        ? 'Could not generate new designs. Retry.'
        : `${result.diagnostics?.message ?? 'No valid layout could be generated with the current settings.'} ${hints}`.trim(),
    );
    if (!opts.refresh) {
      this.generatedTemplates.set([]);
      this.templatesGenerated.set(false);
    }
  }

  /** Click a template card — preview that layout on the canvas immediately. */
  protected previewDiningTemplate(templateId: string): void {
    this.selectedPreviewTemplateId.set(templateId);
    this.applyDiningTemplateLayout(templateId, false);
  }

  /** Commit the previewed layout permanently and close the wizard. */
  protected fixDiningLayout(): void {
    const templateId = this.selectedPreviewTemplateId();
    if (!templateId) {
      this.tableGridWizardError.set('Select a layout pattern to preview, then click Fix Layout.');
      return;
    }
    const el = this.center();
    // Canvas already shows the selected template from preview — fix that exact pattern.
    if (el && (el.diningTables?.length ?? 0) > 0) {
      this.commitFixedDiningLayout(templateId);
      return;
    }
    this.applyDiningTemplateLayout(templateId, true);
  }

  /** Persist the currently previewed canvas layout as the fixed pattern. */
  private commitFixedDiningLayout(templateId: string): void {
    const el = this.center();
    if (!el) {
      return;
    }
    const tmpl = this.generatedTemplates().find((t) => t.id === templateId);
    this.canvas.update(el.id, {
      appliedDiningLayoutTemplateId: templateId,
      diningLayoutGeneration: tmpl
        ? {
            family: tmpl.family ?? 'regular-grid',
            score: tmpl.score ?? 0,
            seed: tmpl.seed ?? 0,
            fingerprint: tmpl.fingerprint ?? '',
          }
        : el.diningLayoutGeneration,
    });
    this.enabledDiningFeatures.set(this.draftDiningFeatures());
    this.replacingFixedLayout.set(false);
    this.diningLayoutRestoreSnapshot.set(null);
    this.tableCreateWizardOpen.set(false);
    this.diningWizardStep.set(1);
    this.templatesGenerated.set(false);
    this.generatedTemplates.set([]);
    this.selectedPreviewTemplateId.set(null);
    this.tableGridWizardError.set(null);

    if (this.isDraftDiningFeatureEnabled('serviceroute')) {
      this.startServiceRouteDrawing();
    }
  }

  private applyDiningTemplateLayout(templateId: string, commit: boolean): void {
    const el = this.center();
    if (!el) {
      return;
    }

    const tmpl = this.generatedTemplates().find((t) => t.id === templateId);
    if (!tmpl) {
      return;
    }

    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const inputs = this.diningLayoutDraftInputs(el);
    // Keep a user-placed exit edge if they already set one.
    if (el.diningExit != null) {
      inputs.exitSideEdgeId = el.diningExit.sideEdgeId ?? null;
      inputs.exitOffsetAlongEdgeM = el.diningExit.offsetAlongEdgeM ?? 0;
      inputs.hasExit = true;
    }

    const patch = buildDiningLayoutPatchFromTemplate(el, rect, inputs, tmpl);
    if (!patch) {
      // Never ask to change inputs — drop broken cards and preview the next working one.
      const remaining = this.generatedTemplates().filter((t) => t.id !== templateId);
      this.generatedTemplates.set(remaining);
      this.tableGridWizardError.set(null);
      if (remaining.length === 0) {
        this.templatesGenerated.set(false);
        this.selectedPreviewTemplateId.set(null);
        this.tableGridWizardError.set(
          `No working layout for ${this.draftTableCount()} tables × ${this.draftTableSeats()} chairs in this block.`,
        );
        return;
      }
      const nextId = remaining[0].id;
      this.previewDiningTemplate(nextId);
      return;
    }

    this.canvas.update(el.id, patch);
    this.tableGridWizardError.set(null);

    if (!commit) {
      return;
    }

    this.commitFixedDiningLayout(templateId);
  }

  /** @deprecated Use previewDiningTemplate + fixDiningLayout */
  protected applyDiningTemplate(templateId: string): void {
    this.selectedPreviewTemplateId.set(templateId);
    this.applyDiningTemplateLayout(templateId, true);
  }

  protected applyTableCreateWizardDirect(): void {
    const el = this.center();
    if (!el) {
      return;
    }

    // Reuse existing stage side edge if present, otherwise default to 0
    let stageSide = el.diningStage?.sideEdgeId ?? 0;
    // Reuse existing food prepare side edge if present, otherwise default to 2
    let foodPrepareSide = el.diningFoodPrepare?.sideEdgeId ?? 2;

    // 1. Calculate viewpoint angle matching the selected stage side edge to orient the layout
    let viewpointAngle = el.blockViewpointAngleDeg ?? 0;
    if (this.isDraftDiningFeatureEnabled('stage')) {
      const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
      const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
      const edge = logicalMeasureEdgeById(polygon, stageSide);
      if (edge) {
        viewpointAngle = viewpointAngleFromCanvasPoint(rect.cx, rect.cy, edge.midX, edge.midY);
      }
    }

    // 2. Save chair dimensions and updated block viewpoint angle on centerpiece
    this.canvas.update(el.id, {
      chairWidthM: this.draftChairWidth(),
      chairLengthM: this.draftChairLength(),
      defaultTableSeats: this.draftTableSeats(),
      defaultDiningTableShape: this.draftTableShape(),
      defaultTableWidthM: this.draftTableWidthM(),
      defaultTableDepthM: this.draftTableDepthM(),
      defaultTableGapM: this.draftTableGapM(),
      blockViewpointAngleDeg: viewpointAngle,
    });

    // 3. Apply the tables layout (it will read blockViewpointAngleDeg to auto-orient the layout parallel to the stage)
    const error = this.canvas.applyTableGrid(el.id, {
      shape: this.draftTableShape(),
      seats: this.draftTableSeats(),
      widthM: this.draftTableWidthM(),
      depthM: this.draftTableDepthM(),
      gapM: this.draftTableGapM(),
      template: 'grid',
    });

    if (error) {
      this.tableGridWizardError.set(error);
      return;
    }

    // Clean centerpiece's existing active features first
    this.canvas.update(el.id, {
      diningStage: undefined,
      diningFoodPrepare: undefined,
      diningServiceRoutes: undefined
    });

    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());

    // Apply Stage if checked
    let stageSpec: any = undefined;
    if (this.isDraftDiningFeatureEnabled('stage')) {
      stageSpec = createDiningStageOnSide(el, rect, stageSide) ?? undefined;
    }

    // Apply Food Prepare if checked
    let foodPrepSpec: any = undefined;
    if (this.isDraftDiningFeatureEnabled('foodprepare')) {
      foodPrepSpec = createDiningFoodPrepareOnSide(el, rect, foodPrepareSide) ?? undefined;
    }

    // Apply Service Route if checked
    let routesSpec: any[] = [];
    if (this.isDraftDiningFeatureEnabled('serviceroute')) {
      routesSpec = [
        {
          id: 'route_' + Math.random().toString(36).substr(2, 9),
          label: 'Service Route',
          widthM: 1.2,
          points: [
            { xPct: 50, yPct: 15 },
            { xPct: 50, yPct: 85 }
          ]
        }
      ];
    }

    this.canvas.update(el.id, {
      diningStage: stageSpec,
      diningFoodPrepare: foodPrepSpec,
      diningServiceRoutes: routesSpec
    });

    // Synchronize the main enabled features signal
    this.enabledDiningFeatures.set(this.draftDiningFeatures());

    this.tableCreateWizardOpen.set(false);
    this.tableGridWizardError.set(null);
  }



  protected applyTableGrid(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    const error = this.canvas.applyTableGrid(el.id, {
      shape: this.draftTableShape(),
      seats: this.draftTableSeats(),
      widthM: this.draftTableWidthM(),
      depthM: this.draftTableDepthM(),
      gapM: this.draftTableGapM(),
      template: this.draftTableTemplate(),
    });
    if (error) {
      this.tableGridWizardError.set(error);
      return;
    }
    this.tableGridWizardOpen.set(false);
    this.tableGridWizardError.set(null);
  }

  protected applyTableCountGrid(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    const preview = this.tableCreatePreview();
    const tableCount =
      preview && !('error' in preview) ? preview.tableCount : this.draftTableCount();
    const error = this.canvas.applyTableCountGrid(el.id, {
      shape: this.draftTableShape(),
      seats: this.draftTableSeats(),
      widthM: this.draftTableWidthM(),
      depthM: this.draftTableDepthM(),
      gapM: this.draftTableGapM(),
      tableCount,
    });
    if (error) {
      this.tableGridWizardError.set(error);
      return;
    }
    this.tableCreateWizardOpen.set(false);
    this.tableGridWizardError.set(null);
  }

  protected adjustDraftTableSeats(delta: number): void {
    const maxVal = Math.max(1, this.maxDraftTableSeats());
    this.draftTableSeats.update((v) => Math.max(1, Math.min(maxVal, v + delta)));
    this.tableGridWizardError.set(null);
  }

  protected setDraftTableSeats(value: unknown): void {
    const maxVal = Math.max(1, this.maxDraftTableSeats());
    const numVal = parseInt(String(value), 10);
    if (isNaN(numVal)) {
      return;
    }
    this.draftTableSeats.set(Math.max(1, Math.min(maxVal, numVal)));
    this.tableGridWizardError.set(null);
  }

  protected adjustDraftTableCount(delta: number): void {
    if (delta > 0 && !this.canIncreaseDraftTableCount()) {
      return;
    }
    const next = this.draftTableCount() + delta;
    this.draftTableCount.set(clampDiningTableCount(next, this.effectiveMaximumTableCount()));
    this.tableCountAdjustedMessage.set(null);
    this.resetGeneratedTableTemplates();
  }

  protected setDraftTableCount(value: any): void {
    const numVal = parseInt(String(value), 10);
    if (isNaN(numVal)) {
      return;
    }
    const operationalMax = this.effectiveMaximumTableCount();
    if (numVal > this.draftTableCount() && operationalMax == null) {
      return;
    }
    const packMax = this.tableCreateMaxFillCount();
    // Same ceiling as + / − : effective max (validated may exceed local pack).
    const hardMax = operationalMax ?? (packMax >= 1 ? packMax : null);
    this.draftTableCount.set(clampDiningTableCount(numVal, hardMax));
    this.tableCountAdjustedMessage.set(null);
    this.enforceDiningWizardFitConstraints('count');
    this.resetGeneratedTableTemplates();
  }

  /** Keep table count within 1…effective max when capacity shrinks (gap/size/features). */
  protected capDraftTableCountToMax(): void {
    this.enforceDiningWizardFitConstraints('count');
    this.draftTableCount.set(
      clampDiningTableCount(this.draftTableCount(), this.effectiveMaximumTableCount()),
    );
    void this.flushOperationalCapacityProbe();
  }

  protected capDraftTableSeatsToMax(): void {
    const maxVal = Math.max(1, this.maxDraftTableSeats());
    const current = this.draftTableSeats();
    if (current > maxVal) {
      this.draftTableSeats.set(maxVal);
    } else if (current < 1) {
      this.draftTableSeats.set(1);
    }
  }

  protected onTableGridDimsChange(): void {
    this.tableGridWizardError.set(null);
  }

  protected onDiningTableDiameterInput(event: Event): void {
    this.applyDiningTableDimensionEditFromInput(event, 'diameter');
  }

  protected onDiningTableDiameterBlur(event: Event): void {
    this.applyDiningTableDimensionEditFromInput(event, 'diameter');
  }

  protected onDiningTableWidthInput(event: Event): void {
    this.applyDiningTableDimensionEditFromInput(event, 'width');
  }

  protected onDiningTableWidthBlur(event: Event): void {
    this.applyDiningTableDimensionEditFromInput(event, 'width');
  }

  protected onDiningTableDepthInput(event: Event): void {
    this.applyDiningTableDimensionEditFromInput(event, 'depth');
  }

  protected onDiningTableDepthBlur(event: Event): void {
    this.applyDiningTableDimensionEditFromInput(event, 'depth');
  }

  protected onDiningTableGapInput(event: Event): void {
    this.applyDiningTableDimensionEditFromInput(event, 'gap');
  }

  protected onDiningTableGapBlur(event: Event): void {
    this.applyDiningTableDimensionEditFromInput(event, 'gap');
  }

  protected onDiningClearanceInput(
    event: Event,
    kind: 'stage' | 'foodPrep' | 'access' | 'serviceRoute' | 'wall',
  ): void {
    const raw = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(raw)) {
      return;
    }
    const value = Math.max(0, Math.round(raw * 100) / 100);
    switch (kind) {
      case 'stage':
        this.draftStageClearanceM.set(value);
        break;
      case 'foodPrep':
        this.draftFoodPrepClearanceM.set(value);
        break;
      case 'access':
        this.draftAccessClearanceM.set(value);
        break;
      case 'serviceRoute':
        this.draftServiceRouteClearanceM.set(value);
        break;
      case 'wall':
        this.draftWallClearanceM.set(value);
        break;
    }
    this.resetGeneratedTableTemplates();
    if (this.isMultiShapeMode()) {
      this.rebalanceMixCounts();
      return;
    }
    this.enforceDiningWizardFitConstraints('table');
    void this.flushOperationalCapacityProbe();
  }

  protected onDiningChairWidthInput(event: Event): void {
    this.applyDiningTableDimensionEditFromInput(event, 'chairWidth');
  }

  protected onDiningChairWidthBlur(event: Event): void {
    this.applyDiningTableDimensionEditFromInput(event, 'chairWidth');
  }

  protected onDiningChairDepthInput(event: Event): void {
    this.applyDiningTableDimensionEditFromInput(event, 'chairDepth');
  }

  protected onDiningChairDepthBlur(event: Event): void {
    this.applyDiningTableDimensionEditFromInput(event, 'chairDepth');
  }

  protected onTableShapeChange(value: string): void {
    if (value === this.multiShapeSelectValue) {
      if (this.draftTableMix().length === 0) {
        this.draftTableMix.set([this.createMixEntry(this.draftTableShape())]);
      }
      this.draftTableShapeMode.set('multiple');
      this.rebalanceMixCounts(this.draftTableShape());
      this.resetGeneratedTableTemplates();
      return;
    }
    this.draftTableShapeMode.set('single');
    this.draftTableShape.set(value as DiningTableShape);
    this.applyDiningTableDimensionEdit({ source: 'table' });
  }

  /** @deprecated Prefer explicit input handlers; kept for stage/food-prep feature sync triggers. */
  protected onTableCreateDimsChange(): void {
    this.applyDiningTableDimensionEdit({ source: 'table' });
  }

  protected onChairDimsChange(): void {
    this.applyDiningTableDimensionEdit({ source: 'chair' });
  }

  private applyDiningTableDimensionEditFromInput(
    event: Event,
    field: 'diameter' | 'width' | 'depth' | 'gap' | 'chairWidth' | 'chairDepth',
  ): void {
    const input = event.currentTarget as HTMLInputElement | null;
    if (!input) {
      return;
    }
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) {
      return;
    }
    const patch: {
      widthM?: number;
      depthM?: number;
      gapM?: number;
      chairLengthM?: number;
      chairWidthM?: number;
      source: DiningWizardPackPrefer;
    } = {
      source: field === 'chairWidth' || field === 'chairDepth' ? 'chair' : 'table',
    };
    if (field === 'diameter' || field === 'width') {
      patch.widthM = value;
    }
    if (field === 'depth') {
      patch.depthM = value;
    }
    if (field === 'gap') {
      patch.gapM = value;
    }
    if (field === 'chairWidth') {
      patch.chairWidthM = value;
    }
    if (field === 'chairDepth') {
      patch.chairLengthM = value;
    }
    this.applyDiningTableDimensionEdit(patch);
    this.syncDiningNumericInputDisplay(input, this.diningWizardNumericFieldValue(field));
  }

  private diningWizardNumericFieldValue(
    field: 'diameter' | 'width' | 'depth' | 'gap' | 'chairWidth' | 'chairDepth',
  ): number {
    switch (field) {
      case 'diameter':
      case 'width':
        return this.draftTableWidthM();
      case 'depth':
        return this.draftTableDepthM();
      case 'gap':
        return this.draftTableGapM();
      case 'chairWidth':
        return this.draftChairWidth();
      case 'chairDepth':
        return this.draftChairLength();
    }
  }

  private syncDiningNumericInputDisplay(input: HTMLInputElement, metres: number): void {
    const rounded = Math.round(metres * 100) / 100;
    if (!Number.isFinite(input.valueAsNumber) || Math.abs(input.valueAsNumber - rounded) > 0.001) {
      input.value = String(rounded);
    }
  }

  private applyDiningTableDimensionEdit(opts: {
    widthM?: number;
    depthM?: number;
    gapM?: number;
    chairLengthM?: number;
    chairWidthM?: number;
    source: DiningWizardPackPrefer;
  }): void {
    this.switchToCustomTableCategoryIfNeeded();

    // In multi-shape mode only the shared table gap lives outside the lane cards.
    if (this.isMultiShapeMode()) {
      if (opts.gapM != null && Number.isFinite(opts.gapM)) {
        this.draftTableGapM.set(Math.max(0.1, Math.round(opts.gapM * 100) / 100));
        this.rebalanceMixCounts();
        this.resetGeneratedTableTemplates();
      }
      return;
    }

    if (opts.widthM != null && Number.isFinite(opts.widthM)) {
      this.draftTableWidthM.set(opts.widthM);
      if (this.draftTableShape() === 'round') {
        this.draftTableDepthM.set(opts.widthM);
      }
    }
    if (opts.depthM != null && Number.isFinite(opts.depthM)) {
      this.draftTableDepthM.set(opts.depthM);
    }
    if (opts.gapM != null && Number.isFinite(opts.gapM)) {
      const el = this.diningWizardCapacityElement() ?? this.center();
      const roomMax = el
        ? Math.max(resolveBlockWidthM(el), resolveBlockLengthM(el))
        : opts.gapM;
      // Gap larger than the room can never place a second table — clamp to room.
      this.draftTableGapM.set(Math.max(0, Math.min(opts.gapM, roomMax)));
    }
    if (opts.chairLengthM != null && Number.isFinite(opts.chairLengthM)) {
      this.draftChairLength.set(opts.chairLengthM);
    }
    if (opts.chairWidthM != null && Number.isFinite(opts.chairWidthM)) {
      this.draftChairWidth.set(opts.chairWidthM);
    }

    this.enforceDiningWizardFitConstraints(opts.source);

    if (
      opts.source === 'table' &&
      (this.isDraftDiningFeatureEnabled('stage') || this.isDraftDiningFeatureEnabled('foodprepare'))
    ) {
      const widthBeforeSync = this.draftTableWidthM();
      const depthBeforeSync = this.draftTableDepthM();
      const countBeforeSync = this.draftTableCount();
      this.syncWizardDiningFeaturesToCanvas(true);
      if (
        this.draftTableWidthM() !== widthBeforeSync ||
        this.draftTableDepthM() !== depthBeforeSync ||
        this.draftTableCount() !== countBeforeSync
      ) {
        // Stage/Food Prep sync must never revert table drafts — restore if it did.
        this.draftTableWidthM.set(widthBeforeSync);
        this.draftTableDepthM.set(depthBeforeSync);
        this.draftTableCount.set(countBeforeSync);
      }
      this.enforceDiningWizardFitConstraints(opts.source);
    }

    this.resetGeneratedTableTemplates();
    if (opts.source === 'chair') {
      this.tableGridWizardError.set(null);
      this.templatesGenerated.set(false);
      this.generatedTemplates.set([]);
      this.selectedPreviewTemplateId.set(null);
    }
  }

  /**
   * Growing table size drops count first. After 1 table, it shrinks chairs to min then stops.
   * Growing chairs does the inverse. Count changes try to keep the requested number by shrinking size.
   */
  private enforceDiningWizardFitConstraints(prefer: DiningWizardPackPrefer = 'table'): void {
    const el = this.diningWizardCapacityElement();
    if (!el) {
      return;
    }

    const packed = resolveDiningWizardPack(el, {
      ...this.diningWizardCapacityOptions(),
      chairWidthM: this.draftChairWidth(),
      tableCount: this.draftTableCount(),
      prefer,
    });

    if (this.draftTableWidthM() !== packed.widthM) {
      this.draftTableWidthM.set(packed.widthM);
    }
    if (this.draftTableDepthM() !== packed.depthM) {
      this.draftTableDepthM.set(packed.depthM);
    }
    if (this.draftChairLength() !== packed.chairLengthM) {
      this.draftChairLength.set(packed.chairLengthM);
    }
    if (this.draftChairWidth() !== packed.chairWidthM) {
      this.draftChairWidth.set(packed.chairWidthM);
    }
    const requestedCount = this.draftTableCount();
    const effective = this.effectiveMaximumTableCount();
    if (requestedCount !== packed.tableCount) {
      // Local AABB pack under-counts free-rotated stages. If operational/validated
      // capacity already allows the requested count, do not snap the stepper down.
      const keepOperationalCount =
        packed.tableCount < requestedCount &&
        effective != null &&
        requestedCount <= effective;
      if (!keepOperationalCount) {
        this.draftTableCount.set(packed.tableCount);
      }
    }
    if (effective != null && effective >= 1 && this.draftTableCount() > effective) {
      this.draftTableCount.set(effective);
    }

    this.capDraftTableSeatsToMax();
  }

  protected retryOperationalCapacityProbe(): void {
    this.diningSuggestions.lastError.set(null);
    this.capacityProbeKey = '';
    this.scheduleOperationalCapacityProbe(this.diningOperationalCapacityKey());
  }

  private diningOperationalCapacityKey(): string {
    const el = this.diningWizardCapacityElement();
    const opts = this.diningWizardCapacityOptions();
    return diningWizardPhysicalCapacityKey({
      blockId: el?.id ?? '',
      widthM: el ? resolveBlockWidthM(el) : 0,
      depthM: el ? resolveBlockLengthM(el) : 0,
      polygon: (el?.customPoints ?? []).map((p) => ({ x: p.xPct, y: p.yPct })),
      shape: opts.shape,
      tableWidthM: opts.widthM,
      tableDepthM: opts.depthM,
      gapM: opts.gapM,
      chairWidthM: this.draftChairWidth(),
      chairLengthM: opts.chairLengthM,
      seats: this.draftTableSeats(),
      stage: this.isDraftDiningFeatureEnabled('stage')
        ? {
            w: this.draftStageWidthM(),
            d: this.draftStageDepthM(),
            x: el?.diningStage?.xPct ?? 0,
            y: el?.diningStage?.yPct ?? 0,
            r: el?.diningStage?.rotationDeg ?? 0,
          }
        : null,
      food: this.isDraftDiningFeatureEnabled('foodprepare')
        ? {
            w: this.draftFoodPrepWidthM(),
            d: this.draftFoodPrepDepthM(),
            x: el?.diningFoodPrepare?.xPct ?? 0,
            y: el?.diningFoodPrepare?.yPct ?? 0,
            r: el?.diningFoodPrepare?.rotationDeg ?? 0,
          }
        : null,
      entrance: el?.diningEntrance
        ? { x: el.diningEntrance.xPct, y: el.diningEntrance.yPct, w: el.diningEntrance.widthM }
        : el?.diningSharedAccessPoint
          ? {
              x: el.diningSharedAccessPoint.xPct,
              y: el.diningSharedAccessPoint.yPct,
              w: el.diningSharedAccessPoint.widthM,
            }
          : null,
      exit: el?.diningExit
        ? { x: el.diningExit.xPct, y: el.diningExit.yPct, w: el.diningExit.widthM }
        : null,
      stageClearanceM: this.draftStageClearanceM(),
      foodPrepClearanceM: this.draftFoodPrepClearanceM(),
      accessClearanceM: this.draftAccessClearanceM(),
      serviceRouteClearanceM: this.draftServiceRouteClearanceM(),
      wallClearanceM: this.draftWallClearanceM(),
    });
  }

  protected readonly diningPhysicalCapacitySignature = computed(() => this.diningOperationalCapacityKey());

  private scheduleOperationalCapacityProbe(key: string): void {
    if (!key) {
      return;
    }
    const status = this.diningSuggestions.capacityStatus();
    if (key === this.capacityProbeKey && (status === 'ready' || status === 'checking')) {
      return;
    }
    if (this.diningSuggestions.hasReadyKnowledgeFor(key)) {
      this.capacityProbeKey = key;
      return;
    }
    this.capacityProbeKey = key;
    this.diningSuggestions.markCapacityChecking();
    if (this.capacityProbeTimer) {
      clearTimeout(this.capacityProbeTimer);
    }
    this.capacityProbeTimer = setTimeout(() => {
      this.capacityProbeTimer = null;
      void this.runOperationalCapacityProbe(key);
    }, 350);
  }

  private async flushOperationalCapacityProbe(): Promise<void> {
    if (this.capacityProbeTimer) {
      clearTimeout(this.capacityProbeTimer);
      this.capacityProbeTimer = null;
    }
    await this.runOperationalCapacityProbe(this.diningOperationalCapacityKey());
  }

  private async runOperationalCapacityProbe(key: string): Promise<void> {
    if (this.diningSuggestions.hasReadyKnowledgeFor(key)) {
      this.capacityProbeKey = key;
      return;
    }
    const el = this.diningWizardCapacityElement() ?? this.diningWizardBlock();
    if (!el || !this.tableCreateWizardOpen()) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const request = buildDiningLayoutGenerationRequest({
      element: el,
      rect,
      draft: this.diningWizardGenerationDraft(),
      seed: 1,
      excludeFingerprints: [],
      categories: this.tableCategoryService.list(),
      selectedCategoryId: this.selectedTableCategoryId(),
      relocateFeatures: false,
      mode: 'capacity',
      timeBudgetMs: 2500,
    });
    this.capacityProbeKey = key;
    await this.diningSuggestions.probeCapacity(request, key);
    this.scheduleSelectedCountFeasibility();
  }

  private scheduleSelectedCountFeasibility(): void {
    if (!this.tableCreateWizardOpen() || this.diningWizardStep() < 4) {
      return;
    }
    if (this.diningSuggestions.capacityStatus() !== 'ready') {
      return;
    }
    const count = this.draftTableCount();
    if (
      this.diningSuggestions.lastFeasibilityCount() === count &&
      (this.diningSuggestions.lastFeasibilityResult() === 'found' ||
        this.diningSuggestions.lastFeasibilityResult() === 'impossible')
    ) {
      return;
    }
    if (this.feasibilityTimer) {
      clearTimeout(this.feasibilityTimer);
    }
    if (this.diningSuggestions.selectedCountIsValidated(count)) {
      void this.runSelectedCountFeasibility();
      return;
    }
    this.feasibilityTimer = setTimeout(() => {
      this.feasibilityTimer = null;
      void this.runSelectedCountFeasibility();
    }, 350);
  }

  private async runSelectedCountFeasibility(): Promise<void> {
    const el = this.center();
    if (!el || !this.tableCreateWizardOpen() || this.diningSuggestions.capacityStatus() !== 'ready') {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const request = buildDiningLayoutGenerationRequest({
      element: el,
      rect,
      draft: this.diningWizardGenerationDraft(),
      seed: 1,
      excludeFingerprints: [],
      categories: this.tableCategoryService.list(),
      selectedCategoryId: this.selectedTableCategoryId(),
      relocateFeatures: false,
      mode: 'feasibility',
      timeBudgetMs: 1800,
    });
    await this.diningSuggestions.checkFeasibility(request);
  }

  private diningWizardBlock(): CenterpieceElement | null {
    const id = this.diningWizardBlockId() ?? this.center()?.id ?? null;
    if (id) {
      const found = this.canvas.elements().find((el) => el.id === id);
      if (found?.type === 'centerpiece') {
        return found as CenterpieceElement;
      }
    }
    return this.center();
  }

  /** Capacity element with wizard Stage / Food Prep drafts applied. */
  private diningWizardCapacityElement(): CenterpieceElement | null {
    const el = this.diningWizardBlock();
    if (!el) {
      return null;
    }
    return {
      ...el,
      chairWidthM: this.draftChairWidth(),
      chairLengthM: this.draftChairLength(),
      diningStage: this.isDraftDiningFeatureEnabled('stage')
        ? {
            ...(el.diningStage ?? {
              sideEdgeId: 0,
              xPct: 50,
              yPct: 50,
              offsetAlongEdgeM: 0,
              label: 'Stage',
            }),
            sideEdgeId: el.diningStage?.sideEdgeId ?? 0,
            widthM: this.draftStageWidthM(),
            depthM: this.draftStageDepthM(),
            insetFromEdgeM: this.draftStageDepthM() / 2,
          }
        : undefined,
      diningFoodPrepare: this.isDraftDiningFeatureEnabled('foodprepare')
        ? {
            ...(el.diningFoodPrepare ?? {
              sideEdgeId: 2,
              xPct: 50,
              yPct: 50,
              offsetAlongEdgeM: 0,
              label: 'Food Prep',
            }),
            sideEdgeId: el.diningFoodPrepare?.sideEdgeId ?? 2,
            widthM: this.draftFoodPrepWidthM(),
            depthM: this.draftFoodPrepDepthM(),
            insetFromEdgeM: this.draftFoodPrepDepthM() / 2,
          }
        : undefined,
      diningEntrance: el.diningEntrance ?? undefined,
      diningExit: el.diningExit ?? undefined,
      diningSharedAccessPoint: el.diningSharedAccessPoint ?? undefined,
      diningAccessMode: el.diningAccessMode,
    };
  }

  private diningMixSharedOptions(): DiningTableMixSharedOptions {
    return {
      gapM: this.draftTableGapM(),
      featureClearanceM: this.diningWizardFeatureClearanceM(),
      wallClearanceM: this.draftWallClearanceM(),
      template: 'grid',
      includeAnchoredFeatures: true,
    };
  }

  protected diningShapeLabel(shape: DiningTableShape): string {
    return diningTableShapeLabel(shape);
  }

  protected isMixShapeSelected(shape: DiningTableShape): boolean {
    return this.draftTableMix().some((entry) => entry.shape === shape);
  }

  protected mixEntry(shape: DiningTableShape): DiningTableMixEntry | null {
    return this.draftTableMix().find((entry) => entry.shape === shape) ?? null;
  }

  protected mixShapeCapacity(shape: DiningTableShape): DiningTableMixShapeCapacity | null {
    return this.diningTableMixCapacity()?.shapes.find((s) => s.shape === shape) ?? null;
  }

  protected maxMixSeats(shape: DiningTableShape): number {
    const entry = this.mixEntry(shape);
    if (!entry) {
      return 1;
    }
    return Math.max(
      1,
      computeMaxChairsAroundTable({
        shape: entry.shape,
        tableWidthM: entry.widthM,
        tableDepthM: entry.shape === 'round' ? entry.widthM : entry.depthM,
        chairWidthM: entry.chairWidthM,
        chairDepthM: entry.chairLengthM,
      }),
    );
  }

  /** Seeds a lane from the current single-shape draft when the shapes match. */
  private createMixEntry(shape: DiningTableShape): DiningTableMixEntry {
    if (shape === this.draftTableShape()) {
      return {
        shape,
        widthM: this.draftTableWidthM(),
        depthM: shape === 'round' ? this.draftTableWidthM() : this.draftTableDepthM(),
        seats: this.draftTableSeats(),
        chairWidthM: this.draftChairWidth(),
        chairLengthM: this.draftChairLength(),
        count: 1,
      };
    }
    const widthM = shape === 'round' ? DEFAULT_TABLE_WIDTH_M : DEFAULT_TABLE_WIDTH_M;
    return {
      shape,
      widthM,
      depthM: shape === 'round' ? widthM : DEFAULT_TABLE_DEPTH_M,
      seats: DEFAULT_TABLE_SEATS,
      chairWidthM: this.draftChairWidth(),
      chairLengthM: this.draftChairLength(),
      count: 1,
    };
  }

  protected toggleMixShape(shape: DiningTableShape): void {
    const current = this.draftTableMix();
    const next = current.some((entry) => entry.shape === shape)
      ? current.filter((entry) => entry.shape !== shape)
      : [...current, this.createMixEntry(shape)].sort(
          (a, b) =>
            DINING_TABLE_MIX_SHAPES.findIndex((s) => s.shape === a.shape) -
            DINING_TABLE_MIX_SHAPES.findIndex((s) => s.shape === b.shape),
        );
    this.draftTableMix.set(next);
    this.rebalanceMixCounts(shape);
    this.switchToCustomTableCategoryIfNeeded();
    this.resetGeneratedTableTemplates();
  }

  private patchMixEntry(shape: DiningTableShape, patch: Partial<DiningTableMixEntry>): void {
    this.draftTableMix.update((entries) =>
      entries.map((entry) => (entry.shape === shape ? { ...entry, ...patch } : entry)),
    );
  }

  /**
   * Keeps every lane inside the shared block budget after an edit. The lane the
   * user just touched holds its value; the others give way.
   */
  private rebalanceMixCounts(protectedShape?: DiningTableShape): void {
    const el = this.diningWizardCapacityElement();
    const entries = this.draftTableMix();
    if (!el || entries.length === 0) {
      return;
    }
    const clamped = clampDiningTableMixCounts(el, entries, this.diningMixSharedOptions(), protectedShape);
    if (clamped.some((entry, i) => entry.count !== entries[i]?.count)) {
      this.draftTableMix.set(clamped);
    }
    this.syncDraftTableCountFromMix();
  }

  private syncDraftTableCountFromMix(): void {
    if (!this.isMultiShapeMode()) {
      return;
    }
    const total = this.draftTableMix().reduce((sum, entry) => sum + Math.max(0, entry.count), 0);
    this.draftTableCount.set(Math.max(1, total));
  }

  protected setMixDimension(
    shape: DiningTableShape,
    field: 'widthM' | 'depthM' | 'chairWidthM' | 'chairLengthM',
    value: unknown,
  ): void {
    const entry = this.mixEntry(shape);
    if (!entry) {
      return;
    }
    const parsed = this.num(String(value));
    if (!Number.isFinite(parsed)) {
      return;
    }
    const floor =
      field === 'chairLengthM'
        ? MIN_DINING_CHAIR_LENGTH_M
        : field === 'chairWidthM'
          ? MIN_DINING_CHAIR_WIDTH_M
          : MIN_DINING_TABLE_SIZE_M;
    const next = Math.max(floor, Math.round(parsed * 100) / 100);
    const patch: Partial<DiningTableMixEntry> =
      field === 'widthM' && shape === 'round' ? { widthM: next, depthM: next } : { [field]: next };
    this.patchMixEntry(shape, patch);
    this.patchMixEntry(shape, { seats: Math.min(this.mixEntry(shape)!.seats, this.maxMixSeats(shape)) });
    this.rebalanceMixCounts(shape);
    this.switchToCustomTableCategoryIfNeeded();
    this.resetGeneratedTableTemplates();
  }

  protected setMixSeats(shape: DiningTableShape, value: unknown): void {
    const parsed = parseInt(String(value), 10);
    if (Number.isNaN(parsed)) {
      return;
    }
    this.patchMixEntry(shape, { seats: Math.max(1, Math.min(this.maxMixSeats(shape), parsed)) });
    this.resetGeneratedTableTemplates();
  }

  protected adjustMixSeats(shape: DiningTableShape, delta: number): void {
    const entry = this.mixEntry(shape);
    if (!entry) {
      return;
    }
    this.setMixSeats(shape, entry.seats + delta);
  }

  protected setMixCount(shape: DiningTableShape, value: unknown): void {
    const parsed = parseInt(String(value), 10);
    if (Number.isNaN(parsed)) {
      return;
    }
    const max = this.mixShapeCapacity(shape)?.maxCount ?? 0;
    this.patchMixEntry(shape, { count: Math.max(0, Math.min(Math.max(max, 0), parsed)) });
    this.rebalanceMixCounts(shape);
    this.resetGeneratedTableTemplates();
  }

  protected adjustMixCount(shape: DiningTableShape, delta: number): void {
    const entry = this.mixEntry(shape);
    if (!entry) {
      return;
    }
    this.setMixCount(shape, entry.count + delta);
  }

  protected canIncreaseMixCount(shape: DiningTableShape): boolean {
    const capacity = this.mixShapeCapacity(shape);
    return capacity != null && capacity.count < capacity.maxCount;
  }

  private diningWizardFeatureClearanceM(): number {
    const stageOn = this.isDraftDiningFeatureEnabled('stage');
    const foodOn = this.isDraftDiningFeatureEnabled('foodprepare');
    if (stageOn && foodOn) {
      return Math.max(this.draftStageClearanceM(), this.draftFoodPrepClearanceM());
    }
    if (foodOn) {
      return this.draftFoodPrepClearanceM();
    }
    if (!stageOn) {
      return Math.max(this.draftStageClearanceM(), this.draftFoodPrepClearanceM());
    }
    return this.draftStageClearanceM();
  }

  private diningWizardCapacityOptions(): DiningTableCapacityDimsOptions & { chairLengthM: number } {
    const featureClearanceM = this.diningWizardFeatureClearanceM();
    return {
      shape: this.draftTableShape(),
      widthM: this.draftTableWidthM(),
      depthM: this.draftTableDepthM(),
      gapM: this.draftTableGapM(),
      chairLengthM: this.draftChairLength(),
      featureClearanceM,
      wallClearanceM: this.draftWallClearanceM(),
      template: 'grid',
      includeAnchoredFeatures: true,
    };
  }

  private switchToCustomTableCategoryIfNeeded(): void {
    const id = this.selectedTableCategoryId();
    if (id !== '' && id !== TABLE_CATEGORY_CUSTOM) {
      this.selectedTableCategoryId.set(TABLE_CATEGORY_CUSTOM);
      this.tableCategorySaveName.set('');
    }
  }

  private resetGeneratedTableTemplates(): void {
    this.tableGridWizardError.set(null);
    this.templatesGenerated.set(false);
    this.generatedTemplates.set([]);
    this.selectedPreviewTemplateId.set(null);
  }

  protected tableCategoryOptionLabel(cat: TableCategoryTemplate): string {
    const shapeLabel = cat.shape === 'round' ? 'Round' : 'Rectangular';
    const sizeLabel =
      cat.shape === 'round'
        ? `${cat.tableWidthM} m dia`
        : `${cat.tableWidthM} × ${cat.tableDepthM} m`;
    return `${cat.name} — ${shapeLabel}, ${sizeLabel}, ${cat.tableSeats} seats`;
  }

  protected tableCategorySummary(cat: TableCategoryTemplate): string {
    const sizeLabel =
      cat.shape === 'round'
        ? `Ø ${cat.tableWidthM} m`
        : `${cat.tableWidthM} × ${cat.tableDepthM} m`;
    return `${cat.shape === 'round' ? 'Round' : 'Rect'} · ${sizeLabel} · ${cat.tableSeats} chairs · gap ${cat.tableGapM} m`;
  }

  protected selectTableCategory(categoryId: string): void {
    this.onTableCategoryChange(categoryId);
  }

  protected onTableCategoryChange(categoryId: string): void {
    this.selectedTableCategoryId.set(categoryId);
    this.tableCategoryError.set(null);
    if (!categoryId) {
      this.tableCategorySaveName.set('');
      return;
    }
    if (categoryId === TABLE_CATEGORY_CUSTOM) {
      this.tableCategorySaveName.set('');
      return;
    }
    const category = this.tableCategoryService.getById(categoryId);
    if (!category) {
      return;
    }
    this.applyTableCategoryToDrafts(category);
    this.resetGeneratedTableTemplates();
    this.enforceDiningWizardFitConstraints('table');
  }

  private applyTableCategoryToDrafts(category: TableCategoryTemplate): void {
    // A category preset is a single table spec, so it always leaves multi-shape mode.
    this.draftTableShapeMode.set('single');
    this.draftTableMix.set([]);
    this.draftTableShape.set(category.shape);
    this.draftTableWidthM.set(category.tableWidthM);
    this.draftTableDepthM.set(category.tableDepthM);
    this.draftChairWidth.set(category.chairWidthM);
    this.draftChairLength.set(category.chairLengthM);
    this.draftTableGapM.set(category.tableGapM);
    const tableDepthM =
      category.shape === 'rectangular' ? category.tableDepthM : category.tableWidthM;
    const maxSeats = computeMaxChairsAroundTable({
      shape: category.shape,
      tableWidthM: category.tableWidthM,
      tableDepthM,
      chairWidthM: category.chairWidthM,
      chairDepthM: category.chairLengthM,
    });
    this.draftTableSeats.set(Math.max(1, Math.min(maxSeats, Math.round(category.tableSeats))));
    this.tableCategorySaveName.set(category.name);
  }

  protected saveTableCategory(): void {
    const name = this.tableCategorySaveName().trim();
    if (!name) {
      this.tableCategoryError.set('Enter a name for this table category.');
      return;
    }
    try {
      const saved = this.tableCategoryService.save({
        name,
        shape: this.draftTableShape(),
        tableWidthM: this.draftTableWidthM(),
        tableDepthM: this.draftTableDepthM(),
        tableSeats: this.draftTableSeats(),
        chairWidthM: this.draftChairWidth(),
        chairLengthM: this.draftChairLength(),
        tableGapM: this.draftTableGapM(),
        existingId: null,
      });
      this.selectedTableCategoryId.set(saved.id);
      this.tableCategorySaveName.set(saved.name);
      this.tableCategoryError.set(null);
    } catch (err) {
      this.tableCategoryError.set(err instanceof Error ? err.message : 'Could not save table category.');
    }
  }

  protected deleteSelectedTableCategory(): void {
    const id = this.selectedTableCategoryId();
    if (!id) {
      return;
    }
    this.tableCategoryService.delete(id);
    this.selectedTableCategoryId.set('');
    this.tableCategorySaveName.set('');
    this.tableCategoryError.set(null);
  }

  protected layoutPreviewSvg(svg: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  }

  protected removeAllTables(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.removeDiningTables(el.id);
    this.tableGridWizardOpen.set(false);
    this.tableCreateWizardOpen.set(false);
  }

  protected deleteSelectedTable(): void {
    const el = this.center();
    const table = this.selectedTable();
    if (!el || !table) {
      return;
    }
    this.canvas.deleteDiningTable(el.id, table.id);
  }

  protected updateSelectedTableSeats(seats: number): void {
    const el = this.center();
    const table = this.selectedTable();
    if (!el || !table) {
      return;
    }
    const capped = Math.max(1, Math.min(this.maxSelectedTableSeats(), Math.round(seats)));
    this.canvas.updateDiningTable(el.id, table.id, { seats: capped });
  }

  protected updateSelectedTableShape(shape: DiningTableShape): void {
    const el = this.center();
    const table = this.selectedTable();
    if (!el || !table) {
      return;
    }
    this.canvas.updateDiningTable(el.id, table.id, { shape });
  }

  protected updateSelectedTableAccessCategory(value: string): void {
    const el = this.center();
    const table = this.selectedTable();
    if (!el || !table) {
      return;
    }
    const accessCategory = value ? (value as DiningTableAccessCategory) : undefined;
    this.canvas.updateDiningTable(el.id, table.id, { accessCategory });
  }



  protected addDiningStage(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.startStageSidePick(el.id, false);
  }

  protected changeDiningStageSide(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.startStageSidePick(el.id, true);
  }

  protected cancelStageSidePick(): void {
    this.canvas.cancelStageSidePick();
  }

  protected removeDiningStage(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.removeDiningStage(el.id);
  }

  protected updateDiningStageWidth(widthM: number): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.updateDiningStage(el.id, { widthM: Math.max(0.5, widthM) });
  }

  protected updateDiningStageDepth(depthM: number): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.updateDiningStage(el.id, { depthM: Math.max(0.3, depthM) });
  }

  protected diningStageRotationDeg(): number {
    const el = this.center();
    const stage = el?.diningStage;
    if (!el || !stage) {
      return 0;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    return resolveDiningFeatureRotationDeg(el, rect, stage);
  }

  protected updateDiningStageRotation(rotationDeg: number): void {
    const el = this.center();
    if (!el?.diningStage) {
      return;
    }
    this.canvas.updateDiningStage(el.id, {
      rotationDeg: normalizeDiningFeatureRotationDeg(rotationDeg),
    });
  }

  protected resetDiningStageRotationToWall(): void {
    const el = this.center();
    if (!el?.diningStage) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    this.canvas.updateDiningStage(el.id, {
      rotationDeg: normalizeDiningFeatureRotationDeg(
        diningFeatureRotationDeg(el, rect, el.diningStage.sideEdgeId),
      ),
    });
  }

  protected updateDiningStageAlongEdge(offsetAlongEdgeM: number): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.updateDiningStage(el.id, { offsetAlongEdgeM });
  }

  protected updateDiningStageInset(insetFromEdgeM: number): void {
    const el = this.center();
    if (!el?.diningStage) {
      return;
    }
    // Keep stage fully inside the block — never less than half depth from the border.
    const minInset = el.diningStage.depthM / 2;
    this.canvas.updateDiningStage(el.id, { insetFromEdgeM: Math.max(minInset, insetFromEdgeM) });
  }

  protected updateDiningStageAlignment(alignment: 'edge' | 'center' | 'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br'): void {
    const el = this.center();
    if (!el || !el.diningStage) {
      return;
    }
    const blockWidthM = resolveBlockWidthM(el);
    const blockLengthM = resolveBlockLengthM(el);
    const wPct = (el.diningStage.widthM / blockWidthM) * 100;
    const dPct = (el.diningStage.depthM / blockLengthM) * 100;
    
    let xPct = el.diningStage.xPct;
    let yPct = el.diningStage.yPct;
    
    if (alignment === 'center') {
      xPct = 50;
      yPct = 50;
    } else if (alignment === 'corner-tl') {
      xPct = wPct / 2 + 5;
      yPct = dPct / 2 + 5;
    } else if (alignment === 'corner-tr') {
      xPct = 100 - (wPct / 2 + 5);
      yPct = dPct / 2 + 5;
    } else if (alignment === 'corner-bl') {
      xPct = wPct / 2 + 5;
      yPct = 100 - (dPct / 2 + 5);
    } else if (alignment === 'corner-br') {
      xPct = 100 - (wPct / 2 + 5);
      yPct = 100 - (dPct / 2 + 5);
    } else {
      xPct = 50;
      yPct = 50;
    }
    
    this.canvas.updateDiningStage(el.id, {
      alignment,
      xPct,
      yPct,
      offsetAlongEdgeM: alignment === 'edge' ? 0 : undefined,
      insetFromEdgeM: alignment === 'edge' ? el.diningStage.depthM / 2 : undefined,
    });
  }

  protected addDiningFoodPrepare(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.addDiningFoodPrepare(el.id);
  }

  protected changeDiningFoodPrepareSide(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.startFoodPrepareSidePick(el.id, true);
  }

  protected cancelFoodPrepareSidePick(): void {
    this.canvas.cancelFoodPrepareSidePick();
  }

  protected removeDiningFoodPrepare(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.removeDiningFoodPrepare(el.id);
  }

  protected updateDiningFoodPrepareWidth(widthM: number): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.updateDiningFoodPrepare(el.id, { widthM: Math.max(0.5, widthM) });
  }

  protected updateDiningFoodPrepareDepth(depthM: number): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.updateDiningFoodPrepare(el.id, { depthM: Math.max(0.3, depthM) });
  }

  protected diningFoodPrepareRotationDeg(): number {
    const el = this.center();
    const fp = el?.diningFoodPrepare;
    if (!el || !fp) {
      return 0;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    return resolveDiningFeatureRotationDeg(el, rect, fp);
  }

  protected updateDiningFoodPrepareRotation(rotationDeg: number): void {
    const el = this.center();
    if (!el?.diningFoodPrepare) {
      return;
    }
    this.canvas.updateDiningFoodPrepare(el.id, {
      rotationDeg: normalizeDiningFeatureRotationDeg(rotationDeg),
    });
  }

  protected resetDiningFoodPrepareRotationToWall(): void {
    const el = this.center();
    if (!el?.diningFoodPrepare) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    this.canvas.updateDiningFoodPrepare(el.id, {
      rotationDeg: normalizeDiningFeatureRotationDeg(
        diningFeatureRotationDeg(el, rect, el.diningFoodPrepare.sideEdgeId),
      ),
    });
  }

  protected updateDiningFoodPrepareAlongEdge(offsetAlongEdgeM: number): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.updateDiningFoodPrepare(el.id, { offsetAlongEdgeM });
  }

  protected updateDiningFoodPrepareInset(insetFromEdgeM: number): void {
    const el = this.center();
    if (!el?.diningFoodPrepare) {
      return;
    }
    const minInset = el.diningFoodPrepare.depthM / 2;
    this.canvas.updateDiningFoodPrepare(el.id, { insetFromEdgeM: Math.max(minInset, insetFromEdgeM) });
  }

  protected updateDiningFoodPrepareAlignment(alignment: 'edge' | 'center' | 'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br'): void {
    const el = this.center();
    if (!el || !el.diningFoodPrepare) {
      return;
    }
    const blockWidthM = resolveBlockWidthM(el);
    const blockLengthM = resolveBlockLengthM(el);
    const wPct = (el.diningFoodPrepare.widthM / blockWidthM) * 100;
    const dPct = (el.diningFoodPrepare.depthM / blockLengthM) * 100;
    
    let xPct = el.diningFoodPrepare.xPct;
    let yPct = el.diningFoodPrepare.yPct;
    
    if (alignment === 'center') {
      xPct = 50;
      yPct = 50;
    } else if (alignment === 'corner-tl') {
      xPct = wPct / 2 + 5;
      yPct = dPct / 2 + 5;
    } else if (alignment === 'corner-tr') {
      xPct = 100 - (wPct / 2 + 5);
      yPct = dPct / 2 + 5;
    } else if (alignment === 'corner-bl') {
      xPct = wPct / 2 + 5;
      yPct = 100 - (dPct / 2 + 5);
    } else if (alignment === 'corner-br') {
      xPct = 100 - (wPct / 2 + 5);
      yPct = 100 - (dPct / 2 + 5);
    } else {
      xPct = 50;
      yPct = 50;
    }
    
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const next: DiningFoodPrepareSpec = {
      ...el.diningFoodPrepare,
      alignment,
      xPct,
      yPct,
      offsetAlongEdgeM: alignment === 'edge' ? 0 : undefined,
      insetFromEdgeM: alignment === 'edge' ? el.diningFoodPrepare.depthM / 2 : undefined,
    };
    
    let positioned = next;
    if (alignment === 'edge') {
      positioned = syncStageSpecFromMetrics(el, rect, next as unknown as DiningStageSpec) as unknown as DiningFoodPrepareSpec;
    }
    this.canvas.update(el.id, { diningFoodPrepare: positioned });
  }

  protected updateDiningFoodPrepareSide(sideIndex: number): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.updateDiningFoodPrepare(el.id, { sideEdgeId: sideIndex });
  }

  protected startServiceRouteDrawing(): void {
    const el = this.center();
    if (!el || !this.hasCustomShape()) {
      return;
    }
    this.canvas.syncBlockPhysicalDimsFromMeasuredSides(el.id);
    this.tableCreateWizardOpen.set(false);
    this.tableGridWizardOpen.set(false);
    this.canvas.startServiceRouteDrawing(el.id);
  }

  protected startServiceRouteDrawingForTableCreate(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.syncBlockPhysicalDimsFromMeasuredSides(el.id);
    const preview = this.tableCreatePreview();
    const tableCount =
      preview && !('error' in preview) ? preview.tableCount : this.draftTableCount();

    this.canvas.serviceRouteTableGenPending.set(true);
    this.canvas.serviceRouteTableGenClearance.set(this.draftServiceRouteClearanceM());
    this.canvas.serviceRouteTableGenType.set('count');
    this.canvas.serviceRouteTableGenOptions.set({
      shape: this.draftTableShape(),
      seats: this.draftTableSeats(),
      widthM: this.draftTableWidthM(),
      depthM: this.draftTableDepthM(),
      gapM: this.draftTableGapM(),
      tableCount,
    });

    this.tableCreateWizardOpen.set(false);
    this.canvas.startServiceRouteDrawing(el.id);
  }

  protected startServiceRouteDrawingForTableGrid(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.syncBlockPhysicalDimsFromMeasuredSides(el.id);

    this.canvas.serviceRouteTableGenPending.set(true);
    this.canvas.serviceRouteTableGenClearance.set(this.draftServiceRouteClearanceM());
    this.canvas.serviceRouteTableGenType.set('grid');
    this.canvas.serviceRouteTableGenOptions.set({
      shape: this.draftTableShape(),
      seats: this.draftTableSeats(),
      widthM: this.draftTableWidthM(),
      depthM: this.draftTableDepthM(),
      gapM: this.draftTableGapM(),
    });

    this.tableGridWizardOpen.set(false);
    this.canvas.startServiceRouteDrawing(el.id);
  }

  protected finishServiceRouteDrawing(): void {
    this.canvas.finishServiceRouteDrawing();
  }

  protected cancelServiceRouteDrawing(): void {
    this.canvas.cancelServiceRouteDrawing();
  }

  protected deleteSelectedServiceRoute(): void {
    const el = this.center();
    const routeId = this.selectedServiceRouteId();
    if (!el || !routeId) {
      return;
    }
    this.canvas.deleteDiningServiceRoute(el.id, routeId);
  }

  protected updateSelectedServiceRouteWidth(widthM: number): void {
    const el = this.center();
    const routeId = this.selectedServiceRouteId();
    if (!el || !routeId) {
      return;
    }
    this.canvas.updateDiningServiceRouteWidth(el.id, routeId, widthM);
  }

  protected removeAllServiceRoutes(): void {
    const el = this.center();
    if (!el) {
      return;
    }
    this.canvas.removeDiningServiceRoutes(el.id);
  }

  protected updateAutoFillConfig(
    patch: Partial<{
      chairLengthM: number;
      chairWidthM: number;
      seatGapM: number;
      rowGapM: number;
      borderGapM: number;
      curveDeg: number;
      curveEnabled: boolean;
    }>,
  ): void {
    this.canvas.setAutoFillSeatingConfig(patch);
    this.canvas.autoFillError.set(null);
  }

  protected captureAutoFillFromSelection(): void {
    this.canvas.captureAutoFillConfigFromSelection();
  }

  protected setAutoFillBlockMeasurementScaleEnabled(enabled: boolean): void {
    this.canvas.setAutoFillBlockMeasurementScaleEnabled(enabled);
  }

  protected setAutoFillBlockSideLength(index: number, lengthM: number): void {
    const blockId = this.autoFillMeasurementView()?.blockId;
    if (!blockId) {
      return;
    }
    this.canvas.setAutoFillBlockSideLength(blockId, index, lengthM);
  }

  protected runAutoFillSeating(): void {
    this.canvas.applyAutoFillToSelectedBlocks();
  }

  protected runAutoFillSeatingAnimated(): void {
    void this.canvas.applyAutoFillToSelectedBlocksAnimated();
  }

  protected saveAutoFillSeatedBlocks(): void {
    this.saveAutoFillLayout.emit();
  }

  protected exitAutoFillLayoutMode(): void {
    this.canvas.exitAutoFillLayoutMode();
  }

  protected editAutoFillConfiguration(): void {
    this.canvas.openBlockWorkspaceForAutoFillEdit();
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the image file.'));
    reader.readAsDataURL(file);
  });
}
