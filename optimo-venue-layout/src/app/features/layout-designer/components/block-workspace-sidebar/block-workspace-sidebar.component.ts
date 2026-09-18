import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  HostListener,
  inject,
  OnDestroy,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { InspectorPanelComponent } from '../inspector-panel/inspector-panel.component';
import {
  BLOCK_TYPE_OPTIONS,
  BlockTypeId,
  blockTypeHasTools,
  blockTypeHasCustomizationFlow,
  blockTypeHasGaFlow,
  blockTypeUsesSideLabelConfigureUi,
  blockTypeLabel,
} from '../../models/block-type.model';
import { BlockConfigTemplateService } from '../../services/block-config-template.service';
import { LayoutCanvasService } from '../../services/layout-canvas.service';
import { resolveBlockTierLabel } from '../../lib/block-tier';
import {
  computeSideScaleFactorFromSingleEdit,
  scaleSideLengthMapByFactor,
} from '../../lib/auto-fill-measurements';
import { startPressHoldRepeat, type PressHoldRepeatControl } from '../../lib/press-hold-repeat';
import { ToastService } from '../../../../core/services/toast.service';
import type {
  AutoFillAisleSlot,
  AutoFillAisleType,
} from '../../models/auto-fill-seating.model';
import {
  createDefaultAisleSlot,
  normalizeAutoFillAisles,
} from '../../models/auto-fill-seating.model';
import {
  AUTO_FILL_CURVE_DEFAULT_DEG,
  AUTO_FILL_CURVE_MAX,
  AUTO_FILL_CURVE_MIN,
  AUTO_FILL_CURVE_STEP_DEG,
  clampAutoFillCurveDeg,
} from '../../lib/auto-fill-seating';

/** Auto-fill measurement highlighted on the mini seat diagram. */
type AutoFillDim = 'chairWidth' | 'chairDepth' | 'seatGap' | 'rowGap' | 'borderGap' | 'curve';

@Component({
  selector: 'app-block-workspace-sidebar',
  imports: [FormsModule, InspectorPanelComponent],
  templateUrl: './block-workspace-sidebar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block-workspace-sidebar',
  },
})
export class BlockWorkspaceSidebarComponent implements OnDestroy {
  protected readonly canvas = inject(LayoutCanvasService);
  protected readonly templates = inject(BlockConfigTemplateService);
  private readonly toast = inject(ToastService);

  private static readonly SIDE_LENGTH_STEP_M = 0.1;
  private static readonly AUTO_FILL_CHAIR_STEP_M = 0.05;
  private static readonly AUTO_FILL_GAP_STEP_M = 0.001;
  private measurementHold: PressHoldRepeatControl | null = null;
  private autoFillDimHold: PressHoldRepeatControl | null = null;

  protected readonly blockTypeOptions = BLOCK_TYPE_OPTIONS;
  protected readonly blockTypeLabel = blockTypeLabel;
  protected readonly blockTypeHasTools = blockTypeHasTools;
  protected readonly blockTypeHasCustomizationFlow = blockTypeHasCustomizationFlow;
  protected readonly blockTypeHasGaFlow = blockTypeHasGaFlow;
  protected readonly blockTypeUsesSideLabelConfigureUi = blockTypeUsesSideLabelConfigureUi;

  protected readonly block = computed(() => this.canvas.blockWorkspaceElement());
  protected readonly blockTitle = computed(() => {
    const el = this.block();
    if (!el) {
      return 'Block';
    }
    return el.label?.trim() || el.name?.trim() || 'Block';
  });

  protected readonly selectedBlockType = computed(() => this.block()?.blockType ?? null);
  protected readonly viewpointConfirmed = computed(() => this.canvas.blockWorkspaceViewpointConfirmed());
  protected readonly sidesConfigured = computed(() => this.canvas.blockWorkspaceSidesConfigured());
  protected readonly seatingEditMode = computed(() => this.canvas.blockWorkspaceSeatingEditMode());

  protected readonly showViewpointStep = computed(
    () => blockTypeHasCustomizationFlow(this.selectedBlockType()) && !this.viewpointConfirmed(),
  );

  protected readonly showSideLabelConfigureStep = computed(() => {
    const type = this.selectedBlockType();
    if (!blockTypeUsesSideLabelConfigureUi(type)) {
      return false;
    }
    if (blockTypeHasGaFlow(type)) {
      return !this.gaMaxParticipantsStep();
    }
    // Seating & dining: stay on configure until user chooses edit tools.
    if (blockTypeHasCustomizationFlow(type)) {
      return this.viewpointConfirmed() && !this.seatingEditMode();
    }
    return this.viewpointConfirmed() && !this.sidesConfigured();
  });

  /** Seating: measurements saved — show Auto Fill inputs and path buttons. */
  protected readonly showAutofillChoiceSection = computed(() => {
    if (this.selectedBlockType() !== 'seating' || !this.viewpointConfirmed() || this.seatingEditMode()) {
      return false;
    }
    const el = this.block();
    return Boolean(el && this.canvas.allGaSidesConfigured(el));
  });

  /** Dining: measurements saved — show path into table edit tools. */
  protected readonly showDiningConfigureChoiceSection = computed(() => {
    if (this.selectedBlockType() !== 'dining-table' || !this.viewpointConfirmed() || this.seatingEditMode()) {
      return false;
    }
    const el = this.block();
    return Boolean(el && this.canvas.allGaSidesConfigured(el));
  });

  protected readonly workspaceBlockSeatCount = computed(() => this.canvas.blockWorkspaceSeatCount());

  protected readonly showSeatingTools = computed(
    () =>
      this.selectedBlockType() === 'seating' &&
      this.viewpointConfirmed() &&
      this.seatingEditMode(),
  );

  protected readonly showDiningTools = computed(
    () =>
      this.selectedBlockType() === 'dining-table' &&
      this.viewpointConfirmed() &&
      this.seatingEditMode(),
  );

