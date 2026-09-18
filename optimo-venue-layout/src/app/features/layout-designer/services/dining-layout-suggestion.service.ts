import { Injectable, inject, isDevMode, signal } from '@angular/core';

import { environment } from '../../../../environments/environment';
import { SupabaseService } from '../../../core/services/supabase.service';
import { DINING_LAYOUT_ENGINE } from '../lib/dining-layout-engine.flag';
import {
  diningCapacitySignature,
  generatorVersionMismatchMessage,
  mergeCapacityKnowledge,
  type DiningCapacityKnowledge,
} from '../lib/dining-capacity-signature';
import type { OperationalCapacityStatus } from '../lib/dining-effective-capacity';
import type {
  DiningTableMixTarget,
  GenerateDiningLayoutsRequestDto,
  GenerateDiningLayoutsResponseDto,
  GeneratedDiningLayoutDto,
} from '../models/dining-layout-generation.model';

export const EXPECTED_DINING_GENERATOR_VERSION = '2026-08-25-preview-rot-v1';

function layoutMatchesMix(layout: GeneratedDiningLayoutDto, mix: DiningTableMixTarget[]): boolean {
  const counts = new Map<string, number>();
  for (const table of layout.tables ?? []) {
    counts.set(table.catalogueId, (counts.get(table.catalogueId) ?? 0) + 1);
  }
  return mix.every((lane) => (counts.get(lane.catalogueId) ?? 0) === Math.round(lane.count));
}

export interface DiningOperationalCapacity {
  validatedFeasibleCount: number;
  provenMaximumCount: number | null;
  maximumProven: boolean;
  basicGeometricUpperBound: number;
  witnessTableCount: number;
  witnessValidated: boolean;
  generatorVersion: string | null;
}

@Injectable({ providedIn: 'root' })
export class DiningLayoutSuggestionService {
  private readonly supabase = inject(SupabaseService);
  private readonly db = this.supabase.client;

  readonly loading = signal(false);
  readonly lastError = signal<string | null>(null);
  readonly lastDiagnostics = signal<GenerateDiningLayoutsResponseDto['diagnostics'] | null>(null);
  readonly lastGeneratorVersion = signal<string | null>(null);
  readonly suggestions = signal<GeneratedDiningLayoutDto[]>([]);

  readonly capacityLoading = signal(false);
  readonly capacityStatus = signal<OperationalCapacityStatus>('unknown');
  readonly operationalMaximumTableCount = signal<number | null>(null);
  readonly operationalWitnessTableCount = signal<number | null>(null);
  readonly operationalWitnessValidated = signal(false);
  readonly validatedFeasibleTableCount = signal<number | null>(null);
  readonly provenMaximumTableCount = signal<number | null>(null);
  readonly maximumProven = signal(false);
  readonly basicGeometricUpperBound = signal<number | null>(null);
  readonly lastCapacityDebugSvg = signal<string | null>(null);
  readonly lastPhysicalExplanation = signal<{
    tabletopDiameterM: number;
    chairOccupiedDiameterM: number;
    requiredPitchM: number;
    roomWidthM: number;
    roomDepthM: number;
    wallClearanceM: number;
    stageClearanceM: number;
  } | null>(null);
  readonly feasibilityLoading = signal(false);
  readonly lastFeasibilityCount = signal<number | null>(null);
  readonly lastFeasibilityResult = signal<'found' | 'not-found-yet' | 'impossible' | null>(null);
  /** Physical wizard key whose capacity knowledge is still valid. Visual patches must not clear this. */
  readonly lastReadyPhysicalKey = signal('');

  private shownFingerprints: string[] = [];
  private exclusionSignature = '';
  private lastRequest: GenerateDiningLayoutsRequestDto | null = null;
  private lastCapacitySignature = '';
  private lastCapacityKey = '';
  private capacitySeq = 0;
  private capacityInflightKey = '';
  private capacityInflight: Promise<DiningOperationalCapacity | null> | null = null;
  private lastKnowledge: DiningCapacityKnowledge | null = null;
  private feasibilitySeq = 0;

