import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  signal,
} from '@angular/core';

import { VenueLayoutConfig } from '../../../../core/models/venue-layout-config.model';
import { LayoutPreviewComponent } from '../layout-preview/layout-preview.component';

/** Defers full SVG preview until the card scrolls near the viewport. */
@Component({
  selector: 'app-lazy-layout-preview',
  imports: [LayoutPreviewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'lazy-layout-preview',
  },
  template: `
    @if (shouldRender()) {
      <app-layout-preview [config]="config()" />
    } @else {
      <div class="layout-preview-placeholder" aria-hidden="true"></div>
    }
  `,
})
export class LazyLayoutPreviewComponent {
  readonly config = input.required<VenueLayoutConfig>();

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly shouldRender = signal(false);

  constructor() {
    afterNextRender(() => this.observeViewport());
  }

  private observeViewport(): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.shouldRender.set(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.shouldRender.set(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin: '120px 0px', threshold: 0.01 },
    );

    observer.observe(this.host.nativeElement);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }
}
