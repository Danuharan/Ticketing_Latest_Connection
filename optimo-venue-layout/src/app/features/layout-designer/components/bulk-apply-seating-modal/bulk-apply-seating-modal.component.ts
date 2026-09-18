import {

  ChangeDetectionStrategy,

  Component,

  computed,

  effect,

  inject,

  signal,

} from '@angular/core';

import { FormsModule } from '@angular/forms';

import { DomSanitizer, SafeHtml } from '@angular/platform-browser';



import { LayoutCanvasService } from '../../services/layout-canvas.service';

import { ToastService } from '../../../../core/services/toast.service';



@Component({

  selector: 'app-bulk-apply-seating-modal',

  imports: [FormsModule],

  templateUrl: './bulk-apply-seating-modal.component.html',

  changeDetection: ChangeDetectionStrategy.OnPush,

  host: {

    class: 'bulk-apply-seating-modal-host',

  },

})

export class BulkApplySeatingModalComponent {

  protected readonly canvas = inject(LayoutCanvasService);

  private readonly toast = inject(ToastService);

  private readonly sanitizer = inject(DomSanitizer);



  protected readonly prompt = computed(() => this.canvas.bulkApplyPrompt());



  protected readonly selectedIds = signal<Set<string>>(new Set());



  protected readonly selectableCandidates = computed(() =>

    (this.prompt()?.candidates ?? []).filter((c) => c.selectable),

  );



  protected readonly skippedCandidates = computed(() =>

    (this.prompt()?.candidates ?? []).filter((c) => !c.selectable),

  );



  protected readonly selectedCount = computed(() => this.selectedIds().size);



  protected readonly allSelected = computed(() => {

    const selectable = this.selectableCandidates();

    const selected = this.selectedIds();

    return selectable.length > 0 && selectable.every((c) => selected.has(c.id));

  });



  constructor() {

    effect(() => {

      const prompt = this.prompt();

      if (!prompt) {

        this.selectedIds.set(new Set());

        return;

      }

      this.selectedIds.set(new Set(prompt.candidates.filter((c) => c.selectable).map((c) => c.id)));

    });

  }



  protected previewSvg(svg: string): SafeHtml {

    return this.sanitizer.bypassSecurityTrustHtml(svg);

  }



  protected isChecked(id: string): boolean {

    return this.selectedIds().has(id);

  }



  protected toggleCandidate(id: string, checked: boolean): void {

    this.selectedIds.update((current) => {

      const next = new Set(current);

      if (checked) {

        next.add(id);

      } else {

        next.delete(id);

      }

      return next;

    });

  }



  protected toggleSelectAll(): void {

    const selectable = this.selectableCandidates();

    if (this.allSelected()) {

      this.selectedIds.set(new Set());

      return;

    }

    this.selectedIds.set(new Set(selectable.map((c) => c.id)));

  }



  protected onBackdropClick(event: MouseEvent): void {

    if ((event.target as HTMLElement).classList.contains('bulk-apply-modal__backdrop')) {

      this.skip();

    }

  }



  protected skip(): void {

    this.canvas.closeBulkApplyPrompt();

    this.canvas.exitBlockWorkspace();

  }



  protected apply(): void {

    const prompt = this.prompt();

    if (!prompt) {

      return;

    }

    const targetIds = [...this.selectedIds()];

    if (targetIds.length === 0) {

      this.toast.error('Select at least one block to apply seating.');

      return;

    }

    const applied = this.canvas.bulkApplySeatingConfig(

      prompt.sourceId,

      targetIds,

      prompt.snapshot,

      prompt.configId,

      prompt.configName,

    );

    this.canvas.closeBulkApplyPrompt();

    this.canvas.markBlockWorkspaceConfigSaved();

    this.canvas.exitBlockWorkspace();

    if (applied > 0) {

      const labels = prompt.candidates

        .filter((c) => targetIds.includes(c.id))

        .map((c) => c.label)

        .join(', ');

      this.toast.success(`Applied seating to ${applied} block${applied === 1 ? '' : 's'} (${labels}).`);

    }

  }

}


