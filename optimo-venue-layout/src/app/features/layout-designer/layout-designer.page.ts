import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, HostListener, inject, OnDestroy, OnInit, signal, untracked, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { isInteractiveUiTarget } from './lib/interactive-ui-target';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { combineLatest, Subscription } from 'rxjs';

import { BlockWorkspaceSidebarComponent } from './components/block-workspace-sidebar/block-workspace-sidebar.component';
import { BlockWorkspaceStepperComponent } from './components/block-workspace-stepper/block-workspace-stepper.component';
import { BulkApplySeatingModalComponent } from './components/bulk-apply-seating-modal/bulk-apply-seating-modal.component';
import { DiningBackgroundAdjustComponent } from './components/dining-background-adjust/dining-background-adjust.component';
import { BlueprintAuditPanelComponent } from './components/blueprint-audit-panel/blueprint-audit-panel.component';
import { CanvasStageComponent } from './components/canvas-stage/canvas-stage.component';
import { ElementToolCardComponent } from './components/element-tool-card/element-tool-card.component';
import { InspectorPanelComponent } from './components/inspector-panel/inspector-panel.component';
import { LayersPanelComponent } from './components/layers-panel/layers-panel.component';
import { SeatingImportPanelComponent } from './components/seating-import-panel/seating-import-panel.component';
import { ToolIconComponent } from './components/tool-icon/tool-icon.component';
import { getElementsByCategory } from './data/element-registry';
import {
  assignOcrToBlocks,
  summarizeCvResult,
  type CvAnalysisResult,
  type OcrToken,
} from './lib/assign-ocr-labels';
import {
  buildDetectionParagraph,
  buildTierGroups,
  defaultTierEdits,
  MAX_AI_TIERS,
  venueTitleFromResult,
  type AiTierEdit,
} from './lib/ai-tier-groups';
import { cvToLayoutElements } from './lib/cv-to-layout';
import { canvasSizeForImage, loadImageDimensions } from './lib/canvas-image';
import {
  BLUEPRINT_IMAGE_SPEC,
  BLUEPRINT_IMAGE_SPEC_SUMMARY,
  BLUEPRINT_IMAGE_SPEC_TOOLTIP_LINES,
} from './lib/blueprint-image-spec';
import { detectBlocksFromFile, fileToDataUrl, dataUrlToFile } from './lib/detect-blocks';
import { fitLayoutGeometry } from './lib/fit-layout-geometry';
import { ElementDefinition } from './models/element-definition.model';
import { BlueprintAnalyzerService, BlueprintAnalysisError } from './services/blueprint-analyzer.service';
import { BlueprintAuditService } from './services/blueprint-audit.service';
import { LayoutCanvasService } from './services/layout-canvas.service';
import { LayoutDesignerDraft, LayoutDraftService } from './services/layout-draft.service';
import { venueTemplateKeys } from '../venue-layouts/services/venue-template.keys';
import { VenueTemplateService } from '../venue-layouts/services/venue-template.service';
import { parkingTemplateKeys } from '../venue-layouts/services/parking-template.keys';
import { ParkingTemplateService } from '../venue-layouts/services/parking-template.service';
import { LayoutPreviewComponent } from '../venue-layouts/components/layout-preview/layout-preview.component';
import { ParkingLayoutTemplateSummary } from '../../core/models/parking-layout-template.model';
import { ToastService } from '../../core/services/toast.service';

type ParkingDeleteUiState = 'idle' | 'confirm' | 'deleting';

type AiPhase = 'idle' | 'preview' | 'analyzing' | 'result' | 'error';

interface StartOption {
  id: 'ai' | 'upload' | 'manual' | 'parking';
  title: string;
  description: string;
  badge?: string;
  featured?: boolean;
}

type StartPanel = 'chooser' | 'ai' | 'upload';

