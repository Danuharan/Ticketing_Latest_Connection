import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import {
  CHAIR_BACKREST,
  CHAIR_CUSHION,
  CHAIR_FRONT_ARROW_PATH,
  CHAIR_RAIL_LEFT,
  CHAIR_RAIL_RIGHT,
  SEAT_BODY_FILL,
  SEAT_BODY_STROKE,
  SEAT_SELECTED_BODY_FILL,
  SEAT_SELECTED_BODY_STROKE,
  SEAT_SELECTED_HALO_STROKE,
  seatLabelFontSize,
  seatLabelOffsetY,
  shadeHexColor,
} from '../../lib/chair-seat-icon';

/**
 * Unified seat glyph (all seating tools): true top-down chair facing the stage —
 * dark backrest bar behind the sitter, thin armrest rails down both sides, and a
 * small chevron on the cushion pointing at the stage so the facing reads at a glance.
 * All part colors derive from the single `fill` input so category tints keep working.
 */
@Component({
  selector: 'svg:g[appSeatChairGraphic]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.transform]': 'outerTransform()',
    '[class.canvas-stage-seat-graphic--selected]': 'selected()',
  },
  template: `
    @if (compact()) {
      <svg:circle
        cx="0"
        cy="0"
        [attr.r]="compactRadius()"
        [attr.fill]="cushionFill()"
        [attr.stroke]="bodyStroke()"
        [attr.stroke-width]="selected() ? 0.9 : 0.35"
        pointer-events="none"
      />
    } @else {
      @if (selected()) {
        <svg:rect
          class="canvas-stage-seat-halo"
          x="-6.4"
          y="-6.4"
          width="12.8"
          height="12.8"
          rx="4.2"
          ry="4.2"
          fill="none"
          [attr.stroke]="haloStroke"
          stroke-width="1.1"
          pointer-events="none"
        />
      }
      <svg:rect
        [attr.x]="backrest.x"
        [attr.y]="backrest.y"
        [attr.width]="backrest.width"
        [attr.height]="backrest.height"
        [attr.rx]="backrest.rx"
        [attr.ry]="backrest.ry"
        [attr.fill]="backrestFill()"
        pointer-events="none"
      />
      <svg:rect
        [attr.x]="railLeft.x"
        [attr.y]="railLeft.y"
        [attr.width]="railLeft.width"
        [attr.height]="railLeft.height"
        [attr.rx]="railLeft.rx"
        [attr.ry]="railLeft.ry"
        [attr.fill]="railFill()"
        pointer-events="none"
      />
      <svg:rect
        [attr.x]="railRight.x"
        [attr.y]="railRight.y"
        [attr.width]="railRight.width"
        [attr.height]="railRight.height"
        [attr.rx]="railRight.rx"
        [attr.ry]="railRight.ry"
        [attr.fill]="railFill()"
        pointer-events="none"
      />
      <svg:rect
        [attr.x]="cushion.x"
        [attr.y]="cushion.y"
        [attr.width]="cushion.width"
        [attr.height]="cushion.height"
        [attr.rx]="cushion.rx"
        [attr.ry]="cushion.ry"
        [attr.fill]="cushionFill()"
        [attr.stroke]="bodyStroke()"
        [attr.stroke-width]="selected() ? 0.9 : 0.45"
        pointer-events="none"
      />
      <svg:path
        [attr.d]="frontArrow"
        fill="none"
        [attr.stroke]="arrowStroke()"
        stroke-width="0.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        pointer-events="none"
      />
      @if (showLabels() && labelText()) {
        <svg:text
          x="0"
          [attr.y]="labelOffsetY"
          text-anchor="middle"
          dominant-baseline="middle"
          [attr.font-size]="labelFontSize()"
          font-weight="700"
          [attr.fill]="selected() ? '#78350f' : '#334155'"
          pointer-events="none"
        >{{ labelText() }}</svg:text>
      }
    }
  `,
})
export class SeatChairGraphicComponent {
  readonly x = input.required<number>();
  readonly y = input.required<number>();
  readonly scale = input(1);
  /** Optional vertical scale — long chairs (chair_length_m) render elongated. */
  readonly scaleY = input<number | null>(null);
  readonly rotationDeg = input(0);
  readonly labelText = input('');
  readonly showLabels = input(true);
  readonly selected = input(false);
  /** Lightweight dot glyph for large layouts while scrolling or zoomed out. */
  readonly compact = input(false);
  readonly fill = input(SEAT_BODY_FILL);
  readonly stroke = input(SEAT_BODY_STROKE);

  protected readonly backrest = CHAIR_BACKREST;
  protected readonly cushion = CHAIR_CUSHION;
  protected readonly railLeft = CHAIR_RAIL_LEFT;
  protected readonly railRight = CHAIR_RAIL_RIGHT;
  protected readonly frontArrow = CHAIR_FRONT_ARROW_PATH;
  protected readonly labelOffsetY = seatLabelOffsetY();
  protected readonly haloStroke = SEAT_SELECTED_HALO_STROKE;

  private readonly baseFill = computed(() =>
    this.selected() ? SEAT_SELECTED_BODY_FILL : this.fill(),
  );
  protected readonly bodyStroke = computed(() =>
    this.selected() ? SEAT_SELECTED_BODY_STROKE : this.stroke(),
  );
  protected readonly cushionFill = computed(() => this.baseFill());
  protected readonly backrestFill = computed(() => shadeHexColor(this.baseFill(), -0.45));
  protected readonly railFill = computed(() => shadeHexColor(this.baseFill(), -0.22));
  protected readonly arrowStroke = computed(() => this.bodyStroke());

  protected readonly compactRadius = computed(() => Math.max(1.6, 2.8 * this.scale()));

  protected readonly outerTransform = computed(() => {
    const parts = [`translate(${this.x()},${this.y()})`];
    const rotation = this.rotationDeg();
    if (rotation) {
      parts.push(`rotate(${rotation})`);
    }
    const sy = this.scaleY();
    parts.push(
      sy != null && sy !== this.scale()
        ? `scale(${this.scale()},${sy})`
        : `scale(${this.scale()})`,
    );
    return parts.join(' ');
  });

  protected readonly labelFontSize = computed(() => seatLabelFontSize(this.scale()));
}