  protected readonly showEditingTools = computed(
    () => this.showSeatingTools() || this.showDiningTools(),
  );

  protected readonly progress = computed(() => this.canvas.blockWorkspaceProgress());

  protected readonly groundFocalLabel = computed(() => this.canvas.groundFocalPoint().label);

  protected readonly viewpointAutoInferred = computed(() => {
    const el = this.block();
    return Boolean(el && el.blockViewpointAngleDeg == null && el.dragSeatsStadiumSideIndex == null);
  });

  protected goBackStep(): void {
    this.canvas.goBackBlockWorkspaceStep();
  }

  protected readonly currentSideLabel = computed(() => {
    const layout = this.canvas.blockWorkspaceViewpointLayout();
    return layout?.sideLabel ?? '';
  });

  protected readonly confirmedViewpointSideLabel = computed(() => {
    if (!this.viewpointConfirmed()) {
      return '';
    }
    return this.currentSideLabel();
  });

  protected readonly savedConfigs = computed(() => {
    const type = this.selectedBlockType();
    return type ? this.templates.listByType(type) : [];
  });

  protected readonly selectedConfigId = signal<string>('');
  protected readonly saveConfigName = signal('');

  // ── General Admission UI state ────────────────────────────────────────────
  protected readonly isGaWorkspace = computed(() => this.canvas.isGaWorkspace());
  protected readonly gaMaxParticipantsStep = computed(() => this.canvas.gaWorkspaceMaxParticipantsStep());
  protected readonly gaConfiguredSides = computed(() => this.block()?.gaConfiguredSides ?? []);
  /** Content fingerprint so draft sync does not re-run on unrelated block patches. */
  private readonly gaConfiguredSidesSyncKey = computed(() =>
    this.gaConfiguredSides()
      .map((s) => `${s.logicalId}:${s.label ?? ''}:${s.lengthM ?? ''}`)
      .join('|'),
  );
  protected readonly gaExistingMaxParticipants = computed(() => this.block()?.gaMaxParticipants ?? null);
  protected readonly gaWorkspaceEdges = computed(() => this.canvas.gaWorkspaceEdges());
  protected readonly gaPendingSideId = computed(() => this.canvas.gaWorkspacePendingSideId());
  protected readonly gaTotalSideCount = computed(() => this.canvas.gaWorkspaceEdges()?.length ?? 0);
  protected readonly gaConfiguredCount = computed(() => this.gaConfiguredSides().length);

  protected readonly allSidesConfigured = computed(() => {
    const el = this.block();
    if (!el) {
      return false;
    }
    return this.canvas.allGaSidesConfigured(el);
  });

  protected readonly autoFillConfig = computed(() => this.canvas.autoFillSeatingConfig());

  /** Which end of every row gets seat 1 (spectator facing the VIEW POINT). */
  protected readonly seatStartSide = computed<'left' | 'right'>(() => {
    const el = this.canvas.blockWorkspaceElement();
    return el ? this.canvas.seatStartSide(el.id) : 'left';
  });

  /** True once the block stores an explicit choice (legacy blocks show the detected side). */
  protected readonly seatStartSideChosen = computed(
    () => this.canvas.blockWorkspaceElement()?.seatStartSide != null,
  );

  protected setSeatStartSide(side: 'left' | 'right'): void {
    const el = this.canvas.blockWorkspaceElement();
    if (el) {
      this.canvas.setSeatStartSide(el.id, side);
    }
  }

  protected readonly measurementSyncInfo = computed(() => this.canvas.workspaceMeasurementSyncInfo());

  /** Per-side label drafts — keyed by logicalId. Updated on every keystroke. */
  readonly gaDraftLabels = signal<Record<number, string | undefined>>({});
  /** Per-side length drafts in metres — keyed by logicalId. */
  readonly gaDraftLengths = signal<Record<number, number | undefined>>({});
  /** Baseline lengths used when one side is edited — all sides scale from these. */
  readonly sideLengthBaselines = signal<Record<number, number>>({});
  /** Max participants input on step 3. */
  readonly gaDraftMaxParticipants = signal<number | null>(null);
  /** Template name to save this GA config under (optional). */
  readonly gaConfigName = signal('');

  /** Avoid re-capturing Auto Fill defaults while the user edits settings in the workspace. */
  private autofillPrefillCapturedForBlockId: string | null = null;
  /** Seed key for GA draft reset — ignore chair/gap patches that recreate the element object. */
  private draftsSeededForKey: string | null = null;
  /**
   * Stable key for workspace draft hydration. Chair/gap/curve/aisle patches
   * rewrite the block object but must not reset the sidebar.
   * Also tracks blockType so dining ↔ seating switches re-init drafts.
   */
  private readonly workspaceHydrationKey = computed(() => {
    const el = this.block();
    if (!el) {
      return '';
    }
    return `${el.id}\0${el.appliedConfigId ?? ''}\0${el.appliedConfigName ?? ''}\0${el.blockType ?? ''}`;
  });

