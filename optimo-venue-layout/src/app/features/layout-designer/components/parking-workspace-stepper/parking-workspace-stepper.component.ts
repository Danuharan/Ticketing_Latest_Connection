import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { LayoutCanvasService, ParkingWorkspaceStepId } from '../../services/layout-canvas.service';

const PARKING_STEPS: { id: ParkingWorkspaceStepId; number: number; label: string }[] = [
  { id: 'draw-area', number: 1, label: 'Draw area' },
  { id: 'measure-edges', number: 2, label: 'Measure edges' },
  { id: 'draw-lines', number: 3, label: 'Add parking lines' },
  { id: 'save', number: 4, label: 'Save' },
];

type ParkingSlotPhase = 'access-points' | 'slots' | 'routes';
const PARKING_LINES_SUB_STEPS: { id: ParkingSlotPhase; number: number; label: string }[] = [
  { id: 'access-points', number: 1, label: 'Set enter & exit' },
  { id: 'slots', number: 2, label: 'Add slots' },
  { id: 'routes', number: 3, label: 'Add routes' },
];

@Component({
  selector: 'app-parking-workspace-stepper',
  templateUrl: './parking-workspace-stepper.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block-workspace-stepper',
  },
})
export class ParkingWorkspaceStepperComponent {
  protected readonly canvas = inject(LayoutCanvasService);

  protected readonly steps = PARKING_STEPS;
  protected readonly activeStep = computed(() => this.canvas.parkingWorkspaceStep());

  protected stepComplete(id: ParkingWorkspaceStepId): boolean {
    const order: ParkingWorkspaceStepId[] = ['draw-area', 'measure-edges', 'draw-lines', 'save'];
    return order.indexOf(id) < order.indexOf(this.activeStep());
  }

  protected stepActive(id: ParkingWorkspaceStepId): boolean {
    return this.activeStep() === id;
  }

  /** Sub-progress row for "Add parking lines" — shown directly below the main bar. */
  protected readonly showSubSteps = computed(() => this.activeStep() === 'draw-lines');
  protected readonly subSteps = PARKING_LINES_SUB_STEPS;

  protected subStepComplete(id: ParkingSlotPhase): boolean {
    const order: ParkingSlotPhase[] = ['access-points', 'slots', 'routes'];
    return order.indexOf(id) < order.indexOf(this.canvas.parkingSlotPhase());
  }

  protected subStepActive(id: ParkingSlotPhase): boolean {
    return this.canvas.parkingSlotPhase() === id;
  }
}
