import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';

import { SupabaseService } from '../../../core/services/supabase.service';
import { LayoutCanvasService } from './layout-canvas.service';
import { renderVerificationImages, type AuditBlockSummary } from '../lib/audit-overlay';
import { referenceImageDrawRect } from '../lib/canvas-image';
import { rectFromPositionSize } from '../lib/geometry';
import { polygonCanvasPointsFromBlock } from '../lib/block-viewpoint';
import type { CvAnalysisResult, OcrToken } from '../lib/assign-ocr-labels';
import type { PointPct } from '../lib/contour-geometry';
import type { LayoutElement } from '../models/layout-element.model';
import { hasTracedBlockOutline } from '../models/layout-element.model';

const EDGE_FUNCTION = 'analyze-blueprint';

export type AuditPhase = 'idle' | 'running' | 'done' | 'error';

export type AuditIssueType = 'missing' | 'split' | 'merged' | 'misnamed' | 'extra' | 'malformed';

interface AuditRegion {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

/** Raw issue as returned by the verifyBlocks edge-function mode. */
interface VerificationIssue {
  type: AuditIssueType;
  realBlockLabel: string | null;
  detectedIndices: number[];
  approxRegion: AuditRegion | null;
  note: string;
}

interface VerificationResult {
  totalRealBlocks: number;
  issues: VerificationIssue[];
  confidence: 'low' | 'medium' | 'high';
  summary: string;
}

export interface AuditIssueView {
  /** Stable identity within one audit result (used for fix/accept tracking). */
  key: string;
  type: AuditIssueType;
  realBlockLabel: string | null;
  /** Canvas element ids affected (mapped from overlay badge numbers). */
  elementIds: string[];
  /** Approximate real-block bounding box in blueprint-image %. */
  approxRegion: AuditRegion | null;
  note: string;
}

/** Per-issue workflow status shown in the panel. */
export type MissingIssueStatus = 'open' | 'done';

export interface AuditResultView {
  /** Computed client-side: matched real blocks / total real blocks. */
  accuracyPct: number;
  totalRealBlocks: number;
  matchedBlocks: number;
  detectedBlockCount: number;
  /** Imperfectly created blocks: split / merged / misnamed / extra. */
  type2Issues: AuditIssueView[];
  /** Real blocks that were never created. */
  type3Issues: AuditIssueView[];
  confidence: 'low' | 'medium' | 'high';
  summary: string;
}

/** User-facing verification failure, mapped from the raw provider error. */
export interface AuditError {
  /** Visual treatment / icon in the panel. */
  kind: 'credits' | 'auth' | 'rate-limit' | 'network' | 'config' | 'model' | 'generic';
  title: string;
  /** Short, plain-language explanation of what went wrong. */
  message: string;
  /** What the user can do about it. */
  hint: string;
  /** External link that resolves the problem (e.g. the credits page). */
  actionUrl?: string;
  actionLabel?: string;
  /** Raw technical error, shown collapsed under "Technical details". */
  detail?: string;
}

/** Maps a raw invoke/provider error message to a friendly panel error. */
export function toAuditError(raw: string): AuditError {
  if (/\b402\b|requires more credits|add more credits|insufficient credits/i.test(raw)) {
    return {
      kind: 'credits',
      title: 'AI credits exhausted',
      message: 'The AI verification service has run out of OpenRouter credits, so this check could not run.',
      hint: 'Your layout is unaffected. Add credits to the OpenRouter account, then click Re-verify.',
      actionUrl: 'https://openrouter.ai/settings/credits',
      actionLabel: 'Add credits',
      detail: raw,
    };
  }
  if (/\b(401|403)\b|invalid api key|unauthorized|forbidden/i.test(raw)) {
    return {
      kind: 'auth',
      title: 'AI service not authorised',
      message: 'The AI provider rejected the configured API key.',
      hint: 'Check the OPENROUTER_API_KEY configured for the analyze-blueprint function, then click Re-verify.',
      detail: raw,
    };
  }
  if (/\b429\b|rate limit|too many requests|overloaded/i.test(raw)) {
    return {
      kind: 'rate-limit',
      title: 'AI service is busy',
      message: 'The AI provider is receiving too many requests right now.',
      hint: 'Wait a minute, then click Re-verify.',
      detail: raw,
    };
  }
  if (/not configured|outdated|redeploy|not reachable/i.test(raw)) {
    return {
      kind: 'config',
      title: 'AI verifier needs setup',
      message: 'The verification service is not fully configured yet.',
      hint: 'Ask your administrator to complete the setup described in AI_DETECTION_SETUP.md.',
      detail: raw,
    };
  }
  if (/JSON|did not contain a JSON object|empty response/i.test(raw)) {
    return {
      kind: 'model',
      title: 'AI gave an unreadable answer',
      message: 'The AI verifier responded, but its answer was garbled and could not be read.',
      hint: 'This is a one-off glitch, not a problem with your layout — click Re-verify to run the check again.',
      detail: raw,
    };
  }
  if (/failed to fetch|networkerror|timed? ?out|\b(502|503|504)\b/i.test(raw)) {
    return {
      kind: 'network',
      title: 'Could not reach the AI verifier',
      message: 'The verification service did not respond.',
      hint: 'Check your internet connection and try again in a moment.',
      detail: raw,
    };
  }
  return {
    kind: 'generic',
    title: 'Verification failed',
    message: 'Something went wrong while checking the blocks against the blueprint.',
    hint: 'Your layout is unaffected. Click Re-verify to try again.',
    detail: raw,
  };
}

export interface AuditContext {
  file: File;
  detection: CvAnalysisResult;
  /** Per labeledBlocks index: created element id, or null when rejected. */
  blockElementIds: (string | null)[];
}

/** A block as it currently exists on the canvas, in blueprint-image %. */
interface CanvasAuditBlock {
  elementId: string;
  label: string;
  polygon: PointPct[];
}

/**
 * Runs the AI verification pass after blueprint blocks are generated:
 * renders the blueprint + numbered-outline overlay, sends both to the
 * verifyBlocks edge-function mode, and exposes the audit as signals for the
 * results panel. Failures never touch the generated layout.
 */
@Injectable({ providedIn: 'root' })
export class BlueprintAuditService {
  private readonly supabase = inject(SupabaseService);
  private readonly canvas = inject(LayoutCanvasService);