  constructor() {
    // Load saved templates once per workspace open — not on every Auto Fill keystroke.
    effect(() => {
      const workspaceId = this.canvas.blockWorkspaceId();
      if (!workspaceId) {
        return;
      }
      untracked(() => {
        this.templates.ensureLoaded().catch(() => {
          this.toast.error('Could not load saved configurations.');
        });
      });
    });

    // Initialise sidebar drafts when the user opens a different block / applied
    // config / block type — not when diningExit.widthM or similar changes.
    effect(() => {
      const key = this.workspaceHydrationKey();
      if (!key) {
        return;
      }
      const el = untracked(() => this.block());
      if (!el) {
        this.draftsSeededForKey = null;
        return;
      }
      // Only re-seed when the block, applied config, or GA sides change — not when
      // Auto Fill +/- patches chairWidthM / seatGapM / etc. (new object each time).
      const seedKey = [
        el.id,
        el.appliedConfigId ?? '',
        el.appliedConfigName ?? '',
        ...(el.gaConfiguredSides ?? []).map(
          (side) => `${side.logicalId}:${side.label}:${side.lengthM ?? ''}`,
        ),
      ].join('|');
      if (seedKey === this.draftsSeededForKey) {
        return;
      }
      this.draftsSeededForKey = seedKey;

      this.selectedConfigId.set(el.appliedConfigId ?? '');
      this.saveConfigName.set(el.appliedConfigName ?? '');
      this.gaConfigName.set(el.appliedConfigName ?? '');
      this.sideLengthBaselines.set({});

      const labels: Record<number, string | undefined> = {};
      const lengths: Record<number, number | undefined> = {};

      // Confirmed sides take highest priority.
      for (const side of el.gaConfiguredSides ?? []) {
        labels[side.logicalId] = side.label;
        if (side.lengthM != null) {
          lengths[side.logicalId] = side.lengthM;
        }
      }

      this.gaDraftLabels.set(labels);
      this.gaDraftLengths.set(lengths);
      untracked(() => this.prefillSideDraftsFromEdges());
    });

    // Fill every side's label/length as soon as configure edges exist — no click required.
    effect(() => {
      const edges = this.gaWorkspaceEdges();
      if (!edges || edges.length === 0) {
        return;
      }
      untracked(() => this.prefillSideDraftsFromEdges());
    });

    // When a side is selected: pre-fill with saved values (or geometric name as suggestion),
    // focus the label input for immediate typing.
    // Only react to pendingId — other signal reads must be untracked, or every +/-
    // length nudge re-fires this and used to jump the sidebar (scrollIntoView + select).
    // Focus uses preventScroll; scrollIntoView only runs inside the local sidebar scroller
    // when the row is actually outside that rail's viewport.
    effect(() => {
      const pendingId = this.gaPendingSideId();
      if (pendingId == null) {
        return;
      }
      untracked(() => {
        const edge = this.gaWorkspaceEdges()?.find((e) => e.id === pendingId);
        if (!edge) {
          return;
        }
        // If no label typed/saved yet, suggest the geometric side name (e.g. "Side 1").
        if (!this.gaDraftLabels()[pendingId]) {
          this.gaDraftLabels.update((current) => ({ ...current, [pendingId]: edge.sideLabel }));
        }
        // Pre-fill length: prefer GA-saved value, then fall back to the seating/dining
        // measurement (customSideLengthsM) stored on the same block.
        if (this.gaDraftLengths()[pendingId] == null) {
          const fallback = edge.lengthM ?? edge.suggestedLengthM;
          if (fallback != null) {
            this.gaDraftLengths.update((current) => ({ ...current, [pendingId]: fallback }));
          }
        }
      });
      // Focus the newly selected side without scrolling admin <main>.
      // Local sidebar may scroll only when the row is outside its own viewport.
      setTimeout(() => {
        const input = document.getElementById(`ga-label-input-${pendingId}`) as HTMLInputElement | null;
        if (!input) {
          return;
        }
        input.focus({ preventScroll: true });
        input.select();
        const sidebar = input.closest('.designer-sidebar-col') as HTMLElement | null;
        if (!sidebar) {
          return;
        }
        const inputRect = input.getBoundingClientRect();
        const sideRect = sidebar.getBoundingClientRect();
        if (inputRect.top < sideRect.top || inputRect.bottom > sideRect.bottom) {
          input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 0);
    });

    // Sync draft labels/lengths from confirmed sides when their content changes
    // (e.g. after template apply) — not on every unrelated block property patch.
    effect(() => {
      const syncKey = this.gaConfiguredSidesSyncKey();
      void syncKey;
      untracked(() => {
        const configured = this.gaConfiguredSides();
        this.gaDraftLabels.update((current) => {
          const merged = { ...current };
          for (const side of configured) {
            merged[side.logicalId] = side.label;
          }
          return merged;
        });
        this.gaDraftLengths.update((current) => {
          const merged = { ...current };
          for (const side of configured) {
            if (side.lengthM != null) {
              merged[side.logicalId] = side.lengthM;
            }
          }
          return merged;
        });
      });
    });

    // Pre-fill max participants when entering that step.
    effect(() => {
      if (this.gaMaxParticipantsStep()) {
        this.gaDraftMaxParticipants.set(this.gaExistingMaxParticipants());
      }
    });

    // Pre-fill Auto Fill settings once when measurements are first saved in the workspace.
    effect(() => {
      const workspaceBlockId = this.canvas.blockWorkspaceId();
      if (!workspaceBlockId) {
        untracked(() => {
          this.autofillPrefillCapturedForBlockId = null;
        });
        return;
      }
      if (this.selectedBlockType() !== 'seating' || !this.showAutofillChoiceSection()) {
        return;
      }
      if (this.autofillPrefillCapturedForBlockId === workspaceBlockId) {
        return;
      }
      untracked(() => {
        this.canvas.captureAutoFillConfigFromWorkspaceBlock();
        this.autofillPrefillCapturedForBlockId = workspaceBlockId;
      });
    });

    // Capture per-side length baselines for proportional scaling in configure.
    effect(() => {
      const edges = this.gaWorkspaceEdges();
      const type = this.selectedBlockType();
      if (!edges || !blockTypeUsesSideLabelConfigureUi(type)) {
        return;
      }
      untracked(() => {
        const current = this.sideLengthBaselines();
        const baselines: Record<number, number> = { ...current };
        let changed = false;
        for (const edge of edges) {
          if (baselines[edge.id] != null && baselines[edge.id] > 0) {
            continue;
          }
          const suggested = edge.lengthM ?? edge.suggestedLengthM;
          if (suggested != null && suggested > 0) {
            baselines[edge.id] = suggested;
            changed = true;
          }
        }
        if (changed) {
          this.sideLengthBaselines.set(baselines);
        }
      });
    });
  }

  protected exitWorkspace(): void {
    this.canvas.exitBlockWorkspace();
  }

  protected onBlockTypeChange(raw: string): void {
    const el = this.block();
    if (!el) {
      return;
    }
    const next = (raw || null) as BlockTypeId | null;
    this.canvas.setBlockType(el.id, next);
    this.selectedConfigId.set('');
    this.saveConfigName.set('');
  }

  protected onSavedConfigChange(configId: string): void {
    this.selectedConfigId.set(configId);
    const el = this.block();
    if (!el || !configId) {
      return;
    }
    const template = this.templates.getById(configId);
    if (!template) {
      return;
    }
    this.canvas.applyBlockConfigTemplate(
      el.id,
      template.id,
      template.name,
      template.seating,
      template.dining,
      template.ga,
    );
    this.saveConfigName.set(template.name);
    if (template.ga) {
      this.gaConfigName.set(template.name);
    }
    const viewpointAngle =
      template.seating?.blockViewpointAngleDeg ??
      template.dining?.blockViewpointAngleDeg;
    const sideIndex =
      template.seating?.dragSeatsStadiumSideIndex ??
      template.dining?.dragSeatsStadiumSideIndex;
    if (viewpointAngle != null) {
      this.canvas.setBlockWorkspaceViewpointAngle(viewpointAngle);
    } else if (sideIndex != null) {
      this.canvas.setBlockWorkspaceSeatingSideIndex(sideIndex);
    }
    this.canvas.confirmBlockWorkspaceViewpoint();
    this.canvas.refreshBlockWorkspaceSidesConfigured();
    this.toast.success(`Applied "${template.name}" to this block.`);
  }

  protected adjustViewpoint(delta: number): void {
    const current = this.canvas.blockWorkspaceViewpointAngleDeg();
    this.canvas.setBlockWorkspaceViewpointAngle(current + delta);
  }

  protected resetViewpoint(): void {
    this.canvas.resetBlockWorkspaceViewpoint();
  }

  protected refitView(): void {
    this.canvas.refitBlockWorkspaceView();
  }

  protected confirmViewpoint(): void {
    this.canvas.confirmBlockWorkspaceViewpoint();
    this.toast.success('VIEW POINT set — configure each block side next.');
  }

  protected async saveCurrentConfig(): Promise<void> {
    const el = this.block();
    const blockType = this.selectedBlockType();
    if (!el || !blockType) {
      this.toast.error('Choose a block type first.');
      return;
    }
    const name = this.saveConfigName().trim();
    if (!name) {
      this.toast.error('Enter a name for this configuration.');
      return;
    }

    try {
      const seating =
        blockType === 'seating' ? this.canvas.exportBlockSeatingConfig(el.id) ?? undefined : undefined;
      const dining =
        blockType === 'dining-table' ? this.canvas.exportBlockDiningConfig(el.id) ?? undefined : undefined;
      const existingId = this.selectedConfigId() || el.appliedConfigId || null;
      const saved = await this.templates.saveTemplate({
        name,
        blockType,
        shapeType: el.shape,
        seating,
        dining,
        existingId,
      });
      this.selectedConfigId.set(saved.id);
      this.canvas.linkBlockToSavedConfig(el.id, saved.id, saved.name);
      this.canvas.markBlockWorkspaceConfigSaved();
      this.toast.success(`Saved "${saved.name}".`);

      if (blockType === 'seating' && seating) {
        const candidates = this.canvas.findSimilarSeatingBlocks(el.id);
        if (candidates.some((candidate) => candidate.selectable)) {
          this.canvas.openBulkApplyPrompt({
            sourceId: el.id,
            sourceLabel: el.label?.trim() || el.name?.trim() || 'Block',
            sourceTierLabel: resolveBlockTierLabel(el, this.canvas.elements(), this.canvas.canvas()),
            configId: saved.id,
            configName: saved.name,
            snapshot: seating,
            candidates,
          });
          return;
        }
      }

      this.canvas.exitBlockWorkspace();
    } catch (error) {
      this.toast.error(error instanceof Error ? error.message : 'Could not save configuration.');
    }
  }

  // ── General Admission methods ─────────────────────────────────────────────

  /** Put suggested label/length on every side so values show without a click. */
  private prefillSideDraftsFromEdges(): void {
    const edges = this.gaWorkspaceEdges();
    if (!edges || edges.length === 0) {
      return;
    }
    const labels = { ...this.gaDraftLabels() };
    const lengths = { ...this.gaDraftLengths() };
    let labelsChanged = false;
    let lengthsChanged = false;
    for (const edge of edges) {
      if (labels[edge.id] == null || labels[edge.id] === '') {
        labels[edge.id] = edge.sideLabel;
        labelsChanged = true;
      }
      if (lengths[edge.id] == null) {
        const suggested = edge.lengthM ?? edge.suggestedLengthM;
        if (suggested != null) {
          lengths[edge.id] = suggested;
          lengthsChanged = true;
        }
      }
    }
    if (labelsChanged) {
      this.gaDraftLabels.set(labels);
    }
    if (lengthsChanged) {
      this.gaDraftLengths.set(lengths);
    }
  }

  /** Update the draft label for a specific side. */
  protected gaSetDraftLabel(logicalId: number, value: string): void {
    this.gaDraftLabels.update((current) => ({ ...current, [logicalId]: value }));
  }

  /** Update the draft length (metres) for a specific side — seating/dining scales all sides together. */
  protected gaSetDraftLength(logicalId: number, value: string | number): void {
    const num = typeof value === 'number' ? value : parseFloat(value);
    const newLength = isNaN(num) || num <= 0 ? undefined : num;
    const type = this.selectedBlockType();

    if (blockTypeHasCustomizationFlow(type) && newLength != null) {
      const baselines = this.sideLengthBaselines();
      const baseline = baselines[logicalId];
      if (baseline && baseline > 0) {
        const factor = computeSideScaleFactorFromSingleEdit(baseline, newLength);
        const scaled = scaleSideLengthMapByFactor(baselines, factor);
        const next: Record<number, number | undefined> = { ...this.gaDraftLengths() };
        for (const [id, length] of Object.entries(scaled)) {
          next[Number(id)] = length;
        }
        this.gaDraftLengths.set(next);
        return;
      }
    }

    this.gaDraftLengths.update((current) => ({
      ...current,
      [logicalId]: newLength,
    }));
  }

  protected nudgeGaDraftLength(logicalId: number, deltaM: number): void {
    const current = this.gaDraftLengths()[logicalId];
    const base = current != null && current > 0 ? current : 1;
    const next = Math.max(0.1, Math.round((base + deltaM) * 100) / 100);
    this.gaSetDraftLength(logicalId, next);
  }

  protected onMeasurementStepDown(logicalId: number, direction: -1 | 1, event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    if (target instanceof HTMLElement && target.setPointerCapture) {
      target.setPointerCapture(event.pointerId);
    }
    this.stopMeasurementHold();
    const step = BlockWorkspaceSidebarComponent.SIDE_LENGTH_STEP_M;
    this.measurementHold = startPressHoldRepeat(() => this.nudgeGaDraftLength(logicalId, direction * step));
  }

  protected onMeasurementStepUp(event: PointerEvent): void {
    event.stopPropagation();
    const target = event.currentTarget;
    if (target instanceof HTMLElement && target.releasePointerCapture) {
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer may already be released.
      }
    }
    this.stopMeasurementHold();
  }

  @HostListener('window:pointerup')
  @HostListener('window:pointercancel')
  protected onWindowPointerUp(): void {
    this.stopMeasurementHold();
    this.stopAutoFillDimHold();
  }

  ngOnDestroy(): void {
    this.stopMeasurementHold();
    this.stopAutoFillDimHold();
  }

  private stopMeasurementHold(): void {
    this.measurementHold?.stop();
    this.measurementHold = null;
  }

  private stopAutoFillDimHold(): void {
    this.autoFillDimHold?.stop();
    this.autoFillDimHold = null;
  }

  private refreshSideLengthBaselinesFromDrafts(): void {
    const drafts = this.gaDraftLengths();
    const baselines: Record<number, number> = {};
    for (const [id, length] of Object.entries(drafts)) {
      if (length != null && length > 0) {
        baselines[Number(id)] = length;
      }
    }
    if (Object.keys(baselines).length > 0) {
      this.sideLengthBaselines.set(baselines);
    }
  }

  /** Select a side (highlight yellow on canvas) and confirm its draft label + length. */
  protected gaConfirmSideById(logicalId: number): void {
    const label = (this.gaDraftLabels()[logicalId] ?? '').trim();
    if (!label) {
      this.toast.error('Enter a label for this side first.');
      return;
    }
    const lengthM = this.gaDraftLengths()[logicalId];
    if (!lengthM || lengthM <= 0) {
      this.toast.error('Enter a length in metres for this side first.');
      return;
    }

    if (blockTypeHasCustomizationFlow(this.selectedBlockType())) {
      if (!this.canvas.gaConfirmAllSidesFromDrafts(this.gaDraftLabels(), this.gaDraftLengths())) {
        this.toast.error('Enter a label and length for every side first.');
        return;
      }
      this.refreshSideLengthBaselinesFromDrafts();
      const synced = this.measurementSyncInfo();
      if (synced.length > 0) {
        this.toast.success(
          `Measurements saved. ${synced.length} other block${synced.length === 1 ? '' : 's'} updated — see Inspector panel on the right.`,
        );
      } else {
        this.toast.success('Block measurements saved.');
      }
      return;
    }

    this.canvas.gaSelectSide(logicalId);
    this.canvas.gaConfirmSide(label, lengthM);
  }

  protected gaGoToMaxParticipants(): void {
    this.canvas.gaEnterMaxParticipantsStep();
  }

  protected proceedAfterSideLabelConfigure(): void {
    const type = this.selectedBlockType();
    if (blockTypeHasGaFlow(type)) {
      this.gaGoToMaxParticipants();
      return;
    }
    // Seating / dining stay on configure after sides (choice section unlocks edit).
    if (blockTypeHasCustomizationFlow(type)) {
      return;
    }
    if (!this.canvas.completeSideLabelConfigureStep()) {
      this.toast.error('Label and save every side before continuing.');
    }
  }

  /** Which auto-fill measurement is highlighted on the mini seat diagram. */
  private readonly focusedAutoFillDim = signal<AutoFillDim | null>(null);
  private readonly hoveredAutoFillDim = signal<AutoFillDim | null>(null);
  /** Hover wins over focus so the diagram always tracks the pointer. */
  protected readonly activeAutoFillDim = computed(
    () => this.hoveredAutoFillDim() ?? this.focusedAutoFillDim(),
  );

  /** Viewport position of the floating diagram card (fixed, next to the field). */
  protected readonly afdPopoverPos = signal<{ left: number; top: number } | null>(null);
  /** After first show, skip the pop-in animation so value updates do not flicker. */
  protected readonly afdPopoverShown = signal(false);

  protected readonly autoFillDimMeta: Record<AutoFillDim, { label: string; desc: string }> = {
    chairWidth: { label: 'Chair width', desc: 'how wide each chair is, side to side' },
    chairDepth: { label: 'Chair depth', desc: 'how deep each chair is, front to back' },
    seatGap: { label: 'Seat spacing', desc: 'space between chairs in the same row' },
    rowGap: { label: 'Row gap', desc: 'walking space between one row and the next' },
    borderGap: { label: 'Border gap', desc: 'empty margin between the block edge and the chairs' },
    curve: { label: 'Curve', desc: 'how much each row bows — higher is more curved, 0 is straight' },
  };

  /**
   * Diagram geometry in SVG px (viewBox 240×150), scaled from the real
   * measurements so changing a value visibly grows/shrinks that part:
   * 2 rows × 3 chairs inside the block border, all proportional.
   */
  protected readonly afdGeometry = computed(() => {
    const cfg = this.autoFillConfig();
    const chairWm = Math.max(cfg.chairWidthM || 0, 0.05);
    const chairDm = Math.max(cfg.chairLengthM || 0, 0.05);
    const seatGapM = Math.max(cfg.seatGapM || 0, 0);
    const rowGapM = Math.max(cfg.rowGapM || 0, 0);
    const borderM = Math.max(cfg.borderGapM || 0, 0);
    const curveDeg = cfg.curveEnabled ? Math.max(0, cfg.curveDeg || 0) : 0;

    const cols = 3;
    const rows = 2;
    const totalWm = cols * chairWm + (cols - 1) * seatGapM + 2 * borderM;
    const totalHm = rows * chairDm + (rows - 1) * rowGapM + 2 * borderM;
    const scale = Math.min(216 / totalWm, 126 / totalHm);

    const blockW = totalWm * scale;
    const blockH = totalHm * scale;
    const blockX = (240 - blockW) / 2;
    const blockY = (150 - blockH) / 2;
    const bp = borderM * scale;
    const cw = chairWm * scale;
    const cd = chairDm * scale;
    const sg = seatGapM * scale;
    const rg = rowGapM * scale;
    const halfSpan = Math.max(0.5, (cols - 1) / 2);
    const curveAmp = (curveDeg / 6) * Math.min(cd * 0.95, Math.max(8, (cols * cw + (cols - 1) * sg) * 0.18));

    const chairs: { x: number; y: number }[] = [];
    for (let r = 0; r < rows; r += 1) {
      const rowScale = rows <= 1 ? 1 : 0.28 + 0.72 * (r / (rows - 1));
      for (let c = 0; c < cols; c += 1) {
        const normalized = (c - (cols - 1) / 2) / halfSpan;
        const bow = -(normalized * normalized) * curveAmp * rowScale;
        chairs.push({
          x: blockX + bp + c * (cw + sg),
          y: blockY + bp + r * (cd + rg) + bow,
        });
      }
    }

    const seatStrips: { x: number; y: number; w: number; h: number }[] = [];
    for (let c = 0; c < cols - 1; c += 1) {
      for (let r = 0; r < rows; r += 1) {
        seatStrips.push({
          x: blockX + bp + cw + c * (cw + sg),
          y: blockY + bp + r * (cd + rg),
          w: sg,
          h: cd,
        });
      }
    }
    const innerW = blockW - 2 * bp;
    const rowStrip = { x: blockX + bp, y: blockY + bp + cd, w: innerW, h: rg };
    const borderPath =
      `M${blockX} ${blockY}h${blockW}v${blockH}h${-blockW}Z ` +
      `M${blockX + bp} ${blockY + bp}h${innerW}v${blockH - 2 * bp}h${-innerW}Z`;

    const c0 = chairs[0];
    const c1 = chairs[1];
    const c2 = chairs[2];
    const widthY = c0.y + cd * 0.62;
    const depthX = c1.x + cw / 2;
    return {
      blockX,
      blockY,
      blockW,
      blockH,
      borderPath,
      rowStrip,
      seatStrips,
      chairs,
      chairW: cw,
      chairD: cd,
      chairRx: Math.min(6, cw * 0.15, cd * 0.15),
      backInsetX: cw * 0.14,
      backInsetY: Math.min(4, cd * 0.1),
      backW: cw * 0.72,
      backH: Math.min(6, cd * 0.18),
      widthArrow: {
        x1: c0.x + 2,
        x2: c0.x + cw - 2,
        y: widthY,
        head1: cw > 24 ? `M${c0.x + 2} ${widthY}l7 -4v8Z` : '',
        head2: cw > 24 ? `M${c0.x + cw - 2} ${widthY}l-7 -4v8Z` : '',
      },
      depthArrow: {
        x: depthX,
        y1: c1.y + 2,
        y2: c1.y + cd - 2,
        head1: cd > 24 ? `M${depthX} ${c1.y + 2}l-4 7h8Z` : '',
        head2: cd > 24 ? `M${depthX} ${c1.y + cd - 2}l-4 -7h8Z` : '',
      },
      seatTicks: { x1: c0.x + cw, x2: c1.x, y: c0.y + cd / 2 },
      rowTicks: { x: c2.x + cw / 2, y1: c2.y + cd, y2: c2.y + cd + rg },
      borderTicks: { x1: blockX, x2: blockX + bp, y: blockY + blockH / 2 },
      curvePath: chairs
        .slice(0, cols)
        .map((chair, i) => `${i === 0 ? 'M' : 'L'}${chair.x + cw / 2} ${chair.y + cd / 2}`)
        .join(' '),
    };
  });

  protected setAutoFillDimFocus(dim: AutoFillDim, event?: Event): void {
    this.focusedAutoFillDim.set(dim);
    this.updateAfdPopoverPos(event);
  }

  protected clearAutoFillDimFocus(dim: AutoFillDim): void {
    if (this.focusedAutoFillDim() === dim) {
      this.focusedAutoFillDim.set(null);
    }
  }

  protected setAutoFillDimHover(dim: AutoFillDim, event?: Event): void {
    this.hoveredAutoFillDim.set(dim);
    this.updateAfdPopoverPos(event);
  }

  protected clearAutoFillDimHover(dim: AutoFillDim): void {
    if (this.hoveredAutoFillDim() === dim) {
      this.hoveredAutoFillDim.set(null);
    }
  }

  /** Anchors the diagram card just right of the hovered/focused field. */
  private updateAfdPopoverPos(event?: Event): void {
    const target = event?.currentTarget;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const anchor = target.closest('.afd-field') ?? target.closest('label') ?? target;
    const rect = anchor.getBoundingClientRect();
    const top = Math.max(8, Math.min(rect.top - 70, window.innerHeight - 250));
    this.afdPopoverPos.set({ left: rect.right + 14, top });
    this.afdPopoverShown.set(true);
  }

  /** Current value of a diagram dimension, trimmed for display ("0.061"). */
  protected autoFillDimValue(dim: AutoFillDim): number {
    const cfg = this.autoFillConfig();
    const value =
      dim === 'chairWidth'
        ? cfg.chairWidthM
        : dim === 'chairDepth'
          ? cfg.chairLengthM
          : dim === 'seatGap'
            ? cfg.seatGapM
            : dim === 'rowGap'
              ? cfg.rowGapM
              : dim === 'curve'
                ? cfg.curveDeg ?? 0
                : cfg.borderGapM;
    return Math.round(value * 1000) / 1000;
  }

  protected updateAutoFillConfig(patch: {
    chairWidthM?: number;
    chairLengthM?: number;
    seatGapM?: number;
    rowGapM?: number;
    borderGapM?: number;
    curveDeg?: number;
    curveEnabled?: boolean;
    aisles?: AutoFillAisleSlot[];
  }): void {
    const next: typeof patch = {};
    for (const [key, value] of Object.entries(patch) as [keyof typeof patch, unknown][]) {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        continue;
      }
      (next as Record<string, unknown>)[key] = value;
    }
    if (Object.keys(next).length === 0) {
      return;
    }
    this.canvas.setAutoFillSeatingConfig(next);
  }

