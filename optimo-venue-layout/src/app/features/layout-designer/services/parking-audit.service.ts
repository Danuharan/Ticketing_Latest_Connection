import { Injectable, computed, inject, signal } from '@angular/core';

import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../core/services/toast.service';
import { LayoutCanvasService } from './layout-canvas.service';
import {
  toAuditError,
  type AuditError,
  type AuditIssueType,
  type AuditIssueView,
  type AuditResultView,
} from './blueprint-audit.service';
import type { AuditBlockSummary } from '../lib/audit-overlay';
import type { OcrToken } from '../lib/assign-ocr-labels';
import { computeParkingPxPerMeter } from '../lib/parking-shape';
import { rectFromPositionSize } from '../lib/geometry';
import { isParkingArea } from '../models/layout-element.model';
import {
  renderParkingVerificationImages,
  slotOrientedPolygon,
  summarizeParkingSlotsForAudit,
} from '../lib/parking-audit-overlay';
import type { ParkingCodeSlot } from '../lib/detect-parking-ocr';
import { parseParkingSlotCodes } from '../lib/detect-parking-ocr';

const EDGE_FUNCTION = 'analyze-blueprint';

export type ParkingAuditPhase = 'idle' | 'running' | 'done' | 'error';

interface VerificationIssue {
  type: AuditIssueType;
  realBlockLabel: string | null;
  detectedIndices: number[];
  approxRegion: { xPct: number; yPct: number; wPct: number; hPct: number } | null;
  note: string;
}

interface VerificationResult {
  totalRealBlocks: number;
  issues: VerificationIssue[];
  confidence: 'low' | 'medium' | 'high';
  summary: string;
}

interface SlotAuditRow {
  slotId: string;
  label: string;
  polygon: { xPct: number; yPct: number }[];
  cxPct: number;
  cyPct: number;
  wPct: number;
  hPct: number;
}

interface ParkingAuditContext {
  file: File;
  elementId: string;
  ocrTokens: OcrToken[];
  uncoveredCodes: ParkingCodeSlot[];
}

/**
 * Post-create QA for parking CV detection — mirrors stadium BlueprintAuditService:
 * client OCR recall for missing codes + Gemini Flash vision for merged/misnamed/extra.
 */
@Injectable({ providedIn: 'root' })
export class ParkingAuditService {
  private readonly supabase = inject(SupabaseService);
  private readonly canvas = inject(LayoutCanvasService);
  private readonly toast = inject(ToastService);

  private context: ParkingAuditContext | null = null;
  private runToken = 0;
  private slotIndexToId: string[] = [];

  readonly phase = signal<ParkingAuditPhase>('idle');
  readonly result = signal<AuditResultView | null>(null);
  readonly error = signal<AuditError | null>(null);
  readonly activeIssueKey = signal<string | null>(null);
  readonly acceptedKeys = signal<ReadonlySet<string>>(new Set());

  readonly openIssueCount = computed(() => {
    const view = this.result();
    if (!view) {
      return 0;
    }
    const accepted = this.acceptedKeys();
    return [...view.type2Issues, ...view.type3Issues].filter((i) => !accepted.has(i.key)).length;
  });

  start(input: {
    file: File;
    elementId: string;
    ocrTokens: OcrToken[];
    uncoveredCodes?: ParkingCodeSlot[];
  }): void {
    this.context = {
      file: input.file,
      elementId: input.elementId,
      ocrTokens: input.ocrTokens,
      uncoveredCodes: input.uncoveredCodes ?? [],
    };
    this.acceptedKeys.set(new Set());
    this.activeIssueKey.set(null);
    void this.run();
  }

  retry(): void {
    if (!this.context) {
      return;
    }
    void this.run();
  }

  reset(): void {
    this.runToken += 1;
    this.context = null;
    this.phase.set('idle');
    this.result.set(null);
    this.error.set(null);
    this.activeIssueKey.set(null);
    this.acceptedKeys.set(new Set());
    this.canvas.setAuditHighlight(null);
  }

