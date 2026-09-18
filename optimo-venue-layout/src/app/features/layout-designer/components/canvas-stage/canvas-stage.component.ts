import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';

import {
  PixelRect,
  annularEllipsePath,
  clamp,
  radialSectorPath,
  rectFromPositionSize,
} from '../../lib/geometry';
import { resolveCenterpieceShapeDraw, resolveBlockGridShapeDraw } from '../../lib/block-shape-geometry';
import {
  RowLabelNode,
  SeatNode,
  buildGridSeatMap,
  buildSeatSectionSeatMap,
  rowLabel,
} from '../../lib/seat-layout';
import { buildSectorSeatMapForBlock } from '../../lib/sector-seat-layout';
import {
  ResizeHandle,
  cornerWorld,
  edgeAnchorWorld,
  isCornerHandle,
  oppositeCorner,
  pixelRectToGeometry,
  resizeFromEdge,
  resizeFromOppositeCorners,
} from '../../lib/resize';
import { getArrangeByRowLastSeatInfo } from '../../lib/arrange-by-row';
import {
  getDragFillRowExtendInfo,
} from '../../lib/drag-fill-seats';
import {
  buildCustomShapeSeatMap,
  resolveCustomShapeSeatPitchPx,
  getLockedBlockPolygonsCanvasPx,
  getPendingBlockPreviewPolygon,
  getRowLinesCanvasPx,
  getSeatingBlockDisplayStats,
  isCanvasPctInsideCustomShape,
  previewSeatsOnLineCanvasPx,
} from '../../lib/custom-shape-seats';
import { resolveSeatFacingDegForShapeSeats } from '../../lib/drag-seats';
import { computeViewpointRevealDelays } from '../../lib/seat-reveal-order';
import {
  buildBowedOpenPolylinePoints,
  buildParkingOutlinePathPx,
  buildParkingOutlinePoints,
  computeParkingPxPerMeter,
  getEdgeBowHandleCanvasPx,
  getOpenEdgeBowHandleCanvasPx,
  sampleBowedEdge,
} from '../../lib/parking-shape';
import { planParkingSlots, PARKING_ACCESS_WAY_WIDTH_M, type SlotRect } from '../../lib/parking-slots';
import { ParkingSlotDefaultsService } from '../../services/parking-slot-defaults.service';
import { ParkingSlotGraphicComponent } from '../parking-slot-graphic/parking-slot-graphic.component';
import { buildDiningTableRenderList,DINING_TABLE_ACCESS_STROKE, type DiningTableRenderNode } from '../../lib/dining-tables';
import { isInteractiveUiTarget } from '../../lib/interactive-ui-target';

import {
  buildDiningStageRenderNode,
  type DiningStageRenderNode,
  buildDiningFoodPrepareRenderNode,
  buildDiningExitRenderNode,
  buildDiningEntranceRenderNode,
  buildDiningSharedAccessRenderNode,
  getStageEdgeFrame,
  DINING_STAGE_FILL,
  DINING_STAGE_STROKE,
  DINING_FOOD_PREP_FILL,
  DINING_FOOD_PREP_STROKE,
  DINING_ZONE_LABEL_FILL,
  DINING_ZONE_SELECTED_STROKE,
  diningFoodPrepIconScale,
  diningFoodPrepIconVisible,
} from '../../lib/dining-stage';
import {
  buildDiningServiceRouteRenderList,
  type DiningServiceRouteRenderNode,
} from '../../lib/dining-service-routes';
import {
  DINING_TABLE_STROKE,
  DINING_TABLE_STROKE_SELECTED,
  diningTableChairArcPath,
} from '../../lib/dining-table-icon';
import { getVisibleGridBounds } from '../../lib/canvas-grid';
import { referenceImageDrawRect, canvasPolygonToReferencePct, canvasPointToReferencePct } from '../../lib/canvas-image';
import {
  diningReferenceImageViewBox,
  hasDiningReferenceAlignment,
} from '../../lib/dining-reference-image';
import {
  diningBackgroundDraw,
  diningBackgroundFitFromRef,
  diningBackgroundUsesManualFit,
  svgLocalClipUrl,
} from '../../lib/dining-background-image';
import {
  DEFAULT_DINING_BACKGROUND_OPACITY,
  type DiningLayoutReferenceImage,
} from '../../models/layout-element.model';
import { canvasPctToLocalPoint, localPointsToAbsolute, localToCanvasPct } from '../../lib/custom-shape';
import { floodFillAtPoint, isBorderPixel, rgbToHex } from '../../lib/flood-fill';
import { pointInPolygon } from '../../lib/contour-geometry';
import { blueprintBlockStyle } from '../../lib/cv-to-layout';
import {
  buildBlockMeasureEdges,
  hitTestBlockMeasureEdges,
  storedNameForEdge,
} from '../../lib/block-measure-edges';
import { edgeSegment, offsetEdgeSegmentOutward, polygonCanvasPointsFromBlock } from '../../lib/block-viewpoint';
import {
  chairHitRadiusFromPitchPx,
  chairHitRadiusFromSeatRadius,
  chairScalesFromSeatPitch,
  SEAT_GRAPHIC_SIZE,
} from '../../lib/chair-seat-icon';
import {
  pxPerMeter,
  resolveBlockLengthM,
  resolveBlockWidthM,
  resolveChairLengthM,
  resolveChairWidthM,
  resolveRowGapM,
  resolveSeatGapM,
} from '../../lib/physical-dims';
import { seatNodeToChairView } from '../../lib/seat-chair-view';
import { SeatChairGraphicComponent } from '../seat-chair-graphic/seat-chair-graphic.component';
import { isElementLocked, isElementVisible } from '../../lib/element-display';
import {
  centerpieceLabelCanvasPosition,
  isCenterpieceLabelDraggable,
  resolveCenterpieceBlockLabelColor,
  resolveCenterpieceDisplayLabelOffset,
  seatFacingDegFromViewpoint,
  workspaceBlockLabelCanvasPosition,
} from '../../lib/block-label';
import { isAutoFillEligibleBlock } from '../../lib/auto-fill-seating';
import { normalizeAutoFillAisles } from '../../models/auto-fill-seating.model';
import { isCompleteDrawnAisle } from '../../lib/drawn-aisle';
import { ThemeService } from '../../../../core/services/theme.service';
import {
  CenterpieceElement,
  ElementPosition,
  LayoutElement,
  RectSide,
  getDiningChairCount,
  getDiningTableCount,
  hasDiningStage,
  hasDiningFoodPrepare,
  hasDiningEntrance,
  hasDiningExit,
  hasDiningSharedAccess,
  resolveDiningAccessMode,
  type DiningAccessPointKind,
  isCustomizableBlock,
  isCustomShapeSeatingEnabled,
  isParkingArea,
  hasTracedBlockOutline,
  ParkingVehicleType,
} from '../../models/layout-element.model';
import { LayoutCanvasService, PARKING_AREA_DRAFT_ID } from '../../services/layout-canvas.service';
import { BlueprintAuditService } from '../../services/blueprint-audit.service';

interface SectorVM {
  id: string;
  path: string;
  seats: SeatNode[];
  rowLabels: RowLabelNode[];
  labelX: number;
  labelY: number;
  code: string;
  displayLabel: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  blockSelected: boolean;
}

interface RectBlockVM {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  seats: SeatNode[];
  labelX: number;
  labelY: number;
  code: string;
  blockSelected: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

interface LabelVM {
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  fontSize: number;
  weight: number;
  color: string;
  elementId?: string;
  draggable?: boolean;
}

interface CustomSeatVM extends SeatNode {
  seatId: string;
  selected: boolean;
  hitRadius: number;
  useChairIcon?: boolean;
  chairScale?: number;
  /** Vertical glyph scale — long chairs (chair_length_m) render elongated. */
  chairScaleY?: number;
  rotationDeg?: number;
  labelText?: string;
  /** Fade-in stagger from VIEW POINT → inward (ms). */
  revealDelayMs?: number;
}

interface ElementVM {
  el: LayoutElement;
  rect: PixelRect;
  transform: string | null;
  selected: boolean;
  fill: string;
  /** Optional `fill-opacity` for the body shape; absent = fully opaque. */
  fillOpacity?: number;
  stroke: string;
  strokeWidth: number;
  labelColor: string;
  // centerpiece / preset
  shapeMode?: 'ellipse' | 'rect' | 'path' | 'polygon';
  rectRx?: number;
  pathD?: string;
  centerLabel?: LabelVM;

  // ring
  ringPath?: string;
  sectors?: SectorVM[];

  // rect-layer
  groundX?: number;
  groundY?: number;
  groundW?: number;
  groundH?: number;
  rectBlocks?: RectBlockVM[];

  // grid / seat-section / custom-shape
  seats?: SeatNode[];
  customSeats?: CustomSeatVM[];
  rowLabels?: RowLabelNode[];
  showRowLabels?: boolean;
  showSeatNumbers?: boolean;
  diningTables?: DiningTableRenderNode[];
  diningStage?: DiningStageRenderNode;
  diningFoodPrepare?: DiningStageRenderNode;
  diningEntrance?: DiningStageRenderNode;
  diningExit?: DiningStageRenderNode;
  diningSharedAccess?: DiningStageRenderNode;
  diningServiceRoutes?: DiningServiceRouteRenderNode[];
  showInlineSeatLabels?: boolean;
  parkingSlots?: {
    id: string;
    label: string | null;
    selected: boolean;
    x: number;
    y: number;
    rotationDeg: number;
    lengthPx: number;
    widthPx: number;
    vehicleType: ParkingVehicleType;
    shapePoints: ElementPosition[] | null;
    /** Canvas px — from plan OCR glyph height when known. */
    labelHeightPx: number | null;
  }[];
  parkingAccessPoints?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    kind: 'enter' | 'exit';
    label: string;
  }[];
  parkingRoutes?: { id: string; pointsStr: string; arrows: RouteArrowVM[] }[];
  /** Optional OCR/plan divider guides in canvas px (when present). */
  parkingDividerLines?: { x1: number; y1: number; x2: number; y2: number }[];
  diningLayoutReferenceImage?: DiningLayoutReferenceImage;

  // aisle / label
  aisle?: boolean;
  label?: LabelVM;
}

interface DragSession {
  id: string;
  startXPct: number;
  startYPct: number;
  startPointerX: number;
  startPointerY: number;
}

interface RotateSession {
  id: string;
  startRotation: number;
  startAngle: number;
  cx: number;
  cy: number;
  startPointerX: number;
  startPointerY: number;
}

interface DiningFeatureRotateSession {
  elementId: string;
  kind: 'stage' | 'foodprepare';
  startRotation: number;
  startAngle: number;
  cx: number;
  cy: number;
}

type HandlePos = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface VertexVM {
  index: number;
  x: number;
  y: number;
}

interface HandleVM {
  x: number;
  y: number;
  cursor: string;
}

interface SelectionOverlayVM {
  el: LayoutElement;
  rect: PixelRect;
  rotationTransform: string | null;
  moveX: number;
  moveY: number;
  rotateX: number;
  rotateY: number;
  anchorX: number;
  anchorY: number;
  handleHalf: number;
  controlR: number;
  crossArm: number;
  strokeW: number;
  selectionStroke: number;
  handles: Record<HandlePos, HandleVM>;
  customVertices?: VertexVM[];
  parkingEdgeHandles?: { index: number; x: number; y: number }[];
  showHandles: boolean;
}

interface MarqueeSession {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  active: boolean;
}

/**
 * Screen-pixel targets calibrated to the old fixed canvas handles at 200% zoom
 * (the size users consider "correct"). Divided by zoom so they stay that size on screen.
 */
const SELECTION_HANDLE_HALF_SCREEN = 9;
const SELECTION_CONTROL_R_SCREEN = 14;
const SELECTION_CROSS_ARM_SCREEN = 6.8;
const SELECTION_STROKE_SCREEN = 3;
const SELECTION_OFFSET_SCREEN = 44;
const SELECTION_SPREAD_SCREEN = 22;

function selectionUiSize(screenPx: number, zoomPct: number): number {
  return screenPx / Math.max(0.35, zoomPct / 100);
}

interface VertexDragSession {
  id: string;
  index: number;
}

interface ResizeSession {
  id: string;
  handle: ResizeHandle;
  anchorWorld: { x: number; y: number };
  rotation: number;
  startWidth: number;
  startHeight: number;
}

interface TableDragSession {
  elementId: string;
  tableId: string;
  startPointerX: number;
  startPointerY: number;
  dragging: boolean;
}

interface StageDragSession {
  elementId: string;
  startPointerX: number;
  startPointerY: number;
  dragging: boolean;
}

interface AccessPointDragSession {
  elementId: string;
  kind: DiningAccessPointKind;
  startPointerX: number;
  startPointerY: number;
  dragging: boolean;
}

interface DiningFeatureResizeSession {
  elementId: string;
  kind: 'stage' | 'foodprepare';
  handle: 'left' | 'right' | 'top' | 'bottom';
  startPointerX: number;
  startPointerY: number;
  dragging: boolean;
}

interface SeatDragSession {
  elementId: string;
  seatId: string;
  startPointerX: number;
  startPointerY: number;
  dragging: boolean;
  /** When set, dragging the last seat extends an arrange-by-row row column-wise. */
  arrangeByRowRowIndex?: number;
  /** When true, double-click drag extends/fills seats along the row. */
  dragFillDragMode?: boolean;
}

interface RingBlockDragSession {
  elementId: string;
  blockId: string;
  startPointerAngle: number;
  startBlockStartDeg: number;
  startBlockEndDeg: number;
}

interface DraftPointPx {
  x: number;
  y: number;
}

interface RouteArrowVM {
  x: number;
  y: number;
  angleDeg: number;
}

/** One driving-direction arrow at the midpoint of each route segment. */
function routeArrowsFromPoints(points: { x: number; y: number }[]): RouteArrowVM[] {
  const arrows: RouteArrowVM[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 8) {
      continue;
    }
    arrows.push({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      angleDeg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    });
  }
  return arrows;
}

const HANDLE_POSITIONS: HandlePos[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** Base screen angle (deg, y-down) of each handle relative to the element centre. */
const HANDLE_BASE_ANGLE: Record<HandlePos, number> = {
  e: 0,
  se: 45,
  s: 90,
  sw: 135,
  w: 180,
  nw: 225,
  n: 270,
  ne: 315,
};

const CURSOR_BY_AXIS: { ang: number; cursor: string }[] = [
  { ang: 0, cursor: 'ew-resize' },
  { ang: 45, cursor: 'nwse-resize' },
  { ang: 90, cursor: 'ns-resize' },
  { ang: 135, cursor: 'nesw-resize' },
];

function resizeCursor(handle: HandlePos, rotationDeg: number): string {
  let angle = (HANDLE_BASE_ANGLE[handle] + rotationDeg) % 180;
  if (angle < 0) {
    angle += 180;
  }
  let best = CURSOR_BY_AXIS[0];
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const option of CURSOR_BY_AXIS) {
    let diff = Math.abs(angle - option.ang);
    diff = Math.min(diff, 180 - diff);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = option;
    }
  }
  return best.cursor;
}

/** Keep drag deltas continuous across the ±180° wrap. */
function unwrapAngleNear(referenceDeg: number, angleDeg: number): number {
  let angle = angleDeg;
  while (angle - referenceDeg > 180) {
    angle -= 360;
  }
  while (angle - referenceDeg < -180) {
    angle += 360;
  }
  return angle;
}

const SEAT_FILL = '#f4f6f8';
const SEAT_STROKE = '#5b6472';

interface ViewpointDragSession {
  pointerId: number;
}

interface LongPressSession {
  elementId: string;
  startX: number;
  startY: number;
  timerId: ReturnType<typeof setTimeout>;
  pointerId: number;
}

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_PX = 12;

interface BlockTooltipStat {
  label: string;
  value: string | number;
}

interface BlockTooltipVM {
  name: string;
  typeLabel: string;
  configName: string | undefined;
  details: string[];
  mode: 'block' | 'seat' | 'slot';
  stats?: BlockTooltipStat[];
  seatDetail?: string;
}

const SEATING_BLOCK_STROKE = '#2563eb';
const SEATING_BLOCK_STROKE_WIDTH = 2.5;
/**
 * Parking-area body opacity. Low enough that the uploaded plan image underneath stays
 * readable while measuring edges and checking slot placement, high enough that the block
 * still reads as a filled area rather than a bare outline.
 */
const PARKING_AREA_FILL_OPACITY = 0.28;

