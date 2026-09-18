import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import {
  BLOCK_WORKSPACE_STEPS,
  BlockWorkspaceStepId,
  LayoutCanvasService,
} from '../../services/layout-canvas.service';

type GaStepId = 'block-type' | 'ga-sides' | 'ga-max' | 'save';
type AnyStepId = BlockWorkspaceStepId | GaStepId;

const GA_STEPS: { id: GaStepId; number: number; label: string }[] = [
  { id: 'block-type', number: 1, label: 'Select block type' },
  { id: 'ga-sides', number: 2, label: 'Configure sides' },
  { id: 'ga-max', number: 3, label: 'Max participants' },
  { id: 'save', number: 4, label: 'Save' },
];

@Component({
  selector: 'app-block-workspace-stepper',
  templateUrl: './block-workspace-stepper.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block-workspace-stepper',
  },
})
export class BlockWorkspaceStepperComponent {
  protected readonly canvas = inject(LayoutCanvasService);

  protected readonly progress = computed(() => this.canvas.blockWorkspaceProgress());
  protected readonly customizationFlow = computed(() => this.progress().customizationFlow);
  protected readonly isGaFlow = computed(() => this.canvas.isGaWorkspace());
  protected readonly gaOnMaxStep = computed(() => this.canvas.gaWorkspaceMaxParticipantsStep());

  /** Steps shown in the breadcrumb — GA gets its own 4-step sequence. */
  protected readonly steps = computed(() =>
    this.isGaFlow() ? GA_STEPS : BLOCK_WORKSPACE_STEPS,
  );

  protected stepComplete(id: AnyStepId): boolean {
    if (this.isGaFlow()) {
      if (id === 'block-type') return true; // GA type is already selected
      if (id === 'ga-sides') return this.gaOnMaxStep(); // done once user moves to max-participants
      return false;
    }
    return this.progress().completed[id as BlockWorkspaceStepId] ?? false;
  }

  protected stepActive(id: AnyStepId): boolean {
    if (this.isGaFlow()) {
      if (id === 'ga-sides') return !this.gaOnMaxStep();
      if (id === 'ga-max') return this.gaOnMaxStep();
      return false;
    }
    return this.progress().activeStep === (id as BlockWorkspaceStepId);
  }

  protected stepSkipped(id: AnyStepId): boolean {
    if (this.isGaFlow()) return false;
    return !this.customizationFlow() && id !== 'block-type' && id !== 'save';
  }

  protected canGoBack(): boolean {
    return this.progress().canGoBack;
  }

  protected backLabel(): string {
    return this.progress().backLabel;
  }

  protected goBack(): void {
    this.canvas.goBackBlockWorkspaceStep();
  }

  protected onStepClick(stepId: AnyStepId): void {
    if (this.isGaFlow()) return;
    const progress = this.progress();
    if (stepId === 'save' && progress.completed.edit && progress.activeStep === 'edit') {
      this.canvas.proceedBlockWorkspaceToSave();
    }
  }

  protected stepClickable(stepId: AnyStepId): boolean {
    if (this.isGaFlow()) return false;
    const progress = this.progress();
    return (
      stepId === 'save' &&
      progress.completed.edit &&
      progress.activeStep === 'edit' &&
      this.canvas.blockWorkspaceForceEditStep()
    );
  }
}
