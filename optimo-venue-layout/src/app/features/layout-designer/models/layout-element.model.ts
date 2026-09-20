import type { BlockTypeId } from './block-type.model';

/**
 * Typed model for placed layout elements.
 *
 * Definitions (tool metadata) live in the registry/factory in code; only these
 * placed instances are serialized to the layout JSON that gets saved to the API.
 * Geometry is percentage-based so a layout scales to any canvas/screen size.
 */

export interface CanvasConfig {
  width: number;
  height: number;
}

/** Element centre as a percentage of the canvas. */
export interface ElementPosition {
  xPct: number;
  yPct: number;
}

/** Element width/height as a percentage of the canvas. */
export interface ElementSize {
  wPct: number;
  hPct: number;
}



export interface ElementStyle {
  fillColor?: string;
  strokeColor?: string;
  labelColor?: string;
}

export type SeatLabelStyle = 'letter' | 'number';

/** Shared seat-layout settings for blocks and custom-shape seating. */
/** Per-block seat configuration (sector / grid blocks). */
export interface SeatLayoutSpec {
  rows: number;
  seatsPerRow: number;
  rowSeatCounts?: number[];
  rowOffsetXPcts?: number[];
  rowOffsetYPcts?: number[];
  rowLabelStyle?: SeatLabelStyle;
  hiddenSeatIds?: string[];
  aisleAfterSeatNumbers?: number[];
  showSeatNumbers?: boolean;
  rowCurveDeg?: number;
  rowCurveDegs?: number[];
  rowRotationDeg?: number;
  seatSpacingPct?: number;
  rowGapPct?: number;
  showRowLabels?: boolean;
  /** Row indices whose left-side row label is hidden on the canvas. */
  hiddenRowLabelIndices?: number[];
  /** Locks seat spacing in custom shapes so adding seats does not shift existing ones. */
  customShapeSeatPitchPx?: number;
  /** Horizontal seat alignment inside each row (drag-seats mode defaults to right). */
  seatAlign?: 'left' | 'center' | 'right';
  /**
   * Per-row extra gap (metres) inserted *before* row `i` — i.e. between row
   * `i-1` and row `i`. Added on top of the block's uniform `rowGapM`; index 0
   * is ignored. Rows `i..` shift away from the VIEW POINT by this amount.
   */
  rowGapExtraM?: number[];
  /**
   * Per-seat-pair extra gap (metres) inserted *after* one seat in one row,
   * keyed `"<rowIndex>:<seatIndex>"`. Added on top of the uniform `seatGapM`;
   * seats after that pair shift along the row.
   */
  seatGapExtraM?: Record<string, number>;
  /**
   * Seats pushed outside the block outline by the custom gaps above. Derived —
   * recomputed on every spacing bake; they reappear when the gaps shrink again.
   */
  spacingHiddenSeatIds?: string[];
}

export interface CustomShapeSeatPosition {
  xPct: number;
  yPct: number;
  /** Per-seat chair rotation (deg) after a row curve is applied. */
  rotationDeg?: number;
}

/** One locked seating zone drawn inside a custom piece. */
export interface CustomShapeSeatBlock {
  id: string;
  code: string;
  /** Zone boundary in element-local % (0–100 of element box). */
  boundaryPoints: ElementPosition[];
  physicalLengthM: number;
  physicalWidthM: number;
  chairLengthM: number;
  chairWidthM: number;
  rows: number;
  seatsPerRow: number;
  rowLabelStyle?: SeatLabelStyle;
  seatLayout?: SeatLayoutSpec;
  seatPositionOverrides?: Record<string, CustomShapeSeatPosition>;
  /** Row paths in canvas % — seats are placed along each line. */
  rowLines?: ElementPosition[][];
}

/**
 * Row / column / seat totals kept on the geometry shell so hover badges and
 * counts work before a block's seating config is fetched.
 */
export interface BlockSeatingSummary {
  rows: number;
  columns: number;
  totalSeats: number;
}