/** Isolated from the canvas so opening the hover card does not re-render 16k seats. */
@Component({
  selector: 'app-canvas-hover-tooltip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <div
      #hoverTip
      popover="manual"
      class="canvas-block-tooltip"
      [class.canvas-block-tooltip--seat]="vm()?.mode === 'seat'"
      [class.canvas-block-tooltip--slot]="vm()?.mode === 'slot'"
      [class.canvas-block-tooltip--visible]="vm()"
      role="tooltip"
    >
      @if (vm(); as tip) {
        <div class="canvas-block-tooltip__header">
          <span class="canvas-block-tooltip__badge">{{ tip.typeLabel }}</span>
          <span class="canvas-block-tooltip__name">{{ tip.name }}</span>
        </div>
        @if (tip.mode === 'seat' && tip.seatDetail) {
          <div class="canvas-block-tooltip__seat">{{ tip.seatDetail }}</div>
        }
        @if (tip.stats?.length) {
          <div
            class="canvas-block-tooltip__stats"
            [class.canvas-block-tooltip__stats--2]="(tip.stats?.length ?? 0) === 2"
          >
            @for (stat of tip.stats; track stat.label) {
              <div class="canvas-block-tooltip__stat">
                <span class="canvas-block-tooltip__stat-value">{{ stat.value }}</span>
                <span class="canvas-block-tooltip__stat-label">{{ stat.label }}</span>
              </div>
            }
          </div>
        }
        @if (tip.configName) {
          <div class="canvas-block-tooltip__config">{{ tip.configName }}</div>
        }
        @for (detail of tip.details; track detail) {
          <div class="canvas-block-tooltip__detail">{{ detail }}</div>
        }
      }
    </div>
  `,
})
export class CanvasHoverTooltipComponent {
  private readonly tipRef = viewChild<ElementRef<HTMLElement>>('hoverTip');
  protected readonly vm = signal<BlockTooltipVM | null>(null);

  constructor() {
    effect(() => {
      const open = Boolean(this.vm());
      const node = this.tipRef()?.nativeElement;
      if (!node || typeof node.showPopover !== 'function') {
        return;
      }
      if (open && !node.matches(':popover-open')) {
        node.showPopover();
      } else if (!open && node.matches(':popover-open')) {
        node.hidePopover();
      }
    });
  }

  show(next: BlockTooltipVM, clientX: number, clientY: number): void {
    this.vm.set(next);
    this.place(clientX, clientY);
    this.openPopoverNow();
  }

  move(clientX: number, clientY: number): void {
    this.place(clientX, clientY);
  }

  hide(): void {
    if (!this.vm()) {
      return;
    }
    this.vm.set(null);
    const node = this.tipRef()?.nativeElement;
    if (node && typeof node.hidePopover === 'function' && node.matches(':popover-open')) {
      node.hidePopover();
    }
  }

  private openPopoverNow(): void {
    const node = this.tipRef()?.nativeElement;
    if (node && typeof node.showPopover === 'function' && !node.matches(':popover-open')) {
      node.showPopover();
    }
  }

  private place(clientX: number, clientY: number): void {
    const pad = 12;
    const offset = 16;
    const estW = 220;
    const estH = this.vm()?.mode === 'seat' ? 78 : 118;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = clientX + offset;
    let y = clientY + offset;
    if (x + estW + pad > vw) {
      x = clientX - estW - offset;
    }
    if (y + estH + pad > vh) {
      y = clientY - estH - offset;
    }
    x = Math.max(pad, Math.min(x, vw - estW - pad));
    y = Math.max(pad, Math.min(y, vh - estH - pad));
    const node = this.tipRef()?.nativeElement;
    if (node) {
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
    }
  }
}

@Component({
  selector: 'app-canvas-stage',
  imports: [SeatChairGraphicComponent, ParkingSlotGraphicComponent, CanvasHoverTooltipComponent],
  templateUrl: './canvas-stage.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CanvasStageComponent {
  protected readonly canvas = inject(LayoutCanvasService);
  private readonly audit = inject(BlueprintAuditService);
  private readonly theme = inject(ThemeService);
  private readonly parkingSlotDefaults = inject(ParkingSlotDefaultsService);
  private readonly hostRef = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly svgRef = viewChild<ElementRef<SVGSVGElement>>('svg');
  private readonly hoverTip = viewChild(CanvasHoverTooltipComponent);

  protected readonly width = computed(() => this.canvas.canvas().width);
  protected readonly height = computed(() => this.canvas.canvas().height);

  private readonly referenceBitmap = signal<ImageBitmap | null>(null);
  private readonly referenceNaturalSize = signal<{ width: number; height: number } | null>(null);

  constructor() {
    this.destroyRef.onDestroy(() => this.hoverTip()?.hide());
    effect(() => {
      const phase = this.canvas.seatHydrationPhase();
      if (phase === 'outline') {
        this.seatMapCache.clear();
      }
    });
    effect(() => {
      const ref = this.canvas.referenceImage()?.dataUrl ?? null;
      void this.loadReferenceBitmap(ref);
    });
    effect((onCleanup) => {
      const svg = this.svgRef()?.nativeElement;
      if (!svg) {
        return;
      }
      const handler = (event: PointerEvent) => {
        this.consumeAccessPointPlacementPointer(event);
      };
      svg.addEventListener('pointerdown', handler, true);
      onCleanup(() => svg.removeEventListener('pointerdown', handler, true));
    });
    // Auto-zoom needs real screen pixels to decide how large a chair renders.
    effect((onCleanup) => {
      const svg = this.svgRef()?.nativeElement;
      if (!svg || typeof ResizeObserver === 'undefined') {
        return;
      }
      const publish = () =>
        this.canvas.viewportPx.set({ width: svg.clientWidth, height: svg.clientHeight });
      publish();
      const observer = new ResizeObserver(() => publish());
      observer.observe(svg);
      onCleanup(() => observer.disconnect());
    });
    effect((onCleanup) => {
      if (!this.isTablePlacing()) {
        return;
      }
      const handler = (event: PointerEvent) => {
        this.consumeTablePlacementPointer(event);
      };
      document.addEventListener('pointerdown', handler, true);
      onCleanup(() => document.removeEventListener('pointerdown', handler, true));
    });
  }

  /**
   * While placing tables one-by-one, capture document pointerdowns so labels,
   * selection chrome, and HTML overlays on the canvas cannot eat the click.
   */
  private consumeTablePlacementPointer(event: PointerEvent): boolean {
    if (isInteractiveUiTarget(event.target)) {
      return false;
    }
    if (!this.isTablePlacing() || event.button !== 0) {
      return false;
    }
    if (!this.pointerInsideSvg(event)) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const id = this.canvas.tablePlacementElementId();
    const pt = this.toCanvasPct(event.clientX, event.clientY);
    if (id && pt) {
      this.canvas.placeTableAt(id, pt);
    }
    return true;
  }

  private pointerInsideSvg(event: PointerEvent): boolean {
    const svg = this.svgRef()?.nativeElement;
    if (!svg) {
      return false;
    }
    const r = svg.getBoundingClientRect();
    return (
      event.clientX >= r.left &&
      event.clientX <= r.right &&
      event.clientY >= r.top &&
      event.clientY <= r.bottom
    );
  }

  /**
   * While placing an entrance/exit, swallow canvas pointerdowns so they cannot
   * deselect the block, open another block, or bubble into navigation.
   * Placement itself only succeeds on a selected-block edge hit.
   */
  private consumeAccessPointPlacementPointer(event: PointerEvent): boolean {
    if (isInteractiveUiTarget(event.target)) {
      return false;
    }
    if (!this.isAccessPointPlacing() || event.button !== 0) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    const id = this.canvas.accessPointPlacementElementId();
    const pt = this.toCanvasPct(event.clientX, event.clientY);
    if (id && pt) {
      this.canvas.placeAccessPointAt(id, pt);
    }
    return true;
  }

  private async loadReferenceBitmap(dataUrl: string | null): Promise<void> {
    if (!dataUrl) {
      this.referenceBitmap.set(null);
      this.referenceNaturalSize.set(null);
      return;
    }
    try {
      const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
      this.referenceBitmap.set(img);
      this.referenceNaturalSize.set({ width: img.width, height: img.height });
    } catch {
      this.referenceBitmap.set(null);
      this.referenceNaturalSize.set(null);
    }
  }

  private drag: DragSession | null = null;
  private ringBlockDrag: RingBlockDragSession | null = null;
  private rotateSession: RotateSession | null = null;
  private featureRotateSession: DiningFeatureRotateSession | null = null;
  private vertexDrag: VertexDragSession | null = null;
  private drawAisleDrag: {
    aisleId: string;
    mode: 'start' | 'end' | 'body';
    startLocal: { xPct: number; yPct: number };
    endLocal: { xPct: number; yPct: number };
    pointerStart: { xPct: number; yPct: number };
  } | null = null;
  private resizeSession: ResizeSession | null = null;
  private seatDrag: SeatDragSession | null = null;
  private tableDrag: TableDragSession | null = null;
  private stageDrag: StageDragSession | null = null;
  private foodPrepareDrag: StageDragSession | null = null;
  private accessPointDrag: AccessPointDragSession | null = null;
  private featureResizeDrag: DiningFeatureResizeSession | null = null;
  private arrangeByRowDrag: { elementId: string } | null = null;
  private panning = false;
  private panPointer = { x: 0, y: 0 };
  private panSession: {
    startClientX: number;
    startClientY: number;
    startCameraX: number;
    startCameraY: number;
  } | null = null;
  private panFrameScheduled = false;
  private panPendingClient = { x: 0, y: 0 };
  private longPressSession: LongPressSession | null = null;
  private longPressTriggered = false;
  /** Short tap on a seat while watching for long-press — handled on pointer up. */
  private pendingSeatTap: { elementId: string; seatId: string } | null = null;
  private viewpointDrag: ViewpointDragSession | null = null;
  private labelDrag: { elementId: string } | null = null;
  /** Left-drag on empty canvas (or double-click-drag on a block) pans the workspace. */
  private bgPanDrag: {
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    /** Plain empty-space tap (normal mode) still clears the selection. */
    deselectOnTap: boolean;
    /** Auto Fill: a second tap without drag must still toggle the block. */
    tapToggleElement?: LayoutElement;
  } | null = null;
  /** Last primary-button press on an element — arms double-click-drag panning. */
  private lastElementTap: { elementId: string; atMs: number; x: number; y: number } | null = null;
  /** Dragging the dashed missing-block suggestion box to adjust its position. */
  private auditRegionDrag: {
    grabDX: number;
    grabDY: number;
    width: number;
    height: number;
  } | null = null;
  private lastDragFillSeatClick: { seatId: string; atMs: number } | null = null;
  private marquee: MarqueeSession | null = null;
  private parkingEdgeDrag: { id: string; edgeIndex: number } | null = null;
  /** Dragging one individually selected parking slot to adjust its position. */
  private parkingSlotDrag: {
    elementId: string;
    slotId: string;
    rect: PixelRect;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null = null;
  /** Bowing a not-yet-closed draft segment (mid-drawing, before the shape exists as an element). */
  private draftEdgeBowDrag: { segmentIndex: number } | null = null;
  /** True while the pointer hovers the first draft dot close enough to close a parking area. */
  protected readonly parkingCloseHoverActive = signal(false);

  protected readonly marqueeRect = signal<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // ── Hover tooltip ────────────────────────────────────────────────────────────
  /** Avoid rebuilding tooltip content while the pointer stays on the same target. */
  private hoverKey: string | null = null;

  /** Side chosen for venue-scale calibration — highlighted so "5 m" is unambiguous. */
  protected readonly venueScaleEdgeVm = computed(() => {
    const pick = this.canvas.venueScaleEdgePick();
    if (!pick) {
      return null;
    }
    const el = this.canvas.elements().find((item) => item.id === pick.elementId);
    if (!el || el.type !== 'centerpiece') {
      return null;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const points =
      (el.customPoints?.length ?? 0) >= 3
        ? el.customPoints!
        : [
            { xPct: 0, yPct: 0 },
            { xPct: 100, yPct: 0 },
            { xPct: 100, yPct: 100 },
            { xPct: 0, yPct: 100 },
          ];
    const polygon = polygonCanvasPointsFromBlock(points, rect);
    const edge = buildBlockMeasureEdges(polygon).find((item) => item.id === pick.edgeId);
    if (!edge) {
      return null;
    }
    return { x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2, midX: edge.midX, midY: edge.midY, label: edge.label };
  });

  private static readonly DRAG_FILL_DOUBLE_CLICK_MS = 420;
  private static readonly MARQUEE_DRAG_THRESHOLD_PX = 4;

  protected readonly inBlockWorkspace = computed(() => Boolean(this.canvas.blockWorkspaceId()));
  protected readonly blockViewpointMode = computed(() => this.canvas.blockWorkspaceNeedsViewpoint());

  protected readonly viewpointGuides = computed(() => {
    const layout = this.canvas.blockWorkspaceViewpointLayout();
    if (!layout) {
      return [];
    }
    const interactive = this.blockViewpointMode();
    const measuringSides = Boolean(this.canvas.gaCanvasWorkspaceEdges()?.length);
    const confirmed =
      !interactive &&
      this.inBlockWorkspace() &&
      this.canvas.blockWorkspaceViewpointConfirmed();
    if (!interactive && (!confirmed || measuringSides)) {
      return [];
    }
    const ui = 1 / Math.max(0.35, this.canvas.zoom() / 100);
    const zoom = Math.max(1, this.canvas.zoom() / 100);
    const offsetPx = Math.max(6, 12 / zoom);
    const logicalEdges =
      layout.logicalEdges?.length > 0
        ? layout.logicalEdges
        : layout.logicalEdge
          ? [layout.logicalEdge]
          : [];
    const edges = logicalEdges.map((logicalEdge) =>
      offsetEdgeSegmentOutward(
        layout.polygon,
        { x1: logicalEdge.x1, y1: logicalEdge.y1, x2: logicalEdge.x2, y2: logicalEdge.y2 },
        offsetPx,
      ),
    );
    if (edges.length === 0) {
      const fallback = edgeSegment(layout.polygon, layout.sideIndex);
      if (fallback) {
        edges.push(offsetEdgeSegmentOutward(layout.polygon, fallback, offsetPx));
      }
    }
    return [
      {
        ui,
        edges,
        edge: edges[0] ?? null,
        interactive,
        cx: layout.rect.cx,
        cy: layout.rect.cy,
        orbitR: layout.distance,
        minDist: layout.minDist,
        x: layout.position.x,
        y: layout.position.y,
        labelW: 120 * ui,
        labelH: 32 * ui,
        fontSize: 12 * ui,
      },
    ];
  });
  protected readonly isDrawing = computed(() => Boolean(this.canvas.drawingElementId()));
  /** True while placing a brand-new parking area's outline, or redrawing an existing one. */
  protected readonly isParkingAreaDrawing = computed(() => {
    const drawingId = this.canvas.drawingElementId();
    if (!drawingId) {
      return false;
    }
    if (drawingId === PARKING_AREA_DRAFT_ID) {
      return true;
    }
    const el = this.canvas.elements().find((item) => item.id === drawingId);
    return Boolean(el && isParkingArea(el));
  });
  protected readonly isSeatRowDrawing = computed(() =>
    Boolean(this.canvas.seatRowDrawingElementId()),
  );
  protected readonly isLineSeatDrawing = computed(() =>
    Boolean(this.canvas.lineSeatDrawingElementId()),
  );
  protected readonly isParkingAccessPlacing = computed(() =>
    Boolean(this.canvas.parkingAccessPlacementElementId()),
  );
  protected readonly isParkingSlotDrawing = computed(() =>
    Boolean(this.canvas.parkingSlotDrawingElementId()),
  );
  protected readonly isParkingRouteDrawing = computed(() =>
    Boolean(this.canvas.parkingRouteDrawingElementId()),
  );
  protected readonly isParkingCustomSlotDrawing = computed(() =>
    Boolean(this.canvas.parkingCustomSlotDrawingElementId()),
  );
  protected readonly isServiceRouteDrawing = computed(() =>
    Boolean(this.canvas.serviceRouteDrawingElementId()),
  );
  protected readonly isPerSeatPlacing = computed(() =>
    Boolean(this.canvas.perSeatPlacementElementId()),
  );
  protected readonly isDrawAislePlacing = computed(() =>
    Boolean(this.canvas.drawAisleSession()),
  );
  protected readonly drawAisleHoverPx = signal<{ x: number; y: number } | null>(null);
  protected readonly isTablePlacing = computed(() =>
    Boolean(this.canvas.tablePlacementElementId()),
  );
  protected readonly isAccessPointPlacing = computed(() =>
    Boolean(this.canvas.accessPointPlacementElementId()),
  );
  protected readonly isExitPlacing = this.isAccessPointPlacing;
  protected readonly canDragDiningAccessPoints = computed(
    () => !this.canvas.diningAccessPointsLocked(),
  );

  protected readonly accessPointPlacementPreviewVm = computed(() =>
    this.canvas.accessPointPlacementPreview(),
  );
  protected readonly isArrangeByRowActive = computed(() =>
    Boolean(this.canvas.arrangeByRowElementId()),
  );
  protected readonly arrangeByRowMeasureMode = computed(() => this.canvas.isArrangeByRowMeasureMode());
  protected readonly stageSidePickMode = computed(() => this.canvas.isStageSidePickMode());
  protected readonly foodPrepareSidePickMode = computed(() => this.canvas.isFoodPrepareSidePickMode());
  /** Side overlays while measuring. Hidden after Save/Update so only the block shape remains. */
  protected readonly gaWorkspaceEdges = computed(() => this.canvas.gaCanvasWorkspaceEdges());

  protected readonly stageSidePickEdges = computed(() => {
    if (!this.stageSidePickMode()) {
      return null;
    }
    const id = this.canvas.stageSidePickElementId();
    if (!id) {
      return null;
    }
    const el = this.canvas.elements().find((item) => item.id === id);
    if (!el || el.type !== 'centerpiece' || !hasTracedBlockOutline(el)) {
      return null;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const zoom = Math.max(1, this.canvas.zoom() / 100);
    const offsetPx = Math.max(8, 14 / zoom);
    const hitWidth = Math.max(24, 40 / zoom);
    const lineWidth = Math.max(5, 8 / zoom);
    const currentSide = el.diningStage?.sideEdgeId;
    const logical = buildBlockMeasureEdges(polygon);
    return logical.map((edge) => {
      const drawn = offsetEdgeSegmentOutward(
        polygon,
        { x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2 },
        offsetPx,
      );
      const isCurrent = currentSide === edge.id;
      return {
        id: edge.id,
        ...drawn,
        label: edge.label,
        stroke: isCurrent ? '#2563eb' : '#f59e0b',
        strokeWidth: lineWidth + (isCurrent ? 1 : 0),
        hitWidth,
        labelSize: Math.max(9, 11 / zoom),
      };
    });
  });

  protected readonly foodPrepareSidePickEdges = computed(() => {
    if (!this.foodPrepareSidePickMode()) {
      return null;
    }
    const id = this.canvas.foodPrepareSidePickElementId();
    if (!id) {
      return null;
    }
    const el = this.canvas.elements().find((item) => item.id === id);
    if (!el || el.type !== 'centerpiece' || !hasTracedBlockOutline(el)) {
      return null;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const zoom = Math.max(1, this.canvas.zoom() / 100);
    const offsetPx = Math.max(8, 14 / zoom);
    const hitWidth = Math.max(24, 40 / zoom);
    const lineWidth = Math.max(5, 8 / zoom);
    const currentSide = el.diningFoodPrepare?.sideEdgeId;
    const logical = buildBlockMeasureEdges(polygon);
    return logical.map((edge) => {
      const drawn = offsetEdgeSegmentOutward(
        polygon,
        { x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2 },
        offsetPx,
      );
      const isCurrent = currentSide === edge.id;
      return {
        id: edge.id,
        ...drawn,
        label: edge.label,
        stroke: isCurrent ? '#2563eb' : '#f59e0b',
        strokeWidth: lineWidth + (isCurrent ? 1 : 0),
        hitWidth,
        labelSize: Math.max(9, 11 / zoom),
      };
    });
  });

  protected readonly arrangeByRowMeasureEdges = computed(() => {
    if (!this.arrangeByRowMeasureMode()) {
      return null;
    }
    const id = this.canvas.arrangeByRowElementId();
    if (!id) {
      return null;
    }
    const el = this.canvas.elements().find((item) => item.id === id);
    if (!el || el.type !== 'centerpiece' || !hasTracedBlockOutline(el)) {
      return null;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const measured = this.canvas.arrangeByRowMeasuredSides();
    const pending = this.canvas.arrangeByRowPendingSideIds();
    const lengths = this.canvas.arrangeByRowDraftSideLengthsM();
    const names = this.canvas.arrangeByRowDraftSideNames();
    const zoom = Math.max(1, this.canvas.zoom() / 100);
    const offsetPx = Math.max(8, 14 / zoom);
    const hitWidth = Math.max(24, 40 / zoom);
    const lineWidth = Math.max(5, 8 / zoom);
    const activeWidth = Math.max(6, 10 / zoom);
    const logical = buildBlockMeasureEdges(polygon);
    const viewpointIds = new Set(
      (this.canvas.blockWorkspaceViewpointLayout()?.logicalEdges ?? []).map((edge) => edge.id),
    );
    return logical.map((edge) => {
      const drawn = offsetEdgeSegmentOutward(
        polygon,
        { x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2 },
        offsetPx,
      );
      const isMeasured = edge.sourceIndices.every((src) => measured[src]);
      const isActive = pending.includes(edge.id);
      const isPending = !isMeasured;
      const isViewpoint = viewpointIds.has(edge.id);
      const lengthM = edge.sourceIndices.reduce((sum, src) => sum + (lengths[src] ?? 0), 0);
      return {
        id: edge.id,
        index: edge.index,
        sourceIndices: edge.sourceIndices,
        ...drawn,
        label: storedNameForEdge(edge, names),
        lengthM,
        isMeasured,
        isActive,
        isPending,
        isViewpoint,
        stroke: isActive ? '#2563eb' : isViewpoint ? '#22c55e' : isMeasured ? '#22c55e' : '#e2e8f0',
        strokeWidth: isActive ? activeWidth : isViewpoint || isMeasured ? lineWidth + 1 : lineWidth,
        hitWidth,
        dashArray: isPending && !isViewpoint ? '10 7' : null,
        labelSize: Math.max(9, 11 / zoom),
      };
    });
  });

  protected readonly arrangeByRowMeasureTargetId = computed(() =>
    this.arrangeByRowMeasureMode() ? this.canvas.arrangeByRowElementId() : null,
  );

  /** Yellow edge highlight while hovering side-length fields in drag-seats wizard Step 1. */
  protected readonly dragSeatsHighlightEdge = computed(() => {
    const sideIndex = this.canvas.dragSeatsHighlightSideIndex();
    if (sideIndex == null) {
      return null;
    }
    const id = this.canvas.blockWorkspaceId() ?? this.canvas.selectedId();
    if (!id) {
      return null;
    }
    const el = this.canvas.elements().find((item) => item.id === id);
    if (!el || el.type !== 'centerpiece' || !hasTracedBlockOutline(el)) {
      return null;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);
    const seg = edgeSegment(polygon, sideIndex);
    if (!seg) {
      return null;
    }
    const zoom = Math.max(1, this.canvas.zoom() / 100);
    const offsetPx = Math.max(8, 14 / zoom);
    const lineWidth = Math.max(6, 10 / zoom);
    const drawn = offsetEdgeSegmentOutward(polygon, seg, offsetPx);
    return {
      ...drawn,
      strokeWidth: lineWidth,
    };
  });

  /** One row per raw parking-outline edge — active only during the mandatory "measure edges" step. */
  protected readonly parkingMeasureEdges = computed(() => {
    if (this.canvas.parkingWorkspaceStep() !== 'measure-edges') {
      return null;
    }
    const el = this.canvas.parkingWorkspaceElement();
    if (!el || !isParkingArea(el)) {
      return null;
    }
    const points = el.customPoints ?? [];
    const n = points.length;
    if (n < 3) {
      return null;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const bows = el.edgeBowAmounts ?? [];
    const lengths = el.customSideLengthsM ?? [];
    const pendingIndex = this.canvas.parkingMeasureEdgeIndex();
    const zoom = Math.max(1, this.canvas.zoom() / 100);
    const hitWidth = Math.max(24, 40 / zoom);
    const lineWidth = Math.max(5, 8 / zoom);
    const activeWidth = Math.max(6, 10 / zoom);
    const toPx = (p: ElementPosition) => ({
      x: rect.x + (p.xPct / 100) * rect.width,
      y: rect.y + (p.yPct / 100) * rect.height,
    });
    return points.map((_, index) => {
      const a = toPx(points[index]);
      const b = toPx(points[(index + 1) % n]);
      const bow = bows[index] ?? 0;
      const sampled = Math.abs(bow) < 0.005 ? [a, b] : sampleBowedEdge(a, b, bow);
      const mid = sampled[Math.floor(sampled.length / 2)];
      const lengthM = lengths[index] && lengths[index] > 0 ? lengths[index] : null;
      const isPending = pendingIndex === index;
      const isDone = lengthM != null;
      return {
        index,
        pointsStr: sampled.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '),
        midX: mid.x,
        midY: mid.y,
        lengthM,
        isPending,
        isDone,
        stroke: isDone ? '#22c55e' : isPending ? '#eab308' : '#94a3b8',
        strokeWidth: isPending ? activeWidth : isDone ? lineWidth + 1 : lineWidth,
        hitWidth,
        labelSize: Math.max(9, 11 / zoom),
      };
    });
  });
  protected readonly isDragFillSeatsActive = computed(() =>
    Boolean(this.canvas.dragFillSeatsElementId()),
  );
  protected readonly isCanvasToolActive = computed(
    () =>
      this.isDrawing() ||
      this.isSeatRowDrawing() ||
      this.isLineSeatDrawing() ||
      this.isParkingSlotDrawing() ||
      this.isParkingRouteDrawing() ||
      this.isParkingCustomSlotDrawing() ||
      this.isParkingAccessPlacing() ||
      this.isPerSeatPlacing() ||
      this.isDrawAislePlacing() ||
      this.isTablePlacing() ||
      this.isExitPlacing() ||
      this.isServiceRouteDrawing() ||
      this.isArrangeByRowActive(),
  );
  protected readonly isColorDetecting = computed(
    () => this.canvas.colorDetectMode() && Boolean(this.canvas.referenceImage()),
  );
  protected readonly isMoveDragging = signal(false);

  /** Visible region in canvas coordinates — changes with zoom and pan. */
  protected readonly viewBox = computed(() => {
    const zoom = this.canvas.zoom() / 100;
    const viewW = this.width() / zoom;
    const viewH = this.height() / zoom;
    const cx = this.canvas.cameraX();
    const cy = this.canvas.cameraY();
    return {
      x: cx - viewW / 2,
      y: cy - viewH / 2,
      width: viewW,
      height: viewH,
    };
  });

  protected readonly svgViewBox = computed(() => {
    const override = this.canvas.panViewBoxOverride();
    if (override) {
      return override;
    }
    const vb = this.viewBox();
    return `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;
  });

  /** Dot grid extends beyond the viewport so panning always shows dots. */
  protected readonly gridBounds = computed(() =>
    getVisibleGridBounds(this.viewBox(), this.canvas.canvas()),
  );

  /** Live preview points in canvas pixels. */
  protected readonly draftPointList = computed<DraftPointPx[]>(() =>
    this.canvas.draftPoints().map((p) => ({
      x: (p.xPct / 100) * this.width(),
      y: (p.yPct / 100) * this.height(),
    })),
  );

  /** Complete button while dot-drawing — finishes the shape + names it. */
  protected completeCustomDraw(): void {
    const draftPoints = this.canvas.draftPoints();
    const wasNewDraft = this.canvas.drawingElementId() === '__draft__';
    this.canvas.finishDrawing();
    if (wasNewDraft) {
      this.nameDrawnBlock(draftPoints);
    }
    this.audit.onCustomDrawCompleted();
  }

  /**
   * Copies the blueprint's printed label AND chart colour onto a hand-drawn
   * block, so it looks the same as trace-created blocks.
   */
  private nameDrawnBlock(draftPct: { xPct: number; yPct: number }[]): void {
    const id = this.canvas.selectedId();
    const natural = this.referenceNaturalSize();
    if (!id || !natural || draftPct.length < 3) {
      return;
    }
    const canvasCfg = this.canvas.canvas();
    const drawRect = referenceImageDrawRect(
      canvasCfg,
      natural.width,
      natural.height,
      this.canvas.referenceImage()?.geometryScale ?? 1,
    );
    const imagePolygon = canvasPolygonToReferencePct(draftPct, canvasCfg, drawRect);
    let cx = 0;
    let cy = 0;
    for (const p of imagePolygon) {
      cx += p.xPct;
      cy += p.yPct;
    }
    const centroid = { xPct: cx / imagePolygon.length, yPct: cy / imagePolygon.length };
    const label = this.canvas.resolveTracedBlockLabel(imagePolygon, centroid, {
      imageWidth: natural.width,
      imageHeight: natural.height,
    });
    const sampledColor = this.sampleDrawnBlockColor(draftPct, drawRect);
    const patch: { name?: string; label?: string; style?: ReturnType<typeof blueprintBlockStyle> } = {};
    if (label) {
      patch.name = label;
      patch.label = label;
    }
    if (sampledColor) {
      patch.style = blueprintBlockStyle(sampledColor);
    }
    if (Object.keys(patch).length > 0) {
      // Same creation action — no separate history step for name/colour.
      this.canvas.updateSilent(id, patch);
    }
  }

  /** Average non-border chart colour inside the drawn polygon (canvas %). */
  private sampleDrawnBlockColor(
    draftPct: { xPct: number; yPct: number }[],
    drawRect: { x: number; y: number; width: number; height: number },
  ): string | null {
    const bitmap = this.referenceBitmap();
    if (!bitmap) {
      return null;
    }
    const canvasCfg = this.canvas.canvas();
    const polygon = draftPct.map((p) => ({
      xPct: (p.xPct / 100) * canvasCfg.width,
      yPct: (p.yPct / 100) * canvasCfg.height,
    }));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of polygon) {
      minX = Math.min(minX, p.xPct);
      minY = Math.min(minY, p.yPct);
      maxX = Math.max(maxX, p.xPct);
      maxY = Math.max(maxY, p.yPct);
    }
    const bx = Math.max(0, Math.floor(minX));
    const by = Math.max(0, Math.floor(minY));
    const bw = Math.min(canvasCfg.width, Math.ceil(maxX)) - bx;
    const bh = Math.min(canvasCfg.height, Math.ceil(maxY)) - by;
    if (bw < 4 || bh < 4) {
      return null;
    }
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = canvasCfg.width;
    sampleCanvas.height = canvasCfg.height;
    const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return null;
    }
    ctx.drawImage(bitmap, drawRect.x, drawRect.y, drawRect.width, drawRect.height);
    const img = ctx.getImageData(bx, by, bw, bh);
    const step = Math.max(1, Math.round(Math.min(bw, bh) / 48));
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;
    for (let y = 0; y < bh; y += step) {
      for (let x = 0; x < bw; x += step) {
        if (!pointInPolygon(bx + x, by + y, polygon)) {
          continue;
        }
        const pi = (y * bw + x) * 4;
        const r = img.data[pi];
        const g = img.data[pi + 1];
        const b = img.data[pi + 2];
        if (isBorderPixel(r, g, b, img.data[pi + 3])) {
          continue;
        }
        sumR += r;
        sumG += g;
        sumB += b;
        count += 1;
      }
    }
    if (count < 24) {
      return null;
    }
    return rgbToHex(sumR / count, sumG / count, sumB / count);
  }

  protected readonly seatRowDraftList = computed<DraftPointPx[]>(() =>
    this.canvas.seatRowDraftPoints().map((p) => ({
      x: (p.xPct / 100) * this.width(),
      y: (p.yPct / 100) * this.height(),
    })),
  );

  protected readonly seatRowDraftStr = computed(() =>
    this.seatRowDraftList()
      .map((p) => `${p.x},${p.y}`)
      .join(' '),
  );

  protected readonly lineSeatDraftList = computed<DraftPointPx[]>(() =>
    this.canvas.lineSeatDraftPoints().map((p) => ({
      x: (p.xPct / 100) * this.width(),
      y: (p.yPct / 100) * this.height(),
    })),
  );

  protected readonly lineSeatDraftStr = computed(() =>
    this.lineSeatDraftList()
      .map((p) => `${p.x},${p.y}`)
      .join(' '),
  );

  protected readonly parkingSlotDraftPointsPx = computed<DraftPointPx[]>(() =>
    this.canvas.parkingSlotDraftPoints().map((p) => ({
      x: (p.xPct / 100) * this.width(),
      y: (p.yPct / 100) * this.height(),
    })),
  );

  protected readonly parkingSlotDraftPathStr = computed(() =>
    this.parkingSlotDraftPointsPx()
      .map((p) => `${p.x},${p.y}`)
      .join(' '),
  );

  /**
   * Live ghost preview — refills as each new path point is clicked further away. Runs the
   * same `planParkingSlots` rule engine as the commit (outline containment, gate "way"
   * clearance, no overlap, cross-row car-width gap) so the ghost never shows a slot that
   * would be dropped on Finish.
   */
  protected readonly parkingSlotDraftPreview = computed(() => {
    const el = this.canvas.parkingWorkspaceElement();
    const vehicleType = this.canvas.parkingSlotDraftVehicleType();
    const pathPx = this.parkingSlotDraftPointsPx();
    const minPoints = this.canvas.parkingSlotDraftPattern() === 'one' ? 1 : 2;
    if (!el || !vehicleType || pathPx.length < minPoints) {
      return [];
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const outline = buildParkingOutlinePoints(rect, el.customPoints ?? [], el.edgeBowAmounts ?? []);
    if (outline.length < 3) {
      return [];
    }
    const ppm =
      computeParkingPxPerMeter(rect, el.customPoints ?? [], el.customSideLengthsM ?? []) ??
      pxPerMeter(rect, resolveBlockLengthM(el), resolveBlockWidthM(el));
    const defaults = this.parkingSlotDefaults.defaults()[vehicleType];
    const pattern = this.canvas.parkingSlotDraftPattern();
    const gateCenters = this.buildParkingAccessPointsPx(el, rect).map((g) => ({
      x: (g.x1 + g.x2) / 2,
      y: (g.y1 + g.y2) / 2,
    }));
    const existingSlots: SlotRect[] = (el.parkingSlots ?? []).map((s) => ({
      cx: rect.x + (s.xPct / 100) * rect.width,
      cy: rect.y + (s.yPct / 100) * rect.height,
      rotationDeg: s.rotationDeg,
      lengthPx: s.lengthM * ppm,
      widthPx: s.widthM * ppm,
    }));
    return planParkingSlots(pathPx, outline, ppm, defaults, pattern, { gateCenters, existingSlots }).map(
      (slot) => ({
        x: slot.cx,
        y: slot.cy,
        rotationDeg: slot.rotationDeg,
        lengthPx: slot.lengthPx,
        widthPx: slot.widthPx,
        vehicleType,
      }),
    );
  });

  protected readonly parkingRouteDraftPointsPx = computed<DraftPointPx[]>(() =>
    this.canvas.parkingRouteDraftPoints().map((p) => ({
      x: (p.xPct / 100) * this.width(),
      y: (p.yPct / 100) * this.height(),
    })),
  );

  protected readonly parkingRouteDraftPathStr = computed(() =>
    this.parkingRouteDraftPointsPx()
      .map((p) => `${p.x},${p.y}`)
      .join(' '),
  );

  /** Direction arrows at each segment midpoint of the in-progress route draft. */
  protected readonly parkingRouteDraftArrows = computed(() =>
    routeArrowsFromPoints(this.parkingRouteDraftPointsPx()),
  );

  protected readonly parkingCustomSlotDraftPointsPx = computed<DraftPointPx[]>(() =>
    this.canvas.parkingCustomSlotDraftPoints().map((p) => ({
      x: (p.xPct / 100) * this.width(),
      y: (p.yPct / 100) * this.height(),
    })),
  );

  protected readonly parkingCustomSlotDraftPathStr = computed(() =>
    this.parkingCustomSlotDraftPointsPx()
      .map((p) => `${p.x},${p.y}`)
      .join(' '),
  );

  protected readonly serviceRouteDraftList = computed<DraftPointPx[]>(() =>
    this.canvas.serviceRouteDraftPoints().map((p) => ({
      x: (p.xPct / 100) * this.width(),
      y: (p.yPct / 100) * this.height(),
    })),
  );

  protected readonly serviceRouteDraftStr = computed(() =>
    this.serviceRouteDraftList()
      .map((p) => `${p.x},${p.y}`)
      .join(' '),
  );

  protected readonly lineSeatPreviewSeats = computed(() => {
    if (!this.isLineSeatDrawing() || this.canvas.lineSeatDraftPoints().length < 2) {
      return [];
    }
    const id = this.canvas.lineSeatDrawingElementId();
    const el = id ? this.canvas.elements().find((item) => item.id === id) : null;
    if (!el || el.type !== 'centerpiece' || !hasTracedBlockOutline(el)) {
      return [];
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    return previewSeatsOnLineCanvasPx(el, rect, this.canvas.canvas(), this.canvas.lineSeatDraftPoints());
  });

  protected readonly seatRowCompletedDrafts = computed(() =>
    this.canvas.seatRowDraftRows().map((row) =>
      row.map((p) => ({
        x: (p.xPct / 100) * this.width(),
        y: (p.yPct / 100) * this.height(),
      })),
    ),
  );

  protected readonly pendingRowLinesCanvasPx = computed(() => {
    const pending = this.canvas.pendingSeatRow();
    if (!pending) {
      return [];
    }
    return getRowLinesCanvasPx(pending.rowLines, this.canvas.canvas());
  });

  protected readonly pendingLockedZoneStr = computed(() => {
    const pending = this.canvas.pendingSeatRow();
    const el = this.canvas.selected();
    if (!pending || !el || el.type !== 'centerpiece' || el.id !== pending.elementId) {
      return null;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const polygon = getPendingBlockPreviewPolygon(
      el,
      rect,
      this.canvas.canvas(),
      pending.rowLines,
      this.canvas.pendingBlockPreviewWidthM(),
      this.canvas.pendingBlockPreviewLengthM(),
    );
    if (polygon.length < 3) {
      return null;
    }
    return polygon.map((p) => `${p.x},${p.y}`).join(' ');
  });

  protected readonly lockedBlockZoneStrs = computed(() => {
    const el = this.canvas.selected();
    if (!el || el.type !== 'centerpiece') {
      return [];
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    return getLockedBlockPolygonsCanvasPx(el, rect)
      .filter((poly) => poly.length >= 3)
      .map((poly) => poly.map((p) => `${p.x},${p.y}`).join(' '));
  });

  protected readonly draftPointsStr = computed(() =>
    this.draftPointList()
      .map((p) => `${p.x},${p.y}`)
      .join(' '),
  );

  protected readonly draftPointCount = computed(() => this.canvas.draftPoints().length);

  protected readonly draftEdgeBowAmounts = computed(() => this.canvas.draftEdgeBowAmounts());

  /** Bowed version of the live draft preview — parking-area drawing only, straight otherwise. */
  protected readonly draftBowedPointList = computed<DraftPointPx[]>(() => {
    const bows = this.draftEdgeBowAmounts();
    if (!this.isParkingAreaDrawing() || bows.every((b) => Math.abs(b) < 0.005)) {
      return this.draftPointList();
    }
    return buildBowedOpenPolylinePoints(this.draftPointList(), bows);
  });

  protected readonly draftBowedPointsStr = computed(() =>
    this.draftBowedPointList()
      .map((p) => `${p.x},${p.y}`)
      .join(' '),
  );

  /** Drag handles at the midpoint of each already-placed segment (parking-area drawing only). */
  protected readonly draftEdgeBowHandles = computed(() => {
    if (!this.isParkingAreaDrawing()) {
      return [];
    }
    const points = this.draftPointList();
    const bows = this.draftEdgeBowAmounts();
    if (points.length < 2) {
      return [];
    }
    return Array.from({ length: points.length - 1 }, (_, i) => {
      const handle = getOpenEdgeBowHandleCanvasPx(points, bows, i);
      return handle ? { index: i, x: handle.x, y: handle.y } : null;
    }).filter((h): h is { index: number; x: number; y: number } => h != null);
  });

  protected readonly blockLayerVms = computed(() => {
    const selectedIds = new Set(this.canvas.selectedIds());
    return this.renderList().filter(
      (vm) =>
        (vm.sectors?.length ?? 0) > 0 ||
        (vm.rectBlocks?.length ?? 0) > 0 ||
        (!this.inBlockWorkspace() &&
          vm.el.type === 'centerpiece' &&
          hasTracedBlockOutline(vm.el) &&
          (vm.el.customPoints?.length ?? 0) >= 3 &&
          vm.shapeMode === 'polygon' &&
          !selectedIds.has(vm.el.id)),
    );
  });
  protected readonly seatLayerVms = computed(() =>
    this.renderList().filter((vm) => (vm.customSeats?.length ?? 0) > 0),
  );

  /** Pulsing rings so 1–few chairs in a tiny block are findable. */
  protected readonly seatFinderBeacons = computed(() => {
    const workspaceId = this.canvas.blockWorkspaceId();
    if (!workspaceId) {
      return [];
    }
    const vm = this.renderList().find((item) => item.el.id === workspaceId);
    const seats = vm?.customSeats ?? [];
    if (!vm || seats.length === 0) {
      return [];
    }
    const few = seats.length <= 12;
    const tiny = Math.min(vm.rect.width, vm.rect.height) < 36;
    if (!few && !tiny) {
      return [];
    }
    return seats.map((seat) => ({
      x: seat.x,
      y: seat.y,
      r: Math.max(12, (seat.chairScale ?? 1) * SEAT_GRAPHIC_SIZE * 0.9),
      transform: vm.transform,
    }));
  });

  /** Overview hit shapes painted above seats so aisles still count as the block. */
  protected readonly blockHoverHitVms = computed(() => {
    if (this.inBlockWorkspace()) {
      return [];
    }
    return this.renderList().filter((vm) => {
      const el = vm.el;
      return el.type === 'centerpiece' && Boolean(el.blockType) && el.blockType !== 'parking';
    });
  });

  protected readonly drawnAisleOverlay = computed(() => {
    const el = this.canvas.blockWorkspaceElement();
    if (!el || el.blockType !== 'seating' || !hasTracedBlockOutline(el)) {
      return null;
    }
    const config = this.canvas.autoFillSeatingConfig();
    // Only paint aisles that belong to this workspace block. If the shared
    // config still points at another block, fall back to this element's own
    // stored aisles so a previous draw aisle never appears here.
    const aisleSource =
      config.referenceBlockId === el.id
        ? config.aisles
        : el.autoFillAisles?.length
          ? el.autoFillAisles
          : [];
    const vm = this.renderList().find((item) => item.el.id === el.id);
    const rect = vm?.rect ?? rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const ppm = pxPerMeter(rect, resolveBlockLengthM(el), resolveBlockWidthM(el));
    const aisles = normalizeAutoFillAisles(aisleSource, config);
    const session = this.canvas.drawAisleSession();
    const hover = this.drawAisleHoverPx();
    const toPx = (p: { xPct: number; yPct: number }) => ({
      x: rect.x + (p.xPct / 100) * rect.width,
      y: rect.y + (p.yPct / 100) * rect.height,
    });
    const bands = aisles
      .filter((slot) => slot.type === 'draw' && isCompleteDrawnAisle(slot))
      .map((slot) => {
        const start = toPx(slot.drawStart!);
        const end = toPx(slot.drawEnd!);
        const widthPx = Math.max(6, (slot.widthM ?? 1) * ppm);
        return {
          id: slot.id ?? '',
          start,
          end,
          widthPx,
          startLocal: slot.drawStart!,
          endLocal: slot.drawEnd!,
        };
      });
    let pending: { start: { x: number; y: number }; end: { x: number; y: number } | null } | null =
      null;
    if (session?.pendingStart && session.blockId === el.id) {
      pending = {
        start: toPx(session.pendingStart),
        end: hover,
      };
    }
    if (bands.length === 0 && !pending) {
      return null;
    }
    return {
      transform: vm?.transform ?? null,
      handleR: Math.max(6, 8 / Math.max(1, this.canvas.zoom() / 100)),
      bands,
      pending,
    };
  });
  protected readonly tableLayerVms = computed(() =>
    this.renderList().filter((vm) => (vm.diningTables?.length ?? 0) > 0),
  );
  protected readonly stageLayerVms = computed(() =>
    this.renderList().filter((vm) => vm.diningStage != null),
  );
  protected readonly foodPrepareLayerVms = computed(() =>
    this.renderList().filter((vm) => vm.diningFoodPrepare != null),
  );
  protected readonly exitLayerVms = computed(() =>
    this.renderList().filter((vm) => vm.diningExit != null),
  );
  protected readonly entranceLayerVms = computed(() =>
    this.renderList().filter((vm) => vm.diningEntrance != null),
  );
  protected readonly sharedAccessLayerVms = computed(() =>
    this.renderList().filter((vm) => vm.diningSharedAccess != null),
  );
  protected readonly parkingSlotLayerVms = computed(() =>
    this.renderList().filter((vm) => (vm.parkingSlots?.length ?? 0) > 0),
  );
  protected readonly parkingAccessPointLayerVms = computed(() =>
    this.renderList().filter((vm) => (vm.parkingAccessPoints?.length ?? 0) > 0),
  );
  protected readonly parkingRouteLayerVms = computed(() =>
    this.renderList().filter((vm) => (vm.parkingRoutes?.length ?? 0) > 0),
  );

  /** Inverse canvas zoom so access labels stay ~12px on screen. */
  protected readonly accessPointUiScale = computed(
    () => 1 / Math.max(0.35, this.canvas.zoom() / 100),
  );

  protected readonly parkingDividerLineLayerVms = computed(() =>
    this.renderList().filter((vm) => (vm.parkingDividerLines?.length ?? 0) > 0),
  );
  protected readonly serviceRouteLayerVms = computed(() =>
    this.renderList().filter((vm) => (vm.diningServiceRoutes?.length ?? 0) > 0),
  );
  protected readonly referenceImageDraw = computed(() => {
    if (this.inBlockWorkspace()) {
      return null;
    }
    const ref = this.canvas.referenceImage();
    if (!ref?.dataUrl) {
      return null;
    }
    if (ref.visible === false) {
      return null;
    }
    const natural = this.referenceNaturalSize();
    if (!natural) {
      return null;
    }
    const drawRect = referenceImageDrawRect(
      this.canvas.canvas(),
      natural.width,
      natural.height,
      ref.geometryScale ?? 1,
    );
    return {
      href: ref.dataUrl,
      x: drawRect.x,
      y: drawRect.y,
      width: drawRect.width,
      height: drawRect.height,
      opacity: ref.opacity ?? 0.52,
    };
  });

  /** Pulsing rects for the blueprint audit panel's issue highlight. */
  protected readonly auditHighlightRects = computed(() => {
    const highlight = this.canvas.auditHighlight();
    if (!highlight) {
      return [];
    }
    const toBadge = (label: string | null | undefined, x: number, y: number, width: number, height: number, draggable: boolean) => {
      const text = label?.trim() || null;
      return {
        x,
        y,
        width,
        height,
        draggable,
        label: text,
        badgeWidth: text ? Math.max(28, text.length * 9 + 12) : 0,
      };
    };
    if (highlight.kind === 'region') {
      // Missing-block suggestion box: draggable to fine-tune the spot, except
      // while a trace/draw click inside the region is expected.
      const draggable = !this.canvas.colorDetectMode() && !this.isDrawing();
      return [
        toBadge(
          highlight.label,
          highlight.rect.x,
          highlight.rect.y,
          highlight.rect.width,
          highlight.rect.height,
          draggable,
        ),
      ];
    }
    const canvas = this.canvas.canvas();
    const elements = this.canvas.elements();
    const rects: ReturnType<typeof toBadge>[] = [];
    for (const id of highlight.ids) {
      const el = elements.find((item) => item.id === id);
      if (el) {
        const rect = rectFromPositionSize(el.position, el.size, canvas);
        rects.push(
          toBadge(
            (el.type === 'centerpiece' ? el.label || el.name : el.name) || null,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            false,
          ),
        );
      }
    }
    return rects;
  });

  /** Grab the dashed missing-block box so it can be dragged to the right spot. */
  protected onAuditHighlightPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    const highlight = this.canvas.auditHighlight();
    if (highlight?.kind !== 'region') {
      return;
    }
    const pt = this.toCanvasPx(event.clientX, event.clientY);
    if (!pt) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // Keep the box alive while the user adjusts it (no auto-clear mid-drag).
    this.canvas.setAuditHighlight(highlight, 0);
    this.auditRegionDrag = {
      grabDX: pt.x - highlight.rect.x,
      grabDY: pt.y - highlight.rect.y,
      width: highlight.rect.width,
      height: highlight.rect.height,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  protected readonly renderList = computed<ElementVM[]>(() => {
    this.canvas.seatHydrationPhase();
    this.canvas.seatRenderBudget();
    this.resetSeatBudgetCursor();
    const selectedIds = new Set(this.canvas.selectedIds());
    const selectedSeatId = this.canvas.selectedSeatId();
    const selectedSeatElementId = this.canvas.selectedSeatElementId();
    const selectedRow = this.canvas.selectedCustomRow();
    const workspaceId = this.canvas.blockWorkspaceId();
    return this.canvas
      .elements()
      .filter((el) => {
        if (workspaceId && el.id !== workspaceId) {
          return false;
        }
        if (!isElementVisible(el)) {
          return false;
        }
        if (el.type === 'centerpiece' && hasTracedBlockOutline(el)) {
          return (el.customPoints?.length ?? 0) >= 3;
        }
        return true;
      })
      .map((el) =>
        this.buildVm(
          el,
          selectedIds.has(el.id),
          // Seat ids repeat per block — only highlight in the owning element.
          selectedSeatElementId === el.id ? selectedSeatId : null,
          selectedRow,
        ),
      );
  });

  protected readonly selectionOverlays = computed<SelectionOverlayVM[]>(() => {
    if (this.isCanvasToolActive()) {
      return [];
    }
    const ids = this.canvas.selectedIds();
    if (ids.length === 0) {
      return [];
    }
    const multi = ids.length > 1;
    const autoFillLayout = this.canvas.autoFillLayoutMode();
    return ids
      .map((id) => this.canvas.elements().find((el) => el.id === id))
      .filter((el): el is LayoutElement => !!el && isElementVisible(el))
      // Auto Fill: outline only (no move/resize handles) so clicks toggle selection.
      .map((el) => this.buildSelectionOverlay(el, !multi && !autoFillLayout));
  });

  protected readonly handlePositions = HANDLE_POSITIONS;

  protected trackVm = (_: number, vm: ElementVM) => vm.el.id;
  protected trackSeat = (_: number, seat: SeatNode) => seat.key;
  protected trackCustomSeat = (_: number, seat: CustomSeatVM) => seat.seatId;
  protected trackLabel = (_: number, label: RowLabelNode) => label.key;
  protected trackSector = (_: number, s: SectorVM) => s.id;
  protected trackRect = (_: number, b: RectBlockVM) => b.id;
  protected trackHandle = (_: number, pos: HandlePos) => pos;
  protected trackVertex = (_: number, v: VertexVM) => v.index;
  protected trackDraft = (_: number, pt: DraftPointPx) => `${pt.x}-${pt.y}`;

  protected draftRowPointsStr(row: DraftPointPx[]): string {
    return row.map((p) => `${p.x},${p.y}`).join(' ');
  }

  // --- Interaction ---

  protected readonly diningTableStroke = DINING_TABLE_STROKE;
  protected readonly diningTableStrokeSelected = DINING_TABLE_STROKE_SELECTED;
  protected readonly diningTableChairArcPath = diningTableChairArcPath;

  protected diningTableLabelFontSize(table: DiningTableRenderNode): number {
    return Math.min(9, table.widthPx * 0.22);
  }

  protected diningTableHitRadius(table: DiningTableRenderNode): number {
    return Math.max(table.widthPx, table.heightPx) / 2 + table.chairHalfDepthPx * 2;
  }

  protected diningTableHitHalfWidth(table: DiningTableRenderNode): number {
    return table.widthPx / 2 + table.chairHalfDepthPx * 2;
  }

  protected diningTableHitHalfHeight(table: DiningTableRenderNode): number {
    return table.heightPx / 2 + table.chairHalfDepthPx * 2;
  }

  protected diningTableStrokeFor(table: DiningTableRenderNode): string {
    if (table.accessCategory) {
      return DINING_TABLE_ACCESS_STROKE[table.accessCategory];
    }
    return this.diningTableStroke;
  }

  protected diningReferenceAligned(ref: DiningLayoutReferenceImage): boolean {
    return hasDiningReferenceAlignment(ref);
  }

  protected diningReferenceViewBox(ref: DiningLayoutReferenceImage): string {
    if (!hasDiningReferenceAlignment(ref)) {
      return '0 0 1 1';
    }
    return diningReferenceImageViewBox(ref);
  }

  protected diningBackgroundManualFit(ref: DiningLayoutReferenceImage): boolean {
    return diningBackgroundUsesManualFit(ref);
  }

  protected diningBackgroundVisible(ref: DiningLayoutReferenceImage): boolean {
    return ref.visible !== false;
  }

  protected diningBackgroundDrawFor(vm: ElementVM, ref: DiningLayoutReferenceImage) {
    const fit = diningBackgroundFitFromRef(ref);
    return diningBackgroundDraw(ref, vm.rect, {
      ...fit,
      opacity: this.diningBackgroundOpacity(ref),
    });
  }

  protected diningBackgroundOpacity(ref: DiningLayoutReferenceImage): number {
    if (diningBackgroundUsesManualFit(ref)) {
      const opacity = ref.opacity ?? 1;
      return opacity <= DEFAULT_DINING_BACKGROUND_OPACITY ? 1 : opacity;
    }
    return ref.opacity ?? DEFAULT_DINING_BACKGROUND_OPACITY;
  }

  protected diningBackgroundFillOpacity(ref: DiningLayoutReferenceImage | undefined): number {
    if (ref && this.diningBackgroundVisible(ref)) {
      return 0.05;
    }
    return 1;
  }

  protected diningClipUrl(elementId: string): string {
    return svgLocalClipUrl(`dining-ref-clip-${elementId}`);
  }

  protected accessPointDragHitStroke(openStroke: number): number {
    return Math.max(openStroke, 18 * this.accessPointUiScale());
  }

  protected accessPointBadgeSize(_node?: DiningStageRenderNode): {
    w: number;
    h: number;
    font: number;
    thickness: number;
    labelY: number;
  } {
    const ui = this.accessPointUiScale();
    const font = 12 * ui;
    return {
      w: 78 * ui,
      h: 18 * ui,
      font,
      // Kept for placement preview dash; committed openings use border stroke width.
      thickness: 5 * ui,
      labelY: -14 * ui,
    };
  }

  /**
   * Opening stroke in canvas units so it covers the block border segment
   * (not inverse-zoom UI scale — that made openings vanish at high zoom).
   */
  protected accessOpeningBorderStrokeWidth(vm: { strokeWidth: number }): number {
    return Math.max(vm.strokeWidth, 2) + 1.5;
  }

  protected accessOpeningStroke(kind: 'entrance' | 'exit' | 'shared' | 'emergency-exit'): string {
    if (kind === 'entrance') {
      return '#16a34a';
    }
    if (kind === 'exit' || kind === 'emergency-exit') {
      return '#dc2626';
    }
    return '#0f766e';
  }

  protected diningZoneLabelFontSize(zone: DiningStageRenderNode): number {
    const byHeight = zone.heightPx * 0.28;
    const byWidth = zone.widthPx * 0.12;
    return Math.max(6, Math.min(8, byHeight, byWidth));
  }

  protected diningZoneLabelVisible(zone: DiningStageRenderNode): boolean {
    return zone.widthPx >= 24 && zone.heightPx >= 10;
  }

  protected diningZoneStrokeWidth(selected: boolean): number {
    return selected ? 1.75 : 1.15;
  }

  protected foodPrepIconVisible(fp: DiningStageRenderNode): boolean {
    return diningFoodPrepIconVisible(fp.widthPx, fp.heightPx);
  }

  protected foodPrepIconScale(fp: DiningStageRenderNode): number {
    return diningFoodPrepIconScale(fp.widthPx, fp.heightPx);
  }

  protected foodPrepIconStrokeWidth(fp: DiningStageRenderNode): number {
    return 1.2 / Math.max(this.foodPrepIconScale(fp), 0.05);
  }

  protected readonly diningStageFill = DINING_STAGE_FILL;
  protected readonly diningStageStroke = DINING_STAGE_STROKE;
  protected readonly diningFoodPrepFill = DINING_FOOD_PREP_FILL;
  protected readonly diningFoodPrepStroke = DINING_FOOD_PREP_STROKE;
  protected readonly diningZoneLabelFill = DINING_ZONE_LABEL_FILL;
  protected readonly diningZoneSelectedStroke = DINING_ZONE_SELECTED_STROKE;

  private tryBeginArrangeByRow(event: PointerEvent, el?: LayoutElement): boolean {
    if (this.canvas.arrangeByRowWizardPhase() !== 'idle') {
      return false;
    }
    const activeId = this.canvas.arrangeByRowElementId();
    if (!activeId || this.canvas.isArrangeByRowDragging() || this.arrangeByRowDrag) {
      return false;
    }
    if (!this.inBlockWorkspace() || this.canvas.blockWorkspaceId() !== activeId) {
      return false;
    }
    const target =
      el && el.id === activeId
        ? el
        : this.canvas.elements().find((item) => item.id === activeId) ?? null;
    if (!target || target.type !== 'centerpiece' || !hasTracedBlockOutline(target)) {
      return false;
    }
    if (target.interactiveSeatingLocked) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    const pt = this.toCanvasPct(event.clientX, event.clientY);
    if (!pt) {
      return true;
    }
    const rect = rectFromPositionSize(target.position, target.size, this.canvas.canvas());
    if (!isCanvasPctInsideCustomShape(target, rect, this.canvas.canvas(), pt)) {
      return true;
    }
    this.canvas.beginGesture();
    if (this.canvas.beginArrangeByRowAnchorAt(activeId, pt)) {
      this.arrangeByRowDrag = { elementId: activeId };
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    } else {
      this.canvas.cancelGesture();
    }
    return true;
  }

  protected onBackgroundPointerDown(event: PointerEvent): void {
    if (isInteractiveUiTarget(event.target)) {
      return;
    }
    if (event.button === 1) {
      event.preventDefault();
      this.panning = true;
      this.beginPanSession(event.clientX, event.clientY);
      this.panPointer = { x: event.clientX, y: event.clientY };
      return;
    }
    if (event.button !== 0) {
      return;
    }
    if (this.consumeAccessPointPlacementPointer(event)) {
      return;
    }
    if (this.isDrawing()) {
      event.preventDefault();
      if (this.isParkingAreaDrawing() && this.draftPointCount() >= 3) {
        const px = this.toCanvasPx(event.clientX, event.clientY);
        if (px && this.isNearFirstDraftPointPx(px)) {
          this.canvas.finishDrawing();
          this.parkingCloseHoverActive.set(false);
          return;
        }
      }
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (pt) {
        this.canvas.addDraftPoint(pt);
      }
      return;
    }
    if (this.isSeatRowDrawing()) {
      event.preventDefault();
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (pt) {
        this.canvas.addSeatRowDraftPoint(pt);
      }
      return;
    }
    if (this.isParkingSlotDrawing()) {
      event.preventDefault();
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (pt) {
        this.canvas.addParkingSlotDraftPoint(pt);
      }
      return;
    }
    if (this.isParkingRouteDrawing()) {
      event.preventDefault();
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (pt) {
        this.canvas.addParkingRouteDraftPoint(pt);
      }
      return;
    }
    if (this.isParkingCustomSlotDrawing()) {
      event.preventDefault();
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (pt) {
        this.canvas.addParkingCustomSlotDraftPoint(pt);
      }
      return;
    }
    if (this.isLineSeatDrawing()) {
      event.preventDefault();
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (pt) {
        this.canvas.addLineSeatDraftPoint(pt);
      }
      return;
    }
    if (this.isServiceRouteDrawing()) {
      event.preventDefault();
      const id = this.canvas.serviceRouteDrawingElementId();
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (!id || !pt) {
        return;
      }
      const el = this.canvas.elements().find((item) => item.id === id);
      if (!el || el.type !== 'centerpiece' || !hasTracedBlockOutline(el)) {
        return;
      }
      const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
      if (isCanvasPctInsideCustomShape(el, rect, this.canvas.canvas(), pt)) {
        this.canvas.addServiceRouteDraftPoint(pt);
      }
      return;
    }
    if (this.isDrawAislePlacing()) {
      event.preventDefault();
      const session = this.canvas.drawAisleSession();
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (!session || !pt) {
        return;
      }
      const el = this.canvas.elements().find((item) => item.id === session.blockId);
      if (!el || el.type !== 'centerpiece' || !hasTracedBlockOutline(el)) {
        return;
      }
      const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
      if (isCanvasPctInsideCustomShape(el, rect, this.canvas.canvas(), pt)) {
        this.canvas.placeDrawAislePoint(el.id, pt);
      }
      return;
    }
    if (this.isPerSeatPlacing()) {
      event.preventDefault();
      const id = this.canvas.perSeatPlacementElementId();
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (!id || !pt) {
        return;
      }
      const el = this.canvas.elements().find((item) => item.id === id);
      if (!el || el.type !== 'centerpiece' || !hasTracedBlockOutline(el)) {
        return;
      }
      const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
      if (isCanvasPctInsideCustomShape(el, rect, this.canvas.canvas(), pt)) {
        this.canvas.placePerSeatAt(id, pt);
      }
      return;
    }
    if (this.isTablePlacing()) {
      event.preventDefault();
      const id = this.canvas.tablePlacementElementId();
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (id && pt) {
        this.canvas.placeTableAt(id, pt);
      }
      return;
    }
    if (this.tryBeginArrangeByRow(event)) {
      return;
    }
    if (this.isColorDetecting()) {
      event.preventDefault();
      void this.handleColorDetectClick(event.clientX, event.clientY);
      return;
    }
    if (this.blockViewpointMode()) {
      event.preventDefault();
      this.beginViewpointDrag(event);
      return;
    }
    // Auto Fill layout mode: empty workspace clicks must not clear multi-selected
    // blocks — but dragging empty space still pans the workspace.
    if (this.canvas.autoFillLayoutMode()) {
      this.bgPanDrag = {
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
        deselectOnTap: false,
      };
      return;
    }
    const pt = this.toCanvasPx(event.clientX, event.clientY);
    if (pt && !this.isCanvasToolActive()) {
      const workspace = this.inBlockWorkspace();
      if (event.shiftKey && !workspace) {
        // Shift+drag keeps the marquee multi-select.
        this.marquee = {
          startX: pt.x,
          startY: pt.y,
          currentX: pt.x,
          currentY: pt.y,
          active: false,
        };
        return;
      }
      // Plain drag on empty canvas pans the workspace; a plain tap deselects.
      this.bgPanDrag = {
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
        deselectOnTap: !workspace || !this.isInteractiveCanvasTarget(event.target),
      };
      return;
    }
    if (this.isInteractiveCanvasTarget(event.target)) {
      return;
    }
    this.canvas.selectElement(null);
  }

  /** Ignore background deselect when the pointer hit a block, seat, table, or handle. */
  private isInteractiveCanvasTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
      return false;
    }
    return Boolean(
      target.closest(
        '.canvas-stage-el, .canvas-stage-seat, .canvas-stage-table, .canvas-stage-dining-stage, .canvas-stage-service-route, .canvas-stage-overlay, .canvas-stage-block-layer, .canvas-stage-viewpoint-marker, .canvas-stage-measure-edge-hit',
      ),
    );
  }

  private canOpenBlockWorkspace(el: LayoutElement): boolean {
    return (
      !this.inBlockWorkspace() &&
      !this.canvas.autoFillLayoutMode() &&
      isCustomizableBlock(el) &&
      !this.isCanvasToolActive()
    );
  }

  private canInteractWithPlacementSeating(el: LayoutElement): boolean {
    if (!this.inBlockWorkspace() || this.canvas.blockWorkspaceId() !== el.id) {
      return false;
    }
    return el.type !== 'centerpiece' || !el.interactiveSeatingLocked;
  }

  private openBlockWorkspace(el: LayoutElement): void {
    if (!this.canOpenBlockWorkspace(el)) {
      return;
    }
    this.clearLongPress(false);
    this.canvas.enterBlockWorkspace(el.id);
  }

  private beginViewpointDrag(event: PointerEvent): void {
    const pt = this.toCanvasPx(event.clientX, event.clientY);
    if (!pt) {
      return;
    }
    this.canvas.setBlockWorkspaceViewpointFromCanvasPoint(pt.x, pt.y);
    this.viewpointDrag = { pointerId: event.pointerId };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  protected onSeatPointerDown(event: PointerEvent, el: LayoutElement, seatId: string): void {
    if (event.button !== 0) {
      return;
    }
    // Auto Fill layout: seat clicks toggle the parent block in/out of the fill set.
    if (
      this.canvas.autoFillLayoutMode() &&
      el.type === 'centerpiece' &&
      isAutoFillEligibleBlock(el)
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.toggleMultiSelect(el);
      return;
    }
    if (this.isDrawAislePlacing()) {
      const session = this.canvas.drawAisleSession();
      if (session && el.id === session.blockId) {
        event.preventDefault();
        event.stopPropagation();
        const pt = this.toCanvasPct(event.clientX, event.clientY);
        if (pt) {
          this.canvas.placeDrawAislePoint(el.id, pt);
        }
      }
      return;
    }
    if (this.consumeAccessPointPlacementPointer(event)) {
      return;
    }
    if (this.canOpenBlockWorkspace(el)) {
      event.preventDefault();
      event.stopPropagation();
      this.pendingSeatTap = { elementId: el.id, seatId };
      this.beginLongPress(event, el);
      return;
    }
    let arrangeByRowRowIndex: number | undefined;
    let dragFillDragMode = false;
    const placementSeating = this.canInteractWithPlacementSeating(el);
    if (
      placementSeating &&
      el.type === 'centerpiece' &&
      hasTracedBlockOutline(el) &&
      el.dragFillSeatsMode &&
      !this.canvas.isArrangeByRowDragging()
    ) {
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      const rowExtend = getDragFillRowExtendInfo(el, seatId);
      const isDoubleClick =
        event.detail >= 2 ||
        (this.lastDragFillSeatClick?.seatId === seatId &&
          now - this.lastDragFillSeatClick.atMs < CanvasStageComponent.DRAG_FILL_DOUBLE_CLICK_MS);
      this.lastDragFillSeatClick = { seatId, atMs: now };

      if (!rowExtend || !isDoubleClick) {
        this.canvas.selectElement(el.id);
        this.canvas.selectSeat(seatId, el.id);
        return;
      }
      dragFillDragMode = true;
      arrangeByRowRowIndex = rowExtend.rowIndex;
    } else if (
      placementSeating &&
      el.type === 'centerpiece' &&
      hasTracedBlockOutline(el) &&
      el.arrangeByRowMode &&
      !this.canvas.isArrangeByRowDragging()
    ) {
      const lastSeat = getArrangeByRowLastSeatInfo(el, seatId);
      if (lastSeat) {
        arrangeByRowRowIndex = lastSeat.rowIndex;
      }
    }
    if (!arrangeByRowRowIndex && !dragFillDragMode && this.isCanvasToolActive() && !this.isPerSeatPlacing()) {
      return;
    }
    if (
      el.type === 'centerpiece' &&
      el.arrangeByRowMode &&
      !arrangeByRowRowIndex &&
      !dragFillDragMode &&
      !el.dragFillSeatsMode &&
      // Inside the unlocked block workspace individual seats stay draggable.
      !placementSeating
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.canvas.selectElement(el.id);
      this.canvas.selectSeat(seatId, el.id);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.canvas.selectElement(el.id);
    this.canvas.selectSeat(seatId, el.id);
    this.seatDrag = {
      elementId: el.id,
      seatId,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      dragging: false,
      arrangeByRowRowIndex,
      dragFillDragMode,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  protected onTablePointerDown(event: PointerEvent, el: LayoutElement, tableId: string): void {
    if (event.button !== 0) {
      return;
    }
    if (this.consumeAccessPointPlacementPointer(event)) {
      return;
    }
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    if (this.canOpenBlockWorkspace(el)) {
      event.preventDefault();
      event.stopPropagation();
      this.canvas.selectDiningTable(tableId, { additive });
      this.beginLongPress(event, el);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.canvas.selectElement(el.id);
    this.canvas.selectDiningTable(tableId, { additive });
    this.tableDrag = {
      elementId: el.id,
      tableId,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      dragging: false,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  protected onServiceRoutePointerDown(event: PointerEvent, el: LayoutElement, routeId: string): void {
    if (this.consumeAccessPointPlacementPointer(event)) {
      return;
    }
    if (event.button !== 0 || this.isServiceRouteDrawing()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.canvas.selectElement(el.id);
    this.canvas.selectDiningServiceRoute(routeId);
  }

  protected onStagePointerDown(event: PointerEvent, el: LayoutElement): void {
    if (this.consumeAccessPointPlacementPointer(event)) {
      return;
    }
    if (event.button !== 0 || el.type !== 'centerpiece' || !hasDiningStage(el) || this.stageSidePickMode()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.canvas.selectElement(el.id);
    this.canvas.selectDiningStage(true);
    this.stageDrag = {
      elementId: el.id,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      dragging: false,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  protected onFoodPreparePointerDown(event: PointerEvent, el: LayoutElement): void {
    if (this.consumeAccessPointPlacementPointer(event)) {
      return;
    }
    if (event.button !== 0 || el.type !== 'centerpiece' || !hasDiningFoodPrepare(el) || this.foodPrepareSidePickMode()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.canvas.selectElement(el.id);
    this.canvas.selectDiningFoodPrepare(true);
    this.foodPrepareDrag = {
      elementId: el.id,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      dragging: false,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  protected onDiningAccessPointerDown(
    event: PointerEvent,
    el: LayoutElement,
    kind: DiningAccessPointKind,
  ): void {
    if (this.consumeAccessPointPlacementPointer(event)) {
      return;
    }
    if (this.isAccessPointPlacing()) {
      event.stopPropagation();
      return;
    }
    if (
      !this.canDragDiningAccessPoints() ||
      event.button !== 0 ||
      el.type !== 'centerpiece'
    ) {
      return;
    }
    const placed =
      kind === 'shared'
        ? hasDiningSharedAccess(el)
        : kind === 'entrance'
          ? hasDiningEntrance(el)
          : hasDiningExit(el);
    if (!placed) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.canvas.selectElement(el.id);
    this.accessPointDrag = {
      elementId: el.id,
      kind,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      dragging: false,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  protected onRowLabelPointerDown(
    event: PointerEvent,
    el: LayoutElement,
    blockId?: string,
    rowIndex?: number,
  ): void {
    if (event.button !== 0 || this.isCanvasToolActive() || rowIndex == null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.canvas.selectElement(el.id);
    // Seats placed directly on the element (Create seats flow) have no
    // sub-block — the element id stands in so the row can still be selected.
    this.canvas.selectCustomRow(blockId ?? el.id, rowIndex);
  }

  protected onRowLabelDoubleClick(
    event: MouseEvent,
    el: LayoutElement,
    rowIndex?: number,
    blockId?: string,
  ): void {
    if (this.isCanvasToolActive() || rowIndex == null || el.type !== 'centerpiece') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.canvas.toggleRowLabelHidden(el.id, rowIndex, blockId);
  }

  protected updateHoverTooltip(event: PointerEvent): void {
    if (this.shouldSuppressHoverTooltip()) {
      this.clearHoverTooltip();
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest('.canvas-stage-parking-slot-layer')) {
      return;
    }
    const host = this.hostRef.nativeElement;
    if (!(target instanceof Node) || !host.contains(target)) {
      this.clearHoverTooltip();
      return;
    }
    const hit = this.hitTestHover(event);
    if (!hit) {
      this.clearHoverTooltip();
      return;
    }
    if (hit.kind === 'seat') {
      this.applySeatHover(hit.el, hit.seatId, event.clientX, event.clientY);
      return;
    }
    this.applyBlockHover(hit.el, event.clientX, event.clientY);
  }

  /** Friendly, full vehicle-type names for the slot hover card (the graphic uses short codes). */
  private static readonly PARKING_TYPE_LABELS: Record<ParkingVehicleType, string> = {
    car: 'Car',
    bus: 'Bus',
    wheelchair: 'Accessible',
    ev: 'EV charging',
    bike: 'Motorbike',
  };

  protected onParkingSlotMouseEnter(
    event: MouseEvent,
    slot: { label: string | null; vehicleType: ParkingVehicleType; lengthPx: number; widthPx: number },
    el: LayoutElement,
  ): void {
    if (el.type !== 'centerpiece') {
      return;
    }
    this.hoverKey = `slot:${el.id}:${slot.label ?? slot.vehicleType}`;
    this.hoverTip()?.show(this.buildParkingSlotTooltipVm(slot, el), event.clientX, event.clientY);
  }

  protected onParkingSlotMouseLeave(): void {
    this.clearHoverTooltip();
  }

  protected onBlockHoverEnter(event: PointerEvent, el: LayoutElement): void {
    if (this.shouldSuppressHoverTooltip() || el.type !== 'centerpiece') {
      return;
    }
    this.applyBlockHover(el, event.clientX, event.clientY);
  }

  private applyBlockHover(el: CenterpieceElement, clientX: number, clientY: number): void {
    const key = `block:${el.id}`;
    const tip = this.hoverTip();
    if (this.hoverKey !== key) {
      this.hoverKey = key;
      tip?.show(this.buildBlockTooltipVm(el), clientX, clientY);
      return;
    }
    tip?.move(clientX, clientY);
  }

  private applySeatHover(
    el: CenterpieceElement,
    seatId: string,
    clientX: number,
    clientY: number,
  ): void {
    const key = `seat:${el.id}:${seatId}`;
    const tip = this.hoverTip();
    if (this.hoverKey !== key) {
      const vm = this.buildSeatTooltipVm(el, seatId);
      if (!vm) {
        this.applyBlockHover(el, clientX, clientY);
        return;
      }
      this.hoverKey = key;
      tip?.show(vm, clientX, clientY);
      return;
    }
    tip?.move(clientX, clientY);
  }

  private clearHoverTooltip(): void {
    if (!this.hoverKey) {
      return;
    }
    this.hoverKey = null;
    this.hoverTip()?.hide();
  }

  private shouldSuppressHoverTooltip(): boolean {
    return (
      this.isDrawing() ||
      this.isColorDetecting() ||
      this.isMoveDragging() ||
      this.panning ||
      this.canvas.viewportPanning()
    );
  }

  private hitTestHover(
    event: PointerEvent,
  ): { kind: 'block'; el: CenterpieceElement } | { kind: 'seat'; el: CenterpieceElement; seatId: string } | null {
    if (this.inBlockWorkspace()) {
      const seatHit = this.hoverSeatFromPoint(event.clientX, event.clientY);
      if (seatHit) {
        return seatHit;
      }
    }
    const fromPath = this.hoverTargetFromPath(event);
    if (fromPath) {
      return fromPath;
    }
    return this.hoverTargetFromGeometry(event.clientX, event.clientY);
  }

  /** Fast path: tables, hover-hit polygons, and dining extras carry data-element-id. */
  private hoverTargetFromPath(
    event: PointerEvent,
  ): { kind: 'block'; el: CenterpieceElement } | null {
    const target = event.target;
    if (!(target instanceof Element)) {
      return null;
    }
    const node = target.closest('[data-element-id]');
    if (!(node instanceof Element)) {
      return null;
    }
    const id = node.getAttribute('data-element-id');
    if (!id) {
      return null;
    }
    const el = this.canvas.elements().find((item) => item.id === id);
    if (el?.type === 'centerpiece' && el.blockType && el.blockType !== 'parking') {
      return { kind: 'block', el };
    }
    return null;
  }

  private hoverSeatFromPoint(
    clientX: number,
    clientY: number,
  ): { kind: 'seat'; el: CenterpieceElement; seatId: string } | null {
    const stack = document.elementsFromPoint(clientX, clientY);
    for (const node of stack) {
      const seatEl = node.closest?.('[data-seat-id]');
      if (!(seatEl instanceof Element)) {
        continue;
      }
      const seatId = seatEl.getAttribute('data-seat-id');
      const elementId = seatEl.getAttribute('data-element-id');
      if (!seatId || !elementId) {
        continue;
      }
      const el = this.canvas.elements().find((item) => item.id === elementId);
      if (el?.type === 'centerpiece') {
        return { kind: 'seat', el, seatId };
      }
    }
    return null;
  }

  /** Pointer inside the painted block — including aisles between seats. */
  private hoverTargetFromGeometry(
    clientX: number,
    clientY: number,
  ): { kind: 'block'; el: CenterpieceElement } | null {
    const pct = this.toCanvasPct(clientX, clientY);
    if (!pct) {
      return null;
    }
    const canvas = this.canvas.canvas();
    const list = this.renderList();
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const el = list[i].el;
      if (el.type !== 'centerpiece' || !el.blockType || el.blockType === 'parking') {
        continue;
      }
      if (this.pointInBlock(el, list[i].rect, canvas, pct)) {
        return { kind: 'block', el };
      }
    }
    return null;
  }

  private pointInBlock(
    el: CenterpieceElement,
    rect: PixelRect,
    canvas: { width: number; height: number },
    pct: { xPct: number; yPct: number },
  ): boolean {
    const outline =
      hasTracedBlockOutline(el) && (el.customPoints?.length ?? 0) >= 3
        ? localPointsToAbsolute(el, canvas)
        : [
            localToCanvasPct({ xPct: 0, yPct: 0 }, rect, el.rotation ?? 0, canvas),
            localToCanvasPct({ xPct: 100, yPct: 0 }, rect, el.rotation ?? 0, canvas),
            localToCanvasPct({ xPct: 100, yPct: 100 }, rect, el.rotation ?? 0, canvas),
            localToCanvasPct({ xPct: 0, yPct: 100 }, rect, el.rotation ?? 0, canvas),
          ];
    if (outline.length < 3) {
      return false;
    }
    return pointInPolygon(pct.xPct, pct.yPct, outline);
  }

  /** Slot hover card: bookable code as the name, vehicle type, and real-world size. */
  private buildParkingSlotTooltipVm(
    slot: { label: string | null; vehicleType: ParkingVehicleType; lengthPx: number; widthPx: number },
    el: CenterpieceElement,
  ): BlockTooltipVM {
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const ppm =
      computeParkingPxPerMeter(rect, el.customPoints ?? [], el.customSideLengthsM ?? []) ??
      pxPerMeter(rect, resolveBlockLengthM(el), resolveBlockWidthM(el));
    const details: string[] = [];
    if (ppm > 0) {
      const lengthM = Math.round((slot.lengthPx / ppm) * 10) / 10;
      const widthM = Math.round((slot.widthPx / ppm) * 10) / 10;
      details.push(`${lengthM} m × ${widthM} m`);
    }
    return {
      name: slot.label?.trim() || 'Parking slot',
      typeLabel: CanvasStageComponent.PARKING_TYPE_LABELS[slot.vehicleType],
      configName: undefined,
      details,
      mode: 'slot',
    };
  }

  /** Ticketmaster-style seat details: block · row · seat number. */
  private buildSeatTooltipVm(el: CenterpieceElement, seatId: string): BlockTooltipVM | null {
    const style = el.rowLabelStyle ?? el.seatLayout?.rowLabelStyle ?? 'letter';
    const rows = el.seatLayout?.rows ?? el.rows ?? 0;
    // Seat ids are rowLabel + seatNumber; pick the longest row prefix that
    // parses ("11" + "2" beats "1" + "12" for number-style rows).
    let best: { row: string; seat: number } | null = null;
    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      const prefix = rowLabel(rowIndex, style);
      if (!seatId.startsWith(prefix)) {
        continue;
      }
      const rest = seatId.slice(prefix.length);
      const seatNumber = Number(rest);
      if (!rest || !Number.isInteger(seatNumber) || seatNumber < 1) {
        continue;
      }
      if (!best || prefix.length > best.row.length) {
        best = { row: prefix, seat: seatNumber };
      }
    }
    if (!best) {
      return null;
    }
    return {
      name: el.label?.trim() || el.name?.trim() || 'Block',
      typeLabel: 'Seat',
      configName: undefined,
      details: [],
      mode: 'seat',
      seatDetail: `Row ${best.row} · Seat ${best.seat}`,
    };
  }

  private buildBlockTooltipVm(el: CenterpieceElement): BlockTooltipVM {
    const name = el.label?.trim() || el.name?.trim() || 'Block';
    const typeLabel =
      el.blockType === 'general-admission' ? 'General Admission' :
      el.blockType === 'seating' ? 'Seating' : 'Dining Tables';
    const details: string[] = [];
    let stats: BlockTooltipStat[] | undefined;
    if (el.blockType === 'general-admission') {
      const sideCount = el.gaConfiguredSides?.length ?? 0;
      if (sideCount > 0) details.push(`${sideCount} side${sideCount === 1 ? '' : 's'} configured`);
      if (el.gaMaxParticipants) details.push(`Max ${el.gaMaxParticipants} participants`);
    } else if (el.blockType === 'seating') {
      const display = getSeatingBlockDisplayStats(el);
      stats = [
        { label: 'Rows', value: display.rows },
        { label: 'Columns', value: display.columns },
        { label: 'Total seats', value: display.totalSeats },
      ];
    } else if (el.blockType === 'dining-table') {
      stats = [
        { label: 'Tables', value: getDiningTableCount(el) },
        { label: 'Chairs', value: getDiningChairCount(el) },
      ];
    }
    return { name, typeLabel, configName: el.appliedConfigName, details, mode: 'block', stats };
  }

  protected onElementPointerDown(event: PointerEvent, el: LayoutElement): void {
    if (event.button !== 0) {
      return;
    }
    if (this.isDrawAislePlacing()) {
      const session = this.canvas.drawAisleSession();
      if (!session || el.id !== session.blockId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (pt) {
        this.canvas.placeDrawAislePoint(el.id, pt);
      }
      return;
    }
    if (this.consumeAccessPointPlacementPointer(event)) {
      return;
    }
    if (this.tryBeginArrangeByRow(event, el)) {
      return;
    }
    if (
      this.arrangeByRowMeasureMode() &&
      el.type === 'centerpiece' &&
      hasTracedBlockOutline(el) &&
      el.id === this.canvas.arrangeByRowElementId()
    ) {
      event.stopPropagation();
      const pt = this.toCanvasPx(event.clientX, event.clientY);
      const edges = this.arrangeByRowMeasureEdges();
      if (pt && edges) {
        const tolerance = 32 / Math.max(1, this.canvas.zoom() / 100);
        const hit = hitTestBlockMeasureEdges(edges, pt.x, pt.y, tolerance);
        if (hit != null) {
          this.canvas.selectArrangeByRowMeasureSide(hit);
        }
      }
      return;
    }
    if (this.isPerSeatPlacing() && el.type === 'centerpiece' && hasTracedBlockOutline(el)) {
      if (el.id !== this.canvas.perSeatPlacementElementId()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (pt) {
        const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
        if (isCanvasPctInsideCustomShape(el, rect, this.canvas.canvas(), pt)) {
          this.canvas.placePerSeatAt(el.id, pt);
        }
      }
      return;
    }
    if (this.isTablePlacing() && el.type === 'centerpiece' && hasTracedBlockOutline(el)) {
      if (el.id !== this.canvas.tablePlacementElementId()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (pt) {
        this.canvas.placeTableAt(el.id, pt);
      }
      return;
    }
    if (this.isParkingAccessPlacing() && el.type === 'centerpiece' && hasTracedBlockOutline(el)) {
      if (el.id !== this.canvas.parkingAccessPlacementElementId()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (pt) {
        this.canvas.placeParkingAccessPointAt(el.id, pt);
      }
      return;
    }
    if (this.isCanvasToolActive()) {
      return;
    }
    if (this.isDrawing() || isElementLocked(el)) {
      return;
    }
    // Double-click-and-hold on a block: dragging pans the workspace, so the
    // user can navigate even where blocks cover the canvas. A plain double
    // click (no drag) keeps its usual meaning outside Auto Fill layout mode.
    // In Auto Fill mode every click toggles select/unselect immediately.
    if (
      this.canvas.autoFillLayoutMode() &&
      el.type === 'centerpiece' &&
      isAutoFillEligibleBlock(el)
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.toggleMultiSelect(el);
      return;
    }
    const now = performance.now();
    const prevTap = this.lastElementTap;
    this.lastElementTap = { elementId: el.id, atMs: now, x: event.clientX, y: event.clientY };
    if (
      !event.shiftKey &&
      prevTap &&
      prevTap.elementId === el.id &&
      now - prevTap.atMs < 400 &&
      Math.hypot(event.clientX - prevTap.x, event.clientY - prevTap.y) < 8
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.bgPanDrag = {
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
        deselectOnTap: false,
      };
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.toggleMultiSelect(el);
      return;
    }
    if (el.type === 'layer-ring' || el.type === 'layer-rect') {
      return;
    }
    if (
      !this.inBlockWorkspace() &&
      isCustomizableBlock(el) &&
      !this.isCanvasToolActive()
    ) {
      event.stopPropagation();
      this.beginLongPress(event, el);
      return;
    }
    if (this.blockViewpointMode()) {
      event.stopPropagation();
      this.beginViewpointDrag(event);
      return;
    }
    event.stopPropagation();
    if (this.isSeatingEnabled(el)) {
      this.canvas.selectElement(el.id);
      if (this.inBlockWorkspace() && this.canvas.blockWorkspaceId() === el.id) {
        // The block is pinned while it is being customised, so dragging its
        // body slides the camera instead — the block follows the pointer.
        this.bgPanDrag = {
          startX: event.clientX,
          startY: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          moved: false,
          deselectOnTap: false,
        };
      }
      return;
    }
    this.startMove(event, el);
  }

  /** Adds/removes an element from the multi-selection (Shift-click / Auto Fill click). */
  private toggleMultiSelect(el: LayoutElement): void {
    const currentSelected = this.canvas.selectedIds();
    if (currentSelected.includes(el.id)) {
      this.canvas.notifyAutoFillBlockDeselected(el.id);
      const next = currentSelected.filter((id) => id !== el.id);
      this.canvas.selectElements(next, next[0] ?? null);
    } else {
      this.canvas.selectElements([...currentSelected, el.id], el.id);
    }
  }

  private async handleColorDetectClick(clientX: number, clientY: number): Promise<void> {
    const bitmap = this.referenceBitmap();
    const natural = this.referenceNaturalSize();
    if (!bitmap || !natural) {
      return;
    }
    const pt = this.toCanvasPx(clientX, clientY);
    if (!pt) {
      return;
    }
    const canvasCfg = this.canvas.canvas();
    const drawRect = referenceImageDrawRect(
      canvasCfg,
      natural.width,
      natural.height,
      this.canvas.referenceImage()?.geometryScale ?? 1,
    );
    if (
      pt.x < drawRect.x ||
      pt.y < drawRect.y ||
      pt.x > drawRect.x + drawRect.width ||
      pt.y > drawRect.y + drawRect.height
    ) {
      return;
    }

    await this.canvas.ensureReferenceOcrTokens();

    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = canvasCfg.width;
    sampleCanvas.height = canvasCfg.height;
    const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return;
    }
    ctx.drawImage(bitmap, drawRect.x, drawRect.y, drawRect.width, drawRect.height);
    const imageData = ctx.getImageData(0, 0, canvasCfg.width, canvasCfg.height);
    const result = floodFillAtPoint(
      imageData.data,
      canvasCfg.width,
      canvasCfg.height,
      Math.round(pt.x),
      Math.round(pt.y),
      this.canvas.colorDetectTolerance(),
      { targetRect: this.canvas.traceTargetRect() ?? undefined },
    );
    if (!result) {
      return;
    }
    const clickRefPct = canvasPointToReferencePct(
      (pt.x / canvasCfg.width) * 100,
      (pt.y / canvasCfg.height) * 100,
      canvasCfg,
      drawRect,
    );
    const imagePolygon = canvasPolygonToReferencePct(result.polygon, canvasCfg, drawRect);
    const label = this.canvas.resolveTracedBlockLabel(imagePolygon, clickRefPct, {
      imageWidth: natural.width,
      imageHeight: natural.height,
    });
    this.canvas.addBlockFromDetectedRegion(result.polygon, result.fillColor, label);
  }

  protected onRingPointerDown(event: PointerEvent, el: LayoutElement): void {
    if (event.button !== 0 || this.isDrawing() || isElementLocked(el) || el.type !== 'layer-ring') {
      return;
    }
    event.stopPropagation();
    this.startMove(event, el);
  }

  protected onSectorPointerDown(event: PointerEvent, el: LayoutElement, sectorId: string): void {
    if (
      event.button !== 0 ||
      this.isDrawing() ||
      isElementLocked(el) ||
      (el.type !== 'layer-ring' && el.type !== 'layer-rect')
    ) {
      return;
    }
    event.stopPropagation();
    const sel = this.canvas.selectedRingBlock();
    const alreadySelected = sel?.elementId === el.id && sel.blockId === sectorId;
    if (!alreadySelected) {
      this.canvas.selectRingBlock(el.id, sectorId);
      return;
    }
    if (el.type !== 'layer-ring') {
      return;
    }
    const block = el.blocks.find((item) => item.id === sectorId);
    if (!block) {
      return;
    }
    const startPointerAngle = this.ringPointerAngleDeg(el, event.clientX, event.clientY);
    if (startPointerAngle == null) {
      return;
    }
    this.canvas.beginGesture();
    this.ringBlockDrag = {
      elementId: el.id,
      blockId: sectorId,
      startPointerAngle,
      startBlockStartDeg: block.startAngleDeg,
      startBlockEndDeg: block.endAngleDeg,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  protected onSelectionMoveDown(event: PointerEvent, el: LayoutElement): void {
    if (this.consumeAccessPointPlacementPointer(event)) {
      return;
    }
    if (event.button !== 0 || this.isCanvasToolActive() || this.isDrawing() || isElementLocked(el)) {
      return;
    }
    event.stopPropagation();
    // Auto Fill layout: click toggles select/unselect instead of moving the block.
    if (
      this.canvas.autoFillLayoutMode() &&
      el.type === 'centerpiece' &&
      isAutoFillEligibleBlock(el)
    ) {
      event.preventDefault();
      this.toggleMultiSelect(el);
      return;
    }
    this.startMove(event, el);
  }

  protected onRotateHandleDown(event: PointerEvent, el: LayoutElement, rect: PixelRect): void {
    if (this.blockViewpointMode()) {
      return;
    }
    if (event.button !== 0 || isElementLocked(el)) {
      return;
    }
    event.stopPropagation();
    this.canvas.beginGesture();
    const pt = this.toCanvasPx(event.clientX, event.clientY);
    if (!pt) {
      return;
    }
    const startAngle = (Math.atan2(pt.y - rect.cy, pt.x - rect.cx) * 180) / Math.PI;
    this.rotateSession = {
      id: el.id,
      startRotation: el.rotation ?? 0,
      startAngle,
      cx: rect.cx,
      cy: rect.cy,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  /** Rotate handle on a selected stage / food-prep feature (not the whole block). */
  protected onDiningFeatureRotateHandleDown(
    event: PointerEvent,
    el: LayoutElement,
    kind: 'stage' | 'foodprepare',
    node: DiningStageRenderNode,
  ): void {
    if (event.button !== 0 || el.type !== 'centerpiece' || isElementLocked(el)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.canvas.beginGesture();
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const world = this.diningFeatureWorldPoint(el, rect, node.x, node.y);
    const pt = this.toCanvasPx(event.clientX, event.clientY);
    if (!pt) {
      return;
    }
    const startAngle = (Math.atan2(pt.y - world.y, pt.x - world.x) * 180) / Math.PI;
    this.featureRotateSession = {
      elementId: el.id,
      kind,
      startRotation: node.rotationDeg,
      startAngle,
      cx: world.x,
      cy: world.y,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  /** Map a point in element-local canvas space through the element's rotation. */
  private diningFeatureWorldPoint(
    el: LayoutElement,
    rect: PixelRect,
    localX: number,
    localY: number,
  ): { x: number; y: number } {
    const rot = el.rotation ?? 0;
    if (!rot) {
      return { x: localX, y: localY };
    }
    const rad = (rot * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = localX - rect.cx;
    const dy = localY - rect.cy;
    return {
      x: rect.cx + dx * cos - dy * sin,
      y: rect.cy + dx * sin + dy * cos,
    };
  }

  /** Screen-stable offset for the feature rotate knob beyond the short edge. */
  protected diningFeatureRotateHandleOffset(node: DiningStageRenderNode): number {
    return node.heightPx / 2 + 18 * this.accessPointUiScale();
  }

  protected diningFeatureResizeHandleSize(): number {
    return 8 * this.accessPointUiScale();
  }

  protected onDiningFeatureResizeHandleDown(
    event: PointerEvent,
    el: LayoutElement,
    kind: 'stage' | 'foodprepare',
    handle: 'left' | 'right' | 'top' | 'bottom',
  ): void {
    if (event.button !== 0 || el.type !== 'centerpiece' || isElementLocked(el)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (kind === 'stage') {
      this.canvas.selectDiningStage(true);
    } else {
      this.canvas.selectDiningFoodPrepare(true);
    }
    this.featureResizeDrag = {
      elementId: el.id,
      kind,
      handle,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      dragging: false,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  protected onDrawAisleHandlePointerDown(
    event: PointerEvent,
    aisleId: string,
    mode: 'start' | 'end' | 'body',
    startLocal: { xPct: number; yPct: number },
    endLocal: { xPct: number; yPct: number },
  ): void {
    if (event.button !== 0 || this.isDrawAislePlacing()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const el = this.canvas.blockWorkspaceElement();
    const pt = this.toCanvasPct(event.clientX, event.clientY);
    if (!el || !pt) {
      return;
    }
    const local = canvasPctToLocalPoint(el, pt, this.canvas.canvas());
    this.drawAisleDrag = {
      aisleId,
      mode,
      startLocal,
      endLocal,
      pointerStart: local,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  protected onVertexPointerDown(event: PointerEvent, el: LayoutElement, index: number): void {
    if (event.button !== 0 || this.isDrawing() || isElementLocked(el)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.canvas.beginGesture();
    this.canvas.selectElement(el.id);
    this.vertexDrag = { id: el.id, index };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  protected onParkingEdgeHandlePointerDown(event: PointerEvent, el: LayoutElement, edgeIndex: number): void {
    if (event.button !== 0 || this.isDrawing() || isElementLocked(el)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.canvas.beginGesture();
    this.canvas.selectElement(el.id);
    this.parkingEdgeDrag = { id: el.id, edgeIndex };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  /** Select one placed parking slot and start a drag to adjust its position. */
  protected onParkingSlotPointerDown(
    event: PointerEvent,
    el: LayoutElement,
    slot: { id: string; x: number; y: number },
  ): void {
    if (event.button !== 0 || this.isParkingSlotDrawing() || this.isParkingAccessPlacing()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.canvas.selectParkingSlot(slot.id);
    const pt = this.toCanvasPx(event.clientX, event.clientY);
    if (!pt) {
      return;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    this.parkingSlotDrag = {
      elementId: el.id,
      slotId: slot.id,
      rect,
      offsetX: slot.x - pt.x,
      offsetY: slot.y - pt.y,
      moved: false,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  /** Bow a segment that's already been placed, before the parking-area shape is closed. */
  protected onDraftEdgeBowHandlePointerDown(event: PointerEvent, segmentIndex: number): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.draftEdgeBowDrag = { segmentIndex };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  protected onResizeHandleDown(
    event: PointerEvent,
    el: LayoutElement,
    handle: ResizeHandle,
    rect: PixelRect,
  ): void {
    if (event.button !== 0 || this.isDrawing() || isElementLocked(el)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const rotation = el.rotation ?? 0;
    const anchorWorld = isCornerHandle(handle)
      ? cornerWorld(oppositeCorner(handle), rect, rotation)
      : edgeAnchorWorld(handle, rect, rotation);
    this.canvas.beginGesture();
    this.canvas.selectElement(el.id);
    this.resizeSession = {
      id: el.id,
      handle,
      anchorWorld,
      rotation,
      startWidth: rect.width,
      startHeight: rect.height,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  private beginLongPress(event: PointerEvent, el: LayoutElement): void {
    this.clearLongPress(false);
    this.canvas.selectElement(el.id);
    const elementId = el.id;
    const timerId = setTimeout(() => {
      this.longPressTriggered = true;
      this.longPressSession = null;
      this.canvas.enterBlockWorkspace(elementId);
    }, LONG_PRESS_MS);
    this.longPressSession = {
      elementId: el.id,
      startX: event.clientX,
      startY: event.clientY,
      timerId,
      pointerId: event.pointerId,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  private clearLongPress(preserveTriggered: boolean): void {
    if (this.longPressSession?.timerId) {
      clearTimeout(this.longPressSession.timerId);
    }
    this.longPressSession = null;
    if (!preserveTriggered) {
      this.longPressTriggered = false;
    }
  }

  protected onArrangeByRowEdgePointerDown(event: PointerEvent, logicalId: number): void {
    if (event.button !== 0 || !this.arrangeByRowMeasureMode()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.canvas.selectArrangeByRowMeasureSide(logicalId);
  }

  protected onGaSideEdgePointerDown(event: PointerEvent, logicalId: number): void {
    if (event.button !== 0 || !this.canvas.sideLabelConfigureActive()) {
      return;
    }
    const el = this.canvas.blockWorkspaceElement();
    if (el && this.canvas.allGaSidesConfigured(el)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.canvas.gaSelectSide(logicalId);
  }

  protected onParkingMeasureEdgePointerDown(event: PointerEvent, index: number): void {
    if (event.button !== 0 || this.canvas.parkingWorkspaceStep() !== 'measure-edges') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.canvas.parkingSelectMeasureEdge(index);
  }

  protected onStageSideEdgePointerDown(event: PointerEvent, logicalId: number): void {
    if (event.button !== 0 || !this.stageSidePickMode()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const elementId = this.canvas.stageSidePickElementId();
    if (!elementId) {
      return;
    }
    this.canvas.applyStageOnSide(elementId, logicalId);
  }

  protected onFoodPrepareSideEdgePointerDown(event: PointerEvent, logicalId: number): void {
    if (event.button !== 0 || !this.foodPrepareSidePickMode()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const elementId = this.canvas.foodPrepareSidePickElementId();
    if (!elementId) {
      return;
    }
    this.canvas.applyFoodPrepareOnSide(elementId, logicalId);
  }

  protected onViewpointMarkerPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !this.blockViewpointMode()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.beginViewpointDrag(event);
  }

  protected onBlockLabelPointerDown(event: PointerEvent, elementId: string): void {
    if (event.button !== 0 || this.blockViewpointMode()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.canvas.beginGesture();
    this.labelDrag = { elementId };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  protected onViewpointOrbitPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !this.blockViewpointMode()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.beginViewpointDrag(event);
  }

  private startMove(event: PointerEvent, el: LayoutElement): void {
    event.preventDefault();
    this.canvas.beginGesture();
    this.canvas.selectElement(el.id);
    this.drag = {
      id: el.id,
      startXPct: el.position.xPct,
      startYPct: el.position.yPct,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  @HostListener('document:pointermove', ['$event'])
  protected onPointerMove(event: PointerEvent): void {
    this.updateHoverTooltip(event);
    if (this.isDrawAislePlacing()) {
      const hoverPx = this.toCanvasPx(event.clientX, event.clientY);
      this.drawAisleHoverPx.set(hoverPx);
    } else if (this.drawAisleHoverPx()) {
      this.drawAisleHoverPx.set(null);
    }
    if (this.drawAisleDrag) {
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      const el = this.canvas.blockWorkspaceElement();
      if (!pt || !el) {
        return;
      }
      const local = canvasPctToLocalPoint(el, pt, this.canvas.canvas());
      const drag = this.drawAisleDrag;
      const dx = local.xPct - drag.pointerStart.xPct;
      const dy = local.yPct - drag.pointerStart.yPct;
      const clampPct = (v: number) => Math.max(0, Math.min(100, v));
      if (drag.mode === 'start') {
        this.canvas.updateDrawAisleGeometry(
          drag.aisleId,
          { drawStart: { xPct: clampPct(local.xPct), yPct: clampPct(local.yPct) } },
          { refill: false },
        );
      } else if (drag.mode === 'end') {
        this.canvas.updateDrawAisleGeometry(
          drag.aisleId,
          { drawEnd: { xPct: clampPct(local.xPct), yPct: clampPct(local.yPct) } },
          { refill: false },
        );
      } else {
        this.canvas.updateDrawAisleGeometry(
          drag.aisleId,
          {
            drawStart: {
              xPct: clampPct(drag.startLocal.xPct + dx),
              yPct: clampPct(drag.startLocal.yPct + dy),
            },
            drawEnd: {
              xPct: clampPct(drag.endLocal.xPct + dx),
              yPct: clampPct(drag.endLocal.yPct + dy),
            },
          },
          { refill: false },
        );
      }
      return;
    }
    if (this.isAccessPointPlacing()) {
      if (isInteractiveUiTarget(event.target)) {
        this.canvas.accessPointPlacementPreview.set(null);
      } else {
        const id = this.canvas.accessPointPlacementElementId();
        const pt = this.toCanvasPct(event.clientX, event.clientY);
        if (id && pt) {
          this.canvas.updateAccessPointPlacementPreview(id, pt);
        } else {
          this.canvas.accessPointPlacementPreview.set(null);
        }
      }
    } else if (this.canvas.accessPointPlacementPreview()) {
      this.canvas.accessPointPlacementPreview.set(null);
    }
    if (this.isParkingAreaDrawing() && this.draftPointCount() >= 3) {
      const px = this.toCanvasPx(event.clientX, event.clientY);
      this.parkingCloseHoverActive.set(Boolean(px && this.isNearFirstDraftPointPx(px)));
    } else if (this.parkingCloseHoverActive()) {
      this.parkingCloseHoverActive.set(false);
    }
    if (this.longPressSession) {
      const dx = event.clientX - this.longPressSession.startX;
      const dy = event.clientY - this.longPressSession.startY;
      if (Math.hypot(dx, dy) >= LONG_PRESS_MOVE_PX) {
        const elId = this.longPressSession.elementId;
        this.pendingSeatTap = null;
        this.clearLongPress(false);
        const el = this.canvas.elements().find((item) => item.id === elId);
        // Dragging any block on the overview canvas moves it, seating blocks
        // included; the tap/long-press meanings stay untouched.
        if (el && !this.inBlockWorkspace()) {
          this.startMove(event, el);
        }
      }
      return;
    }
    if (this.panning) {
      this.panPointer = { x: event.clientX, y: event.clientY };
      this.schedulePanViewBox(event.clientX, event.clientY);
      return;
    }
    if (this.bgPanDrag) {
      const s = this.bgPanDrag;
      if (!s.moved && Math.hypot(event.clientX - s.startX, event.clientY - s.startY) < 4) {
        return;
      }
      if (!s.moved) {
        this.beginPanSession(s.startX, s.startY);
      }
      s.moved = true;
      this.schedulePanViewBox(event.clientX, event.clientY);
      return;
    }
    if (this.auditRegionDrag) {
      const pt = this.toCanvasPx(event.clientX, event.clientY);
      if (pt) {
        this.audit.moveHighlightRegion({
          x: pt.x - this.auditRegionDrag.grabDX,
          y: pt.y - this.auditRegionDrag.grabDY,
          width: this.auditRegionDrag.width,
          height: this.auditRegionDrag.height,
        });
      }
      return;
    }
    if (this.seatDrag) {
      const dx = event.clientX - this.seatDrag.startPointerX;
      const dy = event.clientY - this.seatDrag.startPointerY;
      if (!this.seatDrag.dragging) {
        if (Math.hypot(dx, dy) < 4) {
          return;
        }
        this.canvas.beginGesture();
        this.seatDrag = { ...this.seatDrag, dragging: true };
      }
      const pt = this.toCanvasPx(event.clientX, event.clientY);
      if (!pt) {
        return;
      }
      if (this.seatDrag.dragFillDragMode) {
        this.canvas.expandDragFillAtSilent(this.seatDrag.elementId, this.seatDrag.seatId, pt);
      } else if (
        this.canvas.isDragSeatsElement(this.seatDrag.elementId) &&
        this.canvas.canUseInteractiveSeatingPlacement(this.seatDrag.elementId)
      ) {
        this.canvas.updateDragSeatsExtentSilent(this.seatDrag.elementId, pt);
      } else if (
        this.seatDrag.arrangeByRowRowIndex != null &&
        this.canvas.canUseInteractiveSeatingPlacement(this.seatDrag.elementId)
      ) {
        this.canvas.expandArrangeByRowLastSeatSilent(
          this.seatDrag.elementId,
          this.seatDrag.arrangeByRowRowIndex,
          pt,
        );
      } else {
        const el = this.canvas.elements().find((item) => item.id === this.seatDrag?.elementId);
        if (el?.type === 'centerpiece' && el.dragFillSeatsMode) {
          return;
        }
        this.canvas.updateCustomSeatPositionSilent(this.seatDrag.elementId, this.seatDrag.seatId, pt);
      }
      return;
    }
    if (this.tableDrag) {
      const dx = event.clientX - this.tableDrag.startPointerX;
      const dy = event.clientY - this.tableDrag.startPointerY;
      if (!this.tableDrag.dragging) {
        if (Math.hypot(dx, dy) < 4) {
          return;
        }
        this.canvas.beginGesture();
        this.tableDrag = { ...this.tableDrag, dragging: true };
      }
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (!pt) {
        return;
      }
      this.canvas.moveDiningTable(this.tableDrag.elementId, this.tableDrag.tableId, pt);
      return;
    }
    if (this.stageDrag) {
      const dx = event.clientX - this.stageDrag.startPointerX;
      const dy = event.clientY - this.stageDrag.startPointerY;
      if (!this.stageDrag.dragging) {
        if (Math.hypot(dx, dy) < 4) {
          return;
        }
        this.canvas.beginGesture();
        this.stageDrag = { ...this.stageDrag, dragging: true };
      }
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (!pt) {
        return;
      }
      this.canvas.moveDiningStage(this.stageDrag.elementId, pt);
      return;
    }
    if (this.foodPrepareDrag) {
      const dx = event.clientX - this.foodPrepareDrag.startPointerX;
      const dy = event.clientY - this.foodPrepareDrag.startPointerY;
      if (!this.foodPrepareDrag.dragging) {
        if (Math.hypot(dx, dy) < 4) {
          return;
        }
        this.canvas.beginGesture();
        this.foodPrepareDrag = { ...this.foodPrepareDrag, dragging: true };
      }
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (!pt) {
        return;
      }
      this.canvas.moveDiningFoodPrepare(this.foodPrepareDrag.elementId, pt);
      return;
    }
    if (this.accessPointDrag) {
      const dx = event.clientX - this.accessPointDrag.startPointerX;
      const dy = event.clientY - this.accessPointDrag.startPointerY;
      if (!this.accessPointDrag.dragging) {
        if (Math.hypot(dx, dy) < 4) {
          return;
        }
        this.canvas.beginGesture();
        this.accessPointDrag = { ...this.accessPointDrag, dragging: true };
      }
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (!pt) {
        return;
      }
      this.canvas.moveDiningAccessPointAt(
        this.accessPointDrag.elementId,
        this.accessPointDrag.kind,
        pt,
      );
      return;
    }
    if (this.featureResizeDrag) {
      const dx = event.clientX - this.featureResizeDrag.startPointerX;
      const dy = event.clientY - this.featureResizeDrag.startPointerY;
      if (!this.featureResizeDrag.dragging) {
        if (Math.hypot(dx, dy) < 4) {
          return;
        }
        this.canvas.beginGesture();
        this.featureResizeDrag = { ...this.featureResizeDrag, dragging: true };
      }
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (!pt) {
        return;
      }
      this.canvas.resizeDiningFeatureSilent(
        this.featureResizeDrag.elementId,
        this.featureResizeDrag.kind,
        this.featureResizeDrag.handle,
        pt,
      );
      return;
    }
    if (this.arrangeByRowDrag) {
      const pt = this.toCanvasPx(event.clientX, event.clientY);
      if (pt) {
        this.canvas.updateArrangeByRowExtentSilent(this.arrangeByRowDrag.elementId, pt);
      }
      return;
    }
    if (this.viewpointDrag) {
      const pt = this.toCanvasPx(event.clientX, event.clientY);
      if (pt) {
        this.canvas.setBlockWorkspaceViewpointFromCanvasPoint(pt.x, pt.y);
      }
      return;
    }
    if (this.labelDrag) {
      const pt = this.toCanvasPx(event.clientX, event.clientY);
      const el = this.canvas.elements().find((item) => item.id === this.labelDrag!.elementId);
      if (pt && el?.type === 'centerpiece') {
        const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
        const xPct = ((pt.x - rect.cx) / Math.max(rect.width, 1)) * 100;
        const yPct = ((pt.y - rect.cy) / Math.max(rect.height, 1)) * 100;
        this.canvas.updateBlockLabelOffsetSilent(el.id, xPct, yPct);
      }
      return;
    }
    if (this.marquee) {
      const pt = this.toCanvasPx(event.clientX, event.clientY);
      if (!pt) {
        return;
      }
      this.marquee.currentX = pt.x;
      this.marquee.currentY = pt.y;
      const moved = Math.hypot(pt.x - this.marquee.startX, pt.y - this.marquee.startY);
      if (moved > CanvasStageComponent.MARQUEE_DRAG_THRESHOLD_PX) {
        this.marquee.active = true;
      }
      if (this.marquee.active) {
        this.marqueeRect.set(
          this.normalizeMarqueeRect(
            this.marquee.startX,
            this.marquee.startY,
            pt.x,
            pt.y,
          ),
        );
      }
      return;
    }
    if (this.rotateSession) {
      const pt = this.toCanvasPx(event.clientX, event.clientY);
      if (!pt) {
        return;
      }
      const s = this.rotateSession;
      const currentAngle = (Math.atan2(pt.y - s.cy, pt.x - s.cx) * 180) / Math.PI;
      let next = s.startRotation + (currentAngle - s.startAngle);
      while (next > 180) {
        next -= 360;
      }
      while (next <= -180) {
        next += 360;
      }
      this.canvas.updateSilent(s.id, { rotation: Math.round(next) });
      return;
    }
    if (this.featureRotateSession) {
      const pt = this.toCanvasPx(event.clientX, event.clientY);
      if (!pt) {
        return;
      }
      const s = this.featureRotateSession;
      const currentAngle = (Math.atan2(pt.y - s.cy, pt.x - s.cx) * 180) / Math.PI;
      const next = s.startRotation + (currentAngle - s.startAngle);
      if (s.kind === 'stage') {
        this.canvas.rotateDiningStageSilent(s.elementId, next);
      } else {
        this.canvas.rotateDiningFoodPrepareSilent(s.elementId, next);
      }
      return;
    }
    if (this.vertexDrag) {
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (!pt) {
        return;
      }
      this.canvas.updateCustomVertexSilent(this.vertexDrag.id, this.vertexDrag.index, pt);
      return;
    }
    if (this.parkingEdgeDrag) {
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (!pt) {
        return;
      }
      this.canvas.updateParkingEdgeBowSilent(this.parkingEdgeDrag.id, this.parkingEdgeDrag.edgeIndex, pt);
      return;
    }
    if (this.parkingSlotDrag) {
      const pt = this.toCanvasPx(event.clientX, event.clientY);
      if (!pt) {
        return;
      }
      const drag = this.parkingSlotDrag;
      if (!drag.moved) {
        drag.moved = true;
        this.canvas.beginGesture();
      }
      const xPct = ((pt.x + drag.offsetX - drag.rect.x) / Math.max(1, drag.rect.width)) * 100;
      const yPct = ((pt.y + drag.offsetY - drag.rect.y) / Math.max(1, drag.rect.height)) * 100;
      this.canvas.updateParkingSlotPositionSilent(drag.elementId, drag.slotId, xPct, yPct);
      return;
    }
    if (this.draftEdgeBowDrag) {
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (!pt) {
        return;
      }
      this.canvas.updateDraftEdgeBowSilent(this.draftEdgeBowDrag.segmentIndex, pt);
      return;
    }
    if (this.resizeSession) {
      const pt = this.toCanvasPx(event.clientX, event.clientY);
      if (!pt) {
        return;
      }
      const s = this.resizeSession;
      const minW = Math.max(20, this.width() * 0.02);
      const minH = Math.max(20, this.height() * 0.02);
      const nextRect = isCornerHandle(s.handle)
        ? resizeFromOppositeCorners(s.anchorWorld, pt, s.rotation, minW, minH)
        : resizeFromEdge(
            s.handle,
            s.anchorWorld,
            pt,
            s.rotation,
            s.startWidth,
            s.startHeight,
            minW,
            minH,
          );
      const geom = pixelRectToGeometry(nextRect, this.width(), this.height());
      this.canvas.updateSilent(s.id, { position: geom.position, size: geom.size });
      return;
    }
    if (this.ringBlockDrag) {
      const el = this.canvas.elements().find((item) => item.id === this.ringBlockDrag!.elementId);
      if (!el || el.type !== 'layer-ring') {
        return;
      }
      const currentAngle = this.ringPointerAngleDeg(el, event.clientX, event.clientY);
      if (currentAngle == null) {
        return;
      }
      const s = this.ringBlockDrag;
      const adjusted = unwrapAngleNear(s.startPointerAngle, currentAngle);
      const delta = adjusted - s.startPointerAngle;
      this.canvas.moveRingBlockSilent(
        s.elementId,
        s.blockId,
        s.startBlockStartDeg + delta,
        s.startBlockEndDeg + delta,
      );
      return;
    }
    if (!this.drag) {
      return;
    }
    if (!this.isMoveDragging()) {
      const moved = Math.hypot(
        event.clientX - this.drag.startPointerX,
        event.clientY - this.drag.startPointerY,
      );
      if (moved > 2) {
        this.isMoveDragging.set(true);
      }
    }
    const scale = this.screenScale();
    const dxPx = (event.clientX - this.drag.startPointerX) / scale;
    const dyPx = (event.clientY - this.drag.startPointerY) / scale;
    this.canvas.moveSilent(this.drag.id, {
      xPct: this.drag.startXPct + (dxPx / this.width()) * 100,
      yPct: this.drag.startYPct + (dyPx / this.height()) * 100,
    });
  }

  @HostListener('document:pointerup')
  protected onPointerUp(): void {
    const longPressFired = this.longPressTriggered;
    let tapToFitId: string | null = null;
    if (
      !longPressFired &&
      this.longPressSession &&
      !this.canvas.autoFillLayoutMode() &&
      !this.inBlockWorkspace()
    ) {
      const tapped = this.canvas
        .elements()
        .find((item) => item.id === this.longPressSession!.elementId);
      if (
        tapped?.type === 'centerpiece' &&
        (tapped.blockType === 'seating' || tapped.blockType === 'dining-table')
      ) {
        tapToFitId = tapped.id;
      }
    }
    if (this.longPressSession) {
      this.clearLongPress(longPressFired);
    }
    if (longPressFired) {
      this.longPressTriggered = false;
      this.pendingSeatTap = null;
      return;
    }
    if (this.pendingSeatTap) {
      const pending = this.pendingSeatTap;
      this.pendingSeatTap = null;
      const el = this.canvas.elements().find((item) => item.id === pending.elementId);
      if (el) {
        this.canvas.selectElement(el.id);
        this.canvas.selectSeat(pending.seatId, el.id);
      }
    }
    if (this.bgPanDrag) {
      const s = this.bgPanDrag;
      this.bgPanDrag = null;
      if (s.moved) {
        this.commitPanSession();
      } else {
        this.canvas.clearPanPreview();
      }
      if (!s.moved) {
        if (s.tapToggleElement) {
          // Second tap without drag: behave like the plain Auto Fill click.
          this.toggleMultiSelect(s.tapToggleElement);
        } else if (s.deselectOnTap) {
          this.canvas.selectElement(null);
        }
      }
    }
    if (this.marquee) {
      const session = this.marquee;
      this.marquee = null;
      this.marqueeRect.set(null);
      if (session.active) {
        const box = this.normalizeMarqueeRect(
          session.startX,
          session.startY,
          session.currentX,
          session.currentY,
        );
        const hits = this.canvas
          .elements()
          .filter((el) => isElementVisible(el))
          .filter((el) => {
            if (el.type === 'centerpiece' && hasTracedBlockOutline(el)) {
              return (el.customPoints?.length ?? 0) >= 3;
            }
            return true;
          })
          .filter((el) => {
            const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
            return this.marqueeIntersects(box, rect);
          })
          .map((el) => el.id);
        this.canvas.selectElements(hits);
      } else if (!this.canvas.autoFillLayoutMode()) {
        this.canvas.selectElement(null);
      }
    }
    if (this.drawAisleDrag) {
      this.canvas.refillWorkspaceSeatsForDrawnAisle();
      this.drawAisleDrag = null;
    }
    if (this.arrangeByRowDrag) {
      this.canvas.commitArrangeByRowRow();
      this.arrangeByRowDrag = null;
    } else if (
      this.drag ||
      this.rotateSession ||
      this.featureRotateSession ||
      this.vertexDrag ||
      this.parkingEdgeDrag ||
      this.parkingSlotDrag?.moved ||
      this.resizeSession ||
      this.ringBlockDrag
    ) {
      this.canvas.commitGesture();
    } else if (this.labelDrag) {
      this.canvas.commitGesture();
    } else if (
      this.seatDrag?.dragging ||
      this.tableDrag?.dragging ||
      this.stageDrag?.dragging ||
      this.foodPrepareDrag?.dragging ||
      this.accessPointDrag?.dragging ||
      this.featureResizeDrag?.dragging
    ) {
      this.canvas.commitGesture();
      if (this.accessPointDrag?.dragging) {
        this.canvas.commitDiningAccessPointDrag(this.accessPointDrag.elementId);
      }
    }
    this.panning = false;
    this.commitPanSession();
    this.rotateSession = null;
    this.featureRotateSession = null;
    this.viewpointDrag = null;
    this.labelDrag = null;
    this.vertexDrag = null;
    this.drawAisleDrag = null;
    this.parkingEdgeDrag = null;
    this.parkingSlotDrag = null;
    this.draftEdgeBowDrag = null;
    this.resizeSession = null;
    this.seatDrag = null;
    this.tableDrag = null;
    this.stageDrag = null;
    this.foodPrepareDrag = null;
    this.accessPointDrag = null;
    this.featureResizeDrag = null;
    this.ringBlockDrag = null;
    this.drag = null;
    this.auditRegionDrag = null;
    this.isMoveDragging.set(false);
    if (tapToFitId) {
      this.zoomCanvasToReadableBlock(tapToFitId);
    }
  }

  protected onSeatDoubleClick(event: MouseEvent, el: LayoutElement): void {
    if (!this.canOpenBlockWorkspace(el)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.openBlockWorkspace(el);
  }

  protected onTableDoubleClick(event: MouseEvent, el: LayoutElement): void {
    if (!this.canOpenBlockWorkspace(el)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.openBlockWorkspace(el);
  }

  protected onElementDoubleClick(event: MouseEvent, el: LayoutElement): void {
    if (this.canOpenBlockWorkspace(el)) {
      event.preventDefault();
      event.stopPropagation();
      this.openBlockWorkspace(el);
      return;
    }
    if (!this.isDragFillSeatsActive()) {
      return;
    }
    const id = this.canvas.dragFillSeatsElementId();
    if (!id || el.id !== id || el.type !== 'centerpiece' || !hasTracedBlockOutline(el)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const pt = this.toCanvasPct(event.clientX, event.clientY);
    if (pt) {
      this.canvas.placeDragFillSeedSeatAt(id, pt);
    }
  }

  protected onDoubleClick(event: MouseEvent): void {
    if (this.isDrawing()) {
      this.completeCustomDraw();
    } else if (this.isParkingSlotDrawing()) {
      this.canvas.finishParkingSlotDrawing();
    } else if (this.isParkingRouteDrawing()) {
      this.canvas.finishParkingRouteDrawing();
    } else if (this.isParkingCustomSlotDrawing()) {
      this.canvas.finishParkingCustomSlotDrawing();
    } else if (this.isLineSeatDrawing()) {
      this.canvas.finishLineSeatDrawing();
    } else if (this.isServiceRouteDrawing()) {
      this.canvas.finishServiceRouteDrawing();
    } else if (this.isSeatRowDrawing()) {
      this.canvas.finishSeatRowDrawing();
    } else if (this.isDragFillSeatsActive()) {
      const id = this.canvas.dragFillSeatsElementId();
      const pt = this.toCanvasPct(event.clientX, event.clientY);
      if (id && pt) {
        this.canvas.placeDragFillSeedSeatAt(id, pt);
      }
    }
  }

  @HostListener('document:keydown', ['$event'])
  protected onKeyDown(event: KeyboardEvent): void {
    if (isInteractiveUiTarget(event.target)) {
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (mod && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        this.canvas.redo();
      } else {
        this.canvas.undo();
      }
      return;
    }

    if (mod && key === 'y') {
      event.preventDefault();
      this.canvas.redo();
      return;
    }

    if (this.stageSidePickMode()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.canvas.cancelStageSidePick();
      }
      return;
    }

    if (this.isColorDetecting()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.canvas.colorDetectMode.set(false);
        return;
      }
      // Deleting a mis-traced block must work without leaving trace mode.
      this.handleDeleteKey(event);
      return;
    }

    if (this.isDrawing()) {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.completeCustomDraw();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.canvas.cancelDrawing();
      }
      return;
    }

    if (this.isParkingSlotDrawing()) {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.canvas.finishParkingSlotDrawing();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.canvas.cancelParkingSlotDrawing();
      }
      return;
    }

    if (this.isParkingRouteDrawing()) {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.canvas.finishParkingRouteDrawing();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.canvas.cancelParkingRouteDrawing();
      }
      return;
    }

    if (this.isParkingCustomSlotDrawing()) {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.canvas.finishParkingCustomSlotDrawing();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.canvas.cancelParkingCustomSlotDrawing();
      }
      return;
    }

    if (this.isParkingAccessPlacing()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.canvas.cancelParkingAccessPointPlacement();
      }
      return;
    }

    const selectedParkingSlot = this.canvas.selectedParkingSlotId();
    const parkingWorkspaceId = this.canvas.parkingWorkspaceId();
    if (selectedParkingSlot && parkingWorkspaceId) {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        this.canvas.removeParkingSlot(parkingWorkspaceId, selectedParkingSlot);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.canvas.selectParkingSlot(null);
        return;
      }
    }

    if (this.isLineSeatDrawing()) {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.canvas.finishLineSeatDrawing();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.canvas.cancelLineSeatDrawing();
      }
      return;
    }

    if (this.isServiceRouteDrawing()) {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.canvas.finishServiceRouteDrawing();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.canvas.cancelServiceRouteDrawing();
      }
      return;
    }

    if (this.isDrawAislePlacing()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.canvas.cancelDrawAisle();
        this.drawAisleHoverPx.set(null);
      }
      return;
    }

    if (this.isPerSeatPlacing()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.canvas.cancelPerSeatPlacement();
      }
      return;
    }

    if (this.isDragFillSeatsActive()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.canvas.cancelDragFillSeats();
      }
      return;
    }

    if (this.isArrangeByRowActive()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.canvas.cancelArrangeByRow();
        this.arrangeByRowDrag = null;
      }
      return;
    }

    if (this.isSeatRowDrawing()) {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.canvas.finishSeatRowDrawing();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.canvas.cancelSeatRowDrawing();
      }
      return;
    }

    this.handleDeleteKey(event);
  }

  private handleDeleteKey(event: KeyboardEvent): void {
    if (event.key !== 'Delete' && event.key !== 'Backspace') {
      return;
    }
    const seatId = this.canvas.selectedSeatId();
    const elementId = this.canvas.selectedId();
    if (seatId && elementId) {
      event.preventDefault();
      this.canvas.removeCustomShapeSeatFromElement(elementId, seatId);
      return;
    }
    const ids = this.canvas.selectedIds();
    if (ids.length > 0) {
      event.preventDefault();
      this.canvas.removeSelected();
    }
  }

  /** Screen pixels per canvas unit, including current zoom. */
  private screenScale(): number {
    const ctm = this.svgRef()?.nativeElement.getScreenCTM();
    return ctm ? ctm.a : this.canvas.zoom() / 100;
  }

  private zoomCanvasToReadableBlock(elementId: string): void {
    const svg = this.svgRef()?.nativeElement;
    this.canvas.fitCameraToElement(elementId, {
      viewportWidth: svg?.clientWidth || undefined,
      viewportHeight: svg?.clientHeight || undefined,
    });
  }

  private toCanvasPct(clientX: number, clientY: number): { xPct: number; yPct: number } | null {
    const pt = this.toCanvasPx(clientX, clientY);
    if (!pt) {
      return null;
    }
    return { xPct: (pt.x / this.width()) * 100, yPct: (pt.y / this.height()) * 100 };
  }

  private toCanvasPx(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = this.svgRef()?.nativeElement;
    if (!svg) {
      return null;
    }
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      return null;
    }
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  private beginPanSession(clientX: number, clientY: number): void {
    this.panSession = {
      startClientX: clientX,
      startClientY: clientY,
      startCameraX: this.canvas.cameraX(),
      startCameraY: this.canvas.cameraY(),
    };
    this.panPendingClient = { x: clientX, y: clientY };
    this.canvas.viewportPanning.set(true);
  }

  private schedulePanViewBox(clientX: number, clientY: number): void {
    this.panPendingClient = { x: clientX, y: clientY };
    if (this.panFrameScheduled) {
      return;
    }
    this.panFrameScheduled = true;
    requestAnimationFrame(() => {
      this.panFrameScheduled = false;
      this.applyPanViewBoxPreview();
    });
  }

  private applyPanViewBoxPreview(): void {
    const session = this.panSession;
    if (!session) {
      return;
    }
    const svg = this.svgRef()?.nativeElement;
    const vw = svg?.clientWidth ?? 1;
    const vh = svg?.clientHeight ?? 1;
    const zoom = this.canvas.zoom() / 100;
    const viewW = this.width() / zoom;
    const viewH = this.height() / zoom;
    const screenDx = this.panPendingClient.x - session.startClientX;
    const screenDy = this.panPendingClient.y - session.startClientY;
    const deltaX = vw > 0 ? (screenDx / vw) * viewW : 0;
    const deltaY = vh > 0 ? (screenDy / vh) * viewH : 0;
    const cx = session.startCameraX - deltaX;
    const cy = session.startCameraY - deltaY;
    this.canvas.panViewBoxOverride.set(
      `${cx - viewW / 2} ${cy - viewH / 2} ${viewW} ${viewH}`,
    );
  }

  private commitPanSession(): void {
    const session = this.panSession;
    if (!session) {
      this.canvas.clearPanPreview();
      return;
    }
    const svg = this.svgRef()?.nativeElement;
    const vw = svg?.clientWidth ?? 1;
    const vh = svg?.clientHeight ?? 1;
    const zoom = this.canvas.zoom() / 100;
    const viewW = this.width() / zoom;
    const viewH = this.height() / zoom;
    const screenDx = this.panPendingClient.x - session.startClientX;
    const screenDy = this.panPendingClient.y - session.startClientY;
    const deltaX = vw > 0 ? (screenDx / vw) * viewW : 0;
    const deltaY = vh > 0 ? (screenDy / vh) * viewH : 0;
    this.canvas.cameraX.set(session.startCameraX - deltaX);
    this.canvas.cameraY.set(session.startCameraY - deltaY);
    this.panSession = null;
    this.canvas.clearPanPreview();
  }

  /** Zoom-aware pixel radius around the first draft dot that closes a parking area outline. */
  private parkingCloseThresholdPx(): number {
    const zoom = this.canvas.zoom();
    return Math.max(16, 28 / Math.max(0.35, zoom / 100));
  }

  private isNearFirstDraftPointPx(pxPoint: { x: number; y: number }): boolean {
    const first = this.draftPointList()[0];
    if (!first) {
      return false;
    }
    return Math.hypot(pxPoint.x - first.x, pxPoint.y - first.y) <= this.parkingCloseThresholdPx();
  }

  /** Pointer angle in ring-local degrees (0° = east, y-down canvas). */
  private ringPointerAngleDeg(el: LayoutElement, clientX: number, clientY: number): number | null {
    if (el.type !== 'layer-ring') {
      return null;
    }
    const pt = this.toCanvasPx(clientX, clientY);
    if (!pt) {
      return null;
    }
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const worldDeg = (Math.atan2(pt.y - rect.cy, pt.x - rect.cx) * 180) / Math.PI;
    return worldDeg - (el.rotation ?? 0);
  }

  // --- View-model building ---

  private seatMapCache = new Map<string, { seats: readonly SeatNode[]; rowLabels: RowLabelNode[] }>();
  private seatBudgetCursor = Number.MAX_SAFE_INTEGER;

  private resetSeatBudgetCursor(): void {
    this.seatBudgetCursor = this.canvas.seatRenderBudget();
  }

  private shouldSkipSeatMap(): boolean {
    return this.canvas.seatHydrationPhase() === 'outline';
  }

  private cachedSeatMap<T extends SeatNode>(
    cacheKey: string,
    builder: () => { seats: T[]; rowLabels: RowLabelNode[] },
  ): { seats: T[]; rowLabels: RowLabelNode[] } {
    if (this.shouldSkipSeatMap()) {
      return { seats: [], rowLabels: [] };
    }
    if (this.canvas.seatHydrationPhase() === 'complete') {
      return builder();
    }
    const cached = this.seatMapCache.get(cacheKey);
    if (cached) {
      return { seats: cached.seats as T[], rowLabels: cached.rowLabels };
    }
    const map = builder();
    this.seatMapCache.set(cacheKey, map);
    return map;
  }

  private applySeatBudget<T extends SeatNode>(seats: T[]): T[] {
    if (this.canvas.seatHydrationPhase() === 'complete') {
      return seats;
    }
    if (this.canvas.seatHydrationPhase() === 'outline') {
      return [];
    }
    const take = seats.slice(0, this.seatBudgetCursor);
    this.seatBudgetCursor -= take.length;
    return take;
  }

  private buildVm(
    el: LayoutElement,
    selected: boolean,
    selectedSeatId: string | null,
    selectedRow: { blockId: string; rowIndex: number } | null,
  ): ElementVM {
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const transform = el.rotation ? `rotate(${el.rotation} ${rect.cx} ${rect.cy})` : null;
    const fill = el.style.fillColor ?? '#e2e8f0';
    const stroke = selected ? '#2563eb' : el.style.strokeColor ?? '#94a3b8';
    const labelColor = el.style.labelColor ?? '#0f172a';
    const base: ElementVM = {
      el,
      rect,
      transform,
      selected,
      fill,
      stroke,
      strokeWidth: selected ? 3.5 : 1.5,
      labelColor,
    };

    switch (el.type) {
      case 'centerpiece':
        return this.buildCenterpiece(base, selectedSeatId, selectedRow);
      case 'layer-ring':
        return this.buildRing(base);
      case 'layer-rect':
        return this.buildRectLayer(base);
      case 'block-grid':
        return this.buildGrid(base);
      case 'seat-section':
        return this.buildSeatSection(base);
      case 'aisle':
        return { ...base, aisle: true };
      case 'label':
        return this.buildLabel(base);
      default:
        return base;
    }
  }

  private buildCenterpiece(
    vm: ElementVM,
    selectedSeatId: string | null,
    selectedRow: { blockId: string; rowIndex: number } | null,
  ): ElementVM {
    const el = vm.el;
    if (el.type !== 'centerpiece') {
      return vm;
    }
    const resolvedEarly = resolveCenterpieceShapeDraw(el, this.canvas.canvas(), {
      buildParkingPath: buildParkingOutlinePathPx,
    });
    const rect = resolvedEarly.rect;
    const labelSize = clamp(Math.min(rect.width, rect.height) * 0.18, 10, 30);
    const inWorkspace = this.inBlockWorkspace();
    const customizable = isCustomizableBlock(el);
    const labelOffset = resolveCenterpieceDisplayLabelOffset(el, inWorkspace, customizable);
    const labelPos =
      inWorkspace && customizable
        ? workspaceBlockLabelCanvasPosition(rect, labelSize)
        : centerpieceLabelCanvasPosition(
            rect,
            labelOffset.labelOffsetXPct,
            labelOffset.labelOffsetYPct,
            labelSize,
          );
    const labelColor = resolveCenterpieceBlockLabelColor(
      el,
      inWorkspace,
      customizable,
      this.theme.isDark(),
    );
    const centerLabel: LabelVM | undefined = el.label.trim()
      ? {
          text: el.label,
          x: labelPos.x,
          y: labelPos.y,
          anchor: 'middle',
          fontSize: labelSize,
          weight: 800,
          color: labelColor,
          elementId: el.id,
          draggable: isCenterpieceLabelDraggable(el, vm.selected, this.blockViewpointMode()),
        }
      : undefined;

    let customSeats: CustomSeatVM[] | undefined;
    let rowLabels: RowLabelNode[] | undefined;
    let showSeatNumbers = false;
    if (hasTracedBlockOutline(el) && isCustomShapeSeatingEnabled(el)) {
      const map = this.cachedSeatMap(`${el.id}:custom`, () => buildCustomShapeSeatMap(el, rect));
      const polygon = polygonCanvasPointsFromBlock(el.customPoints ?? [], rect);

      const perSeatLabels = el.perSeatPlacementMode === true;
      const defaultPitch = resolveCustomShapeSeatPitchPx(el, rect);
      showSeatNumbers =
        el.customSeatBlocks?.[0]?.seatLayout?.showSeatNumbers === true ||
        el.seatLayout?.showSeatNumbers === true;
      const viewpointAngle =
        el.blockViewpointAngleDeg ?? this.canvas.blockWorkspaceViewpointAngleDeg() ?? null;
      const facingDeg =
        el.seatFacingDeg ??
        (polygon.length >= 3
          ? resolveSeatFacingDegForShapeSeats(el, polygon, rect)
          : viewpointAngle != null
            ? seatFacingDegFromViewpoint(viewpointAngle)
            : 0);
      const chairWM = resolveChairWidthM(el);
      const chairLM = resolveChairLengthM(el);
      const seatGapM = resolveSeatGapM(el);
      const rowGapM = resolveRowGapM(el);
      const seatsForRender = this.applySeatBudget(map.seats);
      const revealDelays = this.shouldSkipSeatMap()
        ? []
        : computeViewpointRevealDelays(map.seats, el, rect);
      customSeats = seatsForRender.map((s, index) => {
        const pitch = s.pitchPx ?? defaultPitch;
        const { chairScale: rawScale, chairScaleY: rawScaleY } = chairScalesFromSeatPitch(
          pitch,
          chairWM,
          chairLM,
          seatGapM,
          rowGapM,
        );
        let chairScale = rawScale;
        let chairScaleY = rawScaleY;
        const focusedForReadability =
          (inWorkspace && this.canvas.blockWorkspaceId() === el.id) ||
          (!inWorkspace &&
            this.canvas.selectedIds().length === 1 &&
            this.canvas.selectedIds()[0] === el.id &&
            this.canvas.zoom() >= 250);
        if (focusedForReadability) {
          const drawn = Math.max(chairScale, chairScaleY) * SEAT_GRAPHIC_SIZE;
          // Grow tiny chairs so they read as seats, but never past the seat
          // pitch or neighbouring chairs would overlap into a solid block.
          const target = Math.min(inWorkspace ? 18 : 12, pitch * 0.94);
          if (drawn > 0 && drawn < target) {
            const boost = target / drawn;
            chairScale = rawScale * boost;
            chairScaleY = rawScaleY * boost;
          }
        }
        return {
          ...s,
          selected: s.seatId === selectedSeatId,
          hitRadius: Math.min(
            chairHitRadiusFromPitchPx(pitch),
            chairHitRadiusFromSeatRadius(s.radius),
          ),
          useChairIcon: true,
          chairScale,
          chairScaleY,
          rotationDeg: s.rotationDeg ?? facingDeg,
          labelText: showSeatNumbers ? s.label : '',
          revealDelayMs: revealDelays[index] ?? index * 4,
        };
      });
      rowLabels = this.shouldSkipSeatMap()
        ? []
        : map.rowLabels.map((rl) => ({
            ...rl,
            selected:
              selectedRow != null &&
              (rl.blockId ?? el.id) === selectedRow.blockId &&
              rl.rowIndex === selectedRow.rowIndex,
          }));
    }

    const perSeatLabels = el.type === 'centerpiece' && el.perSeatPlacementMode === true;
    const showRowLabelsInWorkspace =
      inWorkspace &&
      customizable &&
      this.canvas.blockWorkspaceId() === el.id &&
      !perSeatLabels &&
      el.seatLayout?.showRowLabels !== false;
    const seatExtras = customSeats
      ? {
          customSeats,
          rowLabels: showRowLabelsInWorkspace ? rowLabels : [],
          showRowLabels: showRowLabelsInWorkspace,
          showSeatNumbers,
          showInlineSeatLabels: perSeatLabels,
        }
      : {};

    let diningTables: DiningTableRenderNode[] | undefined;
    if (el.blockType === 'dining-table' && getDiningTableCount(el) > 0) {
      diningTables = buildDiningTableRenderList(
        el,
        rect,
        this.canvas.selectedTableId(),
        this.canvas.selectedTableIds(),
      );
    }
    const tableExtras = diningTables ? { diningTables } : {};

    let diningStage: DiningStageRenderNode | undefined;
    if (el.blockType === 'dining-table' && hasDiningStage(el)) {
      diningStage = buildDiningStageRenderNode(el, rect, this.canvas.diningStageSelected()) ?? undefined;
    }
    const stageExtras = diningStage ? { diningStage } : {};

    let diningFoodPrepare: DiningStageRenderNode | undefined;
    if (el.blockType === 'dining-table' && hasDiningFoodPrepare(el)) {
      diningFoodPrepare = buildDiningFoodPrepareRenderNode(el, rect, this.canvas.diningFoodPrepareSelected()) ?? undefined;
    }
    const foodPrepareExtras = diningFoodPrepare ? { diningFoodPrepare } : {};

    const accessMode = resolveDiningAccessMode(el);
    let diningEntrance: DiningStageRenderNode | undefined;
    if (el.blockType === 'dining-table' && accessMode === 'separate' && hasDiningEntrance(el)) {
      diningEntrance = buildDiningEntranceRenderNode(el, rect, false) ?? undefined;
    }
    const entranceExtras = diningEntrance ? { diningEntrance } : {};

    let diningExit: DiningStageRenderNode | undefined;
    if (el.blockType === 'dining-table' && accessMode === 'separate' && hasDiningExit(el)) {
      diningExit = buildDiningExitRenderNode(el, rect, false) ?? undefined;
    }
    const exitExtras = diningExit ? { diningExit } : {};

    let diningSharedAccess: DiningStageRenderNode | undefined;
    if (el.blockType === 'dining-table' && accessMode === 'shared' && hasDiningSharedAccess(el)) {
      diningSharedAccess = buildDiningSharedAccessRenderNode(el, rect, false) ?? undefined;
    }
    const sharedExtras = diningSharedAccess ? { diningSharedAccess } : {};

    let diningServiceRoutes: DiningServiceRouteRenderNode[] | undefined;
    if (el.blockType === 'dining-table' && (el.diningServiceRoutes?.length ?? 0) > 0) {
      diningServiceRoutes = buildDiningServiceRouteRenderList(
        el,
        rect,
        this.canvas.selectedServiceRouteId(),
      );
    }
    const routeExtras = diningServiceRoutes?.length ? { diningServiceRoutes } : {};

    const diningRefExtras = el.diningLayoutReferenceImage
      ? { diningLayoutReferenceImage: el.diningLayoutReferenceImage }
      : {};

    const seatCount = customSeats?.length ?? 0;
    const finish = (result: ElementVM) => this.withSeatingBlockStroke(result, el, seatCount);

    const resolved = resolvedEarly;
    const isParking = el.blockType === 'parking' && (el.customPoints?.length ?? 0) >= 3;
    const parkingExtras = isParking
      ? {
          parkingSlots: this.buildParkingSlotsPx(el, resolved.rect),
          parkingAccessPoints: this.buildParkingAccessPointsPx(el, resolved.rect),
          parkingRoutes: this.buildParkingRoutesPx(el, resolved.rect),
          parkingDividerLines: this.buildParkingDividerLinesPx(el, resolved.rect),
        }
      : {};

    return finish({
      ...vm,
      rect: resolved.rect,
      shapeMode: resolved.shapeMode,
      pathD: resolved.pathD,
      rectRx: resolved.rectRx,
      ...(isParking ? { fillOpacity: PARKING_AREA_FILL_OPACITY } : {}),
      ...diningRefExtras,
      centerLabel,
      ...seatExtras,
      ...tableExtras,
      ...stageExtras,
      ...foodPrepareExtras,
      ...entranceExtras,
      ...exitExtras,
      ...sharedExtras,
      ...routeExtras,
      ...parkingExtras,
    });
  }

  /** Blue outline while placing or editing seats inside block workspace. */
  private shouldHighlightSeatingBlockStroke(el: CenterpieceElement, seatCount: number): boolean {
    if (!this.inBlockWorkspace() || !hasTracedBlockOutline(el) || el.blockType !== 'seating') {
      return false;
    }
    if (seatCount > 0) {
      return true;
    }
    if (!isCustomShapeSeatingEnabled(el)) {
      return false;
    }
    const id = el.id;
    if (this.canvas.dragFillSeatsElementId() === id) {
      return true;
    }
    if (this.canvas.arrangeByRowElementId() === id && this.isArrangeByRowActive()) {
      return true;
    }
    if (this.isPerSeatPlacing() && this.canvas.blockWorkspaceId() === id) {
      return true;
    }
    if (this.isSeatRowDrawing() && this.canvas.drawingElementId() === id) {
      return true;
    }
    if (this.isLineSeatDrawing() && this.canvas.drawingElementId() === id) {
      return true;
    }
    return true;
  }

  private withSeatingBlockStroke(
    vm: ElementVM,
    el: CenterpieceElement,
    seatCount: number,
  ): ElementVM {
    if (!this.shouldHighlightSeatingBlockStroke(el, seatCount)) {
      return vm;
    }
    return { ...vm, stroke: SEATING_BLOCK_STROKE, strokeWidth: SEATING_BLOCK_STROKE_WIDTH };
  }

  private buildRing(vm: ElementVM): ElementVM {
    const el = vm.el;
    if (el.type !== 'layer-ring') {
      return vm;
    }
    const { rect } = vm;
    const outerRx = Math.max(0, rect.width / 2);
    const outerRy = Math.max(0, rect.height / 2);
    const thickness = Math.max(4, (el.thicknessPct / 100) * this.width());
    const innerRx = Math.max(0, outerRx - thickness);
    const innerRy = Math.max(0, outerRy - thickness);
    const ringPath = annularEllipsePath(rect.cx, rect.cy, innerRx, innerRy, outerRx, outerRy);
    const blockSel = this.canvas.selectedRingBlock();
    const ringDefaultFill = el.style.fillColor ?? '#ffffff';
    const defaultStroke = el.style.strokeColor ?? '#cbd5e1';

    const sectors: SectorVM[] = el.blocks.map((block) => {
      const path = radialSectorPath({
        cx: rect.cx,
        cy: rect.cy,
        innerRx,
        innerRy,
        outerRx,
        outerRy,
        startDeg: block.startAngleDeg,
        endDeg: block.endAngleDeg,
      });
      const map = this.cachedSeatMap(`${el.id}:${block.id}:sector`, () =>
        buildSectorSeatMapForBlock(
          block,
          {
            cx: rect.cx,
            cy: rect.cy,
            innerRx,
            innerRy,
            outerRx,
            outerRy,
            startDeg: block.startAngleDeg,
            endDeg: block.endAngleDeg,
          },
          el.rowLabelStyle,
        ),
      );
      const mid = (block.startAngleDeg + block.endAngleDeg) / 2;
      const midRad = (mid * Math.PI) / 180;
      const lr = (innerRx + outerRx) / 2;
      const lry = (innerRy + outerRy) / 2;
      const blockSelected =
        vm.selected && blockSel?.elementId === el.id && blockSel.blockId === block.id;
      return {
        id: block.id,
        path,
        seats: this.applySeatBudget(map.seats),
        rowLabels: this.shouldSkipSeatMap() ? [] : map.rowLabels,
        code: block.code,
        displayLabel: (block.label?.trim() || block.code).trim(),
        labelX: rect.cx + lr * Math.cos(midRad),
        labelY: rect.cy + lry * Math.sin(midRad),
        fill: blockSelected ? '#bfdbfe' : (block.fillColor ?? ringDefaultFill),
        stroke: blockSelected ? '#2563eb' : defaultStroke,
        strokeWidth: blockSelected ? 2 : 1.2,
        blockSelected,
      };
    });

    const ringStroke = vm.selected ? '#2563eb' : el.style.strokeColor ?? '#d8b4fe';
    const ringStrokeWidth = vm.selected ? 2 : 1.25;

    return { ...vm, ringPath, sectors, stroke: ringStroke, strokeWidth: ringStrokeWidth, fill: 'none' };
  }

  private buildRectLayer(vm: ElementVM): ElementVM {
    const el = vm.el;
    if (el.type !== 'layer-rect') {
      return vm;
    }
    const { rect } = vm;
    const band = Math.min(rect.width, rect.height) * 0.22;
    const groundX = rect.x + band;
    const groundY = rect.y + band;
    const groundW = Math.max(0, rect.width - band * 2);
    const groundH = Math.max(0, rect.height - band * 2);

    const bySide = (side: RectSide) => el.blocks.filter((b) => b.side === side);
    const blockSel = this.canvas.selectedRingBlock();
    const ringDefaultFill = el.style.fillColor ?? '#ffffff';
    const defaultStroke = el.style.strokeColor ?? '#cbd5e1';
    const blocks: RectBlockVM[] = [];
    (['top', 'bottom', 'left', 'right'] as RectSide[]).forEach((side) => {
      const list = bySide(side);
      list.forEach((block, i) => {
        const r = this.rectBlockBox(side, i, list.length, rect, band, groundX, groundY, groundW, groundH);
        const map = this.cachedSeatMap(`${el.id}:${block.id}:grid`, () =>
          buildGridSeatMap(r, block.rows, block.seatsPerRow, el.rowLabelStyle),
        );
        const blockSelected =
          vm.selected && blockSel?.elementId === el.id && blockSel.blockId === block.id;
        blocks.push({
          id: block.id,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          seats: this.applySeatBudget(map.seats),
          code: block.code,
          labelX: r.cx,
          labelY: r.cy,
          blockSelected,
          fill: blockSelected ? '#bfdbfe' : ringDefaultFill,
          stroke: blockSelected ? '#2563eb' : defaultStroke,
          strokeWidth: blockSelected ? 2 : 1.2,
        });
      });
    });

    return { ...vm, groundX, groundY, groundW, groundH, rectBlocks: blocks };
  }

  private rectBlockBox(
    side: RectSide,
    index: number,
    count: number,
    rect: PixelRect,
    band: number,
    gx: number,
    gy: number,
    gw: number,
    gh: number,
  ): PixelRect {
    const gap = 4;
    const make = (x: number, y: number, w: number, h: number): PixelRect => ({
      x,
      y,
      width: w,
      height: h,
      cx: x + w / 2,
      cy: y + h / 2,
    });
    if (side === 'top' || side === 'bottom') {
      const slot = (gw - gap * (count - 1)) / Math.max(1, count);
      const x = gx + index * (slot + gap);
      const y = side === 'top' ? rect.y : rect.y + rect.height - band;
      return make(x, y, slot, band);
    }
    const slot = (gh - gap * (count - 1)) / Math.max(1, count);
    const y = gy + index * (slot + gap);
    const x = side === 'left' ? rect.x : rect.x + rect.width - band;
    return make(x, y, band, slot);
  }

  private buildGrid(vm: ElementVM): ElementVM {
    const el = vm.el;
    if (el.type !== 'block-grid') {
      return vm;
    }
    const resolved = resolveBlockGridShapeDraw(el, this.canvas.canvas());
    const map = this.cachedSeatMap(`${el.id}:grid`, () =>
      buildGridSeatMap(resolved.rect, el.rows, el.seatsPerRow, el.rowLabelStyle),
    );
    return {
      ...vm,
      rect: resolved.rect,
      shapeMode: resolved.shapeMode,
      pathD: resolved.pathD,
      rectRx: resolved.rectRx,
      seats: this.applySeatBudget(map.seats),
      rowLabels: this.shouldSkipSeatMap() ? [] : map.rowLabels,
      showRowLabels: true,
    };
  }

  private buildSeatSection(vm: ElementVM): ElementVM {
    const el = vm.el;
    if (el.type !== 'seat-section') {
      return vm;
    }
    const map = this.cachedSeatMap(`${el.id}:section`, () =>
      buildSeatSectionSeatMap(vm.rect, el.rows, el.rowGapPct, el.rowLabelStyle),
    );
    return {
      ...vm,
      seats: this.applySeatBudget(map.seats),
      rowLabels: this.shouldSkipSeatMap() ? [] : map.rowLabels,
      showRowLabels: el.showRowLabels,
    };
  }

  private buildLabel(vm: ElementVM): ElementVM {
    const el = vm.el;
    if (el.type !== 'label') {
      return vm;
    }
    const { rect } = vm;
    const anchor: 'start' | 'middle' | 'end' =
      el.textAlign === 'left' ? 'start' : el.textAlign === 'right' ? 'end' : 'middle';
    const x = anchor === 'start' ? rect.x : anchor === 'end' ? rect.x + rect.width : rect.cx;
    return {
      ...vm,
      label: {
        text: el.text,
        x,
        y: rect.cy + el.fontSize * 0.32,
        anchor,
        fontSize: el.fontSize,
        weight: el.fontWeight === 'bold' ? 700 : 400,
        color: el.style.labelColor ?? '#0f172a',
      },
    };
  }

  protected readonly seatFill = SEAT_FILL;
  protected readonly seatStroke = SEAT_STROKE;

  protected isSeatingEnabled(el: LayoutElement): boolean {
    return el.type === 'centerpiece' && isCustomShapeSeatingEnabled(el);
  }

  /** Elements whose canvas children (sectors, seats, etc.) must receive clicks while selected. */
  protected hasSelectableChildren(el: LayoutElement): boolean {
    return el.type === 'layer-ring' || el.type === 'layer-rect' || this.isSeatingEnabled(el);
  }

  protected selectionOverlayPointerEvents(el: LayoutElement): string {
    if (this.canvas.autoFillLayoutMode()) {
      return 'auto';
    }
    if (this.hasSelectableChildren(el) && !this.blockViewpointMode()) {
      return 'none';
    }
    return 'auto';
  }

  protected selectionRectPointerEvents(el: LayoutElement): string {
    // Auto Fill layout: let polygon hit-tests receive clicks (AABB overlays
    // steal toggles on overlapping blocks). Shape handlers already toggle.
    if (this.canvas.autoFillLayoutMode()) {
      return 'none';
    }
    if (this.blockViewpointMode() || this.hasSelectableChildren(el)) {
      return 'none';
    }
    // Pass clicks through to overlapping blocks and the element shape beneath.
    if (el.type === 'centerpiece') {
      return 'none';
    }
    return 'all';
  }

  protected seatChairView(
    seat: SeatNode,
    options: {
      showNumbers?: boolean;
      selected?: boolean;
    } = {},
  ) {
    return seatNodeToChairView(seat, options);
  }

  protected customSeatTransform(seat: CustomSeatVM): string {
    const rotation = seat.rotationDeg ?? 0;
    const rotate = rotation ? ` rotate(${rotation})` : '';
    return `translate(${seat.x},${seat.y})${rotate}`;
  }

  /**
   * Converts a parking area's stored divider lines (element-local %) into rect-relative
   * canvas px — same unrotated space as the outline path; rotation is applied once by the
   * shared `<g [attr.transform]>` wrapper around both.
   */
  private buildParkingDividerLinesPx(
    el: CenterpieceElement,
    rect: PixelRect,
  ): { x1: number; y1: number; x2: number; y2: number }[] {
    const lines = el.parkingDividerLines ?? [];
    if (lines.length === 0) {
      return [];
    }
    const toPx = (p: ElementPosition) => ({
      x: rect.x + (p.xPct / 100) * rect.width,
      y: rect.y + (p.yPct / 100) * rect.height,
    });
    return lines
      .filter((line) => line.length >= 2)
      .map((line) => {
        const a = toPx(line[0]);
        const b = toPx(line[line.length - 1]);
        return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      });
  }

  /**
   * Converts a parking area's placed slots (element-local %, metre size) into rect-relative
   * canvas px — same unrotated space as the outline path; rotation is applied once by the
   * shared `<g [attr.transform]>` wrapper around both.
   */
  private buildParkingSlotsPx(
    el: CenterpieceElement,
    rect: PixelRect,
  ): NonNullable<ElementVM['parkingSlots']> {
    const slots = el.parkingSlots ?? [];
    if (slots.length === 0) {
      return [];
    }
    const selectedId = this.canvas.selectedParkingSlotId();
    const ppm =
      computeParkingPxPerMeter(rect, el.customPoints ?? [], el.customSideLengthsM ?? []) ??
      pxPerMeter(rect, resolveBlockLengthM(el), resolveBlockWidthM(el));
    return slots.map((slot) => ({
      id: slot.id,
      label: slot.label ?? null,
      selected: slot.id === selectedId,
      x: rect.x + (slot.xPct / 100) * rect.width,
      y: rect.y + (slot.yPct / 100) * rect.height,
      rotationDeg: slot.rotationDeg,
      lengthPx: slot.lengthM * ppm,
      widthPx: slot.widthM * ppm,
      vehicleType: slot.vehicleType,
      shapePoints: slot.shapePoints ?? null,
      labelHeightPx: slot.labelHeightM && slot.labelHeightM > 0 ? slot.labelHeightM * ppm : null,
    }));
  }

  /** Converts a parking area's stored driving routes (element-local %) into canvas px + direction arrows. */
  private buildParkingRoutesPx(
    el: CenterpieceElement,
    rect: PixelRect,
  ): NonNullable<ElementVM['parkingRoutes']> {
    const routes = el.parkingRoutes ?? [];
    if (routes.length === 0) {
      return [];
    }
    return routes
      .filter((route) => route.points.length >= 2)
      .map((route) => {
        const pts = route.points.map((p) => ({
          x: rect.x + (p.xPct / 100) * rect.width,
          y: rect.y + (p.yPct / 100) * rect.height,
        }));
        return {
          id: route.id,
          pointsStr: pts.map((p) => `${p.x},${p.y}`).join(' '),
          arrows: routeArrowsFromPoints(pts),
        };
      });
  }

  /** Converts a parking area's Enter/Exit markers (edge id + offset) into canvas px. */
  /**
   * Renders each Enter/Exit marker as a segment lying directly on the outline edge
   * (not a floating dot) — fixed at `PARKING_ACCESS_WAY_WIDTH_M`, independent of any
   * vehicle type's own slot/aisle defaults.
   */
  private buildParkingAccessPointsPx(
    el: CenterpieceElement,
    rect: PixelRect,
  ): { x1: number; y1: number; x2: number; y2: number; kind: 'enter' | 'exit'; label: string }[] {
    const points = el.parkingAccessPoints ?? [];
    if (points.length === 0) {
      return [];
    }
    const gateWidthM = PARKING_ACCESS_WAY_WIDTH_M;
    // frame.ppm is the generic bounding-box L×W scale (dining-stage.ts) — parking areas
    // need the per-edge measured scale instead, same as every other parking metre<->px
    // conversion (and the same one placeParkingAccessPointAt used to store offsetAlongEdgeM).
    const ppm =
      computeParkingPxPerMeter(rect, el.customPoints ?? [], el.customSideLengthsM ?? []) ??
      pxPerMeter(rect, resolveBlockLengthM(el), resolveBlockWidthM(el));
    const result: { x1: number; y1: number; x2: number; y2: number; kind: 'enter' | 'exit'; label: string }[] = [];
    for (const point of points) {
      const frame = getStageEdgeFrame(el, rect, point.sideEdgeId);
      if (!frame) {
        continue;
      }
      const alongPx = point.offsetAlongEdgeM * ppm;
      const cx = frame.edge.midX + frame.ux * alongPx;
      const cy = frame.edge.midY + frame.uy * alongPx;
      const halfPx = (gateWidthM * ppm) / 2;
      result.push({
        x1: cx - frame.ux * halfPx,
        y1: cy - frame.uy * halfPx,
        x2: cx + frame.ux * halfPx,
        y2: cy + frame.uy * halfPx,
        kind: point.kind,
        label: point.label ?? (point.kind === 'enter' ? 'ENTER' : 'EXIT'),
      });
    }
    return result;
  }

  private buildSelectionOverlay(el: LayoutElement, showHandles: boolean): SelectionOverlayVM {
    const rect = rectFromPositionSize(el.position, el.size, this.canvas.canvas());
    const rotation = el.rotation ?? 0;
    const rotationTransform = rotation ? `rotate(${rotation} ${rect.cx} ${rect.cy})` : null;
    const zoomPct = this.canvas.zoom();
    const ui = (screenPx: number) => selectionUiSize(screenPx, zoomPct);
    const handleHalf = ui(SELECTION_HANDLE_HALF_SCREEN);
    const controlR = ui(SELECTION_CONTROL_R_SCREEN);
    const crossArm = ui(SELECTION_CROSS_ARM_SCREEN);
    const strokeW = ui(SELECTION_STROKE_SCREEN);
    const selectionStroke = ui(SELECTION_STROKE_SCREEN);
    const offset = ui(SELECTION_OFFSET_SCREEN);
    const spread = ui(SELECTION_SPREAD_SCREEN);
    const anchorX = rect.cx;
    const anchorY = rect.y;
    const customVertices =
      showHandles &&
      el.type === 'centerpiece' &&
      hasTracedBlockOutline(el) &&
      el.adjustEdges === true &&
      (el.customPoints?.length ?? 0) >= 3
        ? (el.customPoints ?? []).map((p, index) => ({
            index,
            x: rect.x + (p.xPct / 100) * rect.width,
            y: rect.y + (p.yPct / 100) * rect.height,
          }))
        : undefined;
    const parkingEdgeHandles =
      showHandles &&
      el.type === 'centerpiece' &&
      hasTracedBlockOutline(el) &&
      el.blockType === 'parking' &&
      el.adjustEdges === true &&
      (el.customPoints?.length ?? 0) >= 3
        ? (el.customPoints ?? [])
            .map((_, index) => {
              const handle = getEdgeBowHandleCanvasPx(
                rect,
                el.customPoints ?? [],
                el.edgeBowAmounts ?? [],
                index,
                controlR * 2.2,
              );
              return handle ? { index, x: handle.x, y: handle.y } : null;
            })
            .filter((h): h is { index: number; x: number; y: number } => h != null)
        : undefined;
    return {
      el,
      rect,
      rotationTransform,
      anchorX,
      anchorY,
      moveX: anchorX - spread,
      moveY: anchorY - offset,
      rotateX: anchorX + spread,
      rotateY: anchorY - offset,
      handleHalf,
      controlR,
      crossArm,
      strokeW,
      selectionStroke,
      handles: {
        n: { x: rect.cx, y: rect.y, cursor: resizeCursor('n', rotation) },
        s: { x: rect.cx, y: rect.y + rect.height, cursor: resizeCursor('s', rotation) },
        e: { x: rect.x + rect.width, y: rect.cy, cursor: resizeCursor('e', rotation) },
        w: { x: rect.x, y: rect.cy, cursor: resizeCursor('w', rotation) },
        ne: { x: rect.x + rect.width, y: rect.y, cursor: resizeCursor('ne', rotation) },
        nw: { x: rect.x, y: rect.y, cursor: resizeCursor('nw', rotation) },
        se: { x: rect.x + rect.width, y: rect.y + rect.height, cursor: resizeCursor('se', rotation) },
        sw: { x: rect.x, y: rect.y + rect.height, cursor: resizeCursor('sw', rotation) },
      },
      customVertices,
      parkingEdgeHandles,
      showHandles,
    };
  }

  private normalizeMarqueeRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): { x: number; y: number; width: number; height: number } {
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
  }

  private marqueeIntersects(
    marquee: { x: number; y: number; width: number; height: number },
    rect: PixelRect,
  ): boolean {
    return (
      marquee.x < rect.x + rect.width &&
      marquee.x + marquee.width > rect.x &&
      marquee.y < rect.y + rect.height &&
      marquee.y + marquee.height > rect.y
    );
  }

}
