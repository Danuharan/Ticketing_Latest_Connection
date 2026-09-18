import {
  chairScaleFromSeatRadius,
  seatLabelMinScale,
} from './chair-seat-icon';
import { SeatNode } from './seat-layout';

export interface SeatChairViewModel {
  x: number;
  y: number;
  scale: number;
  labelText: string;
  showLabels: boolean;
  selected: boolean;
}

/** Map a layout seat node to upright squircle view properties (shared by all element types). */
export function seatNodeToChairView(
  seat: SeatNode,
  options: {
    showNumbers?: boolean;
    selected?: boolean;
  } = {},
): SeatChairViewModel {
  const showNumbers = options.showNumbers !== false && seat.showNumber !== false;
  const scale = chairScaleFromSeatRadius(seat.radius);

  return {
    x: seat.x,
    y: seat.y,
    scale,
    labelText: showNumbers ? seat.label : '',
    showLabels: showNumbers && scale >= seatLabelMinScale(),
    selected: options.selected ?? false,
  };
}
