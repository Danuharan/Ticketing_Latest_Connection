import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  parseSeatingImportCsv,
  SEATING_IMPORT_SAMPLE_CSV,
  type SeatingImportParseResult,
} from '../../lib/parse-seating-import-file';
import {
  LayoutCanvasService,
  type SeatingImportConflict,
  type SeatingImportConflictDecision,
  type SeatingImportReportEntry,
} from '../../services/layout-canvas.service';
import { ToastService } from '../../../../core/services/toast.service';

/**
 * Bulk seat fill from a CSV file — one row per block (code + rows/columns or
 * capacity). VIEW POINT is aimed at the pitch automatically, so row A of every
 * imported block faces the pitch.
 */
@Component({
  selector: 'app-seating-import-panel',
  imports: [FormsModule],
  templateUrl: './seating-import-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeatingImportPanelComponent {
  protected readonly canvas = inject(LayoutCanvasService);
  private readonly toast = inject(ToastService);

  protected readonly fileName = signal<string | null>(null);
  protected readonly parsed = signal<SeatingImportParseResult | null>(null);
  protected readonly report = signal<SeatingImportReportEntry[] | null>(null);
  protected readonly importing = signal(false);
  protected readonly progress = signal<{ done: number; total: number; code: string } | null>(null);
  /** Block that cannot fit the documented seats — sweep is paused until answered. */
  protected readonly conflict = signal<
    (SeatingImportConflict & { resolve: (decision: SeatingImportConflictDecision) => void }) | null
  >(null);

  /** First rows shown in the conflict breakdown; the rest collapse into "+N more". */
  protected readonly conflictRowsPreview = computed(() => {
    const c = this.conflict();
    return c ? c.shortfallRows.slice(0, 4) : [];
  });
  protected readonly conflictRowsMore = computed(() => {
    const c = this.conflict();
    return c ? Math.max(0, c.shortfallRows.length - 4) : 0;
  });
  protected readonly conflictMissingSeats = computed(() => {
    const c = this.conflict();
    return c ? c.requestedSeats - c.placeableSeats : 0;
  });

  protected readonly progressPct = computed(() => {
    const p = this.progress();
    return p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  });

  /** Real-world length (m) typed for the highlighted side. */
  protected calibrationLengthM: number | null = null;

  /** Currently selected block — the calibration reference candidate. */
  protected readonly calibrationBlock = computed(() => {
    const ids = this.canvas.selectedIds();
    if (ids.length !== 1) {
      return null;
    }
    const el = this.canvas.elements().find((item) => item.id === ids[0]);
    return el && el.type === 'centerpiece'
      ? { id: el.id, label: el.label?.trim() || el.name?.trim() || 'Block' }
      : null;
  });

  /** Sides of the selected block; picking one highlights it on the canvas. */
  protected readonly calibrationSides = computed(() => {
    const block = this.calibrationBlock();
    return block ? this.canvas.venueScaleSideOptions(block.id) : [];
  });

  protected readonly pickedSideId = computed(() => {
    const pick = this.canvas.venueScaleEdgePick();
    const block = this.calibrationBlock();
    return pick && block && pick.elementId === block.id ? pick.edgeId : null;
  });

  protected pickCalibrationSide(edgeId: number): void {
    const block = this.calibrationBlock();
    if (block) {
      this.canvas.venueScaleEdgePick.set({ elementId: block.id, edgeId });
    }
  }

  protected setVenueScale(): void {
    const block = this.calibrationBlock();
    const sideId = this.pickedSideId();
    const lengthM = this.calibrationLengthM;
    if (!block || sideId == null || lengthM == null || lengthM <= 0) {
      this.toast.error('Pick a side of the selected block, then enter its real length in metres.');
      return;
    }
    if (this.canvas.setVenueScaleFromEdge(block.id, sideId, lengthM)) {
      this.toast.success(`Venue scale set from ${block.label}. All CSV sizes now render real.`);
      this.calibrationLengthM = null;
    }
  }

  protected clearVenueScale(): void {
    this.canvas.clearVenueScale();
    this.calibrationLengthM = null;
  }

  protected readonly filledCount = computed(
    () => (this.report() ?? []).filter((entry) => entry.status === 'filled').length,
  );
  protected readonly failedEntries = computed(
    () => (this.report() ?? []).filter((entry) => entry.status !== 'filled'),
  );
  protected readonly totalImportedSeats = computed(() =>
    (this.report() ?? []).reduce((sum, entry) => sum + (entry.seats ?? 0), 0),
  );

  protected downloadSample(event?: Event): void {
    event?.preventDefault();
    const blob = new Blob([`\uFEFF${SEATING_IMPORT_SAMPLE_CSV}`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'seating-import-sample.csv';
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  protected async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.importing()) {
      return;
    }
    this.report.set(null);
    this.fileName.set(file.name);
    try {
      const text = await file.text();
      this.parsed.set(parseSeatingImportCsv(text));
    } catch {
      this.parsed.set({ rows: [], errors: ['Could not read the file.'] });
    }
  }

  protected async applyImport(): Promise<void> {
    const parsed = this.parsed();
    if (!parsed || parsed.rows.length === 0 || this.importing()) {
      return;
    }
    this.importing.set(true);
    this.progress.set({ done: 0, total: parsed.rows.length, code: '…' });
    try {
      // Sweep the stadium in ~6s regardless of block count (80–220ms per block).
      const stepDelayMs = Math.min(220, Math.max(80, Math.round(6000 / parsed.rows.length)));
      const report = await this.canvas.importSeatingFromRowsAnimated(parsed.rows, {
        stepDelayMs,
        onProgress: (done, total, entry) =>
          this.progress.set({ done, total, code: entry.blockCode }),
        onConflict: (conflict) =>
          new Promise<SeatingImportConflictDecision>((resolve) => {
            this.conflict.set({ ...conflict, resolve });
          }),
      });
      this.report.set(report);
      const filled = report.filter((entry) => entry.status === 'filled').length;
      if (filled > 0) {
        this.toast.success(`Seats filled in ${filled} of ${report.length} blocks.`);
      } else {
        this.toast.error('No blocks could be filled — check the report below.');
      }
    } finally {
      this.importing.set(false);
      this.progress.set(null);
      this.conflict.set(null);
    }
  }

  protected resolveConflict(decision: SeatingImportConflictDecision): void {
    const active = this.conflict();
    if (!active) {
      return;
    }
    this.conflict.set(null);
    active.resolve(decision);
  }

  protected reset(): void {
    if (this.importing()) {
      return;
    }
    this.fileName.set(null);
    this.parsed.set(null);
    this.report.set(null);
  }
}
