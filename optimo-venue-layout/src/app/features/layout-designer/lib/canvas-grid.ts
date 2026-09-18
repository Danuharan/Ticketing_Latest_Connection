import { CanvasConfig } from '../models/layout-element.model';

export interface InfiniteGridBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Dot-grid coverage around the current camera view (infinite pan workspace). */
export function getVisibleGridBounds(
  viewBox: InfiniteGridBounds,
  canvas: CanvasConfig,
  marginRatio = 0.75,
): InfiniteGridBounds {
  const marginX = Math.max(canvas.width * marginRatio, 120);
  const marginY = Math.max(canvas.height * marginRatio, 120);
  return {
    x: viewBox.x - marginX,
    y: viewBox.y - marginY,
    width: viewBox.width + marginX * 2,
    height: viewBox.height + marginY * 2,
  };
}