  readonly phase = signal<AuditPhase>('idle');
  readonly result = signal<AuditResultView | null>(null);
  readonly error = signal<AuditError | null>(null);

  /**
   * Per-issue workflow: 'fixing' after Fix (waiting for a traced block),
   * 'accepted' after OK, 'fixed' after an applied auto-fix (rename / remove).
   */
  private readonly issueStates = signal<Record<string, 'fixing' | 'accepted' | 'fixed'>>({});

  /** Row whose Fix is active — its Trace/Draw mode toggle is shown. */
  readonly activeFixKey = signal<string | null>(null);
  /** Sidebar + canvas: which issue row is focused (click / Fix). */
  readonly focusedIssueKey = signal<string | null>(null);
  /** How the user creates the fixed block: click-trace or manual dot drawing. */
  readonly fixMode = signal<'trace' | 'draw'>('trace');
  private activeFixRegion: { x: number; y: number; width: number; height: number } | null = null;

  /** Issue whose region box is currently highlighted — target of canvas drag adjustments. */
  private highlightedRegionKey: string | null = null;
  /**
   * User-adjusted missing-block positions (blueprint-image %), by issue key.
   * Set by dragging the dashed suggestion box on the canvas; overrides the
   * OCR/model guess for focus, fix targeting and the resolved-anchor check.
   */
  private readonly manualRegions = signal<Record<string, AuditRegion>>({});

  /**
   * Issues in 'fixing' state whose anchor point is now covered by a block
   * element. Reactive: tracing a block turns the row green, deleting that
   * block turns it red again. Covers missing blocks and the redraw-style
   * fixes on detection issues (merged / bad shape).
   */
  private readonly resolvedFixKeys = computed<ReadonlySet<string>>(() => {
    const keys = new Set<string>();
    const report = this.result();
    if (!report) {
      return keys;
    }
    const states = this.issueStates();
    const elements = this.canvas.elements();
    for (const issue of [...report.type3Issues, ...report.type2Issues]) {
      if (states[issue.key] !== 'fixing') {
        continue;
      }
      const anchor = this.issueAnchorPoint(issue);
      if (anchor && anchorCoveredByBlock(anchor, elements, this.canvas.canvas())) {
        keys.add(issue.key);
      }
    }
    return keys;
  });

  /**
   * Live fix progress across ALL issues (missing + detection): how many are
   * resolved and what the accuracy would be if the audit re-ran now. The main
   * score stays the AI-verified snapshot — this is the honest "after your
   * fixes" projection, confirmed for real by Re-verify.
   */
  readonly fixProgress = computed<{
    resolvedCount: number;
    totalIssues: number;
    projectedPct: number;
    allResolved: boolean;
  } | null>(() => {
    const report = this.result();
    if (!report) {
      return null;
    }
    const all = [...report.type3Issues, ...report.type2Issues];
    if (all.length === 0) {
      return null;
    }
    let resolvedCount = 0;
    // Mirror buildView's accuracy: each open non-'extra' issue makes its real
    // block unmatched; resolving it restores the block.
    const affectedLabels = new Set<string>();
    let unlabeled = 0;
    for (const issue of all) {
      if (this.issueStatus(issue) === 'done') {
        resolvedCount += 1;
        continue;
      }
      if (issue.type !== 'extra') {
        affectedLabels.add(issue.realBlockLabel ?? `__unlabeled-${unlabeled++}`);
      }
    }
    const affected = Math.min(report.totalRealBlocks, affectedLabels.size);
    const matched = Math.max(0, report.totalRealBlocks - affected);
    const projectedPct =
      report.totalRealBlocks > 0 ? Math.round((100 * matched) / report.totalRealBlocks) : 100;
    return {
      resolvedCount,
      totalIssues: all.length,
      projectedPct,
      allResolved: resolvedCount === all.length,
    };
  });

  /** Open detection issues that can be fixed in one click (rename / remove). */
  readonly autoFixableCount = computed<number>(() => {
    const report = this.result();
    if (!report) {
      return 0;
    }
    return report.type2Issues.filter(
      (issue) => this.issueStatus(issue) !== 'done' && this.isAutoFixable(issue),
    ).length;
  });

  private context: AuditContext | null = null;
  private runToken = 0;
  /** True while focusIssue/fixIssue updates selection — skip dismiss-on-select. */
  private suppressSelectionClear = false;

  constructor() {
    // Keep canvas audit highlight in sync with the user's real selection:
    // opening another block (or its workspace) must drop the previous dashed box.
    effect(() => {
      const workspaceId = this.canvas.blockWorkspaceId();
      const selectedId = this.canvas.selectedId();
      const highlight = this.canvas.auditHighlight();
      const focusedKey = this.focusedIssueKey();
      if (!highlight && !focusedKey) {
        return;
      }

      untracked(() => {
        if (this.suppressSelectionClear) {
          return;
        }
        if (workspaceId) {
          this.clearFocusUi();
          return;
        }
        if (!highlight) {
          return;
        }
        if (highlight.kind === 'elements') {
          if (selectedId && !highlight.ids.includes(selectedId)) {
            this.clearFocusUi();
          }
          return;
        }
        // Missing-block region highlight — clear as soon as the user picks any block.
        if (selectedId) {
          this.clearFocusUi();
        }
      });
    });

    // Trace-mode counterpart of onCustomDrawCompleted: when a Fix's traced
    // block covers the missing block's spot, stamp the printed label on it.
    // OCR cannot reliably read separator labels (WU_2, S-U2), so tracing often
    // creates the block nameless — the issue's real label is authoritative.
    effect(() => {
      const resolved = this.resolvedFixKeys();
      const report = this.result();
      if (!report || resolved.size === 0) {
        return;
      }
      untracked(() => {
        for (const issue of [...report.type3Issues, ...report.type2Issues]) {
          if (!resolved.has(issue.key)) {
            continue;
          }
          const label = issue.realBlockLabel?.trim();
          if (!label) {
            continue;
          }
          const anchor = this.issueAnchorPoint(issue);
          if (!anchor) {
            continue;
          }
          const el = blockCoveringPoint(anchor, this.canvas.elements(), this.canvas.canvas());
          if (!el || el.type !== 'centerpiece' || el.name === label) {
            continue;
          }
          // Rename only nameless / default / near-miss blocks ("WU 2" → "WU_2").
          // A covering block with a genuinely different name is a neighbour that
          // happens to overlap the spot — never rename it.
          const current = normalizeLabel(el.name);
          if (!current || current === 'custompiece' || current === normalizeLabel(label)) {
            this.canvas.updateSilent(el.id, { name: label, label });
          }
        }
      });
    });
  }

