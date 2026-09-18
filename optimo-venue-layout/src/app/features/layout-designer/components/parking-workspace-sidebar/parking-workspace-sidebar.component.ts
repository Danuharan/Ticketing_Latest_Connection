import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { LayoutCanvasService, PARKING_AREA_DRAFT_ID } from '../../services/layout-canvas.service';
import { ToastService } from '../../../../core/services/toast.service';
import { buildParkingEdgeSummaries } from '../../lib/parking-shape';
import { ParkingSlotPattern, VEHICLE_TYPE_STYLE } from '../../lib/parking-slots';
import { ParkingSlotDefaultsService } from '../../services/parking-slot-defaults.service';
import { ParkingAccessPointSpec, ParkingVehicleType } from '../../models/layout-element.model';

const VEHICLE_TYPES: ParkingVehicleType[] = ['car', 'bus', 'wheelchair', 'ev', 'bike'];
const PATTERNS: { id: ParkingSlotPattern; label: string }[] = [
  { id: 'single', label: 'Single-side' },
  { id: 'double', label: 'Double-side' },
  { id: 'angled', label: 'Angled' },
  { id: 'double-angled', label: 'Double-angled' },
  { id: 'one', label: 'One slot' },
];

interface ParkingLaneSummary {
  laneId: string;
  vehicleType: ParkingVehicleType;
  count: number;
}

@Component({
  selector: 'app-parking-workspace-sidebar',
  imports: [FormsModule],
  templateUrl: './parking-workspace-sidebar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block-workspace-sidebar',
  },
})
export class ParkingWorkspaceSidebarComponent {
  protected readonly canvas = inject(LayoutCanvasService);
  protected readonly slotDefaultsService = inject(ParkingSlotDefaultsService);
  private readonly toast = inject(ToastService);

  protected readonly vehicleTypes = VEHICLE_TYPES;
  protected readonly patterns = PATTERNS;
  protected readonly vehicleStyle = VEHICLE_TYPE_STYLE;

  protected readonly element = computed(() => this.canvas.parkingWorkspaceElement());
  protected readonly title = computed(() => this.element()?.name?.trim() || 'Parking Area');

  /** True while placing the very first outline, or redrawing an existing one. */
  protected readonly isDrawingArea = computed(() => {
    const drawingId = this.canvas.drawingElementId();
    if (!drawingId) {
      return false;
    }
    return drawingId === PARKING_AREA_DRAFT_ID || drawingId === this.element()?.id;
  });
  protected readonly draftPointCount = computed(() => this.canvas.draftPoints().length);

  protected readonly adjustEdges = computed(() => this.element()?.adjustEdges === true);

  protected readonly isMeasuringEdges = computed(() => this.canvas.parkingWorkspaceStep() === 'measure-edges');
  protected readonly measureEdgeIndex = computed(() => this.canvas.parkingMeasureEdgeIndex());
  protected readonly edges = computed(() => {
    const el = this.element();
    if (!el) {
      return [];
    }
    return buildParkingEdgeSummaries(el.customPoints ?? [], el.edgeBowAmounts ?? [], el.customSideLengthsM ?? []);
  });
  protected readonly measuredCount = computed(() => this.edges().filter((e) => e.lengthM != null).length);
  protected readonly allMeasured = computed(() => {
    const el = this.element();
    return !!el && this.canvas.allParkingEdgesMeasured(el.id);
  });

  readonly draftLengths = signal<Record<number, number | undefined>>({});

  /** True once past "measure edges" — the "Add parking lines" step (access points + slots) is active. */
  protected readonly isAddingLines = computed(() => !this.isDrawingArea() && !this.isMeasuringEdges() && !!this.element());
  protected readonly isAccessPointPhase = computed(
    () => this.isAddingLines() && this.canvas.parkingSlotPhase() === 'access-points',
  );
  protected readonly isSlotPhase = computed(
    () => this.isAddingLines() && this.canvas.parkingSlotPhase() === 'slots',
  );
  protected readonly isRoutePhase = computed(
    () => this.isAddingLines() && this.canvas.parkingSlotPhase() === 'routes',
  );

