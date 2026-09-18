import { PixelRect } from './geometry';
import {
  estimateGridDefaultsForCustomShape,
  placeDefineByRowColumnGridInShape,
} from './custom-shape-seats';
import { CenterpieceElement, hasTracedBlockOutline } from '../models/layout-element.model';

/** Fill the custom shape with a clean rows × columns grid (rows/columns only — no block/chair dims). */
export function createDefineByRowColumnSeating(
  element: CenterpieceElement,
  rect: PixelRect,
  rows: number,
  columns: number,
): Partial<CenterpieceElement> {
  const grid = placeDefineByRowColumnGridInShape(element, rect, rows, columns);
  const code = element.code?.trim() || element.name?.trim() || 'CUSTOM';

  return {
    code,
    rows: grid.rows,
    seatsPerRow: grid.seatsPerRow,
    rowLabelStyle: 'letter',
    seatLayout: grid.seatLayout,
    seatPositionOverrides: grid.overrides,
    defineByRowColumnMode: true,
    defineByRowColumnRows: grid.rows,
    defineByRowColumnColumns: grid.seatsPerRow,
    dragSeatsMode: undefined,
    dragSeatsStadiumSideIndex: undefined,
    dragSeatsFirstRowSeatCount: undefined,
    customSideLengthsM: undefined,
    perSeatPlacementMode: undefined,
    arrangeByRowMode: undefined,
    arrangeByRowRows: undefined,
    customLineSeatRows: undefined,
  };
}

export function estimateDefineByRowColumnDefaults(
  element: CenterpieceElement,
  rect: PixelRect,
): { rows: number; columns: number } {
  return estimateGridDefaultsForCustomShape(element, rect);
}

export function isDefineByRowColumnElement(el: CenterpieceElement): boolean {
  return hasTracedBlockOutline(el) && el.defineByRowColumnMode === true;
}