  rememberFingerprints(fps: string[]): void {
    this.shownFingerprints = [...this.shownFingerprints, ...fps].slice(
      -DINING_LAYOUT_ENGINE.maxSessionFingerprints,
    );
  }

  markCapacityChecking(): void {
    this.capacityStatus.set('checking');
    this.capacityLoading.set(true);
  }

  clearSession(): void {
    this.shownFingerprints = [];
    this.exclusionSignature = '';
    this.suggestions.set([]);
    this.lastError.set(null);
    this.lastDiagnostics.set(null);
    this.lastGeneratorVersion.set(null);
    this.lastRequest = null;
    this.lastCapacityKey = '';
    this.lastCapacitySignature = '';
    this.capacityInflightKey = '';
    this.lastReadyPhysicalKey.set('');
    this.lastKnowledge = null;
    this.operationalMaximumTableCount.set(null);
    this.operationalWitnessTableCount.set(null);
    this.operationalWitnessValidated.set(false);
    this.validatedFeasibleTableCount.set(null);
    this.provenMaximumTableCount.set(null);
    this.maximumProven.set(false);
    this.basicGeometricUpperBound.set(null);
    this.capacityLoading.set(false);
    this.capacityStatus.set('unknown');
    this.lastCapacityDebugSvg.set(null);
    this.lastPhysicalExplanation.set(null);
  }

  clearSuggestions(): void {
    this.shownFingerprints = [];
    this.exclusionSignature = '';
    this.suggestions.set([]);
    this.lastError.set(null);
    this.lastDiagnostics.set(null);
    this.lastRequest = null;
  }

  excludedFingerprints(): string[] {
    return [...this.shownFingerprints];
  }

  private configurationSignature(req: GenerateDiningLayoutsRequestDto): string {
    return JSON.stringify({
      capacity: diningCapacitySignature(req),
      count: req.target.tableCount,
    });
  }

  private scopeExclusions(request: GenerateDiningLayoutsRequestDto): GenerateDiningLayoutsRequestDto {
    const sig = this.configurationSignature(request);
    if (sig !== this.exclusionSignature) {
      this.shownFingerprints = [];
      this.exclusionSignature = sig;
      return {
        ...request,
        generation: { ...request.generation, excludeFingerprints: [] },
      };
    }
    return request;
  }

  nextSeed(): number {
    return (Date.now() ^ (Math.floor(Math.random() * 0xffff) << 8)) >>> 0;
  }

  private applyKnowledge(knowledge: DiningCapacityKnowledge, signature: string): void {
    this.lastKnowledge = knowledge;
    this.lastCapacitySignature = signature;
    this.validatedFeasibleTableCount.set(knowledge.validatedFeasibleCount);
    this.provenMaximumTableCount.set(knowledge.provenMaximumCount);
    this.maximumProven.set(knowledge.maximumProven);
    this.basicGeometricUpperBound.set(knowledge.basicGeometricUpperBound);
    this.operationalWitnessTableCount.set(knowledge.witnessTableCount);
    this.operationalWitnessValidated.set(knowledge.witnessTableCount > 0 || knowledge.maximumProven);
    this.operationalMaximumTableCount.set(
      knowledge.maximumProven ? knowledge.provenMaximumCount : null,
    );
    this.lastGeneratorVersion.set(knowledge.generatorVersion);
    const ready =
      knowledge.witnessTableCount > 0 ||
      (knowledge.maximumProven && (knowledge.provenMaximumCount ?? 0) === 0);
    this.capacityStatus.set(ready ? 'ready' : 'error');
  }

  hasReadyKnowledgeFor(key: string): boolean {
    return Boolean(key) && key === this.lastReadyPhysicalKey() && this.lastKnowledge != null;
  }

