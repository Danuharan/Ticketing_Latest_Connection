/** Registry keys for canvas tools — definitions live in code, instances in layout JSON. */
export type ElementTypeId =
  | 'custom-piece'
  | 'center-piece'
  | 'layer-ring'
  | 'layer-rect'
  | 'block-grid'
  | 'seat-section'
  | 'aisle'
  | 'label'
  | 'stage'
  | 'exit'
  | 'entrance'
  | 'canteen'
  | 'shop';

export type ElementCategory = 'focus' | 'annotation';