  /**
   * Curve tick beside Auto Fill settings: on → keep the same settings/aisles UI
   * and set a default curve for Create seats; off → straight rows.
   */
  protected toggleAutoFillCurve(enabled: boolean): void {
    if (!enabled) {
      this.canvas.setAutoFillSeatingConfig({ curveEnabled: false });
      return;
    }
    const current = this.autoFillConfig().curveDeg ?? 0;
    this.canvas.setAutoFillSeatingConfig({
      curveEnabled: true,
      curveDeg: current > 0 ? current : AUTO_FILL_CURVE_DEFAULT_DEG,
    });
  }

  protected nudgeAutoFillCurve(delta: number): void {
    const current = clampAutoFillCurveDeg(this.autoFillConfig().curveDeg);
    const next = clampAutoFillCurveDeg(current + delta);
    if (next === current) {
      return;
    }
    this.canvas.setAutoFillSeatingConfig({ curveDeg: next, curveEnabled: true });
  }

  protected onCurveStepDown(direction: -1 | 1, event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    if (target instanceof HTMLElement && target.setPointerCapture) {
      target.setPointerCapture(event.pointerId);
    }
    this.stopMeasurementHold();
    this.measurementHold = startPressHoldRepeat(() =>
      this.nudgeAutoFillCurve(direction * AUTO_FILL_CURVE_STEP_DEG),
    );
  }

