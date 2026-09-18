import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  clampDiningBackgroundScale,
  defaultDiningBackgroundFit,
  diningBackgroundPreviewLayout,
  diningBackgroundDraw,
  diningBackgroundUserScaleForMode,
  type DiningBackgroundClipSource,
  type DiningBackgroundFit,
  type DiningBackgroundFitMode,
} from '../../lib/dining-background-image';
import type { DiningLayoutReferenceImage } from '../../models/layout-element.model';

@Component({
  selector: 'app-dining-background-adjust',
  imports: [FormsModule],
  templateUrl: './dining-background-adjust.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'dining-bg-adjust-host',
  },
})
export class DiningBackgroundAdjustComponent implements OnDestroy {
  private readonly hostRef = inject(ElementRef<HTMLElement>);

  readonly image = input.required<DiningLayoutReferenceImage>();
  /** Block bounding-box width / height. */
  readonly blockAspect = input(1);
  /** Same shape/polygon used to render this block on the main canvas. */
  readonly clipSource = input<DiningBackgroundClipSource>({});
  readonly initialFit = input<DiningBackgroundFit | null>(null);

  readonly applied = output<DiningBackgroundFit>();
  readonly cancelled = output<void>();

  protected readonly fit = signal<DiningBackgroundFit>(defaultDiningBackgroundFit());
  private readonly drag = signal<{
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);

  protected readonly preview = computed(() =>
    diningBackgroundPreviewLayout(this.clipSource(), this.blockAspect()),
  );

  protected readonly previewDraw = computed(() => {
    const img = this.image();
    return diningBackgroundDraw(img, this.preview().rect, this.fit());
  });

  protected readonly imageStyle = computed(() => {
    const draw = this.previewDraw();
    const rect = this.preview().rect;
    if (!draw) {
      return null;
    }
    return {
      left: `${draw.x - rect.x}px`,
      top: `${draw.y - rect.y}px`,
      width: `${draw.width}px`,
      height: `${draw.height}px`,
      transform: `rotate(${draw.rotationDeg}deg)`,
    };
  });

  protected readonly isCoverMode = computed(() => this.fit().fitMode === 'cover');
  protected readonly isContainMode = computed(() => this.fit().fitMode === 'contain');

  private seeded = false;

  constructor() {
    afterNextRender(() => {
      document.body.appendChild(this.hostRef.nativeElement);
    });
    effect(() => {
      const initial = this.initialFit();
      if (this.seeded) {
        return;
      }
      this.seeded = true;
      this.fit.set(initial ? { ...defaultDiningBackgroundFit(), ...initial } : defaultDiningBackgroundFit());
    });
  }

  ngOnDestroy(): void {
    this.hostRef.nativeElement.remove();
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const current = this.fit();
    this.drag.set({
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: current.offsetXPct,
      startOffsetY: current.offsetYPct,
    });
  }

  protected onPointerMove(event: PointerEvent): void {
    const session = this.drag();
    if (!session) {
      return;
    }
    const inner = this.preview().rect;
    const dx = ((event.clientX - session.startX) / Math.max(1, inner.width)) * 100;
    const dy = ((event.clientY - session.startY) / Math.max(1, inner.height)) * 100;
    this.fit.update((current) => ({
      ...current,
      offsetXPct: Math.min(180, Math.max(-80, session.startOffsetX + dx)),
      offsetYPct: Math.min(180, Math.max(-80, session.startOffsetY + dy)),
    }));
  }

  protected onPointerUp(): void {
    this.drag.set(null);
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    this.setScale(this.fit().scale + delta);
  }

  protected setScale(value: number): void {
    this.fit.update((current) => ({
      ...current,
      scale: clampDiningBackgroundScale(value),
    }));
  }

  protected rotate(delta: number): void {
    this.fit.update((current) => {
      const rotationDeg = ((current.rotationDeg + delta) % 360 + 360) % 360;
      const next = { ...current, rotationDeg };
      if (current.fitMode === 'cover' || current.fitMode === 'contain') {
        next.scale = this.userScaleFor(current.fitMode, rotationDeg);
        next.offsetXPct = 50;
        next.offsetYPct = 50;
      }
      return next;
    });
  }

  protected applyMode(mode: DiningBackgroundFitMode): void {
    this.fit.update((current) => ({
      ...current,
      fitMode: mode,
      scale: this.userScaleFor(mode, current.rotationDeg),
      offsetXPct: 50,
      offsetYPct: 50,
    }));
  }

  protected fitContain(): void {
    this.applyMode('contain');
  }

  protected fitCover(): void {
    this.applyMode('cover');
  }

  protected reset(): void {
    this.fit.set(defaultDiningBackgroundFit());
  }

  protected apply(): void {
    this.applied.emit({ ...this.fit(), visible: true });
  }

  protected cancel(): void {
    this.cancelled.emit();
  }

  private userScaleFor(mode: DiningBackgroundFitMode, rotationDeg: number): number {
    const img = this.image();
    return diningBackgroundUserScaleForMode(
      img.imageWidth ?? 1,
      img.imageHeight ?? 1,
      this.preview().rect,
      rotationDeg,
      mode,
    );
  }
}
