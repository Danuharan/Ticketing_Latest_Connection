/** @vitest-environment jsdom */
import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { getTestBed } from '@angular/core/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { SupabaseService } from '../../../core/services/supabase.service';
import { DEFAULT_DINING_LAYOUT_RULES } from '../models/dining-layout-generation.model';
import type { GenerateDiningLayoutsRequestDto } from '../models/dining-layout-generation.model';
import {
  DiningLayoutSuggestionService,
  EXPECTED_DINING_GENERATOR_VERSION,
} from './dining-layout-suggestion.service';

if (!getTestBed().platform) {
  getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
}

function request(): GenerateDiningLayoutsRequestDto {
  return {
    block: {
      id: 'b',
      polygon: [
        { x: 0, y: 0 },
        { x: 5.6, y: 0 },
        { x: 5.6, y: 7.73 },
        { x: 0, y: 7.73 },
      ],
      widthM: 5.6,
      depthM: 7.73,
    },
    accessPoints: { entrances: [], exits: [] },
    features: {},
    tableCatalogue: [
      {
        id: 'round',
        name: 'Round',
        shape: 'round',
        widthM: 0.6,
        depthM: 0.6,
        capacity: 3,
        chairWidthM: 0.4,
        chairDepthM: 0.5,
        allowed: true,
      },
    ],
    target: { tableCount: 8 },
    rules: { ...DEFAULT_DINING_LAYOUT_RULES },
    generation: { suggestionCount: 4, seed: 1 },
  };
}