  protected onCurveStepUp(event: PointerEvent): void {
    this.onMeasurementStepUp(event);
  }

  protected readonly autoFillCurveMin = AUTO_FILL_CURVE_MIN;
  protected readonly autoFillCurveMax = AUTO_FILL_CURVE_MAX;

  protected readonly autoFillAisles = computed(() =>
    normalizeAutoFillAisles(this.autoFillConfig().aisles, this.autoFillConfig()),
  );

  protected addAutoFillAisle(): void {
    const current = this.autoFillAisles();
    const lastType = current[current.length - 1]?.type;
    const type: AutoFillAisleType =
      lastType === 'draw' || lastType === 'row' || lastType === 'column' || lastType === 'center'
        ? lastType
        : 'row';
    const slot = createDefaultAisleSlot(type);
    this.canvas.setAutoFillSeatingConfig({ aisles: [...current, slot] });
    if (type === 'draw' && slot.id) {
      this.canvas.startDrawAisle(slot.id);
    }
  }

  protected addDrawAisle(): void {
    const slot = createDefaultAisleSlot('draw');
    this.canvas.setAutoFillSeatingConfig({ aisles: [...this.autoFillAisles(), slot] });
    if (slot.id) {
      this.canvas.startDrawAisle(slot.id);
    }
  }