/** Default real-world dimensions (metres) for custom blocks and chairs. */
export const DEFAULT_BLOCK_LENGTH_M = 10;
export const DEFAULT_BLOCK_WIDTH_M = 8;
export const DEFAULT_CHAIR_LENGTH_M = 0.5;
export const DEFAULT_CHAIR_WIDTH_M = 0.45;
/** Default gap between seat centres (0.2 ft). */
export const DEFAULT_SEAT_GAP_FT = 0.2;
export const FT_TO_METRES = 0.3048;
/** Rounded so inputs show clean values (raw 0.2×0.3048 = 0.06096…). */
export const DEFAULT_SEAT_GAP_M = Math.round(DEFAULT_SEAT_GAP_FT * FT_TO_METRES * 1000) / 1000;

export type DiningTableShape = 'round' | 'rectangular';

/** Booking / access type for an individual dining table. */
export type DiningTableAccessCategory = 'private' | 'public' | 'shared' | 'vip';

/** A dining table placed inside a custom-shape block. */
export interface DiningTableSpec {
  id: string;
  label: string;
  /** Position within block bounds (% of element box). */
  xPct: number;
  yPct: number;
  shape: DiningTableShape;
  seats: number;
  /** Table diameter (round) or width (rectangular) in metres. */
  widthM: number;
  /** Table depth in metres (rectangular only). */
  depthM?: number;
  /** Rotation in degrees — chairs face toward the viewpoint by default. */
  rotationDeg?: number;
  /** Private, public, shared, or VIP access for this table. */
  accessCategory?: DiningTableAccessCategory;
  /** Merged table group id — tables sharing this were combined visually. */
  mergeGroupId?: string;
  /** Original table specs restored when splitting a merged table. */
  mergeRestore?: DiningTableSpec[];
  /**
   * Rectangular edge indices (0=top,1=right,2=bottom,3=left) with chairs removed
   * because this side touches another merged table, or had no dots in a reference image.
   */
  suppressedChairEdges?: number[];
  /**
   * Exact chair counts per edge from reference dots [top, right, bottom, left].
   * When set, chairs are placed only on sides with counts > 0 (one-side pattern).
   */
  seatsByEdge?: [number, number, number, number];
}

export const DEFAULT_TABLE_WIDTH_M = 1.2;
export const DEFAULT_TABLE_DEPTH_M = 0.8;
export const DEFAULT_TABLE_SEATS = 6;
export const DEFAULT_TABLE_GAP_M = 0.6;
export const DEFAULT_DINING_STAGE_WIDTH_M = 4;
export const DEFAULT_DINING_STAGE_DEPTH_M = 1.2;
export const DEFAULT_DINING_FOOD_PREPARE_WIDTH_M = 2;
export const DEFAULT_DINING_FOOD_PREPARE_DEPTH_M = 2;
export const DEFAULT_DINING_EXIT_WIDTH_M = 1.5;
export const DEFAULT_DINING_EXIT_DEPTH_M = 0.5;
export const DEFAULT_DINING_ENTRANCE_WIDTH_M = DEFAULT_DINING_EXIT_WIDTH_M;
export const DEFAULT_DINING_ENTRANCE_DEPTH_M = DEFAULT_DINING_EXIT_DEPTH_M;
export const DEFAULT_DINING_SHARED_ACCESS_WIDTH_M = DEFAULT_DINING_EXIT_WIDTH_M;
export const DEFAULT_DINING_SHARED_ACCESS_DEPTH_M = DEFAULT_DINING_EXIT_DEPTH_M;
export const MIN_DINING_ACCESS_WIDTH_M = 0.2;
/** Subtle default opacity for a dining-block background reference image. */
export const DEFAULT_DINING_BACKGROUND_OPACITY = 0.38;
/** Minimum gap between a table (incl. chairs) and stage / food prep / access points / service route. */
export const DINING_FEATURE_TABLE_CLEARANCE_M = 0.1;

