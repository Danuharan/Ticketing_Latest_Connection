import { DEFAULT_VIEWPOINT_ANGLE_DEG } from './block-viewpoint';

export interface LabelOffsetPct {
  labelOffsetXPct: number;
  labelOffsetYPct: number;
}

/** Canvas position for a block label using % offsets from block centre. */
export function centerpieceLabelCanvasPosition(
  rect: { cx: number; cy: number; width: number; height: number },
  offsetXPct: number,
  offsetYPct: number,
  fontSize: number,
): { x: number; y: number } {
  return {
    x: rect.cx + (offsetXPct / 100) * rect.width,
    y: rect.cy + (offsetYPct / 100) * rect.height + fontSize * 0.32,
  };
}

/** Block name just above the top border in block-workspace configure mode. */
export function workspaceBlockLabelCanvasPosition(
  rect: { cx: number; y: number },
  fontSize: number,
): { x: number; y: number } {
  const gapAboveBorder = Math.max(5, fontSize * 0.12);
  return {
    x: rect.cx,
    y: rect.y - gapAboveBorder,
  };
}

/** Place the label outside the block, toward the VIEW POINT direction. */
export function defaultLabelOffsetOutsideViewpoint(
  angleDeg: number = DEFAULT_VIEWPOINT_ANGLE_DEG,
  marginPct = 54,
): LabelOffsetPct {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    labelOffsetXPct: Math.sin(rad) * marginPct,
    labelOffsetYPct: -Math.cos(rad) * marginPct,
  };
}

export function hasCustomLabelOffset(el: {
  labelOffsetXPct?: number;
  labelOffsetYPct?: number;
}): boolean {
  return (el.labelOffsetXPct ?? 0) !== 0 || (el.labelOffsetYPct ?? 0) !== 0;
}

export function resolveLabelOffsetXPct(el: { labelOffsetXPct?: number }): number {
  return el.labelOffsetXPct ?? 0;
}

export function resolveLabelOffsetYPct(el: { labelOffsetYPct?: number }): number {
  return el.labelOffsetYPct ?? 0;
}

/**
 * Label position for canvas rendering.
 * Main layout: always centered inside the block.
 * Block workspace: floated above/outside so seating configuration stays clear.
 */
export function resolveCenterpieceDisplayLabelOffset(
  el: {
    blockViewpointAngleDeg?: number;
    labelOffsetXPct?: number;
    labelOffsetYPct?: number;
  },
  inBlockWorkspace: boolean,
  isCustomizable: boolean,
): LabelOffsetPct {
  if (inBlockWorkspace && isCustomizable) {
    const angle = el.blockViewpointAngleDeg ?? DEFAULT_VIEWPOINT_ANGLE_DEG;
    return defaultLabelOffsetOutsideViewpoint(angle);
  }

  return { labelOffsetXPct: 0, labelOffsetYPct: 0 };
}

/** Theme-aware label colour — workspace labels contrast with the canvas background. */
export function resolveCenterpieceBlockLabelColor(
  el: { style?: { labelColor?: string } },
  inBlockWorkspace: boolean,
  isCustomizable: boolean,
  isDark: boolean,
): string {
  if (inBlockWorkspace && isCustomizable) {
    return isDark ? '#f8fafc' : '#0f172a';
  }
  return el.style?.labelColor ?? '#0f172a';
}

const PRESET_VENUE_LABELS = new Set(['STAGE', 'EXIT', 'ENTRANCE', 'CANTEEN', 'SHOP']);

/** Fixed-label venue presets (Stage, Exit, Entrance, etc.) — label is not repositioned. */
export function isPresetVenueMarker(el: {
  type?: string;
  shape?: string;
  label?: string;
}): boolean {
  if (el.type !== 'centerpiece' || el.shape !== 'rectangle') {
    return false;
  }
  return PRESET_VENUE_LABELS.has((el.label ?? '').trim().toUpperCase());
}

export function isCenterpieceLabelDraggable(
  _el: { type?: string; shape?: string; label?: string },
  _selected: boolean,
  _blockViewpointMode: boolean,
): boolean {
  return false;
}

/** Chair icon rotation so seats face toward the pitch / VIEW POINT (0° = above block). */
export function seatFacingDegFromViewpoint(angleDeg: number): number {
  let deg = angleDeg;
  while (deg > 180) {
    deg -= 360;
  }
  while (deg <= -180) {
    deg += 360;
  }
  return deg;
}