  protected startDrawAisle(aisleId: string | undefined, replace = false): void {
    if (!aisleId) {
      return;
    }
    this.canvas.startDrawAisle(aisleId, { replace });
  }

  protected isDrawingAisle(aisleId: string | undefined): boolean {
    const session = this.canvas.drawAisleSession();
    return Boolean(aisleId && session?.aisleId === aisleId);
  }

  protected drawAislePrompt(): string {
    const session = this.canvas.drawAisleSession();
    if (session?.pendingStart) {
      return 'Click the second point on the block.';
    }
    return 'Click the first point on the block.';
  }

  protected removeAutoFillAisle(index: number): void {
    const removed = this.autoFillAisles()[index];
    if (removed?.id && this.canvas.drawAisleSession()?.aisleId === removed.id) {
      this.canvas.cancelDrawAisle();
    }
    const aisles = this.autoFillAisles().filter((_, i) => i !== index);
    this.canvas.setAutoFillSeatingConfig({ aisles });
  }

  protected updateAutoFillAisle(index: number, patch: Partial<AutoFillAisleSlot>): void {
    if (patch.widthM != null && !Number.isFinite(patch.widthM)) {
      return;
    }
    const current = this.autoFillAisles()[index];
    const aisles = this.autoFillAisles().map((slot, i) => {
      if (i !== index) {
        return { ...slot };
      }
      const merged: AutoFillAisleSlot = { ...slot, ...patch };
      if (patch.type != null) {
        merged.type = patch.type as AutoFillAisleType;
        if (merged.type === 'center' && merged.centerAxis !== 'row' && merged.centerAxis !== 'column') {
          merged.centerAxis = 'column';
        }
        if (merged.type !== 'center') {
          merged.centerAxis = undefined;
        }
        if (merged.type !== 'draw') {
          merged.drawStart = undefined;
          merged.drawEnd = undefined;
        }
      }
      return merged;
    });
    this.canvas.setAutoFillSeatingConfig({ aisles });
    if (patch.type === 'draw' && aisles[index]?.id) {
      this.canvas.startDrawAisle(aisles[index].id!);
    }
    if (
      current?.type === 'draw' &&
      patch.widthM != null &&
      current.drawStart &&
      current.drawEnd
    ) {
      this.canvas.refillWorkspaceSeatsForDrawnAisle();
    }
  }