/** Reference floor plan stored on a dining block (image-upload layouts). */
export interface DiningLayoutReferenceImage {
  dataUrl: string;
  name?: string;
  /** Ink bounding box as % of the full image — aligns overlay with detected positions. */
  contentBounds?: {
    minXPct: number;
    minYPct: number;
    maxXPct: number;
    maxYPct: number;
  };
  imageWidth?: number;
  imageHeight?: number;
  /**
   * Manual crop/adjust: multiplier on cover-fit (1 = fill the block).
   * When set, the editor uses this transform instead of contentBounds.
   */
  scale?: number;
  /** Image centre as % of the block box (50 = centred). */
  offsetXPct?: number;
  offsetYPct?: number;
  rotationDeg?: number;
  /** Last explicit Fit / Fill action. */
  fitMode?: 'cover' | 'contain';
  /**
   * Signature of `customPoints` when this background was last applied.
   * Used to warn if the block polygon later changes.
   */
  clipSignature?: string;
  /** 0–1. Defaults to DEFAULT_DINING_BACKGROUND_OPACITY. */
  opacity?: number;
  /** When false the background is hidden but kept on the element. */
  visible?: boolean;
}

/** Stage placed along a chosen block side inside a dining block. */
export interface DiningStageSpec {
  /** Logical side id — which block edge the stage sits on. */
  sideEdgeId?: number;
  /** Width along the front edge in metres. */
  widthM: number;
  /** Depth into the room in metres. */
  depthM: number;
  /** Centre within block bounds (% of element box). */
  xPct: number;
  yPct: number;
  /** Shift along the front edge from centre, in metres. */
  offsetAlongEdgeM?: number;
  /** Centre distance from the front edge inward, in metres. */
  insetFromEdgeM?: number;
  /**
   * Free rotation in degrees (0 = along +X). When omitted, rotation matches the
   * chosen wall edge. Set when the user rotates the stage away from the wall.
   */
  rotationDeg?: number;
  label?: string;
  alignment?: 'edge' | 'center' | 'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br';
}

/** Food preparation area placed along a chosen block side. */
export interface DiningFoodPrepareSpec {
  sideEdgeId?: number;
  widthM: number;
  depthM: number;
  xPct: number;
  yPct: number;
  offsetAlongEdgeM?: number;
  insetFromEdgeM?: number;
  /** Free rotation in degrees; omitted means match the chosen wall edge. */
  rotationDeg?: number;
  label?: string;
  alignment?: 'edge' | 'center' | 'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br';
}

/** Access-point role. Extra kinds (e.g. emergency-exit) can be added later. */
export type DiningAccessPointKind = 'entrance' | 'exit' | 'emergency-exit' | 'shared';

/** Whether entrance and exit are two openings or one shared opening. */
export type DiningAccessMode = 'separate' | 'shared';

/**
 * Entrance, exit, or future emergency exit along a block side.
 * Optional `id` / `kind` keep older persisted `diningExit` rows loadable.
 */
export interface DiningAccessPointSpec {
  id?: string;
  kind?: DiningAccessPointKind;
  sideEdgeId?: number;
  widthM: number;
  depthM: number;
  xPct: number;
  yPct: number;
  offsetAlongEdgeM?: number;
  insetFromEdgeM?: number;
  label?: string;
  alignment?: 'edge' | 'center' | 'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br';
}

/** @deprecated Prefer DiningAccessPointSpec — kept so existing layouts and callers still type-check. */
export type DiningExitSpec = DiningAccessPointSpec;
export type ParkingVehicleType = 'car' | 'bus' | 'wheelchair' | 'ev' | 'bike';

/** A single Enter or Exit marker snapped to one parking-outline edge. */
export interface ParkingAccessPointSpec {
  id: string;
  kind: 'enter' | 'exit';
  /** Logical side id — matches buildBlockMeasureEdges id for the outline edge it's snapped to. */
  sideEdgeId: number;
  /** Shift along that edge from its midpoint, in metres. */
  offsetAlongEdgeM: number;
  label?: string;
}

