import { VenueLayoutConfig } from '../../../core/models/venue-layout-config.model';
import { rectFromPositionSize } from '../../layout-designer/lib/geometry';
import { getCustomShapeVisibleSeatCount } from '../../layout-designer/lib/custom-shape-seats';
import { visibleSeatCount } from '../../layout-designer/lib/sector-seat-layout';
import {
  hasSeats,
  isCustomShapeSeatingEnabled,
  LayoutElement,
} from '../../layout-designer/models/layout-element.model';

/** Block count for template cards (matches designer toolbar logic). */
export function countBlocksInLayout(
  elements: LayoutElement[],
  canvas: VenueLayoutConfig['canvas'],
): number {
  return elements.reduce((total, el) => {
    if (el.type === 'layer-ring' || el.type === 'layer-rect') {
      return total + el.blocks.length;
    }
    if (el.type === 'block-grid' || el.type === 'seat-section') {
      return total + 1;
    }
    if (el.type === 'centerpiece' && isCustomShapeSeatingEnabled(el)) {
      const rect = rectFromPositionSize(el.position, el.size, canvas);
      return total + (getCustomShapeVisibleSeatCount(el, rect) > 0 ? 1 : 0);
    }
    return total;
  }, 0);
}

/** Seat count for template cards (matches designer toolbar logic). */
export function countSeatsInLayout(
  elements: LayoutElement[],
  canvas: VenueLayoutConfig['canvas'],
): number {
  return elements.reduce((total, el) => total + countSeatsOnElement(el, canvas), 0);
}

export function countLayoutStats(config: VenueLayoutConfig): {
  element_count: number;
  block_count: number;
  seat_count: number;
} {
  return {
    element_count: config.elements.length,
    block_count: countBlocksInLayout(config.elements, config.canvas),
    seat_count: countSeatsInLayout(config.elements, config.canvas),
  };
}

function countSeatsOnElement(
  el: LayoutElement,
  _canvas: VenueLayoutConfig['canvas'],
): number {
  if (!hasSeats(el)) {
    return 0;
  }
  switch (el.type) {
    case 'block-grid': {
      if (el.seatPositionOverrides && Object.keys(el.seatPositionOverrides).length > 0) {
        return Object.keys(el.seatPositionOverrides).length;
      }
      const rows = el.rows ?? el.seatLayout?.rows ?? 0;
      const seatsPerRow = el.seatsPerRow ?? el.seatLayout?.seatsPerRow ?? 0;
      return Math.max(0, rows) * Math.max(0, seatsPerRow);
    }
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