  async probeCapacity(
    request: GenerateDiningLayoutsRequestDto,
    key: string,
  ): Promise<DiningOperationalCapacity | null> {
    const signature = diningCapacitySignature(request);
    const samePhysicalKey = Boolean(key) && (key === this.lastReadyPhysicalKey() || key === this.lastCapacityKey);
    if (samePhysicalKey && this.lastKnowledge) {
      if (this.capacityInflight && key === this.capacityInflightKey) {
        return this.capacityInflight;
      }
      if (this.capacityStatus() !== 'ready') {
        this.applyKnowledge(this.lastKnowledge, this.lastCapacitySignature || signature);
      }
      return this.toCapacity(this.lastKnowledge);
    }
    if (signature !== this.lastCapacitySignature) {
      this.lastFeasibilityCount.set(null);
      this.lastFeasibilityResult.set(null);
    }
    if (this.capacityInflight && key === this.capacityInflightKey) {
      return this.capacityInflight;
    }
    const seq = ++this.capacitySeq;
    this.capacityInflightKey = key;
    this.markCapacityChecking();
    const run = this.invokeCapacity(request);
    this.capacityInflight = run;
    try {
      const result = await run;
      if (seq !== this.capacitySeq) {
        return result;
      }
      if (!result) {
        if (samePhysicalKey && this.lastKnowledge) {
          this.applyKnowledge(this.lastKnowledge, this.lastCapacitySignature || signature);
          return this.toCapacity(this.lastKnowledge);
        }
        this.capacityStatus.set('error');
        return null;
      }
      const incoming: DiningCapacityKnowledge = {
        validatedFeasibleCount: result.validatedFeasibleCount,
        provenMaximumCount: result.provenMaximumCount,
        maximumProven: result.maximumProven,
        basicGeometricUpperBound: result.basicGeometricUpperBound,
        witnessTableCount: result.witnessTableCount,
        generatorVersion: result.generatorVersion,
      };
      const merged = mergeCapacityKnowledge(this.lastKnowledge, incoming, signature === this.lastCapacitySignature);
      this.applyKnowledge(merged, signature);
      this.lastCapacityKey = key;
      if (this.capacityStatus() === 'ready') {
        this.lastReadyPhysicalKey.set(key);
      }
      return this.toCapacity(merged);
    } finally {
      if (seq === this.capacitySeq) {
        this.capacityLoading.set(false);
        this.capacityInflight = null;
      }
    }
  }

  async ensureCapacity(request: GenerateDiningLayoutsRequestDto, key: string): Promise<DiningOperationalCapacity | null> {
    if (this.capacityInflight && (key === this.lastCapacityKey || key === this.capacityInflightKey)) {
      return this.capacityInflight;
    }
    return this.probeCapacity(request, key);
  }

  selectedCountIsValidated(count: number): boolean {
    const feasible = this.validatedFeasibleTableCount();
    return this.capacityStatus() === 'ready' && feasible != null && count <= feasible;
  }