/**
 * One placed parking slot. `lengthM`/`widthM` are a snapshot of the vehicle type's
 * default size at placement time, so editing the global defaults later never silently
 * resizes slots that are already on the canvas.
 */
export interface ParkingSlotSpec {
  id: string;
  /** Groups slots generated from one drawn path together, for delete-by-lane. */
  laneId: string;
  /** Human-readable bookable slot code, unique within the parking area — "A1", "A2", … "B1" per lane. */
  label?: string;
  vehicleType: ParkingVehicleType;
  /** Centre, element-local % (same space as customPoints). */
  xPct: number;
  yPct: number;
  /** Local rotation in degrees — same convention as a seat's rotationDeg. */
  rotationDeg: number;
  lengthM: number;
  widthM: number;
  /**
   * Optional custom shape: polygon vertices in slot-local % of the lengthM×widthM box
   * (x along the depth axis, y across; 0–100, centre at 50/50). Absent = plain rectangle.
   */
  shapePoints?: ElementPosition[];
  /**
   * Printed code glyph height from the plan (metres via parking scale). When set, the
   * canvas label renders at this size so it matches the uploaded image naming.
   */
  labelHeightM?: number;
}

/** A driving route drawn inside a parking area (Enter → Exit), rendered as a yellow arrowed path. */
export interface ParkingRouteSpec {
  id: string;
  /** Route vertices in element-local % (same space as customPoints) — order is the driving direction. */
  points: ElementPosition[];
  label?: string;
}

/** A service / staff route drawn inside a dining block. */
export interface DiningServiceRouteSpec {
  id: string;
  label: string;
  /** Route vertices in element % coordinates. */
  points: ElementPosition[];
  widthM?: number;
}

export const DEFAULT_SERVICE_ROUTE_WIDTH_M = 1.2;

/** One labelled side of a General Admission block (logicalId matches buildBlockMeasureEdges id). */
export interface GaConfiguredSide {
  logicalId: number;
  label: string;
  /** Physical length of this side in metres, entered by the user. */
  lengthM?: number;
}

export type ShapeId =
  | 'oval'
  | 'circle'
  | 'rectangle'
  | 'square'
  | 'triangle'
  | 'hexagon'
  | 'octagon'
  | 'd-end'
  | 'custom';

export type ElementKind =
  | 'centerpiece'
  | 'layer-ring'
  | 'layer-rect'
  | 'block-grid'
  | 'seat-section'
  | 'aisle'
  | 'label';

interface ElementBase {
  id: string;
  type: ElementKind;
  name: string;
  position: ElementPosition;
  size: ElementSize;
  rotation: number;
  style: ElementStyle;
  /** When false, element is hidden on canvas (default: visible). */
  visible?: boolean;
  /** When true, element cannot be moved or edited on canvas (default: unlocked). */
  locked?: boolean;
}

/**
 * Center Piece — a labeled shape (oval, rectangle, hexagon, …). Custom pieces are
 * the same element with `shape: 'custom'` and a traced outline. Stage/Exit/etc.
 * presets are also centerpieces, distinguished only by their style + label.
 */