  /** Drops sidebar active row + canvas dashed highlight (Fix/Trace targeting too). */
  private clearFocusUi(): void {
    if (
      !this.focusedIssueKey() &&
      !this.activeFixKey() &&
      !this.canvas.auditHighlight() &&
      !this.highlightedRegionKey
    ) {
      return;
    }
    this.focusedIssueKey.set(null);
    this.activeFixKey.set(null);
    this.activeFixRegion = null;
    this.highlightedRegionKey = null;
    this.canvas.setAuditHighlight(null);
    this.canvas.colorDetectMode.set(false);
    this.canvas.traceTargetRect.set(null);
    if (this.canvas.drawingElementId() === '__draft__') {
      this.canvas.cancelDrawing();
    }
  }

  private withSelectionClearSuppressed(fn: () => void): void {
    this.suppressSelectionClear = true;
    try {
      fn();
    } finally {
      queueMicrotask(() => {
        this.suppressSelectionClear = false;
      });
    }
  }

  /** Stores the analysis context and starts the audit (fire-and-forget). */
  start(context: AuditContext): void {
    this.context = context;
    void this.run();
  }

  /** Re-runs the audit with the stored context. */
  retry(): void {
    if (this.context && this.phase() !== 'running') {
      void this.run();
    }
  }

  /** Clears the audit (e.g. when starting a new layout). */
  reset(): void {
    this.runToken += 1;
    this.context = null;
    this.phase.set('idle');
    this.result.set(null);
    this.error.set(null);
    this.issueStates.set({});
    this.activeFixKey.set(null);
    this.focusedIssueKey.set(null);
    this.activeFixRegion = null;
    this.fixMode.set('trace');
    this.highlightedRegionKey = null;
    this.manualRegions.set({});
    this.canvas.setAuditHighlight(null);
  }

  /**
   * Canvas drag moved the highlighted missing-block box — remember the
   * adjusted spot so focus/fix/trace all target it instead of the OCR guess.
   */
  moveHighlightRegion(rect: { x: number; y: number; width: number; height: number }): void {
    const key = this.highlightedRegionKey;
    if (!key) {
      return;
    }
    const current = this.canvas.auditHighlight();
    if (current?.kind === 'region') {
      this.canvas.setAuditHighlight({ ...current, rect }, 0);
    }
    const region = this.canvasRectToRegion(rect);
    if (region) {
      this.manualRegions.update((s) => ({ ...s, [key]: region }));
    }
    if (this.activeFixKey() === key) {
      this.activeFixRegion = rect;
      if (this.fixMode() === 'trace') {
        this.canvas.traceTargetRect.set(rect);
      }
    }
  }

  /** Workflow status of any issue (drives red/green in the panel). */
  issueStatus(issue: AuditIssueView): MissingIssueStatus {
    const state = this.issueStates()[issue.key];
    if (state === 'accepted' || state === 'fixed') {
      return 'done';
    }
    if (state === 'fixing' && this.resolvedFixKeys().has(issue.key)) {
      return 'done';
    }
    return 'open';
  }

  /**
   * Whether a detection issue has a deterministic one-click fix:
   * misnamed → rename the block to its printed label; extra → delete it.
   * Merged / bad-shape blocks need a redraw, so they go through Fix instead.
   */
  isAutoFixable(issue: AuditIssueView): boolean {
    const liveIds = this.liveElementIds(issue);
    if (liveIds.length === 0) {
      return false;
    }
    if (issue.type === 'misnamed') {
      return (issue.realBlockLabel ?? '').trim().length > 0;
    }
    return issue.type === 'extra';
  }

  /** Applies the one-click fix for a misnamed (rename) or extra (remove) issue. */
  autoFixIssue(issue: AuditIssueView): void {
    if (this.issueStatus(issue) === 'done' || !this.isAutoFixable(issue)) {
      return;
    }
    const liveIds = this.liveElementIds(issue);
    if (issue.type === 'misnamed') {
      const label = (issue.realBlockLabel ?? '').trim();
      for (const id of liveIds) {
        const el = this.canvas.elements().find((item) => item.id === id);
        if (el && el.type === 'centerpiece') {
          this.canvas.updateSilent(id, { name: label, label });
        }
      }
    } else {
      this.canvas.removeMany(liveIds);
    }
    this.issueStates.update((s) => ({ ...s, [issue.key]: 'fixed' }));
    if (this.activeFixKey() === issue.key) {
      this.activeFixKey.set(null);
    }
    if (this.focusedIssueKey() === issue.key) {
      this.clearFocusUi();
    }
  }

  /** Fix-all button — applies every open one-click fix (renames + removals). */
  fixAllDetectionIssues(): void {
    const report = this.result();
    if (!report) {
      return;
    }
    for (const issue of report.type2Issues) {
      if (this.issueStatus(issue) !== 'done' && this.isAutoFixable(issue)) {
        this.autoFixIssue(issue);
      }
    }
  }

  /** Issue element ids that still exist on the canvas. */
  private liveElementIds(issue: AuditIssueView): string[] {
    const elements = this.canvas.elements();
    return issue.elementIds.filter((id) => elements.some((el) => el.id === id));
  }

  /** OK button — user accepts the block as-is; row turns green immediately. */
  acceptIssue(issue: AuditIssueView): void {
    this.issueStates.update((s) => ({ ...s, [issue.key]: 'accepted' }));
    if (this.activeFixKey() === issue.key) {
      this.activeFixKey.set(null);
    }
    if (this.focusedIssueKey() === issue.key) {
      this.focusedIssueKey.set(null);
    }
  }

