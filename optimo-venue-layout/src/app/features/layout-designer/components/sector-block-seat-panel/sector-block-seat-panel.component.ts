import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { SeatChairGraphicComponent } from '../seat-chair-graphic/seat-chair-graphic.component';

import {
  SeatLabelStyle,
  SeatLayoutSpec,
  SectorBlock,
} from '../../models/layout-element.model';
import { rowLabel, SeatNode } from '../../lib/seat-layout';
import { seatNodeToChairView } from '../../lib/seat-chair-view';
import {
  addSeatsToLayout,
  buildSectorSeatPreview,
  mergeSeatLayoutPatch,
  parseCommaNumbers,
  parseSeatIdList,
  resolveSeatLayout,
  seatLayoutToBlockFields,
  visibleSeatCount,
} from '../../lib/sector-seat-layout';

@Component({
  selector: 'app-sector-block-seat-panel',
  imports: [FormsModule, SeatChairGraphicComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sector-block-seat-panel.component.html',
})
export class SectorBlockSeatPanelComponent {
  readonly block = input.required<SectorBlock>();
  readonly ringRowLabelStyle = input<SeatLabelStyle>('letter');
  readonly compact = input(false);

  readonly blockChange = output<Partial<SectorBlock>>();

  protected readonly seatsToAdd = signal(1);

  protected readonly layout = computed(() =>
    resolveSeatLayout(this.block(), this.ringRowLabelStyle()),
  );

  protected readonly seatCount = computed(() =>
    visibleSeatCount(this.block(), this.ringRowLabelStyle()),
  );

  protected readonly rowSeatCounts = computed(() => this.layout().rowSeatCounts ?? []);

  protected readonly rowOffsetXPcts = computed(() => this.layout().rowOffsetXPcts ?? []);

  protected readonly rowOffsetYPcts = computed(() => this.layout().rowOffsetYPcts ?? []);

  protected readonly maxAssignedSeatsPerRow = computed(() =>
    this.rowSeatCounts().reduce((max, count) => Math.max(max, count), this.layout().seatsPerRow),
  );

  private static readonly PREVIEW_W = 200;
  private static readonly PREVIEW_H = 130;

  protected readonly preview = computed(() =>
    buildSectorSeatPreview(
      this.block(),
      this.ringRowLabelStyle(),
      SectorBlockSeatPanelComponent.PREVIEW_W,
      SectorBlockSeatPanelComponent.PREVIEW_H,
    ),
  );

  protected seatChairPreview(seat: SeatNode) {
    return seatNodeToChairView(seat, {
      showNumbers: seat.showNumber,
    });
  }

  protected rowLabelAt(index: number): string {
    return rowLabel(index, this.layout().rowLabelStyle ?? 'letter');
  }

  protected num(value: string | number): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  protected aisleValue(): string {
    return (this.layout().aisleAfterSeatNumbers ?? []).join(', ');
  }

  protected hiddenSeatsValue(): string {
    return (this.layout().hiddenSeatIds ?? []).join(', ');
  }

  protected patchLayout(partial: Partial<SeatLayoutSpec>): void {
    const next = mergeSeatLayoutPatch(this.block(), this.ringRowLabelStyle(), partial);
    this.emitLayout(next);
  }

  protected resizeRows(nextRows: number): void {
    const layout = this.layout();
    const safeRows = Math.max(1, Math.min(50, Math.round(nextRows)));
    const rowSeatCounts = Array.from(
      { length: safeRows },
      (_, index) => layout.rowSeatCounts?.[index] ?? layout.seatsPerRow,
    );
    const rowOffsetXPcts = Array.from(
      { length: safeRows },
      (_, index) => layout.rowOffsetXPcts?.[index] ?? 0,
    );
    const rowOffsetYPcts = Array.from(
      { length: safeRows },
      (_, index) => layout.rowOffsetYPcts?.[index] ?? 0,
    );
    this.patchLayout({ rows: safeRows, rowSeatCounts, rowOffsetXPcts, rowOffsetYPcts });
  }

  protected updateDefaultSeatsPerRow(next: number): void {
    const layout = this.layout();
    const safe = Math.max(1, Math.min(100, Math.round(next)));
    this.patchLayout({
      seatsPerRow: safe,
      rowSeatCounts: (layout.rowSeatCounts ?? []).map((count) =>
        count === layout.seatsPerRow ? safe : count,
      ),
    });
  }

  protected updateRowSeatCount(rowIndex: number, next: number): void {
    const counts = [...this.rowSeatCounts()];
    counts[rowIndex] = Math.max(0, Math.min(100, Math.round(next)));
    this.patchLayout({ rowSeatCounts: counts });
  }

  protected updateRowOffset(rowIndex: number, axis: 'x' | 'y', next: number): void {
    const safe = Math.max(-40, Math.min(40, next));
    if (axis === 'x') {
      const rowOffsetXPcts = [...this.rowOffsetXPcts()];
      rowOffsetXPcts[rowIndex] = safe;
      this.patchLayout({ rowOffsetXPcts });
      return;
    }
    const rowOffsetYPcts = [...this.rowOffsetYPcts()];
    rowOffsetYPcts[rowIndex] = safe;
    this.patchLayout({ rowOffsetYPcts });
  }

  protected setAisles(raw: string): void {
    const limit = Math.max(this.layout().seatsPerRow, this.maxAssignedSeatsPerRow());
    this.patchLayout({ aisleAfterSeatNumbers: parseCommaNumbers(raw, limit + 1) });
  }

  protected setHiddenSeats(raw: string): void {
    this.patchLayout({ hiddenSeatIds: parseSeatIdList(raw) });
  }

  protected addSeats(): void {
    const next = addSeatsToLayout(this.layout(), this.seatsToAdd());
    this.emitLayout(next);
  }

  private emitLayout(layout: SeatLayoutSpec): void {
    this.blockChange.emit({
      ...seatLayoutToBlockFields(layout),
      seatLayout: layout,
    });
  }
}
