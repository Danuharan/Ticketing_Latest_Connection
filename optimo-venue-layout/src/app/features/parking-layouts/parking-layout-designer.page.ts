import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Subscription } from 'rxjs';

import { CanvasStageComponent } from '../layout-designer/components/canvas-stage/canvas-stage.component';
import { ParkingWorkspaceSidebarComponent } from '../layout-designer/components/parking-workspace-sidebar/parking-workspace-sidebar.component';
import { ParkingWorkspaceStepperComponent } from '../layout-designer/components/parking-workspace-stepper/parking-workspace-stepper.component';
import { ParkingAuditPanelComponent } from '../layout-designer/components/parking-audit-panel/parking-audit-panel.component';
import { isParkingArea } from '../layout-designer/models/layout-element.model';
import { LayoutCanvasService } from '../layout-designer/services/layout-canvas.service';
import { ParkingSlotDefaultsService } from '../layout-designer/services/parking-slot-defaults.service';
import { ParkingAuditService } from '../layout-designer/services/parking-audit.service';
import { BlueprintAnalyzerService } from '../layout-designer/services/blueprint-analyzer.service';
import { canvasSizeForImage } from '../layout-designer/lib/canvas-image';
import { fileToDataUrl } from '../layout-designer/lib/detect-blocks';
import type { OcrToken } from '../layout-designer/lib/assign-ocr-labels';
import {
  assignEdgeLengths,
  buildDetectedSlots,
  detectCellsAtPoints,
  detectParkingPlan,
  ensureOutlineContainsBays,
  parseDimensionTokens,
  rasterizeParkingPlanFile,
  resolveParkingPlanScale,
  suggestPlanName,
  type DetectedParkingBay,
  type DetectedParkingSlotPlacement,
  type ParkingPlanRaster,
} from '../layout-designer/lib/detect-parking-plan';
import {
  assignOcrCodesToCvPlacements,
  buildOcrSlotPlacements,
  clusterCodeLanes,
  codesToPseudoBays,
  mergeDetectedCellBays,
  outlineFromCodes,
  parseParkingSlotCodes,
} from '../layout-designer/lib/detect-parking-ocr';
import { parkingTemplateKeys } from '../venue-layouts/services/parking-template.keys';
import { ParkingTemplateService } from '../venue-layouts/services/parking-template.service';
import { ToastService } from '../../core/services/toast.service';

type PlanAiPhase = 'idle' | 'preview' | 'analyzing';

/**
 * Standalone parking-lot 2D editor — a separate canvas from the venue's stadium layout,
 * linked to it only via `venue_layout_template_id`. Reuses the same drawing tools
 * (ParkingWorkspaceSidebar/Stepper, CanvasStageComponent) as the embedded V1 workspace did,
 * just mounted as its own page instead of an overlay inside the stadium designer.
 */