  /** Back button on a done row — reopens it (green → red). */
  reopenIssue(issue: AuditIssueView): void {
    this.issueStates.update((s) => {
      const next = { ...s };
      delete next[issue.key];
      return next;
    });
    if (this.activeFixKey() === issue.key) {
      this.activeFixKey.set(null);
    }
    if (this.focusedIssueKey() === issue.key) {
      this.focusedIssueKey.set(null);
    }
  }

  /** Switches how the active Fix creates the block: click-trace or dot drawing. */
  setFixMode(mode: 'trace' | 'draw'): void {
    this.fixMode.set(mode);
    if (mode === 'trace') {
      this.canvas.cancelDrawing();
      this.canvas.colorDetectMode.set(true);
      this.canvas.traceTargetRect.set(this.activeFixRegion);
      return;
    }
    this.canvas.colorDetectMode.set(false);
    this.canvas.startCustomPieceDrawing();
  }

  /**
   * Called when a manually drawn block is completed while a Fix is active —
   * names the new block after the missing block's printed label.
   */
  onCustomDrawCompleted(): void {
    const key = this.activeFixKey();
    const report = this.result();
    if (!key || !report) {
      return;
    }
    const issue = report.type3Issues.find((item) => item.key === key);
    const label = issue?.realBlockLabel;
    const id = this.canvas.selectedId();
    if (!label || !id) {
      return;
    }
    const el = this.canvas.elements().find((item) => item.id === id);
    if (el && el.type === 'centerpiece') {
      // The missing block's printed label is authoritative — override the
      // factory default ('Custom Piece') or a mis-resolved OCR name.
      this.canvas.updateSilent(id, { name: label, label });
    }
  }

  /**
   * Fix button — removes broken / irregular fragments sitting on the real
   * block's area, turns trace mode ON and zooms there so the user can click
   * the block on the blueprint. The row turns green once a traced block
   * covers the spot.
   */
  fixIssue(issue: AuditIssueView): void {
    const region = this.missingBlockCanvasRect(issue) ?? this.elementsCanvasRect(issue);
    if (!region) {
      return;
    }
    this.withSelectionClearSuppressed(() => {
      const brokenIds = this.brokenFragmentsInRegion(region, issue.elementIds);
      if (brokenIds.length > 0) {
        this.canvas.removeMany(brokenIds);
      }

      if (this.canvas.referenceImage()?.visible === false) {
        this.canvas.toggleReferenceImageVisible();
      }
      this.canvas.cancelDrawing();
      this.activeFixRegion = region;
      this.activeFixKey.set(issue.key);
      this.focusedIssueKey.set(issue.key);
      this.fixMode.set('trace');
      this.canvas.colorDetectMode.set(true);
      this.canvas.traceTargetRect.set(region);

      this.canvas.selectElement(null);
      this.canvas.focusCanvasRect(region);
      this.highlightedRegionKey = issue.key;
      this.canvas.setAuditHighlight(
        { kind: 'region', rect: region, label: issue.realBlockLabel ?? undefined },
        8000,
      );
      this.issueStates.update((s) => ({ ...s, [issue.key]: 'fixing' }));
    });
  }

  /** Selects + zooms to the affected blocks, or flashes the missing region. */
  focusIssue(issue: AuditIssueView): void {
    this.withSelectionClearSuppressed(() => {
      this.focusedIssueKey.set(issue.key);
      const liveIds = issue.elementIds.filter((id) =>
        this.canvas.elements().some((el) => el.id === id),
      );
      if (liveIds.length > 0) {
        this.canvas.selectElements(liveIds);
        this.canvas.fitCameraToElement(liveIds[0]);
        this.highlightedRegionKey = null;
        this.canvas.setAuditHighlight({ kind: 'elements', ids: liveIds }, 0);
        return;
      }
      // No live elements — always point somewhere: the label-token/model
      // region, or as a last resort where the issue's elements used to be.
      const rect = this.missingBlockCanvasRect(issue) ?? this.elementsCanvasRect(issue);
      if (rect) {
        this.canvas.selectElement(null);
        this.canvas.focusCanvasRect(rect);
        this.highlightedRegionKey = issue.key;
        // No auto-clear: the box stays so the user can drag it to the right
        // spot before running Fix.
        this.canvas.setAuditHighlight(
          {
            kind: 'region',
            rect,
            label: issue.realBlockLabel ?? undefined,
          },
          0,
        );
      }
    });
  }

  /**
   * Pieces that should be cleared when Fixing a block: linked issue
   * elements, plus any irregular/small junk whose footprint sits on this
   * slot. Large neighbours that only touch the edge are left alone.
   */
  private brokenFragmentsInRegion(
    region: { x: number; y: number; width: number; height: number },
    issueElementIds: string[],
  ): string[] {
    const canvasCfg = this.canvas.canvas();
    const regionArea = region.width * region.height;
    const ids = new Set<string>(
      issueElementIds.filter((id) => this.canvas.elements().some((el) => el.id === id)),
    );

    for (const el of this.canvas.elements()) {
      if (el.type !== 'centerpiece' || ids.has(el.id)) {
        continue;
      }
      const rect = rectFromPositionSize(el.position, el.size, canvasCfg);
      const overlapW =
        Math.min(rect.x + rect.width, region.x + region.width) - Math.max(rect.x, region.x);
      const overlapH =
        Math.min(rect.y + rect.height, region.y + region.height) - Math.max(rect.y, region.y);
      if (overlapW <= 0 || overlapH <= 0) {
        continue;
      }
      const elArea = rect.width * rect.height;
      if (elArea <= 0) {
        continue;
      }
      const overlapArea = overlapW * overlapH;
      const centerInside =
        rect.cx >= region.x &&
        rect.cx <= region.x + region.width &&
        rect.cy >= region.y &&
        rect.cy <= region.y + region.height;

      // Fragment mostly on this block (never a large neighbour that barely touches).
      const mostlyOnBlock = overlapArea >= elArea * 0.35;
      // Small / irregular junk whose centre sits on the missing slot.
      const smallJunkOnBlock =
        elArea <= regionArea * 1.5 && centerInside && overlapArea >= elArea * 0.12;

      if (mostlyOnBlock || smallJunkOnBlock) {
        ids.add(el.id);
      }
    }

    return [...ids];
  }