  async checkFeasibility(request: GenerateDiningLayoutsRequestDto): Promise<'found' | 'not-found-yet' | 'impossible'> {
    const count = request.target.tableCount;
    const signature = diningCapacitySignature(request);
    if (count == null || count < 1) {
      this.lastFeasibilityCount.set(count ?? null);
      this.lastFeasibilityResult.set('not-found-yet');
      return 'not-found-yet';
    }
    if (signature !== this.lastCapacitySignature) {
      this.lastFeasibilityCount.set(null);
      this.lastFeasibilityResult.set(null);
    }
    if (this.selectedCountIsValidated(count)) {
      this.lastFeasibilityCount.set(count);
      this.lastFeasibilityResult.set('found');
      return 'found';
    }
    if (
      this.maximumProven() &&
      this.provenMaximumTableCount() != null &&
      count > this.provenMaximumTableCount()!
    ) {
      this.lastFeasibilityCount.set(count);
      this.lastFeasibilityResult.set('impossible');
      return 'impossible';
    }
    const seq = ++this.feasibilitySeq;
    this.feasibilityLoading.set(true);
    try {
      const payload: GenerateDiningLayoutsRequestDto = {
        ...request,
        generation: {
          ...request.generation,
          mode: 'feasibility',
          suggestionCount: 1,
          timeBudgetMs: request.generation.timeBudgetMs ?? 1800,
        },
      };
      const { data, error } = await this.db.functions.invoke<GenerateDiningLayoutsResponseDto>(
        'generate-dining-layouts',
        { body: payload },
      );
      if (seq !== this.feasibilitySeq) {
        return this.lastFeasibilityResult() ?? 'not-found-yet';
      }
      if (error || !data) {
        const described = await this.describeFunctionError(error);
        this.lastError.set(described.message);
        this.lastFeasibilityCount.set(count);
        this.lastFeasibilityResult.set('not-found-yet');
        return 'not-found-yet';
      }
      if (this.rejectVersion(data.generatorVersion, true)) {
        this.lastFeasibilityCount.set(count);
        this.lastFeasibilityResult.set('not-found-yet');
        return 'not-found-yet';
      }
      const found = (data.layouts ?? []).some((layout) => layout.tableCount === count);
      if (found) {
        const incoming: DiningCapacityKnowledge = {
          validatedFeasibleCount: count,
          provenMaximumCount: null,
          maximumProven: false,
          basicGeometricUpperBound: data.basicGeometricUpperBound ?? this.basicGeometricUpperBound() ?? 0,
          witnessTableCount: count,
          generatorVersion: data.generatorVersion ?? null,
        };
        const merged = mergeCapacityKnowledge(this.lastKnowledge, incoming, signature === this.lastCapacitySignature);
        this.applyKnowledge(merged, signature);
        this.lastFeasibilityCount.set(count);
        this.lastFeasibilityResult.set('found');
        return 'found';
      }
      if (data.diagnostics?.failureKind === 'OPERATIONAL_MAX_BELOW_REQUEST' && data.maximumProven) {
        this.lastFeasibilityCount.set(count);
        this.lastFeasibilityResult.set('impossible');
        return 'impossible';
      }
      this.lastFeasibilityCount.set(count);
      this.lastFeasibilityResult.set('not-found-yet');
      return 'not-found-yet';
    } catch (err) {
      if (seq === this.feasibilitySeq) {
        const described = await this.describeFunctionError(err);
        this.lastError.set(described.message);
        this.lastFeasibilityCount.set(count);
        this.lastFeasibilityResult.set('not-found-yet');
      }
      return 'not-found-yet';
    } finally {
      if (seq === this.feasibilitySeq) {
        this.feasibilityLoading.set(false);
      }
    }
  }

  private toCapacity(knowledge: DiningCapacityKnowledge): DiningOperationalCapacity {
    return {
      validatedFeasibleCount: knowledge.validatedFeasibleCount,
      provenMaximumCount: knowledge.provenMaximumCount,
      maximumProven: knowledge.maximumProven,
      basicGeometricUpperBound: knowledge.basicGeometricUpperBound,
      witnessTableCount: knowledge.witnessTableCount,
      witnessValidated: knowledge.witnessTableCount > 0 || knowledge.maximumProven,
      generatorVersion: knowledge.generatorVersion,
    };
  }

  private rejectVersion(received: string | null | undefined, affectCapacity = true): string | null {
    const message = generatorVersionMismatchMessage(EXPECTED_DINING_GENERATOR_VERSION, received);
    if (!message) {
      return null;
    }
    this.lastError.set(message);
    if (affectCapacity) {
      this.capacityStatus.set('error');
    }
    if (isDevMode()) {
      console.error('[generate-dining-layouts]', message);
    }
    return message;
  }

