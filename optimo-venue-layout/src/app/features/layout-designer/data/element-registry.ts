import { ElementDefinition } from '../models/element-definition.model';
import { ElementCategory } from '../models/element-type.model';

/** Sidebar tool catalogue. Definitions live in code; placed instances (built by
 *  the element factory) are what gets saved to the layout JSON. */
export const ELEMENT_REGISTRY: readonly ElementDefinition[] = [
  {
    id: 'custom-piece',
    category: 'focus',
    title: 'Custom Piece',
    description:
      'Draw any freeform outline on the canvas point-by-point. Use for irregular halls, VIP zones, or unique seating areas.',
    icon: '👑',
  },
  {
    id: 'center-piece',
    category: 'focus',
    title: 'Center Piece',
    description:
      'Standard labeled shapes — oval, rectangle, circle, hexagon, and more. Best for ground, stage, screen, or pitch.',
    icon: '⬭',
  },
  {
    id: 'layer-ring',
    category: 'focus',
    title: 'Layer Ring',
    description: 'Oval/Circle ground — sectors in a ring (like cricket oval).',
    icon: '◎',
  },
  {
    id: 'layer-rect',
    category: 'focus',
    title: 'Layer Rect',
    description: 'Rectangle/Square ground — trapezoid sections around it.',
    icon: '▣',
  },
  {
    id: 'block-grid',
    category: 'focus',
    title: 'Block Grid',
    description: 'Seat block — Square, Oval, Circle, or Curved + Line outline.',
    icon: '▦',
  },
  {
    id: 'seat-section',
    category: 'focus',
    title: 'Seat Section',
    description: 'Custom hall section with row-by-row seats.',
    icon: '⋮⋮',
  },
  {
    id: 'aisle',
    category: 'annotation',
    title: 'Aisle',
    description: 'Walkway or empty gap between blocks.',
    icon: '║',
  },
  {
    id: 'label',
    category: 'annotation',
    title: 'Label',
    description: 'Free text annotation (Entrance, Exit, Bar...).',
    icon: 'T',
  },
  {
    id: 'stage',
    category: 'annotation',
    title: 'Stage',
    description: 'Top-center performance stage preset.',
    icon: '🎭',
  },
  {
    id: 'exit',
    category: 'annotation',
    title: 'Exit',
    description: 'Exit signage / zone preset.',
    icon: '➡',
  },
  {
    id: 'entrance',
    category: 'annotation',
    title: 'Entrance',
    description: 'Entrance signage / zone preset.',
    icon: '⬅',
  },
  {
    id: 'canteen',
    category: 'annotation',
    title: 'Canteen',
    description: 'Food counter / canteen area preset.',
    icon: '🍴',
  },
  {
    id: 'shop',
    category: 'annotation',
    title: 'Shop',
    description: 'Merchandise / shop area preset.',
    icon: '🛍',
  },
] as const;

export function getElementsByCategory(category: ElementCategory): ElementDefinition[] {
  return ELEMENT_REGISTRY.filter((item) => item.category === category);
}