  /**
   * Canvas rect for a real block that has no created element. The printed
   * label's OCR token gives an exact position; the model's approxRegion is
   * only a rough visual guess, so it is used as a fallback (and for sizing).
   */
  private missingBlockCanvasRect(
    issue: AuditIssueView,
  ): { x: number; y: number; width: number; height: number } | null {
    const manual = this.manualRegions()[issue.key];
    if (manual) {
      return this.regionToCanvasRect(manual);
    }
    const token = this.findLabelToken(issue);
    if (token) {
      const wPct = issue.approxRegion?.wPct || 6;
      const hPct = issue.approxRegion?.hPct || 6;
      return this.regionToCanvasRect({
        xPct: token.xPct - wPct / 2,
        yPct: token.yPct - hPct / 2,
        wPct,
        hPct,
      });
    }
    return this.regionToCanvasRect(issue.approxRegion);
  }

  /**
   * Fallback fix region for issues without a label token / model region
   * (e.g. merged blocks): the bounding rect of their live canvas elements.
   */
  private elementsCanvasRect(
    issue: AuditIssueView,
  ): { x: number; y: number; width: number; height: number } | null {
    const canvasCfg = this.canvas.canvas();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of this.canvas.elements()) {
      if (!issue.elementIds.includes(el.id)) {
        continue;
      }
      const rect = rectFromPositionSize(el.position, el.size, canvasCfg);
      minX = Math.min(minX, rect.x);
      minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.width);
      maxY = Math.max(maxY, rect.y + rect.height);
    }
    if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) {
      return null;
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  /**
   * Snapshot of every custom block currently on the canvas, converted to
   * blueprint-image % — the ground truth the verification audits against.
   */
  private collectCanvasBlocks(context: AuditContext): CanvasAuditBlock[] {
    const canvasCfg = this.canvas.canvas();
    const drawRect = referenceImageDrawRect(
      canvasCfg,
      context.detection.width,
      context.detection.height,
      this.canvas.referenceImage()?.geometryScale ?? 1,
    );
    if (drawRect.width <= 0 || drawRect.height <= 0) {
      return [];
    }
    const result: CanvasAuditBlock[] = [];
    for (const el of this.canvas.elements()) {
      if (el.type !== 'centerpiece' || !hasTracedBlockOutline(el)) {
        continue;
      }
      const customPoints = el.customPoints ?? [];
      if (customPoints.length < 3) {
        continue;
      }
      const rect = rectFromPositionSize(el.position, el.size, canvasCfg);
      const polygon = polygonCanvasPointsFromBlock(customPoints, rect).map((p) => ({
        xPct: ((p.x - drawRect.x) / drawRect.width) * 100,
        yPct: ((p.y - drawRect.y) / drawRect.height) * 100,
      }));
      result.push({
        elementId: el.id,
        label: (el.name || el.label || '').trim(),
        polygon,
      });
    }
    return result;
  }

  /**
   * OCR tokens that look like block numbers but sit outside every created
   * block — deterministic "missing" issues merged into the AI report.
   */
  private findUncoveredLabelIssues(
    context: AuditContext,
    existing: AuditIssueView[],
  ): AuditIssueView[] {
    const tokens = this.canvas.referenceOcrTokens();
    if (tokens.length === 0) {
      return [];
    }
    const knownLabels = new Set(
      existing
        .map((issue) => normalizeLabel(issue.realBlockLabel))
        .filter((label) => label.length > 0),
    );
    const elements = this.canvas.elements();
    const canvasCfg = this.canvas.canvas();
    const drawRect = referenceImageDrawRect(
      canvasCfg,
      context.detection.width,
      context.detection.height,
      this.canvas.referenceImage()?.geometryScale ?? 1,
    );

    // Median detected-block size gives a sensible highlight box for the fix flow.
    const widths: number[] = [];
    const heights: number[] = [];
    for (const block of context.detection.labeledBlocks) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of block.polygon) {
        minX = Math.min(minX, p.xPct);
        minY = Math.min(minY, p.yPct);
        maxX = Math.max(maxX, p.xPct);
        maxY = Math.max(maxY, p.yPct);
      }
      widths.push(maxX - minX);
      heights.push(maxY - minY);
    }
    const median = (values: number[], fallback: number): number => {
      if (values.length === 0) {
        return fallback;
      }
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    const boxW = median(widths, 5);
    const boxH = median(heights, 5);

    const results: AuditIssueView[] = [];
    const seen = new Set<string>();
    let index = 0;
    for (const token of tokens) {
      const text = token.text.trim();
      // Block-number shaped only ("248", "A12"); single digits (gates/aisles) skipped.
      if (!/^[A-Za-z]?\d{2,4}[A-Za-z]?$/.test(text)) {
        continue;
      }
      if (token.yPct > 95) {
        continue; // Legend / capacity strip at the very bottom of the chart.
      }
      if (token.hPct !== undefined && token.hPct < 0.7) {
        continue; // Tiny glyphs are aisle/row numbers, not block labels.
      }
      const key = normalizeLabel(text);
      if (seen.has(key) || knownLabels.has(key)) {
        continue;
      }
      const anchor = {
        x: drawRect.x + (token.xPct / 100) * drawRect.width,
        y: drawRect.y + (token.yPct / 100) * drawRect.height,
      };
      // A block covers this spot, but only its OWN label counts as matched. When
      // a different (merged / oversized) block swallowed the area, its label
      // won't match — surface it so the merged block that hid this number is
      // visible in the list instead of being silently dropped.
      const covering = blockCoveringPoint(anchor, elements, canvasCfg);
      if (covering && normalizeLabel(covering.name) === key) {
        continue;
      }
      seen.add(key);
      results.push({
        key: `ocr-missing-${index++}`,
        type: 'missing',
        realBlockLabel: text,
        elementIds: covering ? [covering.id] : [],
        approxRegion: {
          xPct: Math.max(0, Math.min(100, token.xPct - boxW / 2)),
          yPct: Math.max(0, Math.min(100, token.yPct - boxH / 2)),
          wPct: boxW,
          hPct: boxH,
        },
        note: covering
          ? `Printed number ${text} sits inside "${(covering.name || '').trim() || 'an unnamed block'}" — its own block was merged into a neighbour, so ${text} is missing.`
          : `Printed number ${text} is not covered by any created block.`,
      });
    }
    return results;
  }

  /**
   * Created blocks whose polygon is deformed — a tiny fragment or a jagged blob
   * instead of a clean seating section. Deterministic replacement for the old
   * vision "split" reports (which false-positived on adjacent tiers like an
   * upper 344 vs a lower 244). Shown under Detection issues; clicking one zooms
   * to the block so the user can redraw it.
   */
  private findMalformedShapeIssues(blocks: CanvasAuditBlock[]): AuditIssueView[] {
    if (blocks.length < 4) {
      return [];
    }
    const areas = blocks.map((b) => polygonAreaPct(b.polygon));
    const sorted = areas.filter((a) => a > 0).sort((a, b) => a - b);
    if (sorted.length === 0) {
      return [];
    }
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median <= 0) {
      return [];
    }
    const results: AuditIssueView[] = [];
    let index = 0;
    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i];
      const area = areas[i];
      if (area <= 0) {
        continue;
      }
      const bounds = polygonBoundsPct(block.polygon);
      const bboxArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
      const fillRatio = bboxArea > 0 ? area / bboxArea : 0;
      // A clean angled/trapezoid block fills ~0.5+ of its bbox and is near the
      // median size. Flag only clearly broken outlines to avoid false positives.
      const tooSmall = area < 0.3 * median;
      const jaggedBlob = area < 0.55 * median && fillRatio < 0.42;
      if (!tooSmall && !jaggedBlob) {
        continue;
      }
      results.push({
        key: `shape-malformed-${index++}`,
        type: 'malformed',
        realBlockLabel: block.label || null,
        elementIds: [block.elementId],
        approxRegion: {
          xPct: bounds.minX,
          yPct: bounds.minY,
          wPct: bounds.maxX - bounds.minX,
          hPct: bounds.maxY - bounds.minY,
        },
        note: tooSmall
          ? 'Block shape is only a small fragment — redraw it to cover the whole section.'
          : 'Block outline is jagged / incomplete — redraw it to a clean section shape.',
      });
    }
    return results;
  }

  /** Canvas-px point where the missing block's printed label sits. */
  private issueAnchorPoint(issue: AuditIssueView): { x: number; y: number } | null {
    const detection = this.context?.detection;
    if (!detection) {
      return null;
    }
    const manual = this.manualRegions()[issue.key];
    const token = this.findLabelToken(issue);
    const region = issue.approxRegion;
    let xPct: number;
    let yPct: number;
    if (manual) {
      xPct = manual.xPct + manual.wPct / 2;
      yPct = manual.yPct + manual.hPct / 2;
    } else if (token) {
      xPct = token.xPct;
      yPct = token.yPct;
    } else if (region) {
      xPct = region.xPct + region.wPct / 2;
      yPct = region.yPct + region.hPct / 2;
    } else {
      return null;
    }
    const drawRect = referenceImageDrawRect(
      this.canvas.canvas(),
      detection.width,
      detection.height,
      this.canvas.referenceImage()?.geometryScale ?? 1,
    );
    return {
      x: drawRect.x + (xPct / 100) * drawRect.width,
      y: drawRect.y + (yPct / 100) * drawRect.height,
    };
  }

  /** OCR token whose text matches the issue's real block label, if any. */
  private findLabelToken(issue: AuditIssueView): OcrToken | null {
    const label = normalizeLabel(issue.realBlockLabel);
    if (!label) {
      return null;
    }
    const matches = this.canvas
      .referenceOcrTokens()
      .filter((t) => normalizeLabel(t.text) === label);
    if (matches.length === 0) {
      return null;
    }
    const region = issue.approxRegion;
    if (matches.length === 1 || !region) {
      return matches[0];
    }
    // Duplicate labels on the chart — pick the one nearest the model's guess.
    const cx = region.xPct + region.wPct / 2;
    const cy = region.yPct + region.hPct / 2;
    return matches.reduce((best, t) =>
      Math.hypot(t.xPct - cx, t.yPct - cy) < Math.hypot(best.xPct - cx, best.yPct - cy)
        ? t
        : best,
    );
  }

  private async run(): Promise<void> {
    const context = this.context;
    if (!context) {
      return;
    }
    const token = ++this.runToken;
    this.phase.set('running');
    this.error.set(null);

    try {
      // Audit the CURRENT canvas state — user fixes (traced/drawn/renamed
      // blocks) must count, so re-verify never reports stale issues.
      const blocks = this.collectCanvasBlocks(context);
      const images = await renderVerificationImages(
        context.file,
        blocks.map((b) => ({ polygon: b.polygon })),
      );
      const summaries: AuditBlockSummary[] = blocks.map((b, i) => {
        const bounds = polygonBoundsPct(b.polygon);
        return {
          index: i + 1,
          label: b.label,
          cxPct: round1((bounds.minX + bounds.maxX) / 2),
          cyPct: round1((bounds.minY + bounds.maxY) / 2),
          wPct: round1(bounds.maxX - bounds.minX),
          hPct: round1(bounds.maxY - bounds.minY),
        };
      });

      const { data, error } = await this.supabase.client.functions.invoke<{
        verification?: VerificationResult;
        error?: string;
        /** Present when an outdated deployment ran full analysis instead. */
        tiers?: unknown;
      }>(EDGE_FUNCTION, {
        body: {
          verifyBlocks: true,
          imageBase64: images.original.base64,
          overlayBase64: images.overlay.base64,
          mimeType: 'image/jpeg',
          blocks: summaries,
        },
      });

      if (token !== this.runToken) {
        return; // A newer run (or reset) superseded this one.
      }
      if (error) {
        throw new Error(await this.describeInvokeError(error));
      }
      if (!data?.verification) {
        if (data && !data.error && 'tiers' in data) {
          // Old deployment ignored verifyBlocks and ran the full analysis mode.
          throw new Error(
            'The analyze-blueprint edge function is outdated — redeploy it to enable ' +
              'verification (see AI_DETECTION_SETUP.md).',
          );
        }
        throw new Error(data?.error ?? 'The verifier returned an empty response.');
      }

      this.issueStates.set({});
      // Issue keys change per run — stale drag adjustments must not remap.
      this.manualRegions.set({});
      this.highlightedRegionKey = null;
      this.result.set(this.buildView(data.verification, context, blocks));
      this.phase.set('done');
    } catch (err) {
      if (token !== this.runToken) {
        return;
      }
      this.error.set(toAuditError(err instanceof Error ? err.message : String(err)));
      this.phase.set('error');
    }
  }

  private buildView(
    verification: VerificationResult,
    context: AuditContext,
    blocks: CanvasAuditBlock[],
  ): AuditResultView {
    const detectedBlockCount = blocks.length;
    const elementsById = new Map(this.canvas.elements().map((el) => [el.id, el]));

    // Shape problems are found deterministically from geometry FIRST, for every
    // broken block — so the "Bad shape" list is complete and identical each run
    // (not left to the vision model's variable "misnamed" calls).
    const malformed = this.findMalformedShapeIssues(blocks);
    const malformedIds = new Set(malformed.flatMap((issue) => issue.elementIds));

    const issues: AuditIssueView[] = verification.issues
      // "split" is intentionally not reported: adjacent real blocks (e.g. an
      // upper-tier 344 and a lower-tier 244) were being flagged as one block
      // split in two, which is a false positive. Drop the type entirely.
      .filter((issue) => issue.type !== 'split')
      .map((issue, i) => {
        // The model sometimes puts the block index / real label only in the
        // note ("Detected block 24 has no label but covers C3") — recover
        // both so the row can highlight its block and offer a one-click fix.
        let indices = issue.detectedIndices ?? [];
        if (indices.length === 0 && issue.type !== 'missing') {
          indices = blockIndicesFromNote(issue.note, blocks.length);
        }
        let realBlockLabel = issue.realBlockLabel;
        if (!realBlockLabel && issue.type === 'misnamed') {
          realBlockLabel = labelFromNote(issue.note);
        }
        return {
          key: `${issue.type}-${i}`,
          type: issue.type,
          realBlockLabel,
          elementIds: indices
            .map((idx) => blocks[idx - 1]?.elementId ?? null)
            .filter((id): id is string => id !== null),
          approxRegion: issue.approxRegion,
          note: issue.note,
        };
      })
      .filter((issue) => {
        // Drop hallucinated "misnamed" reports: the block already carries
        // exactly the label the issue asks for.
        if (issue.type !== 'misnamed') {
          return true;
        }
        const want = normalizeLabel(issue.realBlockLabel);
        if (!want || issue.elementIds.length === 0) {
          return true;
        }
        return !issue.elementIds.some((id) => {
          const el = elementsById.get(id);
          return el !== undefined && normalizeLabel(el.name) === want;
        });
      })
      .filter((issue) => {
        // A geometrically broken block is a SHAPE problem, not a label/merge
        // problem — drop the model's misnamed/merged report so it shows once,
        // as "Bad shape", instead of being split across two chips.
        if (issue.type !== 'misnamed' && issue.type !== 'merged') {
          return true;
        }
        return (
          issue.elementIds.length === 0 ||
          !issue.elementIds.every((id) => malformedIds.has(id))
        );
      });
    // A broken fragment and a "missing" report for the same printed label are
    // ONE problem — the block exists but is broken. Keep the Bad-shape row
    // (it owns the fragment element) and drop the duplicate missing row.
    const malformedLabels = new Set(
      malformed
        .map((issue) => normalizeLabel(issue.realBlockLabel))
        .filter((label) => label.length > 0),
    );
    const allIssues = issues.filter(
      (issue) =>
        issue.type !== 'missing' ||
        !malformedLabels.has(normalizeLabel(issue.realBlockLabel)),
    );
    // Deterministic replacement for the removed vision "split" reports: created
    // blocks whose polygon is a tiny fragment or jagged blob (e.g. the 200-level
    // ring) — flagged by geometry, so clean adjacent tiers are never false-hit.
    allIssues.push(...malformed);
    // Deterministic recall boost: every printed block number that no created
    // block covers is missing — catches whatever the vision model overlooked.
    // Runs after malformed so a broken block's uncovered label doesn't come
    // back as a second "missing" row.
    allIssues.push(...this.findUncoveredLabelIssues(context, allIssues));

    // Each real block counts once no matter how many issues mention it;
    // "extra" outlines don't make a real block unmatched.
    const affectedLabels = new Set<string>();
    let unlabeled = 0;
    for (const issue of allIssues) {
      if (issue.type !== 'extra') {
        affectedLabels.add(issue.realBlockLabel ?? `__unlabeled-${unlabeled++}`);
      }
    }
    // Total real blocks is derived deterministically on the client, NOT from the
    // vision model (whose count varied run-to-run and often collapsed accuracy to
    // 0%): every created block is a real block, plus every printed-but-missing
    // block found via OCR. matched = created blocks with no problem.
    const missingCount = allIssues.filter((issue) => issue.type === 'missing').length;
    const totalRealBlocks = detectedBlockCount + missingCount;
    const affected = Math.min(totalRealBlocks, affectedLabels.size);
    const matchedBlocks = Math.max(0, totalRealBlocks - affected);
    const accuracyPct = totalRealBlocks > 0 ? Math.round((100 * matchedBlocks) / totalRealBlocks) : 0;

    const confidence = verification.confidence;
    const summary = verification.summary;

    return {
      accuracyPct,
      totalRealBlocks,
      matchedBlocks,
      detectedBlockCount,
      // Bad-shape blocks are broken blocks: they live in the "missing" section
      // and share its remove-and-retrace fix flow (compact trace/draw rows).
      type2Issues: allIssues.filter(
        (issue) => issue.type !== 'missing' && issue.type !== 'malformed',
      ),
      type3Issues: allIssues.filter(
        (issue) => issue.type === 'missing' || issue.type === 'malformed',
      ),
      confidence,
      summary,
    };
  }

  /** Converts a canvas-px rect back to a blueprint-image-% region. */
  private canvasRectToRegion(rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): AuditRegion | null {
    const detection = this.context?.detection;
    if (!detection) {
      return null;
    }
    const drawRect = referenceImageDrawRect(
      this.canvas.canvas(),
      detection.width,
      detection.height,
      this.canvas.referenceImage()?.geometryScale ?? 1,
    );
    if (drawRect.width <= 0 || drawRect.height <= 0) {
      return null;
    }
    return {
      xPct: ((rect.x - drawRect.x) / drawRect.width) * 100,
      yPct: ((rect.y - drawRect.y) / drawRect.height) * 100,
      wPct: (rect.width / drawRect.width) * 100,
      hPct: (rect.height / drawRect.height) * 100,
    };
  }

  /** Converts a blueprint-image-% region to a canvas-px rect. */
  private regionToCanvasRect(
    region: AuditRegion | null,
  ): { x: number; y: number; width: number; height: number } | null {
    const detection = this.context?.detection;
    if (!region || !detection) {
      return null;
    }
    const drawRect = referenceImageDrawRect(
      this.canvas.canvas(),
      detection.width,
      detection.height,
      this.canvas.referenceImage()?.geometryScale ?? 1,
    );
    return {
      x: drawRect.x + (region.xPct / 100) * drawRect.width,
      y: drawRect.y + (region.yPct / 100) * drawRect.height,
      width: Math.max(8, (region.wPct / 100) * drawRect.width),
      height: Math.max(8, (region.hPct / 100) * drawRect.height),
    };
  }

  private async describeInvokeError(error: unknown): Promise<string> {
    // FunctionsHttpError carries the real error body in its Response context.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.clone === 'function') {
      try {
        const body = (await ctx.clone().json()) as { error?: string };
        if (body?.error) {
          return `AI verification failed: ${body.error}`;
        }
      } catch {
        // Body was not JSON — fall through to the generic message.
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|404|failed to send a request|failed to fetch|networkerror/i.test(message)) {
      return 'AI verifier is not reachable. Redeploy the analyze-blueprint edge function (see docs/AI_DETECTION_SETUP.md).';
    }
    return `AI verification failed: ${message}`;
  }
}