  private autoFillDimStepM(dim: AutoFillDim): number {
    return dim === 'chairWidth' || dim === 'chairDepth'
      ? BlockWorkspaceSidebarComponent.AUTO_FILL_CHAIR_STEP_M
      : BlockWorkspaceSidebarComponent.AUTO_FILL_GAP_STEP_M;
  }

  private autoFillDimMin(dim: AutoFillDim): number {
    return dim === 'chairWidth' || dim === 'chairDepth' ? 0.1 : 0;
  }

  protected nudgeAutoFillDim(dim: AutoFillDim, deltaM: number): void {
    const step = this.autoFillDimStepM(dim);
    const min = this.autoFillDimMin(dim);
    const next = Math.max(min, Math.round((this.autoFillDimValue(dim) + deltaM) * 1000) / 1000);
    const patch =
      dim === 'chairWidth'
        ? { chairWidthM: next }
        : dim === 'chairDepth'
          ? { chairLengthM: next }
          : dim === 'seatGap'
            ? { seatGapM: next }
            : dim === 'rowGap'
              ? { rowGapM: next }
              : { borderGapM: next };
    this.updateAutoFillConfig(patch);
  }

  protected onAutoFillDimStepDown(dim: AutoFillDim, direction: -1 | 1, event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    if (target instanceof HTMLElement && target.setPointerCapture) {
      target.setPointerCapture(event.pointerId);
    }
    // Keep focus off the number input so the browser does not scrollIntoView.
    if (target instanceof HTMLElement) {
      target.focus({ preventScroll: true });
    }
    this.stopAutoFillDimHold();
    const step = this.autoFillDimStepM(dim);
    this.autoFillDimHold = startPressHoldRepeat(() => this.nudgeAutoFillDim(dim, direction * step));
  }