  // --- Phase A: Entrances & Exits ---
  protected readonly accessPoints = computed<ParkingAccessPointSpec[]>(() => this.element()?.parkingAccessPoints ?? []);
  protected readonly enterCount = computed(() => this.accessPoints().filter((p) => p.kind === 'enter').length);
  protected readonly exitCount = computed(() => this.accessPoints().filter((p) => p.kind === 'exit').length);
  protected readonly hasRequiredAccessPoints = computed(() => this.enterCount() > 0 && this.exitCount() > 0);
  protected readonly placingAccessPointKind = computed(() =>
    this.canvas.parkingAccessPlacementElementId() != null ? this.canvas.parkingAccessPlacementKind() : null,
  );

  protected startPlacingAccessPoint(kind: 'enter' | 'exit'): void {
    const el = this.element();
    if (el) {
      this.canvas.startParkingAccessPointPlacement(el.id, kind);
    }
  }

  protected cancelPlacingAccessPoint(): void {
    this.canvas.cancelParkingAccessPointPlacement();
  }

  protected removeAccessPoint(pointId: string): void {
    const el = this.element();
    if (el) {
      this.canvas.removeParkingAccessPoint(el.id, pointId);
    }
  }

  protected continueToSlots(): void {
    const el = this.element();
    if (!el) {
      return;
    }
    if (!this.canvas.proceedFromParkingAccessPoints(el.id)) {
      this.toast.error('Mark at least one Enter and one Exit first.');
    }
  }

  // --- Phase B: Vehicle slots ---
  protected readonly showDefaultsEditor = signal(false);
  protected readonly defaults = computed(() => this.slotDefaultsService.defaults());
  protected readonly selectedPattern = computed(() => this.canvas.parkingSlotDraftPattern());
  protected readonly isDrawingSlots = computed(() => this.canvas.parkingSlotDrawingElementId() != null);
  protected readonly slotDraftPointCount = computed(() => this.canvas.parkingSlotDraftPoints().length);
  protected readonly drawingVehicleType = computed(() => this.canvas.parkingSlotDraftVehicleType());
  protected readonly lanes = computed<ParkingLaneSummary[]>(() => {
    const slots = this.element()?.parkingSlots ?? [];
    const byLane = new Map<string, ParkingLaneSummary>();
    for (const slot of slots) {
      const existing = byLane.get(slot.laneId);
      if (existing) {
        existing.count += 1;
      } else {
        byLane.set(slot.laneId, { laneId: slot.laneId, vehicleType: slot.vehicleType, count: 1 });
      }
    }
    return [...byLane.values()];
  });

  protected toggleDefaultsEditor(): void {
    this.showDefaultsEditor.update((v) => !v);
  }

  protected updateDefaultLength(type: ParkingVehicleType, value: number): void {
    if (value > 0) {
      this.slotDefaultsService.update(type, { lengthM: value });
    }
  }

  protected updateDefaultWidth(type: ParkingVehicleType, value: number): void {
    if (value > 0) {
      this.slotDefaultsService.update(type, { widthM: value });
    }
  }

  protected updateDefaultAisle(type: ParkingVehicleType, value: number): void {
    if (value > 0) {
      this.slotDefaultsService.update(type, { aisleWidthM: value });
    }
  }

  protected resetDefault(type: ParkingVehicleType): void {
    this.slotDefaultsService.resetToBuiltIn(type);
  }

  protected setPattern(pattern: ParkingSlotPattern): void {
    this.canvas.parkingSlotDraftPattern.set(pattern);
  }

  protected startAddingSlots(type: ParkingVehicleType): void {
    const el = this.element();
    if (el) {
      this.canvas.startParkingSlotDrawing(el.id, type, this.selectedPattern());
    }
  }

  /** Minimum clicks before a lane can be finished — the 'one' stamp tool needs just one. */
  protected readonly minSlotDraftPoints = computed(() => (this.selectedPattern() === 'one' ? 1 : 2));

  protected finishAddingSlots(): void {
    if (this.slotDraftPointCount() < this.minSlotDraftPoints()) {
      return;
    }
    if (!this.canvas.finishParkingSlotDrawing()) {
      this.toast.error('No slots fit there — try a longer row further from the edges and gates.');
    }
  }

  protected cancelAddingSlots(): void {
    this.canvas.cancelParkingSlotDrawing();
  }

  protected removeLane(laneId: string): void {
    const el = this.element();
    if (el) {
      this.canvas.removeParkingSlotLane(el.id, laneId);
    }
  }

  // --- Custom-shape slot tool (dots → confirm → one slot) ---
  protected readonly isDrawingCustomSlot = computed(
    () => this.canvas.parkingCustomSlotDrawingElementId() != null,
  );
  protected readonly customSlotDraftPointCount = computed(
    () => this.canvas.parkingCustomSlotDraftPoints().length,
  );