/**
 * Overlay badge numbers mentioned in an issue note ("Detected block 24 …") —
 * fallback when the model left detectedIndices empty. Only indices that fit
 * the created-block range are kept, so real block labels like "224" in a
 * 30-block chart are ignored.
 */
function blockIndicesFromNote(note: string, blockCount: number): number[] {
  const out: number[] = [];
  for (const match of note.matchAll(/\bblocks?\s+#?(\d{1,3})\b/gi)) {
    const idx = Number(match[1]);
    if (idx >= 1 && idx <= blockCount && !out.includes(idx)) {
      out.push(idx);
    }
  }
  return out;
}

/**
 * Real block label mentioned in a misnamed-issue note, e.g. quoted ('CE1') or
 * "… covers C3" — fallback when the model left realBlockLabel null.
 */
function labelFromNote(note: string): string | null {
  // "Real label is 'CE1'" — never the first quote, which is the WRONG label.
  const real = note.match(/real label\s+(?:is\s+)?'([^']{1,10})'/i);
  if (real) {
    return real[1];
  }
  const covers = note.match(/\bcovers\s+([A-Za-z]{0,3}\d{1,4}[A-Za-z]?)\b/i);
  if (covers) {
    return covers[1];
  }
  const quotes = [...note.matchAll(/'([^']{1,10})'/g)];
  return quotes.length > 0 ? quotes[quotes.length - 1][1] : null;
}

