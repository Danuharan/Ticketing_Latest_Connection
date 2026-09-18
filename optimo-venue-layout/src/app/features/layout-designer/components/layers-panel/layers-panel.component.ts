import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import {
  elementLayerTitle,
  elementSwatchColor,
  elementTypeLabel,
  isElementLocked,
  isElementVisible,
} from '../../lib/element-display';
import { LayoutElement } from '../../models/layout-element.model';
import { LayoutCanvasService } from '../../services/layout-canvas.service';

interface LayerRow {
  el: LayoutElement;
  zIndex: number;
  title: string;
  typeLabel: string;
  swatch: string;
  visible: boolean;
  locked: boolean;
  selected: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

@Component({
  selector: 'app-layers-panel',
  templateUrl: './layers-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayersPanelComponent {
  protected readonly canvas = inject(LayoutCanvasService);

  protected readonly rows = computed<LayerRow[]>(() => {
    const items = this.canvas.elements();
    const selectedIds = new Set(this.canvas.selectedIds());
    return items.map((el, index) => ({
      el,
      zIndex: index + 1,
      title: elementLayerTitle(el),
      typeLabel: elementTypeLabel(el),
      swatch: elementSwatchColor(el),
      visible: isElementVisible(el),
      locked: isElementLocked(el),
      selected: selectedIds.has(el.id),
      canMoveUp: index < items.length - 1,
      canMoveDown: index > 0,
    }));
  });

  protected trackRow = (_: number, row: LayerRow) => row.el.id;

  protected selectLayer(id: string): void {
    if (this.canvas.autoFillLayoutMode()) {
      const current = this.canvas.selectedIds();
      if (current.includes(id) && current.length > 1) {
        this.canvas.selectElements(
          current.filter((selectedId) => selectedId !== id),
          this.canvas.selectedId() === id ? null : this.canvas.selectedId(),
        );
        return;
      }
      if (!current.includes(id)) {
        this.canvas.selectElements([...current, id], id);
        return;
      }
    }
    this.canvas.selectElement(id);
  }

  protected moveUp(id: string): void {
    this.canvas.moveLayerUp(id);
  }

  protected moveDown(id: string): void {
    this.canvas.moveLayerDown(id);
  }

  protected toggleVisible(id: string, event: Event): void {
    event.stopPropagation();
    this.canvas.toggleLayerVisible(id);
  }

  protected toggleLocked(id: string, event: Event): void {
    event.stopPropagation();
    this.canvas.toggleLayerLocked(id);
  }

  protected removeLayer(id: string, event: Event): void {
    event.stopPropagation();
    this.canvas.remove(id);
  }
}
