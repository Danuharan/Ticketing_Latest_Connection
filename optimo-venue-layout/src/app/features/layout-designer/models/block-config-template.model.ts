import { BlockTypeId } from './block-type.model';
import {
  ArrangeByRowPath,
  CustomShapeSeatBlock,
  CustomShapeSeatPosition,
  DiningTableSpec,
  DiningTableShape,
  DiningStageSpec,
  DiningFoodPrepareSpec,
  DiningExitSpec,
  DiningAccessPointSpec,
  DiningAccessMode,
  DiningLayoutReferenceImage,
  DiningServiceRouteSpec,
  ElementPosition,
  GaConfiguredSide,
  SeatLabelStyle,
  SeatLayoutSpec,
} from './layout-element.model';
import type { AutoFillAisleSlot } from './auto-fill-seating.model';

/** Seating fields copied when saving or applying a reusable block configuration. */
export interface BlockSeatingConfigSnapshot {
  physicalLengthM?: number;
  physicalWidthM?: number;
  chairLengthM?: number;
  chairWidthM?: number;
  seatGapM?: number;
  rowGapM?: number;
  /** Aisle options on this block before Auto Fill (restored on Cancel). */
  autoFillAisles?: AutoFillAisleSlot[];
  code?: string;
  rows?: number;
  seatsPerRow?: number;
  rowLabelStyle?: SeatLabelStyle;
  seatLayout?: SeatLayoutSpec;
  seatPositionOverrides?: Record<string, CustomShapeSeatPosition>;
  autoFillStraightSeatPositions?: Record<string, CustomShapeSeatPosition>;
  customSeatBlocks?: CustomShapeSeatBlock[];
  customSideLengthsM?: number[];
  /** Per-edge side labels (layout shell strip — lives with seating config). */
  customSideNames?: string[];
  /** Per logical side real-world metres + labels (edit / measure source of truth). */
  gaConfiguredSides?: GaConfiguredSide[];
  /** Display name of the applied master config (restored on hydrate). */
  appliedConfigName?: string;
  dragSeatsMode?: boolean;
  dragSeatsStadiumSideIndex?: number;
  dragSeatsStadiumSideIndices?: number[];
  dragSeatsFirstRowSeatCount?: number;
  customLineSeatRows?: ElementPosition[][];
  perSeatPlacementMode?: boolean;
  arrangeByRowMode?: boolean;
  dragFillSeatsMode?: boolean;
  arrangeByRowRows?: ArrangeByRowPath[];
  defineByRowColumnMode?: boolean;
  defineByRowColumnRows?: number;
  defineByRowColumnColumns?: number;
  blockViewpointAngleDeg?: number;
  /** When true, viewpoint was confirmed manually (not auto toward ground). */
  blockViewpointManuallySet?: boolean;
  /** Which end of each row holds seat 1 (spectator facing VIEW POINT). */
  seatStartSide?: 'left' | 'right';
  labelOffsetXPct?: number;
  labelOffsetYPct?: number;
}

/** Dining table fields copied when saving or applying a reusable block configuration. */
export interface BlockDiningConfigSnapshot {
  customSideLengthsM?: number[];
  customSideNames?: string[];
  dragSeatsStadiumSideIndex?: number;
  blockViewpointAngleDeg?: number;
  labelOffsetXPct?: number;
  labelOffsetYPct?: number;
  diningTables?: DiningTableSpec[];
  tableGridMode?: boolean;
  tableGridRows?: number;
  tableGridColumns?: number;
  defaultDiningTableShape?: DiningTableShape;
  defaultTableSeats?: number;
  defaultTableWidthM?: number;
  defaultTableDepthM?: number;
  defaultTableGapM?: number;
  appliedDiningLayoutTemplateId?: string;
  diningLayoutGeneration?: {
    family: string;
    score: number;
    seed: number;
    fingerprint: string;
  };
  chairWidthM?: number;
  chairLengthM?: number;
  diningLayoutReferenceImage?: DiningLayoutReferenceImage;
  diningStage?: DiningStageSpec;
  diningFoodPrepare?: DiningFoodPrepareSpec;
  diningEntrance?: DiningAccessPointSpec;
  diningExit?: DiningExitSpec;
  diningSharedAccessPoint?: DiningAccessPointSpec;
  diningAccessMode?: DiningAccessMode;
  defaultDiningEntranceWidthM?: number;
  defaultDiningExitWidthM?: number;
  defaultDiningSharedAccessWidthM?: number;
  diningAccessPoints?: DiningAccessPointSpec[];
  diningServiceRoutes?: DiningServiceRouteSpec[];
  defaultServiceRouteWidthM?: number;
  diningServiceRouteClearanceM?: number;
}

/** General Admission fields saved when creating a reusable block configuration. */
export interface BlockGaConfigSnapshot {
  gaConfiguredSides?: GaConfiguredSide[];
  gaMaxParticipants?: number;
}

export interface BlockConfigTemplate {
  id: string;
  name: string;
  blockType: BlockTypeId;
  seating?: BlockSeatingConfigSnapshot;
  dining?: BlockDiningConfigSnapshot;
  ga?: BlockGaConfigSnapshot;
  createdAt: string;
  updatedAt: string;
}
