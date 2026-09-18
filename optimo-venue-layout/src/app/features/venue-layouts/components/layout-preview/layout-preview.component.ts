import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { VenueLayoutConfig } from '../../../../core/models/venue-layout-config.model';
import {
  SEAT_FILL,
  SEAT_STROKE,
  buildLayoutPreviewElements,
} from '../../lib/layout-preview-render';
import { SeatChairGraphicComponent } from '../../../layout-designer/components/seat-chair-graphic/seat-chair-graphic.component';
import { seatNodeToChairView } from '../../../layout-designer/lib/seat-chair-view';
import { SeatNode } from '../../../layout-designer/lib/seat-layout';

/** Full-fidelity mini SVG preview for template library cards. */
@Component({
  selector: 'app-layout-preview',
  imports: [SeatChairGraphicComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      class="layout-preview"
      [attr.viewBox]="viewBox()"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <rect [attr.width]="config().canvas.width" [attr.height]="config().canvas.height" class="layout-preview__bg" />
      @for (vm of items(); track vm.id) {
        <g [attr.transform]="vm.transform || null">
          @switch (vm.type) {
            @case ('centerpiece') {
              @switch (vm.shapeMode) {
                @case ('ellipse') {
                  <ellipse
                    [attr.cx]="vm.rect.cx"
                    [attr.cy]="vm.rect.cy"
                    [attr.rx]="vm.rect.width / 2"
                    [attr.ry]="vm.rect.height / 2"
                    [attr.fill]="vm.fill"
                    [attr.stroke]="vm.stroke"
                    stroke-width="1"
                  />
                }
                @case ('rect') {
                  <rect
                    [attr.x]="vm.rect.x"
                    [attr.y]="vm.rect.y"
                    [attr.width]="vm.rect.width"
                    [attr.height]="vm.rect.height"
                    [attr.rx]="vm.rectRx ?? 0"
                    [attr.fill]="vm.fill"
                    [attr.stroke]="vm.stroke"
                    stroke-width="1"
                  />
                }
                @case ('path') {
                  <path [attr.d]="vm.pathD" [attr.fill]="vm.fill" [attr.stroke]="vm.stroke" stroke-width="1" />
                }
                @case ('polygon') {
                  <polygon [attr.points]="vm.pathD" [attr.fill]="vm.fill" [attr.stroke]="vm.stroke" stroke-width="1" />
                }
              }
              @if (vm.centerLabel; as l) {
                <text
                  [attr.x]="l.x"
                  [attr.y]="l.y"
                  text-anchor="middle"
                  [attr.font-size]="l.fontSize"
                  [attr.font-weight]="l.weight"
                  [attr.fill]="l.color"
                  class="layout-preview__text"
                >
                  {{ l.text }}
                </text>
              }
              @for (seat of vm.seats ?? []; track $index) {
                <circle [attr.cx]="seat.x" [attr.cy]="seat.y" [attr.r]="seat.radius" [attr.fill]="seatFill" [attr.stroke]="seatStroke" stroke-width="0.6" />
              }
            }
            @case ('layer-ring') {
              <path [attr.d]="vm.ringPath" [attr.fill]="vm.fill" [attr.stroke]="vm.stroke" stroke-width="1" fill-rule="evenodd" />
              @for (sector of vm.sectors ?? []; track sector.code) {
                <path [attr.d]="sector.path" [attr.fill]="sector.fill" fill-opacity="0.72" [attr.stroke]="vm.stroke" stroke-width="1" />
                @for (seat of sector.seats; track $index) {
                  @if (seatChairView(seat, seat.showNumber); as chair) {
                    <svg:g
                      appSeatChairGraphic
                      [x]="chair.x"
                      [y]="chair.y"
                      [scale]="chair.scale"
                      [labelText]="chair.labelText"
                      [showLabels]="chair.showLabels"
                      [fill]="seatFill"
                      [stroke]="seatStroke"
                    />
                  }
                }
                <text
                  [attr.x]="sector.labelX"
                  [attr.y]="sector.labelY"
                  text-anchor="middle"
                  font-size="10"
                  font-weight="700"
                  [attr.fill]="vm.labelColor"
                  class="layout-preview__text"
                >
                  {{ sector.displayLabel }}
                </text>
              }
            }
            @case ('layer-rect') {
              <rect
                [attr.x]="vm.groundX"
                [attr.y]="vm.groundY"
                [attr.width]="vm.groundW"
                [attr.height]="vm.groundH"
                rx="6"
                [attr.fill]="vm.fill"
                [attr.stroke]="vm.stroke"
                stroke-width="1"
              />
              @for (block of vm.rectBlocks ?? []; track block.code) {
                <rect
                  [attr.x]="block.x"
                  [attr.y]="block.y"
                  [attr.width]="block.width"
                  [attr.height]="block.height"
                  rx="3"
                  fill="#ffffff"
                  fill-opacity="0.6"
                  [attr.stroke]="vm.stroke"
                  stroke-width="1"
                />
                @for (seat of block.seats; track $index) {
                  @if (seatChairView(seat); as chair) {
                    <svg:g
                      appSeatChairGraphic
                      [x]="chair.x"
                      [y]="chair.y"
                      [scale]="chair.scale"
                      [labelText]="chair.labelText"
                      [showLabels]="chair.showLabels"
                      [fill]="seatFill"
                      [stroke]="seatStroke"
                    />
                  }
                }
                <text
                  [attr.x]="block.labelX"
                  [attr.y]="block.labelY"
                  text-anchor="middle"
                  font-size="9"
                  font-weight="700"
                  [attr.fill]="vm.labelColor"
                  class="layout-preview__text"
                >
                  {{ block.code }}
                </text>
              }
            }
            @case ('block-grid') {
              @switch (vm.shapeMode) {
                @case ('ellipse') {
                  <ellipse
                    [attr.cx]="vm.rect.cx"
                    [attr.cy]="vm.rect.cy"
                    [attr.rx]="vm.rect.width / 2"
                    [attr.ry]="vm.rect.height / 2"
                    [attr.fill]="vm.fill"
                    [attr.stroke]="vm.stroke"
                    stroke-width="1"
                  />
                }
                @case ('path') {
                  <path
                    [attr.d]="vm.pathD"
                    [attr.fill]="vm.fill"
                    [attr.stroke]="vm.stroke"
                    stroke-width="1"
                    stroke-linejoin="round"
                  />
                }
                @default {
                  <rect
                    [attr.x]="vm.rect.x"
                    [attr.y]="vm.rect.y"
                    [attr.width]="vm.rect.width"
                    [attr.height]="vm.rect.height"
                    [attr.rx]="vm.rectRx ?? 6"
                    [attr.fill]="vm.fill"
                    [attr.stroke]="vm.stroke"
                    stroke-width="1"
                  />
                }
              }
              @for (seat of vm.seats ?? []; track $index) {
                @if (seatChairView(seat); as chair) {
                  <svg:g
                    appSeatChairGraphic
                    [x]="chair.x"
                    [y]="chair.y"
                    [scale]="chair.scale"
                    [labelText]="chair.labelText"
                    [showLabels]="chair.showLabels"
                    [fill]="seatFill"
                    [stroke]="seatStroke"
                  />
                }
              }
            }
            @case ('seat-section') {
              <rect
                [attr.x]="vm.rect.x"
                [attr.y]="vm.rect.y"
                [attr.width]="vm.rect.width"
                [attr.height]="vm.rect.height"
                rx="8"
                [attr.fill]="vm.fill"
                [attr.stroke]="vm.stroke"
                stroke-width="1"
              />
              @for (seat of vm.seats ?? []; track $index) {
                @if (seatChairView(seat); as chair) {
                  <svg:g
                    appSeatChairGraphic
                    [x]="chair.x"
                    [y]="chair.y"
                    [scale]="chair.scale"
                    [labelText]="chair.labelText"
                    [showLabels]="chair.showLabels"
                    [fill]="seatFill"
                    [stroke]="seatStroke"
                  />
                }
              }
            }
            @case ('aisle') {
              <rect
                [attr.x]="vm.rect.x"
                [attr.y]="vm.rect.y"
                [attr.width]="vm.rect.width"
                [attr.height]="vm.rect.height"
                rx="2"
                [attr.fill]="vm.fill"
                [attr.stroke]="vm.stroke"
                stroke-width="1"
              />
            }
            @case ('label') {
              @if (vm.textLabel; as l) {
                <text
                  [attr.x]="l.x"
                  [attr.y]="l.y"
                  text-anchor="middle"
                  [attr.font-size]="l.fontSize"
                  [attr.font-weight]="l.weight"
                  [attr.fill]="l.color"
                  class="layout-preview__text"
                >
                  {{ l.text }}
                </text>
              }
            }
          }
        </g>
      }
    </svg>
  `,
})
export class LayoutPreviewComponent {
  readonly config = input.required<VenueLayoutConfig>();

  protected readonly seatFill = SEAT_FILL;
  protected readonly seatStroke = SEAT_STROKE;

  protected readonly items = computed(() => buildLayoutPreviewElements(this.config()));

  protected readonly viewBox = computed(() => {
    const c = this.config().canvas;
    return `0 0 ${c.width} ${c.height}`;
  });

  protected seatChairView(seat: SeatNode, showNumbers = true) {
    return seatNodeToChairView(seat, { showNumbers });
  }
}
