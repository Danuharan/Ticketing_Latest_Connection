import { CenterpieceElement, LayoutElement, hasTracedBlockOutline } from '../models/layout-element.model';

/** Human-readable type shown in the layers list. */
export function elementTypeLabel(el: LayoutElement): string {
  switch (el.type) {
    case 'centerpiece':
      return hasTracedBlockOutline(el) ? 'Custom Piece' : 'Centerpiece';
    case 'layer-ring':
      return 'Layer Ring';
    case 'layer-rect':
      return 'Layer Rect';
    case 'block-grid':
      return 'Block Grid';
    case 'seat-section':
      return 'Seat Section';
    case 'aisle':
      return 'Aisle';
    case 'label':
      return 'Label';
  }
}

/** Primary title in the layers row (name, label, or code). */
export function elementLayerTitle(el: LayoutElement): string {
  if (el.name.trim()) {
    return el.name;
  }
  if (el.type === 'centerpiece' && el.label.trim()) {
    return el.label;
  }
  if (el.type === 'block-grid' && el.code.trim()) {
    return el.code;
  }
  if (el.type === 'label' && el.text.trim()) {
    return el.text;
  }
  return elementTypeLabel(el);
}

export function elementSwatchColor(el: LayoutElement): string {
  return el.style.fillColor ?? '#94a3b8';
}

export function isElementVisible(el: LayoutElement): boolean {
  return el.visible !== false;
}

export function isElementLocked(el: LayoutElement): boolean {
  return el.locked === true;
}

export function isCustomCenterpiece(el: LayoutElement): el is CenterpieceElement {
  return el.type === 'centerpiece' && hasTracedBlockOutline(el);
}