  focusIssue(issue: AuditIssueView): void {
    this.activeIssueKey.set(issue.key);
    const canvas = this.canvas.canvas();
    const ctx = this.context;

    if (issue.elementIds.length > 0 && ctx) {
      const slotId = issue.elementIds[0];
      this.canvas.selectParkingSlot(slotId);
      const el = this.canvas.elements().find((item) => item.id === ctx.elementId);
      const slot = el && isParkingArea(el) ? (el.parkingSlots ?? []).find((s) => s.id === slotId) : null;
      if (el && slot && isParkingArea(el)) {
        const originX = el.position.xPct - el.size.wPct / 2;
        const originY = el.position.yPct - el.size.hPct / 2;
        const cxPct = originX + (slot.xPct / 100) * el.size.wPct;
        const cyPct = originY + (slot.yPct / 100) * el.size.hPct;
        const rect = {
          x: ((cxPct - 2) / 100) * canvas.width,
          y: ((cyPct - 2) / 100) * canvas.height,
          width: (4 / 100) * canvas.width,
          height: (4 / 100) * canvas.height,
        };
        this.canvas.focusCanvasRect(rect);
        this.canvas.setAuditHighlight({ kind: 'region', rect, label: slot.label }, 6000);
      }
      return;
    }

    if (issue.approxRegion) {
      const r = issue.approxRegion;
      const rect = {
        x: (r.xPct / 100) * canvas.width,
        y: (r.yPct / 100) * canvas.height,
        width: (r.wPct / 100) * canvas.width,
        height: (r.hPct / 100) * canvas.height,
      };
      this.canvas.focusCanvasRect(rect);
      this.canvas.setAuditHighlight(
        {
          kind: 'region',
          rect,
          label: issue.realBlockLabel ?? undefined,
        },
        8000,
      );
      if (issue.type === 'missing') {
        this.canvas.parkingSlotPhase.set('slots');
        this.canvas.parkingWorkspaceStep.set('draw-lines');
        this.toast.success(
          issue.realBlockLabel
            ? `Missing slot ${issue.realBlockLabel} — draw it in this highlighted area.`
            : 'Missing slot — draw it in the highlighted area.',
        );
      }
    }
  }

  acceptIssue(issue: AuditIssueView): void {
    this.acceptedKeys.update((set) => new Set([...set, issue.key]));
    if (this.activeIssueKey() === issue.key) {
      this.activeIssueKey.set(null);
      this.canvas.setAuditHighlight(null);
    }
  }

  /** Auto-fix misnamed (rename) or extra (delete). */
  autoFixIssue(issue: AuditIssueView): void {
    const ctx = this.context;
    if (!ctx) {
      return;
    }
    if (issue.type === 'misnamed' && issue.realBlockLabel && issue.elementIds[0]) {
      this.canvas.renameParkingSlot(ctx.elementId, issue.elementIds[0], issue.realBlockLabel);
      this.acceptIssue(issue);
      this.toast.success(`Renamed slot to ${issue.realBlockLabel}.`);
      return;
    }
    if (issue.type === 'extra' && issue.elementIds[0]) {
      this.canvas.removeParkingSlot(ctx.elementId, issue.elementIds[0]);
      this.acceptIssue(issue);
      this.toast.success('Removed extra slot.');
      return;
    }
    this.focusIssue(issue);
  }

