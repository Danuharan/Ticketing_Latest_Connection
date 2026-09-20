/** @vitest-environment jsdom */
import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, signal } from '@angular/core';
import { ComponentFixture, getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { FormsModule } from '@angular/forms';

import type { CenterpieceElement, LayoutElement } from '../../models/layout-element.model';
import { countDiningTablesThatFit } from '../../lib/dining-tables';
import { DiningLayoutSuggestionService } from '../../services/dining-layout-suggestion.service';
import { DiningSpecAnalyzerService } from '../../services/dining-spec-analyzer.service';
import { LayoutCanvasService } from '../../services/layout-canvas.service';
import { SeatingSpecAnalyzerService } from '../../services/seating-spec-analyzer.service';
import { TableCategoryService } from '../../services/table-category.service';
import { InspectorPanelComponent } from './inspector-panel.component';

if (!getTestBed().platform) {
  getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
}

function recordingBlock(): CenterpieceElement {
  return {
    id: 'block-recording',
    type: 'centerpiece',
    shape: 'custom',
    position: { xPct: 50, yPct: 50 },
    size: { wPct: 40, hPct: 40 },
    customPoints: [
      { xPct: 0, yPct: 0 },
      { xPct: 100, yPct: 0 },
      { xPct: 100, yPct: 100 },
      { xPct: 0, yPct: 100 },
    ],
    blockType: 'dining-table',
    physicalWidthM: 5.9,
    physicalLengthM: 8.14,
  } as CenterpieceElement;
}

function dispatchNativeNumberInput(input: HTMLInputElement, value: number): void {
  input.value = String(value);
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

function sig<T>(value: T) {
  return signal(value);
}

function createCanvasMock(elements: ReturnType<typeof signal<LayoutElement[]>>, selectedId: ReturnType<typeof signal<string | null>>) {
  const noop = vi.fn();
  return {
    elements,
    selectedId,
    selected: computed(() => elements().find((el) => el.id === selectedId()) ?? null),
    selectedIds: sig<string[]>([]),
    canvas: sig({ width: 1000, height: 800 }),
    drawingElementId: sig<string | null>(null),
    tablePlacementElementId: sig<string | null>(null),
    diningStageSelected: sig(false),
    autoFillLayoutMode: sig(false),
    blockWorkspaceId: sig<string | null>(null),
    blockWorkspaceElement: computed(() => null),
    blockMeasureContext: sig<'none' | 'workspace-setup' | 'arrange-by-row'>('none'),
    blockWorkspaceSeatingSideIndex: sig(0),
    blockWorkspaceViewpointAngleDeg: sig(0),
    blockWorkspaceViewpointConfirmed: sig(false),
    blockWorkspaceViewpointLayout: computed(() => null),
    pendingSeatRow: sig(null),
    workspaceMeasurementSyncInfo: sig([]),
    seatRowDrawingElementId: sig<string | null>(null),
    lineSeatDrawingElementId: sig<string | null>(null),
    serviceRouteDrawingElementId: sig<string | null>(null),
    perSeatPlacementElementId: sig<string | null>(null),
    arrangeByRowElementId: sig<string | null>(null),
    arrangeByRowPendingSideIds: sig<number[]>([]),
    arrangeByRowDraftSideLengthsM: sig<number[]>([]),
    arrangeByRowDraftSideNames: sig<string[]>([]),
    arrangeByRowWizardPhase: sig<'idle' | 'measure' | 'layout'>('idle'),
    arrangeByRowMeasuredSides: sig<boolean[]>([]),
    arrangeByRowWizardError: sig<string | null>(null),
    tableGapRuleAlert: sig<string | null>(null),
    selectedTableId: sig<string | null>(null),
    selectedTableIds: sig<string[]>([]),
    selectedServiceRouteId: sig<string | null>(null),
    selectedCustomRow: sig<number | null>(null),
    selectedSeatId: sig<string | null>(null),
    selectedAutoFillBlocks: sig([]),
    selectedRingBlock: sig(null),
    accessPointPlacementElementId: sig<string | null>(null),
    accessPointPlacementKind: sig<'entrance' | 'exit'>('exit'),
    accessPointPlacementHint: sig<string | null>(null),
    lineSeatDraftPoints: sig([]),
    serviceRouteDraftPoints: sig([]),
    seatRowDraftPoints: sig([]),
    seatRowDraftRows: sig([]),
    draftPoints: sig([]),
    dragFillSeatsElementId: sig<string | null>(null),
    autoFillAnimating: sig(false),
    autoFillProgressPct: sig(0),
    autoFillError: sig<string | null>(null),
    autoFillLastResult: sig(null),
    autoFillSameColorSelectedCount: sig(0),
    autoFillColorDeselectHint: sig<string | null>(null),
    autoFillSeatingConfig: sig(null),
    autoDiningSpecError: sig<string | null>(null),
    serviceRouteTableGenPending: sig(false),
    serviceRouteTableGenClearance: sig(1.0),
    serviceRouteTableGenType: sig<'count' | 'grid' | null>(null),
    serviceRouteTableGenOptions: sig(null),
    tablePlacementDefaults: sig(null),
    stageSidePickReorient: sig(false),
    foodPrepareSidePickReorient: sig(false),
    isStageSidePickMode: vi.fn(() => false),
    isFoodPrepareSidePickMode: vi.fn(() => false),
    isArrangeByRowMeasureMode: vi.fn(() => false),
    stageSideLabelFor: vi.fn(() => ''),
    diningAccessMaxWidthM: vi.fn(() => null),
    setPendingBlockPreviewLengthM: noop,
    setPendingBlockPreviewWidthM: noop,
    update: noop,
    updateSilent: noop,
    cancelTablePlacement: noop,
    syncBlockPhysicalDimsFromMeasuredSides: noop,
    zoomBlockWorkspaceForTableEditing: noop,
    cancelAccessPointPlacement: noop,
    setDiningAccessPointsLocked: noop,
    moveDiningAccessPointAt: noop,
    commitDiningAccessPointDrag: noop,
    commitAccessWidthEdit: noop,
    startAccessPointPlacement: noop,
    removeDiningEntrance: noop,
    removeDiningExit: noop,
    removeDiningSharedAccess: noop,
    setDiningAccessMode: noop,
    updateDiningAccessPointWidth: noop,
    setDiningAccessDefaultWidths: noop,
    beginDiningBackgroundAdjust: noop,
    setDiningBackgroundImage: (elementId: string, image: unknown) => {
      elements.update((items) =>
        items.map((el) =>
          el.id === elementId ? ({ ...el, diningLayoutReferenceImage: image } as LayoutElement) : el,
        ),
      );
    },
    updateDiningBackgroundImage: (elementId: string, patch: Record<string, unknown>) => {
      elements.update((items) =>
        items.map((el) => {
          if (el.id !== elementId || el.type !== 'centerpiece') {
            return el;
          }
          const current = (el as CenterpieceElement).diningLayoutReferenceImage;
          return {
            ...el,
            diningLayoutReferenceImage: current ? { ...current, ...patch } : current,
          } as LayoutElement;
        }),
      );
    },
    removeDiningBackgroundImage: (elementId: string) => {
      elements.update((items) =>
        items.map((el) =>
          el.id === elementId ? ({ ...el, diningLayoutReferenceImage: undefined } as LayoutElement) : el,
        ),
      );
    },
    applyStageOnSide: noop,
    applyFoodPrepareOnSide: noop,
    removeDiningStage: noop,
    updateDiningStage: noop,
    rotateDiningStageSilent: noop,
    removeDiningFoodPrepare: noop,
    updateDiningFoodPrepare: noop,
    rotateDiningFoodPrepareSilent: noop,
    removeDiningServiceRoutes: noop,
    updateDiningServiceRouteWidth: noop,
    removeDiningTables: noop,
    updateDiningTable: noop,
    deleteDiningTable: noop,
    deleteDiningServiceRoute: noop,
    clearTableGapRuleAlert: noop,
  };
}

describe('InspectorPanelComponent dining table diameter input', () => {
  let fixture: ComponentFixture<InspectorPanelComponent>;
  let component: InspectorPanelComponent;
  let block: CenterpieceElement;

  beforeEach(async () => {
    block = recordingBlock();
    const elements = signal<LayoutElement[]>([block]);
    const selectedId = signal<string | null>(block.id);
    const canvasMock = createCanvasMock(elements, selectedId);
    const validatedFeasibleTableCount = signal<number | null>(null);

    await TestBed.configureTestingModule({
      imports: [FormsModule, InspectorPanelComponent],
      providers: [
        { provide: LayoutCanvasService, useValue: canvasMock },
        { provide: SeatingSpecAnalyzerService, useValue: {} },
        { provide: DiningSpecAnalyzerService, useValue: {} },
        { provide: TableCategoryService, useValue: { list: () => [], getById: () => null } },
        {
          provide: DiningLayoutSuggestionService,
          useValue: {
            clearSession: vi.fn(),
            clearSuggestions: vi.fn(),
            loading: signal(false),
            capacityLoading: signal(false),
            capacityStatus: signal<'unknown' | 'checking' | 'ready' | 'error'>('unknown'),
            operationalMaximumTableCount: signal<number | null>(null),
            operationalWitnessTableCount: signal<number | null>(null),
            operationalWitnessValidated: signal(false),
            validatedFeasibleTableCount,
            provenMaximumTableCount: signal<number | null>(null),
            maximumProven: signal(false),
            basicGeometricUpperBound: signal<number | null>(null),
            lastDiagnostics: signal(null),
            lastError: signal<string | null>(null),
            lastCapacityDebugSvg: signal<string | null>(null),
            lastPhysicalExplanation: signal(null),
            feasibilityLoading: signal(false),
            lastFeasibilityCount: signal<number | null>(null),
            lastFeasibilityResult: signal<'found' | 'not-found-yet' | 'impossible' | null>(null),
            lastReadyPhysicalKey: signal(''),
            hasReadyKnowledgeFor: () => false,
            selectedCountIsValidated: (count: number) => {
              const feasible = validatedFeasibleTableCount();
              return feasible != null && count <= feasible;
            },
            markCapacityChecking: vi.fn(),
            probeCapacity: vi.fn(async () => null),
            ensureCapacity: vi.fn(async () => null),
            checkFeasibility: vi.fn(async () => 'found' as const),
            nextSeed: vi.fn(() => 1),
            excludedFingerprints: vi.fn(() => []),
            generate: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InspectorPanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('variant', 'dining-sidebar');

    component['tableCreateWizardOpen'].set(true);
    component['diningWizardStep'].set(4);
    component['draftTableShape'].set('round');
    component['draftTableWidthM'].set(0.8);
    component['draftTableDepthM'].set(0.8);
    component['draftTableGapM'].set(0.6);
    component['draftChairLength'].set(0.5);
    component['draftChairWidth'].set(0.45);
    component['draftTableCount'].set(6);
    component['autoTableWizardOpen'].set(false);
    component['diningImageUploadOpen'].set(false);
    component['manualTablePlacementOpen'].set(false);

    fixture.detectChanges();
  });

  it('keeps DOM diameter, draft signal, and max fill in sync through native input events', () => {
    const input = fixture.nativeElement.querySelector(
      '[data-testid="dining-table-diameter-input"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();

    const maxFillEl = fixture.nativeElement.querySelector(
      '[data-testid="dining-table-max-fill"]',
    ) as HTMLElement | null;
    expect(maxFillEl).not.toBeNull();

    const expectedAt = (diameterM: number) =>
      countDiningTablesThatFit(block, {
        shape: 'round',
        widthM: diameterM,
        depthM: diameterM,
        gapM: 0.6,
        chairLengthM: 0.5,
        featureClearanceM: 0.8,
        template: 'grid',
      });

    expect(component['draftTableWidthM']()).toBe(0.8);
    expect(component['tableCreateMaxFillCount']()).toBe(expectedAt(0.8));
    expect(maxFillEl!.textContent).toContain(String(expectedAt(0.8)));

    dispatchNativeNumberInput(input!, 1.5);
    fixture.detectChanges();

    expect(input!.valueAsNumber).toBeCloseTo(1.5, 2);
    expect(component['draftTableWidthM']()).toBeCloseTo(1.5, 2);
    expect(component['tableCreateMaxFillCount']()).toBe(expectedAt(1.5));
    expect(maxFillEl!.textContent).toContain(String(expectedAt(1.5)));
    expect(component['draftTableCount']()).toBe(Math.min(6, expectedAt(1.5)));

    dispatchNativeNumberInput(input!, 2.0);
    fixture.detectChanges();

    expect(input!.valueAsNumber).toBeCloseTo(2.0, 2);
    expect(component['draftTableWidthM']()).toBeCloseTo(2.0, 2);
    expect(component['tableCreateMaxFillCount']()).toBe(expectedAt(2.0));
    expect(component['draftTableCount']()).toBe(2);

    const oversizeM = 5.4;
    const clampedMaxM = component['maxDraftTableWidthM']();
    expect(clampedMaxM).toBeLessThan(oversizeM);
    expect(expectedAt(oversizeM)).toBe(0);

    dispatchNativeNumberInput(input!, oversizeM);
    fixture.detectChanges();

    // Must not accept a diameter that cannot fit (matches generator wall clearance).
    expect(input!.valueAsNumber).toBeCloseTo(clampedMaxM, 2);
    expect(component['draftTableWidthM']()).toBeCloseTo(clampedMaxM, 2);
    expect(component['tableCreateMaxFillCount']()).toBe(expectedAt(clampedMaxM));
    expect(component['draftTableCount']()).toBe(1);
    expect(maxFillEl!.textContent).toContain(`Maximum that fits: ${expectedAt(clampedMaxM)}`);
    expect(maxFillEl!.textContent).toContain('Selected: 1');
    expect(maxFillEl!.textContent).not.toContain('operational estimate');
  });

  it('does not use basic geometric capacity as the stepper max while operational capacity is checking', () => {
    const suggestions = TestBed.inject(DiningLayoutSuggestionService) as unknown as {
      capacityStatus: ReturnType<typeof signal<'unknown' | 'checking' | 'ready' | 'error'>>;
      operationalMaximumTableCount: ReturnType<typeof signal<number | null>>;
    };
    suggestions.capacityStatus.set('checking');
    suggestions.operationalMaximumTableCount.set(null);
    component['draftTableCount'].set(3);
    fixture.detectChanges();

    expect(component['tableCreateMaxFillCount']()).toBeGreaterThan(3);
    expect(component['effectiveMaximumTableCount']()).toBeNull();
    expect(component['canIncreaseDraftTableCount']()).toBe(false);
    const plus = fixture.nativeElement.querySelector(
      '[data-testid="dining-table-count-plus"]',
    ) as HTMLButtonElement;
    expect(plus.disabled).toBe(true);
    component['adjustDraftTableCount'](1);
    expect(component['draftTableCount']()).toBe(3);
    component['setDraftTableCount'](12);
    expect(component['draftTableCount']()).toBe(3);
    expect(component['canContinueDiningTableWizard']()).toBe(false);
  });

  it('keeps Continue disabled when operational capacity errors, and does not let count rise', () => {
    const suggestions = TestBed.inject(DiningLayoutSuggestionService) as unknown as {
      capacityStatus: ReturnType<typeof signal<'unknown' | 'checking' | 'ready' | 'error'>>;
      lastError: ReturnType<typeof signal<string | null>>;
    };
    suggestions.capacityStatus.set('error');
    suggestions.lastError.set('Could not reach the dining capacity service.');
    component['draftTableCount'].set(3);
    fixture.detectChanges();

    expect(component['tableCreateMaxFillCount']()).toBeGreaterThanOrEqual(3);
    expect(component['canContinueFromTableMeasurements']()).toBe(false);
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="dining-continue-step-5"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(component['canIncreaseDraftTableCount']()).toBe(false);
    component['setDraftTableCount'](component['tableCreateMaxFillCount']() + 8);
    expect(component['draftTableCount']()).toBe(3);
  });

  it('reduces table count when diameter grows even if operational capacity is in error', () => {
    const suggestions = TestBed.inject(DiningLayoutSuggestionService) as unknown as {
      capacityStatus: ReturnType<typeof signal<'unknown' | 'checking' | 'ready' | 'error'>>;
      lastError: ReturnType<typeof signal<string | null>>;
    };
    suggestions.capacityStatus.set('error');
    suggestions.lastError.set('Could not reach the dining capacity service.');
    component['draftTableCount'].set(6);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      '[data-testid="dining-table-diameter-input"]',
    ) as HTMLInputElement;
    dispatchNativeNumberInput(input, 2.0);
    fixture.detectChanges();

    expect(component['draftTableWidthM']()).toBeCloseTo(2.0, 2);
    expect(component['draftTableCount']()).toBeLessThanOrEqual(2);
    expect(component['draftTableCount']()).toBe(component['tableCreateMaxFillCount']());
    expect(component['canIncreaseDraftTableCount']()).toBe(false);
    expect(component['canContinueFromTableMeasurements']()).toBe(false);
  });

  it('keeps Continue disabled on generator version mismatch', () => {
    const suggestions = TestBed.inject(DiningLayoutSuggestionService) as unknown as {
      capacityStatus: ReturnType<typeof signal<'unknown' | 'checking' | 'ready' | 'error'>>;
      lastError: ReturnType<typeof signal<string | null>>;
    };
    suggestions.capacityStatus.set('error');
    suggestions.lastError.set(
      'Dining generator version mismatch. Expected 2026-08-25-preview-rot-v1, received stale.',
    );
    component['draftTableCount'].set(3);
    fixture.detectChanges();
    expect(component['canContinueFromTableMeasurements']()).toBe(false);
  });

  it('stops the table count + control at a certified proven maximum', () => {
    const suggestions = TestBed.inject(DiningLayoutSuggestionService) as unknown as {
      provenMaximumTableCount: ReturnType<typeof signal<number | null>>;
      maximumProven: ReturnType<typeof signal<boolean>>;
      basicGeometricUpperBound: ReturnType<typeof signal<number | null>>;
      validatedFeasibleTableCount: ReturnType<typeof signal<number | null>>;
      operationalWitnessValidated: ReturnType<typeof signal<boolean>>;
      capacityStatus: ReturnType<typeof signal<'unknown' | 'checking' | 'ready' | 'error'>>;
    };
    // Proven max must stay within geometric pack (wall clearance); room fits 6 at 0.8 m.
    const provenMax = 5;
    suggestions.provenMaximumTableCount.set(provenMax);
    suggestions.maximumProven.set(true);
    suggestions.basicGeometricUpperBound.set(12);
    suggestions.validatedFeasibleTableCount.set(provenMax);
    suggestions.operationalWitnessValidated.set(true);
    suggestions.capacityStatus.set('ready');
    component['draftTableCount'].set(4);
    fixture.detectChanges();

    expect(component['effectiveMaximumTableCount']()).toBe(provenMax);
    const plus = fixture.nativeElement.querySelector(
      '[data-testid="dining-table-count-plus"]',
    ) as HTMLButtonElement;
    expect(plus.disabled).toBe(false);

    component['adjustDraftTableCount'](1);
    fixture.detectChanges();
    expect(component['draftTableCount']()).toBe(provenMax);
    expect(plus.disabled).toBe(true);

    component['adjustDraftTableCount'](1);
    expect(component['draftTableCount']()).toBe(provenMax);

    component['setDraftTableCount'](20);
    expect(component['draftTableCount']()).toBe(provenMax);
  });

  it('lets + rise above local pack when validated operational capacity is higher', () => {
    const suggestions = TestBed.inject(DiningLayoutSuggestionService) as unknown as {
      provenMaximumTableCount: ReturnType<typeof signal<number | null>>;
      maximumProven: ReturnType<typeof signal<boolean>>;
      basicGeometricUpperBound: ReturnType<typeof signal<number | null>>;
      validatedFeasibleTableCount: ReturnType<typeof signal<number | null>>;
      operationalWitnessValidated: ReturnType<typeof signal<boolean>>;
      capacityStatus: ReturnType<typeof signal<'unknown' | 'checking' | 'ready' | 'error'>>;
    };

    // Force a low local AABB pack (free-rotated stage under-count analogue).
    component['draftTableWidthM'].set(2.2);
    component['draftTableDepthM'].set(2.2);
    fixture.detectChanges();
    const packMax = component['tableCreateMaxFillCount']();
    expect(packMax).toBeGreaterThanOrEqual(1);
    expect(packMax).toBeLessThan(6);

    const validated = 6;
    suggestions.provenMaximumTableCount.set(validated);
    suggestions.maximumProven.set(true);
    suggestions.basicGeometricUpperBound.set(12);
    suggestions.validatedFeasibleTableCount.set(validated);
    suggestions.operationalWitnessValidated.set(true);
    suggestions.capacityStatus.set('ready');
    component['draftTableCount'].set(packMax);
    fixture.detectChanges();

    expect(component['effectiveMaximumTableCount']()).toBe(validated);
    expect(component['canIncreaseDraftTableCount']()).toBe(true);

    component['adjustDraftTableCount'](1);
    fixture.detectChanges();
    expect(component['draftTableCount']()).toBe(packMax + 1);

    component['setDraftTableCount'](validated);
    fixture.detectChanges();
    expect(component['draftTableCount']()).toBe(validated);
  });

  it('does not treat a heuristic feasible count as the hard maximum', () => {
    const suggestions = TestBed.inject(DiningLayoutSuggestionService) as unknown as {
      provenMaximumTableCount: ReturnType<typeof signal<number | null>>;
      maximumProven: ReturnType<typeof signal<boolean>>;
      basicGeometricUpperBound: ReturnType<typeof signal<number | null>>;
      validatedFeasibleTableCount: ReturnType<typeof signal<number | null>>;
      capacityStatus: ReturnType<typeof signal<'unknown' | 'checking' | 'ready' | 'error'>>;
    };
    suggestions.validatedFeasibleTableCount.set(6);
    suggestions.maximumProven.set(false);
    suggestions.provenMaximumTableCount.set(null);
    suggestions.basicGeometricUpperBound.set(12);
    suggestions.capacityStatus.set('ready');
    component['draftTableCount'].set(6);
    fixture.detectChanges();

    const packMax = component['tableCreateMaxFillCount']();
    const expectedMax = Math.min(12, packMax);
    expect(component['effectiveMaximumTableCount']()).toBe(expectedMax);
    expect(component['canIncreaseDraftTableCount']()).toBe(6 < expectedMax);
    const fill = fixture.nativeElement.querySelector(
      '[data-testid="dining-table-max-fill"]',
    ) as HTMLElement;
    expect(fill.textContent).toContain('Maximum that fits:');
    expect(fill.textContent).toContain('Validated capacity: at least 6');
    expect(fill.textContent).not.toContain('Operational maximum: 6');
    if (6 < expectedMax) {
      component['adjustDraftTableCount'](1);
      expect(component['draftTableCount']()).toBe(7);
    }
  });

  it('clamps selected count when the proven maximum decreases', () => {
    const suggestions = TestBed.inject(DiningLayoutSuggestionService) as unknown as {
      provenMaximumTableCount: ReturnType<typeof signal<number | null>>;
      maximumProven: ReturnType<typeof signal<boolean>>;
      basicGeometricUpperBound: ReturnType<typeof signal<number | null>>;
      operationalWitnessValidated: ReturnType<typeof signal<boolean>>;
      capacityStatus: ReturnType<typeof signal<'unknown' | 'checking' | 'ready' | 'error'>>;
    };
    suggestions.provenMaximumTableCount.set(5);
    suggestions.maximumProven.set(true);
    suggestions.basicGeometricUpperBound.set(12);
    suggestions.operationalWitnessValidated.set(true);
    suggestions.capacityStatus.set('ready');
    component['draftTableCount'].set(5);
    fixture.detectChanges();
    expect(component['draftTableCount']()).toBe(5);

    suggestions.provenMaximumTableCount.set(3);
    fixture.detectChanges();
    expect(component['draftTableCount']()).toBe(3);
    expect(component['tableCountAdjustedMessage']()).toContain('operational maximum of 3');
  });
});

describe('InspectorPanelComponent background image does not invalidate Continue', () => {
  let fixture: ComponentFixture<InspectorPanelComponent>;
  let component: InspectorPanelComponent;
  let block: CenterpieceElement;
  let elements: ReturnType<typeof signal<LayoutElement[]>>;
  let selectedId: ReturnType<typeof signal<string | null>>;
  let canvasMock: ReturnType<typeof createCanvasMock>;
  let lastReadyPhysicalKey: ReturnType<typeof signal<string>>;
  let markCapacityChecking: ReturnType<typeof vi.fn>;
  let probeCapacity: ReturnType<typeof vi.fn>;
  let capacityStatus: ReturnType<typeof signal<'unknown' | 'checking' | 'ready' | 'error'>>;
  let validatedFeasibleTableCount: ReturnType<typeof signal<number | null>>;

  const backgroundA = {
    dataUrl: 'data:image/jpeg;base64,AAA',
    name: 'hall-a.jpg',
    imageWidth: 1200,
    imageHeight: 1800,
    visible: true,
    scale: 1,
    offsetXPct: 0,
    offsetYPct: 0,
  };
  const backgroundB = {
    ...backgroundA,
    dataUrl: 'data:image/jpeg;base64,BBB',
    name: 'hall-b.jpg',
    scale: 1.2,
    offsetXPct: 4,
  };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    block = recordingBlock();
    elements = signal<LayoutElement[]>([block]);
    selectedId = signal<string | null>(block.id);
    canvasMock = createCanvasMock(elements, selectedId);
    markCapacityChecking = vi.fn();
    probeCapacity = vi.fn(async () => null);
    capacityStatus = signal<'unknown' | 'checking' | 'ready' | 'error'>('unknown');
    validatedFeasibleTableCount = signal<number | null>(null);
    lastReadyPhysicalKey = signal('');

    await TestBed.configureTestingModule({
      imports: [FormsModule, InspectorPanelComponent],
      providers: [
        { provide: LayoutCanvasService, useValue: canvasMock },
        { provide: SeatingSpecAnalyzerService, useValue: {} },
        { provide: DiningSpecAnalyzerService, useValue: {} },
        { provide: TableCategoryService, useValue: { list: () => [], getById: () => null } },
        {
          provide: DiningLayoutSuggestionService,
          useValue: {
            clearSession: vi.fn(),
            clearSuggestions: vi.fn(),
            loading: signal(false),
            capacityLoading: signal(false),
            capacityStatus,
            operationalMaximumTableCount: signal<number | null>(null),
            operationalWitnessTableCount: signal<number | null>(6),
            operationalWitnessValidated: signal(true),
            validatedFeasibleTableCount,
            provenMaximumTableCount: signal<number | null>(null),
            maximumProven: signal(false),
            basicGeometricUpperBound: signal<number | null>(12),
            lastDiagnostics: signal(null),
            lastError: signal<string | null>(null),
            lastCapacityDebugSvg: signal<string | null>(null),
            lastPhysicalExplanation: signal(null),
            feasibilityLoading: signal(false),
            lastFeasibilityCount: signal<number | null>(null),
            lastFeasibilityResult: signal<'found' | 'not-found-yet' | 'impossible' | null>(null),
            lastReadyPhysicalKey,
            hasReadyKnowledgeFor: (key: string) =>
              Boolean(key) && key === lastReadyPhysicalKey() && validatedFeasibleTableCount() != null,
            selectedCountIsValidated: (count: number) =>
              capacityStatus() === 'ready' &&
              validatedFeasibleTableCount() != null &&
              count <= validatedFeasibleTableCount()!,
            markCapacityChecking,
            probeCapacity,
            ensureCapacity: vi.fn(async () => null),
            checkFeasibility: vi.fn(async () => 'found' as const),
            nextSeed: vi.fn(() => 1),
            excludedFingerprints: vi.fn(() => []),
            generate: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InspectorPanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('variant', 'dining-sidebar');
    component['tableCreateWizardOpen'].set(true);
    component['diningWizardBlockId'].set(block.id);
    component['diningWizardStep'].set(4);
    component['draftTableShape'].set('round');
    component['draftTableWidthM'].set(1.05);
    component['draftTableDepthM'].set(1.05);
    component['draftTableGapM'].set(0.6);
    component['draftChairLength'].set(0.5);
    component['draftChairWidth'].set(0.4);
    component['draftTableCount'].set(6);
    component['draftTableSeats'].set(4);
    component['autoTableWizardOpen'].set(false);
    component['diningImageUploadOpen'].set(false);
    component['manualTablePlacementOpen'].set(false);
    fixture.detectChanges();

    capacityStatus.set('ready');
    validatedFeasibleTableCount.set(6);
    lastReadyPhysicalKey.set(component['diningPhysicalCapacitySignature']());
    fixture.detectChanges();
  });

  function continueButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector(
      '[data-testid="dining-continue-step-5"]',
    ) as HTMLButtonElement;
  }

  function snapshotWizard() {
    return {
      step: component['diningWizardStep'](),
      selectedId: selectedId(),
      width: component['draftTableWidthM'](),
      depth: component['draftTableDepthM'](),
      chairW: component['draftChairWidth'](),
      chairD: component['draftChairLength'](),
      count: component['draftTableCount'](),
      signature: component['diningPhysicalCapacitySignature'](),
      canContinue: component['canContinueFromTableMeasurements'](),
      status: capacityStatus(),
    };
  }

  it('keeps Continue enabled after apply / replace / hide / show / remove background', () => {
    expect(continueButton().disabled).toBe(false);
    const before = snapshotWizard();
    const probesBefore = markCapacityChecking.mock.calls.length;
    const invokeBefore = probeCapacity.mock.calls.length;

    canvasMock.setDiningBackgroundImage(block.id, backgroundA);
    fixture.detectChanges();
    expect(snapshotWizard()).toEqual(before);
    expect(continueButton().disabled).toBe(false);

    canvasMock.setDiningBackgroundImage(block.id, backgroundB);
    fixture.detectChanges();
    canvasMock.updateDiningBackgroundImage(block.id, { offsetXPct: 8, scale: 1.4, visible: false });
    fixture.detectChanges();
    canvasMock.updateDiningBackgroundImage(block.id, { visible: true });
    fixture.detectChanges();
    canvasMock.removeDiningBackgroundImage(block.id);
    fixture.detectChanges();

    const after = snapshotWizard();
    expect(after).toEqual(before);
    expect(continueButton().disabled).toBe(false);
    expect(markCapacityChecking.mock.calls.length).toBe(probesBefore);
    expect(probeCapacity.mock.calls.length).toBe(invokeBefore);
    expect(selectedId()).toBe(block.id);
    expect(component['diningWizardBlockId']()).toBe(block.id);
    expect(component['draftTableWidthM']()).toBe(1.05);
    expect(component['draftTableCount']()).toBe(6);
  });

  it('keeps Continue enabled if capacity status flickers after Apply Background', () => {
    expect(continueButton().disabled).toBe(false);
    canvasMock.setDiningBackgroundImage(block.id, backgroundA);
    capacityStatus.set('error');
    fixture.detectChanges();
    expect(component['diningPhysicalCapacitySignature']()).toBe(lastReadyPhysicalKey());
    expect(component['canContinueFromTableMeasurements']()).toBe(true);
    expect(continueButton().disabled).toBe(false);
    expect(component['diningWizardStep']()).toBe(4);
    expect(selectedId()).toBe(block.id);
  });

  it('still re-checks capacity when table diameter actually changes', () => {
    const probesBefore = markCapacityChecking.mock.calls.length;
    const signatureBefore = component['diningPhysicalCapacitySignature']();
    component['draftTableWidthM'].set(1.25);
    fixture.detectChanges();
    expect(component['diningPhysicalCapacitySignature']()).not.toBe(signatureBefore);
    expect(markCapacityChecking.mock.calls.length).toBeGreaterThan(probesBefore);
  });
});