  protected onAutoFillDimStepUp(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    if (target instanceof HTMLElement && target.releasePointerCapture) {
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer may already be released.
      }
    }
    this.stopAutoFillDimHold();
  }

  /** Block label activation / focus scroll when clicking +/− inside the field. */
  protected onAutoFillDimStepClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  protected parseNum(value: string | number): number {
    if (value === '' || value == null) {
      return Number.NaN;
    }
    const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(num)) {
      return Number.NaN;
    }
    // Keep inputs readable — avoid float junk like 0.06096000000000001.
    return Math.round(num * 1000) / 1000;
  }

  protected proceedToEditBlock(): void {
    if (!this.canvas.proceedToEditBlockFromWorkspace()) {
      this.toast.error('Label and save every side before continuing.');
      return;
    }
    const item = this.selectedBlockType() === 'dining-table' ? 'tables' : 'seats';
    this.toast.success(`Configure block complete — add ${item} with the tools below.`);
  }

  protected createSeatsForWorkspaceBlock(): void {
    const result = this.canvas.createSeatsForWorkspaceBlock();
    if (!result) {
      this.toast.error(this.canvas.autoFillError() ?? 'Could not create seats for this block.');
      return;
    }
    this.toast.success(
      `Created ${result.seatCount} seat${result.seatCount === 1 ? '' : 's'} on this block. Click Auto Fill, select/unselect blocks on the layout, then Auto Fill again to seat them.`,
    );
  }

  protected startAutoFillLayout(): void {
    if (!this.canvas.startAutoFillLayoutModeFromWorkspace()) {
      this.toast.error('Label and save every side, then try Auto Fill again.');
      return;
    }
    this.toast.success(
      'All blocks selected — click to unselect/select, then Auto Fill applies only to selected blocks.',
    );
  }

  protected gaBackToSides(): void {
    this.canvas.gaBackToSidesStep();
  }

  protected async gaSaveMaxParticipants(): Promise<void> {
    const count = this.gaDraftMaxParticipants();
    if (!count || count < 1) {
      this.toast.error('Enter a maximum participants count greater than 0.');
      return;
    }
    const el = this.block();
    if (!el) {
      return;
    }

    const name = this.gaConfigName().trim();
    if (name) {
      try {
        const ga = {
          gaConfiguredSides: el.gaConfiguredSides ? structuredClone(el.gaConfiguredSides) : undefined,
          gaMaxParticipants: count,
        };
        const existingId = this.selectedConfigId() || el.appliedConfigId || null;
        const saved = await this.templates.saveTemplate({
          name,
          blockType: 'general-admission',
          shapeType: el.shape,
          ga,
          existingId,
        });
        this.canvas.linkBlockToSavedConfig(el.id, saved.id, saved.name);
      } catch (error) {
        this.toast.error(error instanceof Error ? error.message : 'Could not save configuration.');
        return;
      }
    }

    this.canvas.gaConfirmMaxParticipants(count);
    this.toast.success('General Admission block saved.');
  }

}