  protected startDrawingCustomSlot(): void {
    const el = this.element();
    if (el) {
      this.canvas.startParkingCustomSlotDrawing(el.id);
    }
  }

  protected confirmCustomSlot(): void {
    if (this.customSlotDraftPointCount() < 3) {
      return;
    }
    if (!this.canvas.finishParkingCustomSlotDrawing()) {
      this.toast.error('Place at least 3 dots inside the parking area first.');
    }
  }

  protected cancelCustomSlot(): void {
    this.canvas.cancelParkingCustomSlotDrawing();
  }

  /** The individually selected slot (clicked on the canvas), for per-slot remove/adjust. */
  protected readonly selectedSlot = computed(() => {
    const id = this.canvas.selectedParkingSlotId();
    if (!id) {
      return null;
    }
    return (this.element()?.parkingSlots ?? []).find((s) => s.id === id) ?? null;
  });

  protected removeSelectedSlot(): void {
    const el = this.element();
    const slot = this.selectedSlot();
    if (el && slot) {
      this.canvas.removeParkingSlot(el.id, slot.id);
    }
  }

  protected deselectSlot(): void {
    this.canvas.selectParkingSlot(null);
  }

  // --- Phase C: Driving routes ---
  protected readonly isDrawingRoute = computed(() => this.canvas.parkingRouteDrawingElementId() != null);
  protected readonly routeDraftPointCount = computed(() => this.canvas.parkingRouteDraftPoints().length);
  protected readonly routes = computed(() => this.element()?.parkingRoutes ?? []);

  protected continueToRoutes(): void {
    this.canvas.proceedFromParkingSlots();
  }

  protected backToSlots(): void {
    this.canvas.backToParkingSlots();
  }

  protected startDrawingRoute(): void {
    const el = this.element();
    if (el) {
      this.canvas.startParkingRouteDrawing(el.id);
    }
  }

  protected finishDrawingRoute(): void {
    if (this.routeDraftPointCount() < 2) {
      return;
    }
    if (!this.canvas.finishParkingRouteDrawing()) {
      this.toast.error('Click at least 2 points inside the parking area first.');
    }
  }

  protected cancelDrawingRoute(): void {
    this.canvas.cancelParkingRouteDrawing();
  }

  protected removeRoute(routeId: string): void {
    const el = this.element();
    if (el) {
      this.canvas.removeParkingRoute(el.id, routeId);
    }
  }

  /** Emitted when the user clicks "Back to layout" — caller decides what that means (discard vs navigate). */
  readonly back = output<void>();
  /** Emitted when the user clicks "Save & back to layout" — caller persists and navigates away. */
  readonly save = output<void>();

  protected backToLayout(): void {
    this.back.emit();
  }

  protected startDrawingArea(): void {
    this.canvas.startParkingAreaDrawing();
  }

  protected cancelDrawingArea(): void {
    this.canvas.cancelDrawing();
  }

  protected finishDrawingArea(): void {
    if (this.draftPointCount() >= 3) {
      this.canvas.finishDrawing();
    }
  }

  protected redrawArea(): void {
    const el = this.element();
    if (el) {
      this.canvas.startParkingOutlineRedraw(el.id);
    }
  }

  protected toggleAdjustEdges(enabled: boolean): void {
    const el = this.element();
    if (el) {
      this.canvas.update(el.id, { adjustEdges: enabled });
    }
  }

  protected selectMeasureEdge(index: number): void {
    this.canvas.parkingSelectMeasureEdge(index);
  }

  protected setDraftLength(index: number, value: number): void {
    this.draftLengths.update((current) => ({ ...current, [index]: value }));
  }

  protected confirmEdgeLength(index: number): void {
    const el = this.element();
    if (!el) {
      return;
    }
    const lengthM = this.draftLengths()[index] ?? this.edges()[index]?.lengthM ?? undefined;
    if (!lengthM || lengthM <= 0) {
      this.toast.error('Enter a length in metres first.');
      return;
    }
    this.canvas.confirmParkingEdgeLength(el.id, index, lengthM);
  }

  protected continueToLines(): void {
    const el = this.element();
    if (!el) {
      return;
    }
    if (!this.canvas.proceedFromParkingMeasureEdges(el.id)) {
      this.toast.error('Measure every edge before continuing.');
    }
  }

  protected saveAndExit(): void {
    this.save.emit();
  }
}