  private async describeFunctionError(
    error: unknown,
    label = 'Capacity check failed',
  ): Promise<{ status: number | null; message: string }> {
    const ctx = (error as { context?: Response }).context;
    let status: number | null = null;
    let bodyMessage: string | null = null;
    if (ctx && typeof ctx.clone === 'function') {
      status = typeof ctx.status === 'number' ? ctx.status : null;
      try {
        const body = (await ctx.clone().json()) as {
          error?: string;
          msg?: string;
          message?: string;
          diagnostics?: { message?: string };
        };
        bodyMessage =
          body?.error || body?.diagnostics?.message || body?.msg || body?.message || null;
      } catch {
        try {
          const text = (await ctx.clone().text()).trim();
          if (text) {
            bodyMessage = text.slice(0, 280);
          }
        } catch {
          /* body unreadable */
        }
      }
    }
    const fallback =
      error instanceof Error ? error.message : 'Could not reach the dining capacity service.';
    const detail = bodyMessage || fallback;
    const message = status != null ? `${label} (${status}): ${detail}` : detail;
    return { status, message };
  }

  private logCapacityFailure(
    payload: GenerateDiningLayoutsRequestDto,
    described: { status: number | null; message: string },
  ): void {
    if (!isDevMode()) {
      return;
    }
    console.error('[generate-dining-layouts capacity failed]', {
      supabaseUrl: environment.supabase.url,
      functionName: 'generate-dining-layouts',
      status: described.status,
      message: described.message,
      block: payload.block,
      table: payload.tableCatalogue[0],
      tableGapM: payload.rules.minimumTableToTableClearanceM,
      features: payload.features,
      access: payload.accessPoints,
      generation: payload.generation,
    });
  }

  private async refreshAuthSession(): Promise<boolean> {
    const svc = this.supabase as SupabaseService & { refreshSession?: () => Promise<boolean> };
    if (typeof svc.refreshSession === 'function') {
      return svc.refreshSession();
    }
    try {
      const { error } = await this.db.auth.refreshSession();
      return error == null;
    } catch {
      return false;
    }
  }