@Component({
  selector: 'app-layout-designer-page',
  imports: [
    DecimalPipe,
    FormsModule,
    ElementToolCardComponent,
    ToolIconComponent,
    CanvasStageComponent,
    InspectorPanelComponent,
    LayersPanelComponent,
    BlockWorkspaceSidebarComponent,
    BlockWorkspaceStepperComponent,
    BulkApplySeatingModalComponent,
    DiningBackgroundAdjustComponent,
    SeatingImportPanelComponent,
    BlueprintAuditPanelComponent,
    LayoutPreviewComponent,
  ],
  templateUrl: './layout-designer.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block min-h-full',
  },
})
export class LayoutDesignerPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly templates = inject(VenueTemplateService);
  private readonly parkingTemplates = inject(ParkingTemplateService);
  private readonly toast = inject(ToastService);
  private readonly analyzer = inject(BlueprintAnalyzerService);

  protected readonly canvas = inject(LayoutCanvasService);
  protected readonly audit = inject(BlueprintAuditService);
  private readonly drafts = inject(LayoutDraftService);
  private readonly queryClient = inject(QueryClient);

  private draftReady = false;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private newSessionId: string | null = null;
  private zoomHoldTimer: ReturnType<typeof setInterval> | null = null;
  private zoomHoldDelayTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      if (!this.draftReady) {
        return;
      }
      this.templateId();
      this.templateName();
      this.description();
      this.canvas.elements();
      this.canvas.referenceImage();
      this.canvas.zoom();
      this.canvas.cameraX();
      this.canvas.cameraY();
      this.canvas.selectedId();
      this.canvas.blockWorkspaceId();
      this.scheduleDraftSave();
    });

    effect(() => {
      if (!this.inAutoFillLayout() && !this.inBlockWorkspace()) {
        return;
      }
      queueMicrotask(() => this.scrollWorkplaceToTop());
    });

    effect(() => {
      const inWorkspace = Boolean(this.canvas.blockWorkspaceId());
      untracked(() => this.syncBlockWorkspaceHistory(inWorkspace));
    });
  }

  /**
   * The block workspace is a view state on the same route, so on its own the
   * browser Back arrow would leave the whole designer. Mirror it with one
   * history entry: entering pushes, leaving pops, and a popped entry exits.
   */
  private blockWorkspaceHistoryPushed = false;
  private ignoreHistoryPops = 0;

  private syncBlockWorkspaceHistory(inWorkspace: boolean): void {
    if (typeof window === 'undefined') {
      return;
    }
    if (inWorkspace && !this.blockWorkspaceHistoryPushed) {
      this.blockWorkspaceHistoryPushed = true;
      window.history.pushState(
        { ...(window.history.state ?? {}), ovlBlockWorkspace: true },
        '',
      );
    } else if (!inWorkspace && this.blockWorkspaceHistoryPushed) {
      this.blockWorkspaceHistoryPushed = false;
      this.ignoreHistoryPops += 1;
      window.history.back();
    }
  }

  @HostListener('window:popstate')
  protected onHistoryPop(): void {
    if (this.ignoreHistoryPops > 0) {
      this.ignoreHistoryPops -= 1;
      return;
    }
    if (this.canvas.blockWorkspaceId()) {
      this.blockWorkspaceHistoryPushed = false;
      this.canvas.exitBlockWorkspace();
    }
  }

  private readonly host = inject(ElementRef<HTMLElement>);

  private readonly templateNameInput = viewChild<ElementRef<HTMLInputElement>>('templateNameInput');

  protected readonly focusElements = getElementsByCategory('focus');
  protected readonly annotationElements = getElementsByCategory('annotation');

  protected readonly templateId = signal<string | null>(null);
  protected readonly templateName = signal('');
  protected readonly description = signal('');
  protected readonly isSaving = signal(false);
  /** True while the template JSON is downloading from Supabase. */
  protected readonly isFetchingTemplate = signal(false);
  /** True while the canvas is hydrating after data arrives (overlay on canvas only). */
  protected readonly isCanvasBootstrapping = signal(false);
  /** Blocks save until fetch + first canvas paint complete. */
  protected readonly isTemplateBusy = computed(
    () => this.isFetchingTemplate() || this.isCanvasBootstrapping() || this.isSeatHydrating(),
  );
  protected readonly isSeatHydrating = computed(
    () => this.canvas.seatHydrationPhase() !== 'complete',
  );
  protected readonly showCanvasLoadingOverlay = computed(
    () =>
      this.isFetchingTemplate() ||
      this.isCanvasBootstrapping() ||
      (this.isSeatHydrating() && !this.canvas.seatHydrationSilent()),
  );
  protected readonly seatHydrationProgress = computed(() => this.canvas.seatHydrationProgress());
  protected readonly saveNotice = signal<string | null>(null);
  protected readonly leaveDialogOpen = signal(false);

  /** Save is allowed only when template name is filled (required for Supabase). */
  protected readonly canSave = computed(() => this.templateName().trim().length > 0);

  /** Parking layouts link to a saved venue via FK — only offer it once this venue has an id. */
  protected readonly canAddParking = computed(() => Boolean(this.templateId()));

  protected goToParkingLayout(): void {
    const id = this.templateId();
    if (!id) {
      this.notice.set('Save this layout as a template first, then you can add a parking layout.');
      return;
    }
    this.notice.set(null);
    void this.router.navigate(['/venue-layouts', id, 'parking', 'new']);
  }

  // --- Parking layouts linked to this venue (shown at the bottom of the page) ---

  protected readonly parkingLayouts = signal<ParkingLayoutTemplateSummary[]>([]);
  protected readonly parkingLayoutsLoading = signal(false);
  protected readonly parkingDeleteUi = signal<Record<string, ParkingDeleteUiState>>({});

  private async loadParkingLayouts(venueId: string): Promise<void> {
    this.parkingLayoutsLoading.set(true);
    try {
      const list = await this.queryClient.fetchQuery({
        queryKey: parkingTemplateKeys.listForVenue(venueId),
        queryFn: () => this.parkingTemplates.listForVenue(venueId),
      });
      this.parkingLayouts.set(list);
    } catch (error) {
      this.toast.error(error instanceof Error ? error.message : 'Failed to load parking layouts.');
    } finally {
      this.parkingLayoutsLoading.set(false);
    }
  }

  protected editParkingLayout(parkingId: string): void {
    const venueId = this.templateId();
    if (!venueId) {
      return;
    }
    void this.router.navigate(['/venue-layouts', venueId, 'parking', parkingId, 'edit']);
  }

  protected onDeleteParkingClick(id: string, name: string): void {
    const state = this.parkingDeleteUi()[id] ?? 'idle';
    if (state === 'idle') {
      this.parkingDeleteUi.update((map) => ({ ...map, [id]: 'confirm' }));
      return;
    }
    if (state === 'confirm') {
      void this.performDeleteParking(id, name);
    }
  }

  protected parkingDeleteLabel(id: string): string {
    switch (this.parkingDeleteUi()[id]) {
      case 'confirm':
        return 'Confirm delete?';
      case 'deleting':
        return 'Deleting…';
      default:
        return 'Delete';
    }
  }

  protected isParkingDeleteConfirm(id: string): boolean {
    return this.parkingDeleteUi()[id] === 'confirm';
  }

  protected isParkingDeleteBusy(id: string): boolean {
    return this.parkingDeleteUi()[id] === 'deleting';
  }

  private async performDeleteParking(id: string, name: string): Promise<void> {
    this.parkingDeleteUi.update((map) => ({ ...map, [id]: 'deleting' }));
    try {
      await this.parkingTemplates.deleteTemplate(id);
      this.parkingLayouts.update((list) => list.filter((p) => p.id !== id));
      this.clearParkingDeleteState(id);
      this.queryClient.invalidateQueries({ queryKey: parkingTemplateKeys.listMine() });
      this.toast.success(`"${name}" deleted successfully.`);
    } catch (error) {
      this.clearParkingDeleteState(id);
      this.toast.error(error instanceof Error ? error.message : 'Failed to delete parking layout.');
    }
  }

  private clearParkingDeleteState(id: string): void {
    this.parkingDeleteUi.update((map) => {
      const next = { ...map };
      delete next[id];
      return next;
    });
  }

  /** True when leaving would discard canvas work or unsaved metadata. */
  protected readonly hasDesignWork = computed(() => {
    if (!this.draftReady) {
      return false;
    }
    return this.drafts.hasMeaningfulContent({
      version: 1,
      templateId: this.templateId(),
      templateName: this.templateName(),
      description: this.description(),
      layoutConfig: this.canvas.exportLayoutConfig(),
      zoom: this.canvas.zoom(),
      cameraX: this.canvas.cameraX(),
      cameraY: this.canvas.cameraY(),
      selectedId: this.canvas.selectedId(),
      blockWorkspaceId: this.canvas.blockWorkspaceId(),
      savedAt: '',
    });
  });

  protected readonly startOptions: StartOption[] = [
    {
      id: 'ai',
      title: 'AI Layout Detection',
      description: 'Upload a stadium blueprint — AI detects tiers, blocks, and seat counts automatically.',
      featured: true,
    },
    {
      id: 'upload',
      title: 'Upload Image / Blueprint',
      description: 'Use a floor plan, seating chart, or blueprint as a guide and draw on top of it.',
    },
    {
      id: 'manual',
      title: 'Create My Own Design',
      description: 'Start with the designer tools and build the venue layout yourself.',
    },
    {
      id: 'parking',
      title: 'Add Parking',
      description: 'Design a parking lot as its own separate 2D layout, linked to this venue.',
    },
  ];

  protected readonly notice = signal<string | null>(null);
  protected readonly activePanel = signal<StartPanel>('chooser');

  // --- AI Layout Detection state ---
  protected readonly aiPhase = signal<AiPhase>('idle');
  protected readonly aiError = signal<string | null>(null);
  protected readonly aiFileName = signal<string | null>(null);
  protected readonly aiPreviewUrl = signal<string | null>(null);
  protected readonly aiIncludeSeats = signal(true);
  protected readonly aiResult = signal<CvAnalysisResult | null>(null);
  protected readonly aiCenterpieceName = signal('Pitch');
  protected readonly aiCenterpieceShape = signal<'rectangle' | 'oval' | 'circle'>('rectangle');
  protected readonly aiTierEdits = signal<Record<number, AiTierEdit>>({});
  protected readonly aiManualTierRings = signal<number[]>([]);
  protected readonly blueprintImageSpec = BLUEPRINT_IMAGE_SPEC;
  protected readonly blueprintImageSpecSummary = BLUEPRINT_IMAGE_SPEC_SUMMARY;
  protected readonly blueprintImageSpecTooltip = BLUEPRINT_IMAGE_SPEC_TOOLTIP_LINES;
  /** The image awaiting analysis once the user confirms in the preview step. */
  private aiFile: File | null = null;
  private aiManualRingCounter = 1000;

  protected readonly maxAiTiers = MAX_AI_TIERS;

  protected readonly aiTierGroups = computed(() => {
    const result = this.aiResult();
    if (!result) {
      return [];
    }
    return buildTierGroups(result, this.aiTierEdits(), this.aiManualTierRings());
  });

  protected readonly aiVenueTitle = computed(() => {
    const result = this.aiResult();
    return result ? venueTitleFromResult(result) : '';
  });

  protected readonly aiDetectionParagraph = computed(() => {
    const result = this.aiResult();
    return result ? buildDetectionParagraph(result) : '';
  });

  protected readonly aiSummary = computed(() => {
    const result = this.aiResult();
    return result ? summarizeCvResult(result) : null;
  });

  protected readonly referenceFileName = signal<string | null>(null);

  protected readonly hasReferenceOnCanvas = computed(() => Boolean(this.canvas.referenceImage()));

  protected readonly inBlockWorkspace = computed(() => Boolean(this.canvas.blockWorkspaceId()));

  /** Main 2D layout with compact chrome — both side rails visible beside the canvas. */
  protected readonly inAutoFillLayout = computed(
    () => this.canvas.autoFillLayoutMode() && !this.inBlockWorkspace(),
  );

  private routeSub: Subscription | null = null;

  ngOnInit(): void {
    this.routeSub = combineLatest([this.route.paramMap, this.route.queryParamMap]).subscribe(
      ([params, query]) => {
        const id = params.get('id');
        if (id) {
          this.newSessionId = null;
          this.isFetchingTemplate.set(true);
          const cached = this.queryClient.getQueryData<{ name: string; description?: string | null }>(
            venueTemplateKeys.detail(id),
          );
          if (cached) {
            this.templateName.set(cached.name);
            this.description.set(cached.description ?? '');
          }
          void this.loadTemplate(id);
          return;
        }

        const sessionKey = query.get('t');
        if (!sessionKey) {
          void this.router.navigate(['/venue-layouts/new'], {
            queryParams: { t: Date.now().toString() },
            replaceUrl: true,
          });
          return;
        }

        this.newSessionId = sessionKey;
        this.beginNewLayout(sessionKey);
      },
    );
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
    }
    this.stopZoomHold();
  }

  @HostListener('window:pointerup')
  @HostListener('window:pointercancel')
  protected onWindowPointerUp(): void {
    this.stopZoomHold();
  }

  protected onZoomButtonDown(direction: 'in' | 'out', event: PointerEvent): void {
    event.preventDefault();
    const target = event.currentTarget;
    if (target instanceof HTMLElement && target.setPointerCapture) {
      target.setPointerCapture(event.pointerId);
    }
    this.applyZoomStep(direction, 10);
    this.stopZoomHold();
    this.zoomHoldDelayTimer = setTimeout(() => {
      this.zoomHoldTimer = setInterval(() => this.applyZoomStep(direction, 3), 70);
    }, 320);
  }

  protected onZoomButtonUp(event: PointerEvent): void {
    const target = event.currentTarget;
    if (target instanceof HTMLElement && target.releasePointerCapture) {
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer may already be released.
      }
    }
    this.stopZoomHold();
  }

  protected resetZoomToDefault(): void {
    this.canvas.resetZoomTo100();
  }

  protected runAutoFillSeating(): void {
    this.canvas.applyAutoFillToSelectedBlocks();
  }

  private applyZoomStep(direction: 'in' | 'out', step: number): void {
    if (direction === 'in') {
      this.canvas.zoomIn(step);
    } else {
      this.canvas.zoomOut(step);
    }
  }

  private stopZoomHold(): void {
    if (this.zoomHoldDelayTimer) {
      clearTimeout(this.zoomHoldDelayTimer);
      this.zoomHoldDelayTimer = null;
    }
    if (this.zoomHoldTimer) {
      clearInterval(this.zoomHoldTimer);
      this.zoomHoldTimer = null;
    }
  }

  /** Auto Fill workplace opens at the top so the inspector Auto Fill action is in view. */
  private scrollWorkplaceToTop(): void {
    const page = this.host.nativeElement.querySelector('.designer-page') as HTMLElement | null;
    (page ?? this.host.nativeElement).scrollIntoView({ block: 'start' });

    let node: HTMLElement | null = this.host.nativeElement.parentElement;
    while (node) {
      const { overflowY } = getComputedStyle(node);
      if (overflowY === 'auto' || overflowY === 'scroll') {
        node.scrollTop = 0;
      }
      node = node.parentElement;
    }
  }

  @HostListener('window:beforeunload', ['$event'])
  @HostListener('window:pagehide')
  protected onBeforeUnload(event?: BeforeUnloadEvent): void {
    // Flush debounced draft immediately so refresh keeps the latest canvas.
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
      this.draftTimer = null;
    }
    if (this.draftReady) {
      this.persistDraft();
    }
    if (!event || !this.hasDesignWork()) {
      return;
    }
    event.preventDefault();
    event.returnValue = '';
  }

  @HostListener('document:keydown', ['$event'])
  protected onDocumentKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.leaveDialogOpen()) {
      event.preventDefault();
      this.closeLeaveDialog();
      return;
    }
    if (event.key !== 'Escape' || !this.inBlockWorkspace()) {
      return;
    }
    if (isInteractiveUiTarget(event.target)) {
      return;
    }
    event.preventDefault();
    this.canvas.exitBlockWorkspace();
  }

  protected confirmBack(): void {
    if (this.inBlockWorkspace()) {
      this.canvas.exitBlockWorkspace();
      return;
    }
    if (this.hasDesignWork()) {
      this.leaveDialogOpen.set(true);
      return;
    }
    void this.navigateBack();
  }

  protected closeLeaveDialog(): void {
    this.leaveDialogOpen.set(false);
  }

  protected confirmLeave(): void {
    this.leaveDialogOpen.set(false);
    void this.navigateBack();
  }

  private async navigateBack(): Promise<void> {
    if (this.newSessionId) {
      this.drafts.clear(this.drafts.storageKey(null, this.newSessionId));
    }
    const id = this.templateId();
    if (id) {
      this.drafts.clear(this.drafts.storageKey(id));
    }
    this.drafts.clearLegacyNewDraft();
    this.drafts.clearActiveKey();
    this.canvas.completeSeatHydration();
    this.canvas.resetSession();
    await this.router.navigate(['/venue-layouts']);
  }

  protected selectStartOption(option: StartOption): void {
    if (option.id === 'manual') {
      this.notice.set('Pick an element below to start placing it on the canvas.');
      return;
    }
    if (option.id === 'parking') {
      this.goToParkingLayout();
      return;
    }

    this.notice.set(null);
    this.activePanel.set(option.id);
  }

  protected backToStartChooser(): void {
    this.activePanel.set('chooser');
    this.notice.set(null);
    this.resetAi();
  }

  protected onElementSelect(definition: ElementDefinition): void {
    this.canvas.addTool(definition.id);
    this.notice.set(null);
  }

  protected onFileChosen(event: Event, kind: 'ai' | 'reference' | 'background'): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    if (kind === 'ai') {
      this.selectAiImage(file);
      return;
    }

    if (kind === 'reference') {
      void this.uploadReferenceImage(file);
      return;
    }

    this.notice.set(`Customer background: ${file.name} — coming soon`);
  }

  private async uploadReferenceImage(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      this.toast.error('Please choose an image file (PNG, JPG, WEBP, or SVG).');
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      let nextCanvas = this.canvas.canvas();
      try {
        const dimensions = await loadImageDimensions(dataUrl);
        nextCanvas = canvasSizeForImage(dimensions.width, dimensions.height);
      } catch {
        // Keep current canvas size when dimensions cannot be read.
      }
      this.canvas.setCanvasSize(nextCanvas);
      this.canvas.setReferenceImage({ dataUrl, name: file.name });
      this.referenceFileName.set(file.name);
      this.notice.set(
        'Reference chart uploaded — turn on Trace mode, then click coloured blocks on the blueprint.',
      );
      this.toast.success(`Reference chart loaded: ${file.name}`);
      void this.cacheBlueprintOcr(file);
    } catch {
      this.toast.error('Could not read the image file.');
    }
  }

  private async cacheBlueprintOcr(file: File): Promise<void> {
    try {
      const tokens = await this.analyzer.fetchOcr(file);
      this.canvas.setReferenceOcrTokens(tokens);
    } catch {
      this.canvas.setReferenceOcrTokens([]);
    }
  }

  private async cacheOcrFromReferenceConfig(
    ref: { dataUrl?: string; name?: string } | undefined,
  ): Promise<void> {
    const dataUrl = ref?.dataUrl;
    if (!dataUrl) {
      return;
    }
    try {
      const file = await dataUrlToFile(dataUrl, ref?.name ?? 'chart.png');
      const tokens = await this.analyzer.fetchOcr(file);
      this.canvas.setReferenceOcrTokens(tokens);
    } catch {
      this.canvas.setReferenceOcrTokens([]);
    }
  }

  protected startDesigningFromUploadedImage(): void {
    this.canvas.startFromUploadedImage();
    this.activePanel.set('chooser');
    this.notice.set(
      'Turn on Trace mode below, then click each coloured block on the blueprint to create a 2D shape.',
    );
    this.toast.success('Canvas cleared — enable Trace mode to trace blocks on your blueprint.');
  }

  protected toggleTraceMode(): void {
    if (this.isDrawDotsMode()) {
      this.canvas.cancelDrawing();
    }
    this.canvas.toggleColorDetectMode();
    const on = this.canvas.colorDetectMode();
    this.notice.set(
      on
        ? 'Trace mode on — click coloured sections on the blueprint.'
        : 'Trace mode off — normal selection.',
    );
  }

  protected readonly isDrawDotsMode = computed(
    () => this.canvas.drawingElementId() === '__draft__',
  );

  protected toggleDrawDotsMode(): void {
    if (this.isDrawDotsMode()) {
      this.canvas.cancelDrawing();
      this.notice.set('Draw dots off — normal selection.');
      return;
    }
    this.canvas.colorDetectMode.set(false);
    this.canvas.traceTargetRect.set(null);
    this.canvas.startCustomPieceDrawing();
    this.notice.set(
      'Draw dots on — click the canvas to place points around a block, then press Complete.',
    );
  }

  protected clearReferenceImage(): void {
    this.canvas.setReferenceImage(null);
    this.referenceFileName.set(null);
    this.canvas.colorDetectMode.set(false);
    this.canvas.setReferenceOcrTokens([]);
    this.notice.set(null);
    this.toast.success('Reference chart removed.');
  }

  /** Step 1 — show a preview of the chosen image; analysis waits for confirmation. */
  private selectAiImage(file: File): void {
    if (!file.type.startsWith('image/')) {
      this.aiError.set('Please choose an image file (PNG, JPG, or WEBP).');
      this.aiPhase.set('error');
      return;
    }
    this.revokeAiPreview();
    this.aiFile = file;
    this.aiFileName.set(file.name);
    this.aiPreviewUrl.set(URL.createObjectURL(file));
    this.aiResult.set(null);
    this.aiError.set(null);
    this.aiPhase.set('preview');
  }

  /** Step 2 — user confirmed in the preview; run the analysis. */
  protected startAiAnalysis(): void {
    if (this.aiFile) {
      void this.analyzeBlueprint(this.aiFile);
    }
  }

  /** Runs client CV + server OCR in parallel, then merges labels onto block polygons. */
  private async analyzeBlueprint(file: File): Promise<void> {
    this.aiPhase.set('analyzing');
    this.aiError.set(null);
    this.aiResult.set(null);
    this.aiFileName.set(file.name);

    try {
      const [detection, ocrResult] = await Promise.all([
        detectBlocksFromFile(file, this.canvas.colorDetectTolerance()),
        this.analyzer.fetchOcr(file).then(
          (tokens) => ({ tokens, error: null as string | null }),
          (error: unknown) => ({
            tokens: [] as OcrToken[],
            error:
              error instanceof BlueprintAnalysisError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : 'OCR failed.',
          }),
        ),
      ]);
      const ocrTokens = ocrResult.tokens;

      if (detection.blocks.length < 3) {
        throw new BlueprintAnalysisError(
          'Could not detect enough seating blocks. Try a clearer chart with visible coloured sections and white borders.',
        );
      }

      const merged = assignOcrToBlocks(detection, ocrTokens);
      this.canvas.setReferenceOcrTokens(ocrTokens);
      const ringIndices = [...new Set(merged.labeledBlocks.map((b) => b.ringIndex))];
      this.aiManualTierRings.set([]);
      this.aiTierEdits.set(defaultTierEdits(ringIndices));
      if (merged.pitch) {
        if (merged.pitch.name) {
          this.aiCenterpieceName.set(merged.pitch.name);
        }
        this.aiCenterpieceShape.set(merged.pitch.detectedShape);
      }
      this.aiResult.set(merged);
      this.aiPhase.set('result');
      if (ocrResult.error) {
        this.toast.show(`Block shapes detected, but OCR labels failed: ${ocrResult.error}`, 'info', 7000);
      } else if (ocrTokens.length === 0) {
        this.toast.show(
          'Block shapes detected, but Azure OCR returned no text. Check the analyze-blueprint function and Azure secrets.',
          'info',
          7000,
        );
      } else if (merged.labeledCount === 0) {
        this.toast.show(
          `OCR read ${ocrTokens.length} text tokens, but none matched the detected block shapes.`,
          'info',
          7000,
        );
      }
    } catch (error) {
      const message =
        error instanceof BlueprintAnalysisError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'AI analysis failed.';
      this.aiError.set(message);
      this.aiPhase.set('error');
    }
  }

  /** Applies detected block polygons + background image to the canvas. */
  protected async applyAiResult(): Promise<void> {
    const result = this.aiResult();
    const file = this.aiFile;
    if (!result || !file) {
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    this.referenceFileName.set(file.name);
    let nextCanvas = this.canvas.canvas();
    try {
      const dimensions = await loadImageDimensions(dataUrl);
      nextCanvas = canvasSizeForImage(dimensions.width, dimensions.height);
    } catch {
      // Keep current canvas size when dimensions cannot be read.
    }
    this.canvas.setCanvasSize(nextCanvas);
    const { elements, blockElementIds } = cvToLayoutElements(result, {
      centerpieceName: this.aiCenterpieceName(),
      centerpieceShape: this.aiCenterpieceShape(),
      tierEdits: this.aiTierEdits(),
    });
    const geometryScale = fitLayoutGeometry(elements);
    this.canvas.setReferenceImage({
      dataUrl,
      name: file.name,
      geometryScale,
      opacity: 0.55,
    });
    this.canvas.applyGeneratedElements(elements);
    this.toast.success(
      `Applied ${elements.length} elements (${result.labeledCount} labelled blocks) on the chart.`,
    );
    this.audit.start({ file, detection: result, blockElementIds });
    this.resetAi();
    this.activePanel.set('chooser');
    this.notice.set(
      'Layout applied — turn on Trace mode to add any missing blocks from the blueprint.',
    );
    // Persist immediately — don't wait for the 500ms debounce before a refresh.
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
      this.draftTimer = null;
    }
    this.persistDraft();
  }

  protected addAiTier(): void {
    if (this.aiTierGroups().length >= MAX_AI_TIERS) {
      return;
    }
    const ringIndex = this.aiManualRingCounter++;
    const tierNum = this.aiTierGroups().length + 1;
    this.aiManualTierRings.update((rings) => [...rings, ringIndex]);
    this.updateTierEdit(ringIndex, {
      name: `Tier ${tierNum}`,
      tierCode: `T${tierNum}`,
    });
  }

  protected reAnalyze(): void {
    if (this.aiFile) {
      void this.analyzeBlueprint(this.aiFile);
    }
  }

  protected updateTierEdit(ringIndex: number, patch: Partial<AiTierEdit>): void {
    this.aiTierEdits.update((edits) => ({
      ...edits,
      [ringIndex]: {
        name: edits[ringIndex]?.name ?? `Tier ${ringIndex + 1}`,
        tierCode: edits[ringIndex]?.tierCode ?? `T${ringIndex + 1}`,
        ...patch,
      },
    }));
  }

  protected resetAi(): void {
    this.revokeAiPreview();
    this.aiFile = null;
    this.aiPhase.set('idle');
    this.aiError.set(null);
    this.aiResult.set(null);
    this.aiFileName.set(null);
    this.aiTierEdits.set({});
    this.aiManualTierRings.set([]);
    this.aiCenterpieceName.set('Pitch');
  }

  /** Clears the uploaded preview image and returns to the drop zone. */
  protected removeAiImage(): void {
    this.resetAi();
    this.toast.success('Image removed.');
  }

  /** Removes the seating chart background from the canvas (keeps block overlays). */
  protected removeCanvasReferenceImage(): void {
    this.canvas.setReferenceImage(null);
    this.referenceFileName.set(null);
    this.canvas.colorDetectMode.set(false);
    this.toast.success('Background chart removed from canvas.');
  }

  private revokeAiPreview(): void {
    const url = this.aiPreviewUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    this.aiPreviewUrl.set(null);
  }

  /**
   * Auto Fill inspector Save — lock seats, write layout (with seats) to Supabase,
   * and keep the draft so refresh restores the same seats.
   */
  protected async saveAutoFillLayout(): Promise<void> {
    const commit = this.canvas.saveAutoFillSeatedBlocks();
    if (!commit) {
      this.toast.error(this.canvas.autoFillError() ?? 'Auto Fill seats first, then save.');
      return;
    }

    const name = this.templateName().trim();
    if (!name) {
      this.persistDraft();
      this.toast.success(
        `Saved ${commit.totalSeats} seats on this layout. Enter a template name at the top, then use Save as template to store in the library.`,
      );
      const input = this.templateNameInput()?.nativeElement;
      input?.focus({ preventScroll: true });
      if (!this.inBlockWorkspace()) {
        input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    this.isSaving.set(true);
    this.saveNotice.set(null);

    try {
      const layoutConfig = this.canvas.exportLayoutConfig();
      const id = this.templateId();

      if (id) {
        await this.templates.updateTemplate(id, {
          name,
          description: this.description(),
          layoutConfig,
        });
        this.drafts.clear(this.drafts.storageKey(id));
        this.queryClient.invalidateQueries({ queryKey: venueTemplateKeys.list() });
        this.queryClient.invalidateQueries({ queryKey: venueTemplateKeys.detail(id) });
        this.toast.success(
          `Saved ${commit.totalSeats} seats across ${commit.savedCount} block${commit.savedCount === 1 ? '' : 's'} to the template.`,
        );
      } else {
        const newId = await this.templates.createTemplate({
          name,
          description: this.description(),
          layoutConfig,
        });
        if (this.newSessionId) {
          this.drafts.clear(this.drafts.storageKey(null, this.newSessionId));
        }
        this.drafts.clearLegacyNewDraft();
        this.templateId.set(newId);
        this.newSessionId = null;
        await this.router.navigate(['/venue-layouts', newId, 'edit'], { replaceUrl: true });
        this.queryClient.invalidateQueries({ queryKey: venueTemplateKeys.list() });
        this.queryClient.invalidateQueries({ queryKey: venueTemplateKeys.detail(newId) });
        this.toast.success(
          `Saved ${commit.totalSeats} seats across ${commit.savedCount} block${commit.savedCount === 1 ? '' : 's'} to your template library.`,
        );
      }
      this.persistDraft();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Save failed.';
      this.saveNotice.set(msg);
      this.toast.error(msg);
      this.persistDraft();
    } finally {
      this.isSaving.set(false);
    }
  }

  protected async saveTemplate(): Promise<void> {
    const name = this.templateName().trim();
    if (!name) {
      this.saveNotice.set('Template name is required before saving.');
      this.toast.error('Enter a template name at the top before saving.');
      const input = this.templateNameInput()?.nativeElement;
      input?.focus({ preventScroll: true });
      if (!this.inBlockWorkspace()) {
        input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    this.isSaving.set(true);
    this.saveNotice.set(null);

    try {
      const layoutConfig = this.canvas.exportLayoutConfig();
      const id = this.templateId();

      if (id) {
        await this.templates.updateTemplate(id, {
          name,
          description: this.description(),
          layoutConfig,
        });
        this.drafts.clear(this.drafts.storageKey(id));
        this.queryClient.invalidateQueries({ queryKey: venueTemplateKeys.list() });
        this.queryClient.invalidateQueries({ queryKey: venueTemplateKeys.detail(id) });
        this.toast.success('Template saved.');
        await this.router.navigate(['/venue-layouts']);
      } else {
        await this.templates.createTemplate({
          name,
          description: this.description(),
          layoutConfig,
        });
        if (this.newSessionId) {
          this.drafts.clear(this.drafts.storageKey(null, this.newSessionId));
        }
        this.drafts.clearLegacyNewDraft();
        this.queryClient.invalidateQueries({ queryKey: venueTemplateKeys.list() });
        this.toast.success('Saved to your template library.');
        await this.router.navigate(['/venue-layouts']);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Save failed.';
      this.saveNotice.set(msg);
      this.toast.error(msg);
    } finally {
      this.isSaving.set(false);
    }
  }

  private beginNewLayout(sessionKey: string): void {
    this.draftReady = false;
    const key = this.drafts.storageKey(null, sessionKey);
    this.drafts.clearLegacyNewDraft();

    let draft = this.drafts.load(key);
    // URL `t` lost / mistyped but this tab still has an active draft pointer — recover it.
    if ((!draft || !this.drafts.hasMeaningfulContent(draft)) && this.drafts.shouldRestoreDraft()) {
      const activeKey = this.drafts.readActiveKey();
      if (activeKey && activeKey !== key) {
        const fallback = this.drafts.load(activeKey);
        if (fallback && this.drafts.hasMeaningfulContent(fallback) && fallback.templateId == null) {
          draft = fallback;
          // Keep using the URL session key going forward; re-save under it.
          this.drafts.save(key, { ...fallback, templateId: null });
        }
      }
    }

    if (draft && this.drafts.hasMeaningfulContent(draft)) {
      this.applyDraft({ ...draft, templateId: null });
      this.draftReady = true;
      return;
    }

    this.templateId.set(null);
    this.templateName.set('');
    this.description.set('');
    this.parkingLayouts.set([]);
    this.saveNotice.set(null);
    this.notice.set(null);
    this.activePanel.set('chooser');
    this.isFetchingTemplate.set(false);
    this.isCanvasBootstrapping.set(false);
    this.canvas.completeSeatHydration();
    this.resetAi();
    this.audit.reset();
    this.canvas.resetSession();
    this.draftReady = true;
  }

  private applyDraft(draft: LayoutDesignerDraft): void {
    this.templateId.set(draft.templateId);
    this.templateName.set(draft.templateName);
    this.description.set(draft.description);
    this.isCanvasBootstrapping.set(true);
    this.canvas.restoreSessionState({
      layoutConfig: draft.layoutConfig,
      zoom: draft.zoom,
      cameraX: draft.cameraX,
      cameraY: draft.cameraY,
      selectedId: draft.selectedId,
      blockWorkspaceId: draft.blockWorkspaceId ?? null,
    });
    if (draft.blockWorkspaceId) {
      this.canvas.completeSeatHydration();
    } else {
      this.canvas.beginSeatHydration(this.canvas.seatCount());
    }
    this.referenceFileName.set(draft.layoutConfig.referenceImage?.name ?? null);
    this.saveNotice.set(null);
    this.notice.set(null);
    this.activePanel.set('chooser');
    this.isFetchingTemplate.set(false);
    this.resetAi();
    void this.finishCanvasBootstrap(() => {
      if (draft.templateId) {
        this.scheduleDeferredTemplateExtras(draft.templateId, draft.layoutConfig.referenceImage);
      }
    });
  }

  private scheduleDraftSave(): void {
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
    }
    this.draftTimer = setTimeout(() => this.persistDraft(), 500);
  }

  private persistDraft(): void {
    const draft: LayoutDesignerDraft = {
      version: 1,
      templateId: this.templateId(),
      templateName: this.templateName(),
      description: this.description(),
      layoutConfig: this.canvas.exportLayoutConfig(),
      zoom: this.canvas.zoom(),
      cameraX: this.canvas.cameraX(),
      cameraY: this.canvas.cameraY(),
      selectedId: this.canvas.selectedId(),
      blockWorkspaceId: this.canvas.blockWorkspaceId(),
      savedAt: new Date().toISOString(),
    };

    const key = this.drafts.storageKey(this.templateId(), this.newSessionId);
    if (!this.drafts.hasMeaningfulContent(draft)) {
      this.drafts.clear(key);
      return;
    }
    this.drafts.save(key, draft);
  }

  private async loadTemplate(id: string): Promise<void> {
    this.isFetchingTemplate.set(true);
    this.isCanvasBootstrapping.set(false);
    this.saveNotice.set(null);
    this.draftReady = false;

    try {
      const template = await this.queryClient.fetchQuery({
        queryKey: venueTemplateKeys.detail(id),
        queryFn: () => this.templates.getTemplateById(id),
      });
      const draftKey = this.drafts.storageKey(id);

      const draft = this.drafts.load(draftKey);
      if (draft && draft.templateId === id && this.drafts.hasMeaningfulContent(draft)) {
        this.isFetchingTemplate.set(false);
        this.applyDraft(draft);
        this.draftReady = true;
        return;
      }

      this.templateId.set(id);
      this.templateName.set(template.name);
      this.description.set(template.description ?? '');

      // Paint the editor shell before the heavy in-memory layout hydrate.
      this.isFetchingTemplate.set(false);
      this.isCanvasBootstrapping.set(true);
      await this.yieldToBrowser();

      this.canvas.loadLayoutConfig(template.layout_config);
      this.canvas.beginSeatHydration(this.canvas.seatCount());
      this.referenceFileName.set(template.layout_config.referenceImage?.name ?? null);
      this.activePanel.set('chooser');
      this.notice.set(null);
      this.resetAi();
      this.audit.reset();

      await this.finishCanvasBootstrap(async () => {
        this.scheduleDeferredTemplateExtras(id, template.layout_config.referenceImage);
      });
    } catch (error) {
      this.canvas.completeSeatHydration();
      this.saveNotice.set(error instanceof Error ? error.message : 'Failed to load template.');
      this.isFetchingTemplate.set(false);
      this.isCanvasBootstrapping.set(false);
    } finally {
      this.draftReady = true;
    }
  }

  /** Lets the browser paint shell UI before blocking layout hydration. */
  private yieldToBrowser(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  /** Clears the canvas overlay after the first paint following hydration. */
  private async finishCanvasBootstrap(afterPaint?: () => void | Promise<void>): Promise<void> {
    await this.yieldToBrowser();
    await this.yieldToBrowser();
    this.isCanvasBootstrapping.set(false);
    await afterPaint?.();
  }

  /** Parking list + blueprint OCR — not needed for the first canvas paint. */
  private scheduleDeferredTemplateExtras(
    venueId: string,
    referenceImage: { dataUrl?: string; name?: string } | undefined,
  ): void {
    const run = (): void => {
      void this.loadParkingLayouts(venueId);
      void this.cacheOcrFromReferenceConfig(referenceImage);
    };

    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(run, { timeout: 3000 });
      return;
    }

    setTimeout(run, 300);
  }
}
