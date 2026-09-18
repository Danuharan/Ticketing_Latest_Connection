import type { PixelRect } from './geometry';
import {
  buildViewpointSeatFrame,
  projectOnViewpointFrame,
} from './drag-seats';
import type { CenterpieceElement } from '../models/layout-element.model';

export interface SeatRevealPoint {
  x: number;
  y: number;
  /** Logical row index when known (fallback when no VIEW POINT frame). */
  rowIndex?: number;
}

export interface SeatRevealDelayOptions {
  /** Max stagger from first → last seat (ms). Default 1000. */
  maxStaggerMs?: number;
  /** Preferred delay step per seat before capping (ms). Default 4. */
  stepMs?: number;
}

/**
 * Compute fade-in delays so seats reveal from the VIEW POINT edge inward,
 * then along each row. Delays are monotonic (no modulo wrap).
 *
 * Returns one delay per input seat, in the same array order.
 */
export function computeViewpointRevealDelays(
  seats: SeatRevealPoint[],
  element: CenterpieceElement,
  rect: PixelRect,
  options: SeatRevealDelayOptions = {},
): number[] {
  const n = seats.length;
  if (n === 0) {
    return [];
  }

  const maxStaggerMs = Math.max(0, options.maxStaggerMs ?? 1000);
  const stepMs = Math.max(0, options.stepMs ?? 4);
  const vf = buildViewpointSeatFrame(element, rect);

  const ranked = seats.map((seat, index) => {
    if (vf) {
      const proj = projectOnViewpointFrame(vf.frame, { x: seat.x, y: seat.y });
      return { index, depth: proj.depth, along: proj.along };
    }
    return {
      index,
      depth: seat.rowIndex ?? index,
      along: index,
    };
  });

  ranked.sort((a, b) => {
    if (Math.abs(a.depth - b.depth) > 0.5) {
      return a.depth - b.depth;
    }
    if (Math.abs(a.along - b.along) > 0.5) {
      return a.along - b.along;
    }
    return a.index - b.index;
  });

  const delays = new Array<number>(n).fill(0);
  if (n === 1 || maxStaggerMs <= 0) {
    return delays;
  }

  const rawStep = Math.min(stepMs, maxStaggerMs / (n - 1));
  for (let revealIndex = 0; revealIndex < n; revealIndex += 1) {
    delays[ranked[revealIndex].index] = Math.round(revealIndex * rawStep);
  }
  return delays;
}