export interface CenterpieceElement extends ElementBase {
  type: 'centerpiece';
  shape: ShapeId;
  label: string;
  curveDeg: number;
  polygonSides?: number;
  /** Outline points in element-local space (0–100 of the element box). */
  customPoints?: ElementPosition[];
  /** Real-world block dimensions in metres (depth × width). */
  physicalLengthM?: number;
  physicalWidthM?: number;
  /** Default chair footprint in metres (depth × width). */
  chairLengthM?: number;
  chairWidthM?: number;
  /** Gap between seat centres along a row (metres). */
  seatGapM?: number;
  /** Gap between rows (metres); defaults to seat gap when unset. */
  rowGapM?: number;
  /** Aisle rules last edited / applied during Auto Fill create seats. */
  autoFillAisles?: Array<{
    id?: string;
    type: 'none' | 'row' | 'column' | 'center' | 'draw';
    rows?: string;
    columns?: string;
    widthM?: number;
    centerAxis?: 'row' | 'column';
    drawStart?: { xPct: number; yPct: number };
    drawEnd?: { xPct: number; yPct: number };
  }>;
  /** Seat block code when custom-polygon seating is enabled. */
  code?: string;
  rows?: number;
  seatsPerRow?: number;
  rowLabelStyle?: SeatLabelStyle;
  seatLayout?: SeatLayoutSpec;
  /** Per-seat position overrides (% of element bounds). */
  seatPositionOverrides?: Record<string, CustomShapeSeatPosition>;
  /** Straight Auto Fill seats before the shared Curve value is applied. */
  autoFillStraightSeatPositions?: Record<string, CustomShapeSeatPosition>;
  /**
   * Which end of each row holds seat 1, as seen by a spectator sitting in the
   * block and facing the VIEW POINT. Unset → legacy edge order.
   */
  seatStartSide?: 'left' | 'right';
  /** Locked seating zones drawn inside the custom outline. */
  customSeatBlocks?: CustomShapeSeatBlock[];
  /** Metre length of each polygon edge (same order as customPoints vertices). */
  customSideLengthsM?: number[];
  /** Optional display names for each polygon edge (same order as customPoints). */
  customSideNames?: string[];
  /** Element-level seating expanded by dragging seats downward on the canvas. */
  dragSeatsMode?: boolean;
  /** Polygon edge index (0-based) for the stadium-view side — first row runs along this edge. */
  dragSeatsStadiumSideIndex?: number;
  /** When two sides face the VIEW POINT (corner or dual ground-facing fronts), both raw edge indices. */
  dragSeatsStadiumSideIndices?: number[];
  /** User-chosen seat count for row A in drag-seats mode. */
  dragSeatsFirstRowSeatCount?: number;
  /** Canvas-% paths for rows placed with the custom line seat tool (one path per row). */
  customLineSeatRows?: ElementPosition[][];
  /** Parking area: per-edge bow-curve ratio (index i = edge from customPoints[i] to the next point). */
  edgeBowAmounts?: number[];
  /** Parking area: the one user-drawn reference divider line, element-local %. */
  parkingReferenceLine?: ElementPosition[];
  /** Parking area: generated parallel divider lines, element-local %, clipped to the outline. */
  parkingDividerLines?: ElementPosition[][];
  /** Parking area: last-used bay width (metres), for re-editing. */
  parkingBayWidthM?: number;
  /** Parking area: Enter/Exit markers placed on the outline boundary. */
  parkingAccessPoints?: ParkingAccessPointSpec[];
  /** Parking area: placed vehicle parking slots. */
  parkingSlots?: ParkingSlotSpec[];
  /** Parking area: drawn driving routes (Enter → Exit). */
  parkingRoutes?: ParkingRouteSpec[];
  /** Seats placed individually by clicking on the canvas. */
  perSeatPlacementMode?: boolean;
  /** Rows built by anchoring one seat then dragging to extend seat columns. */
  arrangeByRowMode?: boolean;
  /** Drag seats / arrange-by-row placement is locked after leaving block workspace with seats. */
  interactiveSeatingLocked?: boolean;
  /** Drag-and-fill: double-click seed seat, drag to fill row then rows inward. */
  dragFillSeatsMode?: boolean;
  /** Committed anchor/end paths per row (canvas %). */
  arrangeByRowRows?: ArrangeByRowPath[];
  /** Grid fill using user-defined rows × columns across the custom shape. */
  defineByRowColumnMode?: boolean;
  defineByRowColumnRows?: number;
  defineByRowColumnColumns?: number;
  /** When true, corner vertex handles are shown on the canvas for reshaping. */
  adjustEdges?: boolean;
  /** CV-detected seating ring (0 = innermost). Used for tier-scoped bulk apply. */
  ringIndex?: number;
  /** Display name for the seating tier (e.g. Inner Tier). */
  tierLabel?: string;
  /** Venue usage type — seating, GA, suite, etc. */
  blockType?: BlockTypeId;
  /** GA: labelled sides (green = confirmed). Stored on the element; drive ticket capacity. */
  gaConfiguredSides?: GaConfiguredSide[];
  /** GA: maximum number of participants — used as ticket sale capacity. */
  gaMaxParticipants?: number;
  /** Saved configuration template applied to this block (if any). */
  appliedConfigId?: string;
  appliedConfigName?: string;
  /** Stable uuid for venue_block_configurations.block_id (shell identity). */
  venueBlockId?: string;
  /**
   * Seat totals stamped onto the shell when seating is split out. Read whenever
   * `seatLayout` is absent because the block's config has not been fetched yet.
   */
  seatingSummary?: BlockSeatingSummary;
  /** Viewpoint angle (deg) around this block — 0 = above, like a stage label. */
  blockViewpointAngleDeg?: number;
  /** When true, viewpoint was confirmed manually in block workspace (not auto toward ground). */
  blockViewpointManuallySet?: boolean;
  /** Label position offset from block centre (% of element box). */
  labelOffsetXPct?: number;
  labelOffsetYPct?: number;
  /** Rotation (deg) for chair icons — seats face this direction toward the viewpoint. */
  seatFacingDeg?: number;
  /** Usable area inset/margin from block boundary in meters. */
  borderGapM?: number;
  /** Dining tables placed inside this custom-shape block. */
  diningTables?: DiningTableSpec[];
  /** Click-to-place tables one at a time on the canvas. */
  tablePlacementMode?: boolean;
  /** Tables arranged in a rows × columns grid. */
  tableGridMode?: boolean;
  tableGridRows?: number;
  tableGridColumns?: number;
  defaultDiningTableShape?: DiningTableShape;
  defaultTableSeats?: number;
  defaultTableWidthM?: number;
  defaultTableDepthM?: number;
  defaultTableGapM?: number;
  /** Auto-arranged dining layout pattern committed via Fix Layout. */
  appliedDiningLayoutTemplateId?: string;
  /** Metadata from the constraint generator (not used to recreate geometry). */
  diningLayoutGeneration?: {
    family: string;
    score: number;
    seed: number;
    fingerprint: string;
  };
  /** Per-block background image, clipped to this block's polygon when rendered. */
  diningLayoutReferenceImage?: DiningLayoutReferenceImage;
  /** Performance stage along the VIEW POINT edge. */
  diningStage?: DiningStageSpec;
  /** Food preparation area. */
  diningFoodPrepare?: DiningFoodPrepareSpec;
  /** Primary entrance along a chosen edge. */
  diningEntrance?: DiningAccessPointSpec;
  /** Primary exit / doorway section along a chosen edge. */
  diningExit?: DiningExitSpec;
  /**
   * One physical opening used as both entrance and exit.
   * Used when `diningAccessMode === 'shared'`.
   */
  diningSharedAccessPoint?: DiningAccessPointSpec;
  /** `separate` (default / legacy) or `shared`. */
  diningAccessMode?: DiningAccessMode;
  /** Width used when placing a new entrance. */
  defaultDiningEntranceWidthM?: number;
  /** Width used when placing a new exit. */
  defaultDiningExitWidthM?: number;
  /** Width used when placing a new shared access point. */
  defaultDiningSharedAccessWidthM?: number;
  /**
   * Extra access points beyond the primary entrance/exit (emergency exits, additional doors).
   * Reserved for future multi-door layouts — the editor currently writes only the two primary fields.
   */
  diningAccessPoints?: DiningAccessPointSpec[];
  /** Staff / service paths drawn inside the block. */
  diningServiceRoutes?: DiningServiceRouteSpec[];
  defaultServiceRouteWidthM?: number;
  diningServiceRouteClearanceM?: number;
  /** Keep-out distance from Stage to tables (m). */
  diningStageClearanceM?: number;
  /** Keep-out distance from Food Prep to tables (m). */
  diningFoodPrepClearanceM?: number;
  /** Keep-out distance from Entry/Exit to tables (m). */
  diningAccessClearanceM?: number;
}