/**
 * Case/punctuation-insensitive label comparison key ("Block 211" ≈ "block211",
 * "WU_2" ≈ "WU 2" ≈ "WU-2"). OCR renders underscores/hyphens unreliably, so
 * separator characters must not break label matching.
 */
function normalizeLabel(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Shoelace polygon area in image-% units (unsigned). */
function polygonAreaPct(polygon: PointPct[]): number {
  if (polygon.length < 3) {
    return 0;
  }
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    area += (polygon[j].xPct + polygon[i].xPct) * (polygon[j].yPct - polygon[i].yPct);
  }
  return Math.abs(area) / 2;
}

function polygonBoundsPct(polygon: PointPct[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.xPct);
    minY = Math.min(minY, p.yPct);
    maxX = Math.max(maxX, p.xPct);
    maxY = Math.max(maxY, p.yPct);
  }
  return { minX, minY, maxX, maxY };
}

/** Whether any block element's shape contains the canvas-px point. */
function anchorCoveredByBlock(
  point: { x: number; y: number },
  elements: LayoutElement[],
  canvasCfg: { width: number; height: number },
): boolean {
  return blockCoveringPoint(point, elements, canvasCfg) !== null;
}

/** The block element whose shape contains the canvas-px point, if any. */
function blockCoveringPoint(
  point: { x: number; y: number },
  elements: LayoutElement[],
  canvasCfg: { width: number; height: number },
): LayoutElement | null {
  for (const el of elements) {
    if (el.type !== 'centerpiece') {
      continue;
    }
    const rect = rectFromPositionSize(el.position, el.size, canvasCfg);
    if (
      point.x < rect.x ||
      point.x > rect.x + rect.width ||
      point.y < rect.y ||
      point.y > rect.y + rect.height
    ) {
      continue;
    }
    const customPoints = el.customPoints ?? [];
    if (customPoints.length >= 3) {
      if (pointInPolygonPx(point, polygonCanvasPointsFromBlock(customPoints, rect))) {
        return el;
      }
      continue;
    }
    return el; // Preset shapes: bounding-box hit is close enough.
  }
  return null;
}

/** Ray-cast point-in-polygon in canvas-px space. */
function pointInPolygonPx(
  point: { x: number; y: number },
  polygon: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}
