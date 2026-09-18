import { PixelRect } from './geometry';

const DEG_TO_RAD = Math.PI / 180;

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type Corner = 'nw' | 'ne' | 'se' | 'sw';
type Edge = 'n' | 's' | 'e' | 'w';

const CORNER_OPPOSITE: Record<Corner, Corner> = {
  nw: 'se',
  se: 'nw',
  ne: 'sw',
  sw: 'ne',
};

function rotateVector(v: { x: number; y: number }, rotationDeg: number): { x: number; y: number } {
  const rad = rotationDeg * DEG_TO_RAD;
  return {
    x: v.x * Math.cos(rad) - v.y * Math.sin(rad),
    y: v.x * Math.sin(rad) + v.y * Math.cos(rad),
  };
}

function localCorner(corner: Corner, rect: PixelRect): { x: number; y: number } {
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  switch (corner) {
    case 'nw':
      return { x: -hw, y: -hh };
    case 'ne':
      return { x: hw, y: -hh };
    case 'se':
      return { x: hw, y: hh };
    default:
      return { x: -hw, y: hh };
  }
}

function localToWorld(
  local: { x: number; y: number },
  cx: number,
  cy: number,
  rotationDeg: number,
): { x: number; y: number } {
  const rotated = rotateVector(local, rotationDeg);
  return { x: cx + rotated.x, y: cy + rotated.y };
}

export function isCornerHandle(handle: ResizeHandle): handle is Corner {
  return handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw';
}

export function cornerWorld(
  corner: Corner,
  rect: PixelRect,
  rotationDeg: number,
): { x: number; y: number } {
  return localToWorld(localCorner(corner, rect), rect.cx, rect.cy, rotationDeg);
}

/** Opposite edge centre — stays fixed while the dragged edge moves. */
export function edgeAnchorWorld(
  handle: Edge,
  rect: PixelRect,
  rotationDeg: number,
): { x: number; y: number } {
  const opposite = oppositeEdge(handle);
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  const local =
    opposite === 'n'
      ? { x: 0, y: -hh }
      : opposite === 's'
        ? { x: 0, y: hh }
        : opposite === 'e'
          ? { x: hw, y: 0 }
          : { x: -hw, y: 0 };
  return localToWorld(local, rect.cx, rect.cy, rotationDeg);
}

/** Resize by dragging one corner; the opposite corner stays fixed in world space. */
export function resizeFromOppositeCorners(
  anchorWorld: { x: number; y: number },
  pointerWorld: { x: number; y: number },
  rotationDeg: number,
  minWidthPx: number,
  minHeightPx: number,
): PixelRect {
  const cx = (anchorWorld.x + pointerWorld.x) / 2;
  const cy = (anchorWorld.y + pointerWorld.y) / 2;
  const halfWx = (pointerWorld.x - anchorWorld.x) / 2;
  const halfHy = (pointerWorld.y - anchorWorld.y) / 2;
  const rad = -rotationDeg * DEG_TO_RAD;
  const localHalfW = halfWx * Math.cos(rad) - halfHy * Math.sin(rad);
  const localHalfH = halfWx * Math.sin(rad) + halfHy * Math.cos(rad);
  const width = Math.max(minWidthPx, Math.abs(localHalfW) * 2);
  const height = Math.max(minHeightPx, Math.abs(localHalfH) * 2);
  return { x: cx - width / 2, y: cy - height / 2, width, height, cx, cy };
}

/** Resize by dragging one edge; the opposite edge centre stays fixed in world space. */
export function resizeFromEdge(
  handle: Edge,
  anchorWorld: { x: number; y: number },
  pointerWorld: { x: number; y: number },
  rotationDeg: number,
  startWidth: number,
  startHeight: number,
  minWidthPx: number,
  minHeightPx: number,
): PixelRect {
  const rad = -rotationDeg * DEG_TO_RAD;
  const dx = pointerWorld.x - anchorWorld.x;
  const dy = pointerWorld.y - anchorWorld.y;
  const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
  const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

  let width = startWidth;
  let height = startHeight;
  let centerLocal = { x: 0, y: 0 };

  switch (handle) {
    case 'e':
      width = Math.max(minWidthPx, localX);
      centerLocal = { x: width / 2, y: 0 };
      break;
    case 'w':
      width = Math.max(minWidthPx, -localX);
      centerLocal = { x: -width / 2, y: 0 };
      break;
    case 's':
      height = Math.max(minHeightPx, localY);
      centerLocal = { x: 0, y: height / 2 };
      break;
    case 'n':
      height = Math.max(minHeightPx, -localY);
      centerLocal = { x: 0, y: -height / 2 };
      break;
  }

  const offset = rotateVector(centerLocal, rotationDeg);
  const cx = anchorWorld.x + offset.x;
  const cy = anchorWorld.y + offset.y;
  return { x: cx - width / 2, y: cy - height / 2, width, height, cx, cy };
}

export function oppositeCorner(handle: Corner): Corner {
  return CORNER_OPPOSITE[handle];
}

export function oppositeEdge(handle: Edge): Edge {
  switch (handle) {
    case 'n':
      return 's';
    case 's':
      return 'n';
    case 'e':
      return 'w';
    default:
      return 'e';
  }
}

export function pixelRectToGeometry(
  rect: PixelRect,
  canvasWidth: number,
  canvasHeight: number,
): { position: { xPct: number; yPct: number }; size: { wPct: number; hPct: number } } {
  return {
    position: {
      xPct: (rect.cx / canvasWidth) * 100,
      yPct: (rect.cy / canvasHeight) * 100,
    },
    size: {
      wPct: (rect.width / canvasWidth) * 100,
      hPct: (rect.height / canvasHeight) * 100,
    },
  };
}