export interface ArrangeByRowPath {
  anchor: ElementPosition;
  end: ElementPosition;
}

export interface SectorBlock {
  id: string;
  code: string;
  /** Optional display label on canvas; falls back to code. */
  label?: string;
  /** Per-sector fill — overrides the ring default when set. */
  fillColor?: string;
  rowLabelStyle?: SeatLabelStyle;
  seatLayout?: SeatLayoutSpec;
  startAngleDeg: number;
  endAngleDeg: number;
  rows: number;
  seatsPerRow: number;
}

export interface SelectedRingBlock {
  elementId: string;
  blockId: string;
}

/** Layer Ring — annular band of sector blocks around an oval ground. */
export interface LayerRingElement extends ElementBase {
  type: 'layer-ring';
  label: string;
  thicknessPct: number;
  /** Space between inner ring edge and anchored centerpiece (visual tuning). */
  gapPct?: number;
  /** Optional centerpiece this ring is drawn around. */
  centerpieceId?: string;
  rowLabelStyle: SeatLabelStyle;
  blocks: SectorBlock[];
}

export type RectSide = 'top' | 'bottom' | 'left' | 'right';

export interface RectBlock {
  id: string;
  code: string;
  side: RectSide;
  rows: number;
  seatsPerRow: number;
}

/** Layer Rect — frame of blocks wrapped around a rectangular ground. */
export interface LayerRectElement extends ElementBase {
  type: 'layer-rect';
  label: string;
  rowLabelStyle: SeatLabelStyle;
  blocks: RectBlock[];
}

