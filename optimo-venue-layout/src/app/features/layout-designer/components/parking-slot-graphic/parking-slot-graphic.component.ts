import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { VEHICLE_TYPE_STYLE } from '../../lib/parking-slots';
import { ElementPosition, ParkingVehicleType } from '../../models/layout-element.model';

/**
 * One placed (or ghost-preview) parking slot: a rotated rect + short label (the bookable
 * slot code like "A3", or the vehicle-type name as fallback). Local, unrotated space has
 * the slot's depth (lengthPx) along +x and its pitch/width (widthPx) along +y — the outer
 * `<g>` transform (translate then rotate) does the placement, same convention as
 * `SeatChairGraphicComponent`.
 */
@Component({
  selector: 'svg:g[appParkingSlotGraphic]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.transform]': 'outerTransform()',
  },
  template: `
    @if (selected()) {
      <svg:rect
        [attr.x]="-lengthPx() / 2 - 2.5"
        [attr.y]="-widthPx() / 2 - 2.5"
        [attr.width]="lengthPx() + 5"
        [attr.height]="widthPx() + 5"
        [attr.rx]="Math.min(5, widthPx() / 4)"
        fill="none"
        stroke="#f59e0b"
        stroke-width="1.4"
        stroke-dasharray="4,3"
        pointer-events="none"
      />
    }
    @if (shapePolygonStr(); as poly) {
      <svg:polygon
        [attr.points]="poly"
        [attr.fill]="style().fill"
        [attr.stroke]="selected() ? '#f59e0b' : style().stroke"
        [attr.stroke-width]="selected() ? 1.6 : 0.9"
        [attr.opacity]="preview() ? 0.45 : 1"
        [attr.stroke-dasharray]="preview() ? '3,2' : null"
        stroke-linejoin="round"
        pointer-events="none"
      />
    } @else {
      <svg:rect
        [attr.x]="-lengthPx() / 2"
        [attr.y]="-widthPx() / 2"
        [attr.width]="lengthPx()"
        [attr.height]="widthPx()"
        [attr.rx]="Math.min(4, widthPx() / 4)"
        [attr.fill]="style().fill"
        [attr.stroke]="selected() ? '#f59e0b' : style().stroke"
        [attr.stroke-width]="selected() ? 1.6 : 0.9"
        [attr.opacity]="preview() ? 0.45 : 1"
        [attr.stroke-dasharray]="preview() ? '3,2' : null"
        pointer-events="none"
      />
    }
    @if (showLabel()) {
      <svg:text
        x="0"
        y="0"
        text-anchor="middle"
        dominant-baseline="middle"
        [attr.font-size]="labelFontSize()"
        font-weight="700"
        [attr.fill]="style().stroke"
        [attr.opacity]="preview() ? 0.6 : 1"
        pointer-events="none"
      >{{ displayLabel() }}</svg:text>
    }
    <!-- Invisible hit target so a placed slot can be clicked/dragged in the parking workspace. -->
    <svg:rect
      [attr.x]="-lengthPx() / 2"
      [attr.y]="-widthPx() / 2"
      [attr.width]="lengthPx()"
      [attr.height]="widthPx()"
      fill="transparent"
      [attr.pointer-events]="hit() ? 'all' : 'none'"
      [attr.cursor]="hit() ? 'move' : null"
    />
  `,
})
export class ParkingSlotGraphicComponent {
  protected readonly Math = Math;

  readonly x = input.required<number>();
  readonly y = input.required<number>();
  readonly rotationDeg = input(0);
  readonly lengthPx = input.required<number>();
  readonly widthPx = input.required<number>();
  readonly vehicleType = input.required<ParkingVehicleType>();
  /** Bookable slot code ("A3"); falls back to the vehicle-type name when absent. */
  readonly labelText = input<string | null>(null);
  /**
   * Optional label height in canvas px (from plan OCR glyph size). When set, labels
   * match the uploaded image naming size instead of a tiny fixed cap.
   */
  readonly labelHeightPx = input<number | null>(null);
  /** Custom polygon in slot-local % of the length×width box (absent = rectangle). */
  readonly shapePoints = input<ElementPosition[] | null>(null);
  readonly selected = input(false);
  /** Ghost/translucent rendering for the live drag-to-fill preview, before a lane is committed. */
  readonly preview = input(false);
  readonly showLabel = input(true);
  /** Enables the invisible hit rect so the host `<g>` receives pointer events. */
  readonly hit = input(false);

  protected readonly style = computed(() => VEHICLE_TYPE_STYLE[this.vehicleType()]);
  protected readonly displayLabel = computed(() => this.labelText() ?? this.style().label);

  /** Slot-local polygon points string — % of the box mapped to px, centre at origin. */
  protected readonly shapePolygonStr = computed(() => {
    const pts = this.shapePoints();
    if (!pts || pts.length < 3) {
      return null;
    }
    return pts
      .map(
        (p) =>
          `${((p.xPct / 100 - 0.5) * this.lengthPx()).toFixed(2)},${((p.yPct / 100 - 0.5) * this.widthPx()).toFixed(2)}`,
      )
      .join(' ');
  });
  protected readonly labelFontSize = computed(() => {
    const shortSide = Math.min(this.lengthPx(), this.widthPx());
    const proportional = shortSide * 0.4;
    const fromPlan = this.labelHeightPx();
    // Prefer plan OCR glyph size when known; never go below ~40% of the stall short
    // side so schematic large bays stay readable (old hard-cap of 10px made B1 tiny).
    const target = fromPlan && fromPlan > 0 ? Math.max(fromPlan, proportional) : proportional;
    return Math.max(8, Math.min(target, shortSide * 0.85));
  });

  protected readonly outerTransform = computed(() => {
    const rotation = this.rotationDeg();
    return rotation
      ? `translate(${this.x()},${this.y()}) rotate(${rotation})`
      : `translate(${this.x()},${this.y()})`;
  });
}