@Component({
  selector: 'app-parking-layout-designer-page',
  imports: [
    FormsModule,
    CanvasStageComponent,
    ParkingWorkspaceSidebarComponent,
    ParkingWorkspaceStepperComponent,
    ParkingAuditPanelComponent,
  ],
  templateUrl: './parking-layout-designer.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block min-h-full',
  },
})
export class ParkingLayoutDesignerPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly parkingTemplates = inject(ParkingTemplateService);
  private readonly toast = inject(ToastService);
  private readonly queryClient = inject(QueryClient);
  private readonly analyzer = inject(BlueprintAnalyzerService);
  private readonly slotDefaults = inject(ParkingSlotDefaultsService);
  protected readonly canvas = inject(LayoutCanvasService);
  protected readonly parkingAudit = inject(ParkingAuditService);

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  private routeSub: Subscription | null = null;
  private venueId: string | null = null;
  private parkingId: string | null = null;

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly isSaving = signal(false);
  protected readonly isLoading = signal(false);
  protected readonly saveNotice = signal<string | null>(null);

  /** Save is allowed only when a name is filled (required for Supabase). */
  protected readonly canSave = computed(() => this.name().trim().length > 0);

  // --- AI plan detection: one shot — block + slots + labels together ---
  protected readonly planAiPhase = signal<PlanAiPhase>('idle');
  protected readonly planPreviewUrl = signal<string | null>(null);
  protected readonly planFileName = signal<string | null>(null);
  private planFile: File | null = null;

  /** Upload card is only offered while the canvas has no parking area yet. */
  protected readonly showPlanCard = computed(
    () => !this.isLoading() && this.canvas.parkingWorkspaceElement() == null,
  );

  protected onPlanFileChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.toast.error('Please choose an image file (PNG, JPG, or WEBP).');
      return;
    }
    this.revokePlanPreview();
    this.planFile = file;
    this.planFileName.set(file.name);
    this.planPreviewUrl.set(URL.createObjectURL(file));
    this.planAiPhase.set('preview');
  }

  protected removePlanImage(): void {
    this.revokePlanPreview();
    this.planFile = null;
    this.planFileName.set(null);
    this.planAiPhase.set('idle');
  }

  /**
   * Hybrid Browser CV + OCR (the stronger first-output path):
   * - CV: lot outline + stall cell geometry
   * - OCR: one slot per printed code (S1, T3…) with real labels
   * Falls back to CV-only bay packing when too few codes are readable.
   * Gemini Flash audits afterward (reuse existing verifyBlocks).
   */
  protected async analyzePlanImage(): Promise<void> {
    const file = this.planFile;
    if (!file || this.planAiPhase() === 'analyzing') {
      return;
    }
    this.planAiPhase.set('analyzing');
    this.parkingAudit.reset();
    try {
      const [raster, dataUrl, ocrTokens] = await Promise.all([
        rasterizeParkingPlanFile(file),
        fileToDataUrl(file),
        this.analyzer.fetchOcr(file).catch((): OcrToken[] => []),
      ]);

      this.canvas.setCanvasSize(canvasSizeForImage(raster.width, raster.height));
      this.canvas.setReferenceImage({ dataUrl, name: file.name, opacity: 0.55 });

      // Primary: Browser CV outline/cells + OCR codes for slots & names.
      if (this.analyzeWithOcrAndCv(raster, ocrTokens, file)) {
        this.finishPlanFlow();
        return;
      }

      // Fallback: CV-only when OCR found too few slot codes.
      if (this.analyzeWithLocalCv(raster, ocrTokens, file)) {
        this.finishPlanFlow();
      } else {
        this.planAiPhase.set('preview');
      }
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : 'Plan analysis failed.');
      this.planAiPhase.set('preview');
    }
  }

  /** Minimum readable slot codes before trusting the OCR+CV hybrid over CV-only. */
  private static readonly MIN_OCR_CODES = 6;

  /**
   * Browser CV + OCR hybrid: CV lot/bays + one slot per OCR code (real printed label).
   */
  private analyzeWithOcrAndCv(
    raster: ParkingPlanRaster,
    ocrTokens: OcrToken[],
    file: File,
  ): boolean {
    const codes = parseParkingSlotCodes(ocrTokens);
    if (codes.length < ParkingLayoutDesignerPage.MIN_OCR_CODES) {
      return false;
    }
    const carDefaults = this.slotDefaults.defaults().car;
    const { width, height } = raster;

    const cvDetection = detectParkingPlan(raster);
    const baseOutline = cvDetection?.outlinePct.length
      ? cvDetection.outlinePct
      : outlineFromCodes(codes, width, height);
    if (baseOutline.length < 3) {
      return false;
    }
    const dimensions = parseDimensionTokens(ocrTokens);
    const pseudoBays0: DetectedParkingBay[] = codesToPseudoBays(codes, width, height, null, carDefaults);
    const scale = resolveParkingPlanScale(
      { widthPx: width, heightPx: height, outlinePct: baseOutline, bays: pseudoBays0 },
      dimensions,
      carDefaults,
    );
    const ppm = scale ? scale.ppm : null;

    const pseudoBays: DetectedParkingBay[] = codesToPseudoBays(codes, width, height, ppm, carDefaults);
    const outline = ensureOutlineContainsBays(baseOutline, pseudoBays, width, height, raster);
    const finalOutline = outline.length >= 3 ? outline : baseOutline;

    const sideLengthsM = ppm
      ? assignEdgeLengths(finalOutline, width, height, ppm)
      : undefined;

    const id = this.canvas.applyDetectedParkingPlan({
      outlineCanvasPct: finalOutline,
      sideLengthsM,
    });
    if (!id) {
      return false;
    }

    const codeCells = detectCellsAtPoints(raster, codes);
    const bays = mergeDetectedCellBays(cvDetection?.bays ?? [], codeCells, width, height);
    const placements = buildOcrSlotPlacements(codes, ppm, width, height, carDefaults, bays);
    const placed = this.canvas.addDetectedParkingSlots(id, placements);

    if (!this.name().trim()) {
      const suggested = suggestPlanName(ocrTokens);
      if (suggested) {
        this.name.set(suggested);
      }
    }

    const laneCount = clusterCodeLanes(codes).size;
    const scaleNote = ppm
      ? scale?.source === 'ocr'
        ? 'measurements from the plan dimension labels'
        : 'sizes estimated from the plan geometry'
      : 'no scale found — measure the edges manually';
    const slotNote =
      placed && placed.slotCount > 0
        ? `${placed.slotCount} slots from plan codes (CV+OCR) in ${placed.laneIds.length} lanes, `
        : `${codes.length} codes in ${laneCount} lanes, `;
    this.toast.success(`Parking created with Browser CV + OCR — ${slotNote}${scaleNote}. Verifying…`);

    const placedLabels = new Set(placements.map((p) => p.label?.toUpperCase()).filter(Boolean));
    const uncovered = codes.filter((c) => !placedLabels.has(c.code));

    if (placed !== null && placed.slotCount > 0) {
      this.parkingAudit.start({
        file,
        elementId: id,
        ocrTokens,
        uncoveredCodes: uncovered,
      });
      return true;
    }
    return false;
  }

  /**
   * CV-only fallback when OCR found too few slot codes.
   */
  private analyzeWithLocalCv(
    raster: ParkingPlanRaster,
    ocrTokens: OcrToken[],
    file: File,
  ): boolean {
    const detection = detectParkingPlan(raster);
    if (!detection) {
      this.toast.error(
        'Could not detect a parking area in this image — draw the outline manually over it.',
      );
      return false;
    }

    const dimensions = parseDimensionTokens(ocrTokens);
    const carDefaults = this.slotDefaults.defaults().car;
    const scale = resolveParkingPlanScale(detection, dimensions, carDefaults);
    const sideLengthsM = scale
      ? assignEdgeLengths(detection.outlinePct, detection.widthPx, detection.heightPx, scale.ppm)
      : undefined;

    const id = this.canvas.applyDetectedParkingPlan({
      outlineCanvasPct: detection.outlinePct,
      sideLengthsM,
    });
    if (!id) {
      this.toast.error('Detected outline was too small to use — draw it manually.');
      return false;
    }

    let slots: DetectedParkingSlotPlacement[] = scale
      ? buildDetectedSlots(detection, scale.ppm, carDefaults)
      : [];
    const codes = parseParkingSlotCodes(ocrTokens);
    const labeled = assignOcrCodesToCvPlacements(slots, codes);
    slots = labeled.placements;
    const placed = slots.length > 0 ? this.canvas.addDetectedParkingSlots(id, slots) : null;

    if (!this.name().trim()) {
      const suggested = suggestPlanName(ocrTokens);
      if (suggested) {
        this.name.set(suggested);
      }
    }

    const scaleNote = !scale
      ? 'no scale found — measure the edges manually'
      : scale.source === 'ocr'
        ? 'measurements from the image dimension labels'
        : `measurements estimated from the default car slot width (${carDefaults.widthM} m)`;
    const slotNote =
      placed && placed.slotCount > 0
        ? `${placed.slotCount} slots in ${placed.laneIds.length} lanes, `
        : '';
    this.toast.success(`Parking created with browser CV (OCR fallback) — ${slotNote}${scaleNote}. Verifying…`);

    this.parkingAudit.start({
      file,
      elementId: id,
      ocrTokens,
      uncoveredCodes: labeled.uncovered,
    });
    return true;
  }

  private finishPlanFlow(): void {
    this.planAiPhase.set('idle');
    this.planFile = null;
    this.planFileName.set(null);
    this.revokePlanPreview();
  }

  private revokePlanPreview(): void {
    const url = this.planPreviewUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    this.planPreviewUrl.set(null);
  }

  ngOnInit(): void {
    this.routeSub = this.route.paramMap.subscribe((params) => {
      this.venueId = params.get('venueId');
      this.parkingId = params.get('parkingId');
      this.canvas.resetSession();
      this.finishPlanFlow();
      this.name.set('');
      this.description.set('');
      if (this.parkingId) {
        void this.loadExisting(this.parkingId);
      } else {
        this.canvas.enterParkingWorkspace();
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.revokePlanPreview();
    this.parkingAudit.reset();
  }

  private async loadExisting(id: string): Promise<void> {
    this.isLoading.set(true);
    try {
      const row = await this.parkingTemplates.getTemplateById(id);
      this.canvas.loadLayoutConfig(row.layout_config);
      this.name.set(row.name);
      this.description.set(row.description ?? '');
      const el = this.canvas.elements().find((item) => isParkingArea(item));
      if (el) {
        this.canvas.enterParkingWorkspaceForExisting(el.id);
      } else {
        this.canvas.enterParkingWorkspace();
      }
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : 'Could not load parking layout.');
    } finally {
      this.isLoading.set(false);
    }
  }

  protected async onSave(): Promise<void> {
    const name = this.name().trim();
    if (!name) {
      this.saveNotice.set('Name is required before saving.');
      this.toast.error('Enter a name for this parking layout before saving.');
      const input = this.nameInput()?.nativeElement;
      input?.focus();
      input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!this.venueId) {
      this.toast.error('Missing venue reference — cannot save.');
      return;
    }

    this.isSaving.set(true);
    this.saveNotice.set(null);

    try {
      const layoutConfig = this.canvas.exportLayoutConfig();

      if (this.parkingId) {
        await this.parkingTemplates.updateTemplate(this.parkingId, {
          name,
          description: this.description(),
          layoutConfig,
        });
      } else {
        await this.parkingTemplates.createTemplate({
          venueLayoutTemplateId: this.venueId,
          name,
          description: this.description(),
          layoutConfig,
        });
      }

      this.queryClient.invalidateQueries({ queryKey: parkingTemplateKeys.all });
      this.toast.success('Parking layout saved.');
      await this.router.navigate(['/venue-layouts']);
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : 'Could not save parking layout.');
    } finally {
      this.isSaving.set(false);
    }
  }

  protected async onBack(): Promise<void> {
    await this.router.navigate(['/venue-layouts']);
  }

  protected zoomIn(): void {
    this.canvas.zoomIn(10);
  }

  protected zoomOut(): void {
    this.canvas.zoomOut(10);
  }

  protected resetZoom(): void {
    this.canvas.resetZoomTo100();
  }
}