/** Block Grid — a single rectangular block of rows × seats. */
export interface BlockGridElement extends ElementBase {
  type: 'block-grid';
  code: string;
  label: string;
  rows: number;
  seatsPerRow: number;
  rowLabelStyle: SeatLabelStyle;
}

export interface SeatSectionRow {
  id: string;
  seatCount: number;
  rotationDeg: number;
  curveDeg: number;
  seatSpacingPct: number;
  offsetXPct: number;
  offsetYPct: number;
}

/** Seat Section — a hall section where each row is configured independently. */
export interface SeatSectionElement extends ElementBase {
  type: 'seat-section';
  label: string;
  rowGapPct: number;
  rowLabelStyle: SeatLabelStyle;
  showRowLabels: boolean;
  rows: SeatSectionRow[];
}

/** Aisle — a non-seat walkway/gap. */
export interface AisleElement extends ElementBase {
  type: 'aisle';
  orientation: 'horizontal' | 'vertical';
}

/** Label — free text annotation. */
export interface LabelElement extends ElementBase {
  type: 'label';
  text: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  textAlign: 'left' | 'center' | 'right';
}

export type LayoutElement =
  | CenterpieceElement
  | LayerRingElement
  | LayerRectElement
  | BlockGridElement
  | SeatSectionElement
  | AisleElement
  | LabelElement;

export const DEFAULT_CANVAS: CanvasConfig = { width: 1000, height: 700 };

export function isCenterpiece(el: LayoutElement): el is CenterpieceElement {
  return el.type === 'centerpiece';
}
export function isLayerRing(el: LayoutElement): el is LayerRingElement {
  return el.type === 'layer-ring';
}
export function isLayerRect(el: LayoutElement): el is LayerRectElement {
  return el.type === 'layer-rect';
}
export function isBlockGrid(el: LayoutElement): el is BlockGridElement {
  return el.type === 'block-grid';
}
export function isSeatSection(el: LayoutElement): el is SeatSectionElement {
  return el.type === 'seat-section';
}
export function isAisle(el: LayoutElement): el is AisleElement {
  return el.type === 'aisle';
}
export function isLabel(el: LayoutElement): el is LabelElement {
  return el.type === 'label';
}