  private async invokeCapacity(
    request: GenerateDiningLayoutsRequestDto,
    retry: { auth?: boolean; budget?: boolean } = {},
  ): Promise<DiningOperationalCapacity | null> {
    const payload: GenerateDiningLayoutsRequestDto = {
      ...request,
      target: {
        ...request.target,
        tableCount: undefined,
        targetCapacity: undefined,
      },
      generation: {
        ...request.generation,
        mode: 'capacity',
        suggestionCount: 1,
        timeBudgetMs: request.generation.timeBudgetMs ?? 2500,
      },
    };
    try {
      const { data, error } = await this.db.functions.invoke<GenerateDiningLayoutsResponseDto>(
        'generate-dining-layouts',
        { body: payload },
      );
      if (!data) {
        const described = await this.describeFunctionError(error);
        this.logCapacityFailure(payload, described);
        const status = described.status;
        const network =
          status == null &&
          /failed to send|failed to fetch|networkerror|FunctionsFetchError/i.test(described.message);
        if ((status === 401 || status === 403) && !retry.auth) {
          await this.refreshAuthSession();
          return this.invokeCapacity(request, { ...retry, auth: true });
        }
        if (status === 401 || status === 403) {
          this.lastError.set('Session expired — sign in again.');
          return null;
        }
        if ((network || (status != null && (status >= 500 || status === 546))) && !retry.budget) {
          return this.invokeCapacity(
            {
              ...request,
              generation: { ...request.generation, timeBudgetMs: 1500 },
            },
            { ...retry, budget: true },
          );
        }
        this.lastError.set(described.message);
        return null;
      }
      if (this.rejectVersion(data.generatorVersion)) {
        return null;
      }
      const dbg = data.diagnostics?.generationDebug;
      if (isDevMode()) {
        console.info('[generate-dining-layouts capacity]', {
          supabaseUrl: environment.supabase.url,
          functionName: 'generate-dining-layouts',
          generatorVersion: data.generatorVersion,
          expectedVersion: EXPECTED_DINING_GENERATOR_VERSION,
          block: payload.block,
          table: payload.tableCatalogue[0],
          tableGapM: payload.rules.minimumTableToTableClearanceM,
          features: payload.features,
          access: payload.accessPoints,
          rules: {
            wall: payload.rules.wallClearanceM,
            stage: payload.rules.stageClearanceM,
            food: payload.rules.foodPrepClearanceM,
            entrance: payload.rules.entranceClearanceM,
            exit: payload.rules.exitClearanceM,
            tableGap: payload.rules.minimumTableToTableClearanceM,
          },
          capacity: {
            rawCandidateCount: dbg?.candidatePool?.rawAttempts,
            individuallyValidCandidates: dbg?.candidatePool?.individuallyValid,
            bestValidatedWitness: data.diagnostics?.validatedFeasibleTableCount ?? data.diagnostics?.witnessTableCount,
            maximumProven: data.diagnostics?.maximumProven ?? false,
            provenMaximumCount: data.diagnostics?.provenMaximumTableCount ?? null,
            geometricUpperBound: data.diagnostics?.basicGeometricUpperBound,
            physicalExplanation: dbg?.capacityDebug?.physicalExplanation,
          },
        });
      }
      this.lastCapacityDebugSvg.set(dbg?.candidatePool?.debugSvg ?? null);
      this.lastPhysicalExplanation.set(dbg?.capacityDebug?.physicalExplanation ?? null);
      const feasible =
        data.diagnostics?.validatedFeasibleTableCount ??
        data.diagnostics?.witnessTableCount ??
        data.layouts?.[0]?.tableCount ??
        0;
      const proven = data.diagnostics?.maximumProven === true;
      const provenCount = proven ? (data.diagnostics?.provenMaximumTableCount ?? feasible) : null;
      const geometric = data.diagnostics?.basicGeometricUpperBound ?? dbg?.capacityDebug?.basicGeometricUpperBound ?? 0;
      const witnessCount = data.diagnostics?.witnessTableCount ?? data.layouts?.[0]?.tableCount ?? 0;
      const evidence = feasible > 0 || witnessCount > 0 || (proven && (provenCount ?? 0) === 0);
      if (!evidence) {
        this.lastError.set(data.error || data.diagnostics?.message || 'Dining capacity returned no usable result.');
        this.capacityStatus.set('error');
        return null;
      }
      this.lastError.set(null);
      return {
        validatedFeasibleCount: feasible,
        provenMaximumCount: provenCount,
        maximumProven: proven,
        basicGeometricUpperBound: geometric,
        witnessTableCount: witnessCount,
        witnessValidated: evidence,
        generatorVersion: data.generatorVersion ?? null,
      };
    } catch (err) {
      const described = await this.describeFunctionError(err);
      this.logCapacityFailure(payload, described);
      this.lastError.set(described.message);
      return null;
    }
  }

