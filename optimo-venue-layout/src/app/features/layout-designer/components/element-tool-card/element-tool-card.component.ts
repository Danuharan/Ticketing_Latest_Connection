import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { ToolIconComponent } from '../tool-icon/tool-icon.component';
import { ElementDefinition } from '../../models/element-definition.model';

@Component({
  selector: 'app-element-tool-card',
  imports: [ToolIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="element-tool-card"
      [class.element-tool-card--active]="active()"
      (click)="select.emit(definition())"
    >
      <app-tool-icon [kind]="definition().id" />
      <span class="element-tool-card__body">
        <span class="element-tool-card__title">+ {{ definition().title }}</span>
        <span class="element-tool-card__desc">{{ definition().description }}</span>
      </span>
    </button>
  `,
})
export class ElementToolCardComponent {
  readonly definition = input.required<ElementDefinition>();
  readonly active = input(false);
  readonly select = output<ElementDefinition>();
}