/** True when a centerpiece has a traced polygon outline (any named shape). */
export function hasTracedBlockOutline(el: CenterpieceElement): boolean {
  return (el.customPoints?.length ?? 0) >= 3;
}

/** Traced or drawn custom blocks that can open the block customization workspace. */
export function isCustomizableBlock(el: LayoutElement): el is CenterpieceElement {
  return (
    el.type === 'centerpiece' &&
    el.blockType !== 'parking' &&
    hasTracedBlockOutline(el)
  );
}

/** Traced or drawn parking areas — open the Parking Workspace instead of the block workspace. */
export function isParkingArea(el: LayoutElement): el is CenterpieceElement {
  return (
    el.type === 'centerpiece' &&
    el.blockType === 'parking' &&
    hasTracedBlockOutline(el)
  );
}

/** True when this block has dining tables or active table-editing tools. */
export function hasDiningTables(el: CenterpieceElement): boolean {
  return (
    (el.diningTables?.length ?? 0) > 0 ||
    el.tablePlacementMode === true ||
    el.tableGridMode === true
  );
}

export function getDiningTableCount(el: CenterpieceElement): number {
  return el.diningTables?.length ?? 0;
}

/** Chairs placed on dining tables (configured seats, or per-edge counts when set). */
export function getDiningChairCount(el: CenterpieceElement): number {
  return (el.diningTables ?? []).reduce((sum, table) => {
    if (table.seatsByEdge) {
      return sum + table.seatsByEdge.reduce((edgeSum, count) => edgeSum + Math.max(0, count), 0);
    }
    return sum + Math.max(0, table.seats ?? 0);
  }, 0);
}

export function hasDiningStage(el: CenterpieceElement): boolean {
  return el.diningStage != null;
}

export function hasDiningFoodPrepare(el: CenterpieceElement): boolean {
  return el.diningFoodPrepare != null;
}

export function hasDiningExit(el: CenterpieceElement): boolean {
  return el.diningExit != null;
}

export function hasDiningEntrance(el: CenterpieceElement): boolean {
  return el.diningEntrance != null;
}

export function hasDiningSharedAccess(el: CenterpieceElement): boolean {
  return el.diningSharedAccessPoint != null;
}

export function resolveDiningAccessMode(el: CenterpieceElement): DiningAccessMode {
  if (el.diningAccessMode === 'shared' || el.diningAccessMode === 'separate') {
    return el.diningAccessMode;
  }
  if (el.diningSharedAccessPoint) {
    return 'shared';
  }
  return 'separate';
}

export function resolveDiningAccessWidthM(
  spec: { widthM?: number } | null | undefined,
  fallback = DEFAULT_DINING_ENTRANCE_WIDTH_M,
): number {
  const value = spec?.widthM;
  return value != null && value > 0 ? value : fallback;
}

/** True when block/chair dimensions are saved and seat tools are active (seats may still be empty). */
export function isCustomShapeSeatingEnabled(el: CenterpieceElement): boolean {
  if (!hasTracedBlockOutline(el)) {
    return false;
  }
  return el.seatLayout != null || (el.customSeatBlocks?.length ?? 0) > 0;
}

/** Elements that carry seats — used for seat counts and pricing. */
export function hasSeats(
  el: LayoutElement,
): el is
  | LayerRingElement
  | LayerRectElement
  | BlockGridElement
  | SeatSectionElement
  | CenterpieceElement {
  return (
    el.type === 'layer-ring' ||
    el.type === 'layer-rect' ||
    el.type === 'block-grid' ||
    el.type === 'seat-section' ||
    (el.type === 'centerpiece' && isCustomShapeSeatingEnabled(el))
  );
}