  async generate(request: GenerateDiningLayoutsRequestDto): Promise<GenerateDiningLayoutsResponseDto> {
    this.loading.set(true);
    this.lastError.set(null);
    request = this.scopeExclusions(request);
    this.lastRequest = request;
    try {
      const { data, error } = await this.db.functions.invoke<GenerateDiningLayoutsResponseDto>(
        'generate-dining-layouts',
        {
          body: {
            ...request,
            generation: { ...request.generation, mode: 'generate' },
          },
        },
      );
      if (error) {
        const described = await this.describeFunctionError(error, 'Layout generation failed');
        const message = described.message || 'Layout generation failed.';
        this.lastError.set(message);
        this.suggestions.set([]);
        return { ok: false, layouts: [], error: message, transportFailed: true };
      }
      const payload = data ?? {
        ok: false,
        layouts: [],
        error: 'Empty generator response.',
        transportFailed: true,
      };
      const mismatch = this.rejectVersion(payload.generatorVersion, false);
      if (mismatch) {
        this.suggestions.set([]);
        return { ok: false, layouts: [], error: mismatch, generatorVersion: payload.generatorVersion };
      }
      const requestedMix = (request.target.mix ?? []).filter((lane) => lane.count > 0);
      if (requestedMix.length > 0) {
        const staleMix =
          payload.supportsTableMix !== true ||
          (payload.layouts ?? []).some((layout) => !layoutMatchesMix(layout, requestedMix));
        if (staleMix) {
          const message =
            'Mixed table shapes need the updated layout function. Deploy generate-dining-layouts, then try again.';
          this.lastError.set(message);
          this.suggestions.set([]);
          return { ok: false, layouts: [], error: message, generatorVersion: payload.generatorVersion };
        }
      }
      const requested = request.target.tableCount;
      const exactLayouts =
        requested == null
          ? payload.layouts ?? []
          : (payload.layouts ?? []).filter((layout) => {
              if (layout.tableCount === requested) {
                return true;
              }
              if (isDevMode()) {
                console.error('Generator returned a partial layout', {
                  requested,
                  returned: layout.tableCount,
                  generatorVersion: payload.generatorVersion,
                  functionName: 'generate-dining-layouts',
                  supabaseUrl: environment.supabase.url,
                });
              }
              return false;
            });

      if (isDevMode()) {
        console.info('[generate-dining-layouts]', {
          supabaseUrl: environment.supabase.url,
          functionName: 'generate-dining-layouts',
          generatorVersion: payload.generatorVersion,
          expectedVersion: EXPECTED_DINING_GENERATOR_VERSION,
          requestedTableCount: requested,
          returnedTableCounts: exactLayouts.map((layout) => layout.tableCount),
          requestedSuggestions: payload.diagnostics?.generationDebug?.requestedSuggestions,
          rawExactSolutions: payload.diagnostics?.generationDebug?.rawExactSolutions,
          validExactSolutions: payload.diagnostics?.generationDebug?.validExactSolutions,
          excludedByHistory: payload.diagnostics?.generationDebug?.excludedByHistory,
          removedNearDuplicates: payload.diagnostics?.generationDebug?.removedNearDuplicates,
          finalSuggestions: payload.diagnostics?.generationDebug?.finalSuggestions,
          strategiesAttempted: payload.diagnostics?.generationDebug?.strategiesAttempted,
        });
      }

      const diagnostics = {
        ...(payload.diagnostics ?? {
          candidateCount: 0,
          validCount: 0,
          durationMs: 0,
          rejectionReasons: {},
        }),
        requestedTableCount: requested ?? payload.diagnostics?.requestedTableCount,
      };
      this.lastDiagnostics.set(diagnostics);
      this.lastGeneratorVersion.set(payload.generatorVersion ?? null);

      if (!payload.ok || exactLayouts.length === 0) {
        const msg =
          payload.diagnostics?.message ??
          payload.error ??
          (requested != null ? `No valid ${requested}-table arrangement was found within the current search.` : 'No valid layout found under current rules.');
        this.lastError.set(msg);
        this.suggestions.set([]);
        return {
          ...payload,
          layouts: [],
          diagnostics,
          transportFailed: payload.transportFailed === true,
        };
      }
      this.suggestions.set(exactLayouts);
      this.rememberFingerprints(exactLayouts.map((l) => l.fingerprint));
      return { ...payload, layouts: exactLayouts, diagnostics };
    } catch (err) {
      const described = await this.describeFunctionError(err, 'Layout generation failed');
      const message = described.message || 'Layout generation failed.';
      this.lastError.set(message);
      this.suggestions.set([]);
      return { ok: false, layouts: [], error: message, transportFailed: true };
    } finally {
      this.loading.set(false);
    }
  }

  async refresh(): Promise<GenerateDiningLayoutsResponseDto> {
    const prev = this.lastRequest;
    if (!prev) {
      return { ok: false, layouts: [], error: 'Nothing to refresh yet.' };
    }
    return this.generate({
      ...prev,
      generation: {
        ...prev.generation,
        seed: this.nextSeed(),
        excludeFingerprints: this.excludedFingerprints(),
        mode: 'generate',
      },
    });
  }
}
