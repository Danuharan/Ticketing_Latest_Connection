import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** List-card preview — stored SVG thumbnail or a lightweight placeholder. */
@Component({
  selector: 'app-template-thumbnail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'template-thumbnail-host',
  },
  template: `
    @if (src()) {
      <img
        class="template-thumbnail"
        [src]="src()!"
        [alt]="alt()"
        loading="lazy"
        decoding="async"
      />
    } @else {
      <div class="template-thumbnail template-thumbnail--empty" aria-hidden="true">
        <span class="template-thumbnail__icon">⌁</span>
        <span class="template-thumbnail__hint">Save again to refresh preview</span>
      </div>
    }
  `,
})
export class TemplateThumbnailComponent {
  readonly src = input<string | null>(null);
  readonly alt = input('Venue layout preview');
}