describe('DiningLayoutSuggestionService version and capacity isolation', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  it('rejects a version mismatch and does not mark capacity ready', async () => {
    const invoke = vi.fn(async () => ({
      data: { ok: true, generatorVersion: 'stale-v0', layouts: [], diagnostics: { witnessTableCount: 3, operationalMaxTableCount: 3 } },
      error: null,
    }));
    TestBed.configureTestingModule({
      providers: [
        DiningLayoutSuggestionService,
        { provide: SupabaseService, useValue: { client: { functions: { invoke } } } },
      ],
    });
    const service = TestBed.inject(DiningLayoutSuggestionService);
    const result = await service.probeCapacity(request(), 'k1');
    expect(result).toBeNull();
    expect(service.capacityStatus()).toBe('error');
    expect(service.lastError()).toContain('Dining generator version mismatch');
    expect(service.lastError()).toContain(EXPECTED_DINING_GENERATOR_VERSION);
    expect(service.lastError()).toContain('stale-v0');
    expect(service.validatedFeasibleTableCount()).toBeNull();
  });

  it('does not let generate overwrite a previously validated capacity', async () => {
    const invoke = vi.fn(async (_name: string, args: { body: { generation?: { mode?: string } } }) => {
      if (args.body.generation?.mode === 'capacity') {
        return {
          data: {
            ok: true,
            generatorVersion: EXPECTED_DINING_GENERATOR_VERSION,
            layouts: [{ tableCount: 9, fingerprint: 'a', tables: new Array(9).fill(0) }],
            diagnostics: {
              witnessTableCount: 9,
              validatedFeasibleTableCount: 9,
              maximumProven: false,
              provenMaximumTableCount: null,
              basicGeometricUpperBound: 12,
              generationDebug: { capacityDebug: {}, candidatePool: { debugSvg: '' } },
            },
          },
          error: null,
        };
      }
      return {
        data: {
          ok: true,
          generatorVersion: EXPECTED_DINING_GENERATOR_VERSION,
          layouts: [{ tableCount: 8, fingerprint: 'b', tables: new Array(8).fill(0), id: '1', name: 'x', family: 'regular-grid', score: 1, capacity: 24, metrics: {}, previewSvg: '', seed: 1 }],
          maximumTableCount: 3,
          diagnostics: {
            witnessTableCount: 3,
            operationalMaxTableCount: 3,
            validatedFeasibleTableCount: 3,
            maximumProven: false,
          },
        },
        error: null,
      };
    });
    TestBed.configureTestingModule({
      providers: [
        DiningLayoutSuggestionService,
        { provide: SupabaseService, useValue: { client: { functions: { invoke } } } },
      ],
    });
    const service = TestBed.inject(DiningLayoutSuggestionService);
    await service.probeCapacity(request(), 'cfg');
    expect(service.validatedFeasibleTableCount()).toBe(9);
    expect(service.capacityStatus()).toBe('ready');
    await service.generate(request());
    expect(service.validatedFeasibleTableCount()).toBe(9);
    expect(service.capacityStatus()).toBe('ready');
  });

  it('does not cancel ready capacity when the same physical key is probed again', async () => {
    const invoke = vi.fn(async () => ({
      data: {
        ok: true,
        generatorVersion: EXPECTED_DINING_GENERATOR_VERSION,
        layouts: [{ tableCount: 6, fingerprint: 'a', tables: new Array(6).fill(0) }],
        diagnostics: {
          witnessTableCount: 6,
          validatedFeasibleTableCount: 6,
          maximumProven: false,
          provenMaximumTableCount: null,
          basicGeometricUpperBound: 12,
        },
      },
      error: null,
    }));
    TestBed.configureTestingModule({
      providers: [
        DiningLayoutSuggestionService,
        { provide: SupabaseService, useValue: { client: { functions: { invoke } } } },
      ],
    });
    const service = TestBed.inject(DiningLayoutSuggestionService);
    await service.probeCapacity(request(), 'physical-a');
    expect(service.capacityStatus()).toBe('ready');
    expect(invoke).toHaveBeenCalledTimes(1);
    const again = await service.probeCapacity(request(), 'physical-a');
    expect(again?.validatedFeasibleCount).toBe(6);
    expect(service.capacityStatus()).toBe('ready');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('surfaces the real HTTP status and server body from FunctionsHttpError.context', async () => {
    const context = new Response(JSON.stringify({ error: 'boom' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
    const httpError = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      name: 'FunctionsHttpError',
      context,
    });
    const invoke = vi.fn(async () => ({ data: null, error: httpError }));
    TestBed.configureTestingModule({
      providers: [
        DiningLayoutSuggestionService,
        {
          provide: SupabaseService,
          useValue: {
            client: { functions: { invoke }, auth: { refreshSession: vi.fn() } },
            refreshSession: vi.fn(async () => false),
          },
        },
      ],
    });
    const service = TestBed.inject(DiningLayoutSuggestionService);
    const result = await service.probeCapacity(request(), 'err-500');
    expect(result).toBeNull();
    expect(service.capacityStatus()).toBe('error');
    expect(service.lastError()).toContain('500');
    expect(service.lastError()).toContain('boom');
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('refreshes the session and retries once on 401', async () => {
    const context = new Response(JSON.stringify({ msg: 'Invalid JWT' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    const httpError = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      name: 'FunctionsHttpError',
      context,
    });
    const invoke = vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({
      data: {
        ok: true,
        generatorVersion: EXPECTED_DINING_GENERATOR_VERSION,
        layouts: [{ tableCount: 4, fingerprint: 'a', tables: new Array(4).fill(0) }],
        diagnostics: {
          witnessTableCount: 4,
          validatedFeasibleTableCount: 4,
          maximumProven: true,
          provenMaximumTableCount: 4,
          basicGeometricUpperBound: 6,
        },
      },
      error: null,
    }));
    invoke.mockResolvedValueOnce({ data: null, error: httpError });
    const refreshSession = vi.fn(async () => true);
    TestBed.configureTestingModule({
      providers: [
        DiningLayoutSuggestionService,
        {
          provide: SupabaseService,
          useValue: { client: { functions: { invoke } }, refreshSession },
        },
      ],
    });
    const service = TestBed.inject(DiningLayoutSuggestionService);
    const result = await service.probeCapacity(request(), 'err-401');
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result?.validatedFeasibleCount).toBe(4);
    expect(service.capacityStatus()).toBe('ready');
    expect(service.lastError()).toBeNull();
  });
});
