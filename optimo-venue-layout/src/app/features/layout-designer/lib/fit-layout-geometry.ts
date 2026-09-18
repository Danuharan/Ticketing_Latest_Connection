import type { ElementPosition, ElementSize, LayoutElement } from '../models/layout-element.model';

type Positioned = {
  position?: ElementPosition;
  size?: ElementSize;
};

/**
 * Scales element geometry about the canvas centre (50,50) so detected layouts fill
 * the artboard. Returns the scale factor for the reference image (`geometryScale`).
 */
export function fitLayoutGeometry(elements: LayoutElement[], marginPct = 6): number {
  let minX = 100;
  let minY = 100;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  for (const el of elements) {
    const { position, size } = el as Positioned;
    if (!position || !size) {
      continue;
    }
    found = true;
    minX = Math.min(minX, position.xPct - size.wPct / 2);
    maxX = Math.max(maxX, position.xPct + size.wPct / 2);
    minY = Math.min(minY, position.yPct - size.hPct / 2);
    maxY = Math.max(maxY, position.yPct + size.hPct / 2);
  }

  if (!found || maxX <= minX || maxY <= minY) {
    return 1;
  }

  const extentX = Math.max(50 - minX, maxX - 50);
  const extentY = Math.max(50 - minY, maxY - 50);
  if (extentX <= 0 || extentY <= 0) {
    return 1;
  }

  const limit = 50 - marginPct;
  const rawScale = Math.min(limit / extentX, limit / extentY);
  if (!Number.isFinite(rawScale) || rawScale <= 1.02) {
    return 1;
  }

  const scale = Math.min(rawScale, 2.4);

  for (const el of elements) {
    const positioned = el as Positioned;
    if (positioned.position) {
      positioned.position = {
        xPct: 50 + (positioned.position.xPct - 50) * scale,
        yPct: 50 + (positioned.position.yPct - 50) * scale,
      };
    }
    if (positioned.size) {
      positioned.size = {
        wPct: positioned.size.wPct * scale,
        hPct: positioned.size.hPct * scale,
      };
    }
  }

  return scale;
}