  /** Manual repair guidance for missing/merged/malformed. */
  fixIssue(issue: AuditIssueView): void {
    this.focusIssue(issue);
    if (issue.type === 'merged' || issue.type === 'malformed') {
      this.toast.success('Select the bad slot and delete it, then redraw correctly in Add slots.');
    }
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
      const slots = this.collectSlots(context.elementId);
      this.slotIndexToId = slots.map((s) => s.slotId);
      const images = await renderParkingVerificationImages(
        context.file,
        slots.map((s) => ({ polygon: s.polygon })),
      );
      const summaries: AuditBlockSummary[] = summarizeParkingSlotsForAudit(slots);

      const { data, error } = await this.supabase.client.functions.invoke<{
        verification?: VerificationResult;
        error?: string;
        tiers?: unknown;
      }>(EDGE_FUNCTION, {
        body: {
          // Reuse the already-deployed stadium verify path (Gemini Flash) —
          // no edge-function redeploy required. Overlay + block table carry the
          // parking stalls; client maps issues back to slots.
          verifyBlocks: true,
          imageBase64: images.original.base64,
          overlayBase64: images.overlay.base64,
          mimeType: 'image/jpeg',
          blocks: summaries,
        },
      });

      if (token !== this.runToken) {
        return;
      }
      if (error) {
        throw new Error(await this.describeInvokeError(error));
      }
      if (!data?.verification) {
        if (data && !data.error && 'tiers' in data) {
          throw new Error(
            'The analyze-blueprint edge function is outdated — redeploy it to enable verification.',
          );
        }
        throw new Error(data?.error ?? 'The verifier returned an empty response.');
      }

      this.result.set(this.buildView(data.verification, context, slots));
      this.phase.set('done');
    } catch (err) {
      if (token !== this.runToken) {
        return;
      }
      this.error.set(toAuditError(err instanceof Error ? err.message : String(err)));
      this.phase.set('error');
    }
  }

  private collectSlots(elementId: string): SlotAuditRow[] {
    const el = this.canvas.elements().find((item) => item.id === elementId);
    if (!el || !isParkingArea(el)) {
      return [];
    }
    const canvas = this.canvas.canvas();
    const rect = rectFromPositionSize(el.position, el.size, canvas);
    const ppm =
      computeParkingPxPerMeter(rect, el.customPoints ?? [], el.customSideLengthsM ?? []) ??
      Math.max(rect.width, rect.height) / 100;
    const originX = el.position.xPct - el.size.wPct / 2;
    const originY = el.position.yPct - el.size.hPct / 2;
    const rows: SlotAuditRow[] = [];
    for (const slot of el.parkingSlots ?? []) {
      const cxPct = originX + (slot.xPct / 100) * el.size.wPct;
      const cyPct = originY + (slot.yPct / 100) * el.size.hPct;
      const lengthPx = slot.lengthM * ppm;
      const widthPx = slot.widthM * ppm;
      const lengthPct = (lengthPx / canvas.width) * 100;
      const widthPct = (widthPx / canvas.height) * 100;
      const polygon = slotOrientedPolygon(cxPct, cyPct, lengthPct, widthPct, slot.rotationDeg);
      rows.push({
        slotId: slot.id,
        label: slot.label ?? '',
        polygon,
        cxPct,
        cyPct,
        wPct: lengthPct,
        hPct: widthPct,
      });
    }
    return rows;
  }

  private buildView(
    verification: VerificationResult,
    context: ParkingAuditContext,
    slots: SlotAuditRow[],
  ): AuditResultView {
    const type2: AuditIssueView[] = [];
    const type3: AuditIssueView[] = [];

    for (let i = 0; i < verification.issues.length; i += 1) {
      const raw = verification.issues[i];
      if (raw.type === 'missing' || raw.type === 'split') {
        continue;
      }
      const elementIds = (raw.detectedIndices ?? [])
        .map((idx) => this.slotIndexToId[idx - 1])
        .filter((id): id is string => Boolean(id));
      const issue: AuditIssueView = {
        key: `vision-${raw.type}-${i}`,
        type: raw.type,
        realBlockLabel: raw.realBlockLabel,
        elementIds,
        approxRegion: raw.approxRegion,
        note: raw.note,
      };
      type2.push(issue);
    }

    const uncovered =
      context.uncoveredCodes.length > 0
        ? context.uncoveredCodes
        : this.uncoveredFromOcr(context.ocrTokens, slots);
    uncovered.forEach((code, i) => {
      type3.push({
        key: `missing-${code.code}-${i}`,
        type: 'missing',
        realBlockLabel: code.code,
        elementIds: [],
        approxRegion: {
          xPct: Math.max(0, code.xPct - 1.5),
          yPct: Math.max(0, code.yPct - 1.5),
          wPct: 3,
          hPct: 3,
        },
        note: `Printed code ${code.code} has no detected slot nearby.`,
      });
    });

    const detected = slots.length;
    const totalReal = Math.max(verification.totalRealBlocks, detected + type3.length);
    const matched = Math.max(0, totalReal - type3.length - type2.filter((i) => i.type === 'extra').length);
    const accuracyPct =
      totalReal > 0 ? Math.round((Math.min(matched, totalReal) / totalReal) * 100) : 0;

    return {
      accuracyPct,
      totalRealBlocks: totalReal,
      matchedBlocks: matched,
      detectedBlockCount: detected,
      type2Issues: type2,
      type3Issues: type3,
      confidence: verification.confidence,
      summary: verification.summary,
    };
  }

  private uncoveredFromOcr(tokens: OcrToken[], slots: SlotAuditRow[]): ParkingCodeSlot[] {
    const codes = parseParkingSlotCodes(tokens);
    if (codes.length === 0) {
      return [];
    }
    return codes.filter((code) => {
      const near = slots.some((s) => Math.hypot(s.cxPct - code.xPct, s.cyPct - code.yPct) < 3.5);
      return !near;
    });
  }

  private async describeInvokeError(error: { message?: string }): Promise<string> {
    return error?.message || 'Verification request failed.';
  }
}
