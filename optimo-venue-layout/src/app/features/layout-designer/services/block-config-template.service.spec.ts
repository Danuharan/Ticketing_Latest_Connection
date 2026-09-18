/** @vitest-environment jsdom */
import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SupabaseService } from '../../../core/services/supabase.service';
import { BlockConfigTemplateService } from './block-config-template.service';

describe('BlockConfigTemplateService ensureLoaded / reloadTemplates', () => {
  let service: BlockConfigTemplateService;
  let selectOrderCalls: number;
  let resolveSelect: (value: { data: unknown[]; error: null }) => void;
  let selectPromise: Promise<{ data: unknown[]; error: null }>;

  beforeEach(() => {
    selectOrderCalls = 0;
    selectPromise = new Promise((resolve) => {
      resolveSelect = resolve;
    });

    const fromMock = vi.fn(() => ({
      select: vi.fn(() => {
        selectOrderCalls += 1;
        return {
          order: vi.fn(() => selectPromise),
        };
      }),
    }));

    const injector = Injector.create({
      providers: [
        BlockConfigTemplateService,
        {
          provide: SupabaseService,
          useValue: {
            client: {
              from: fromMock,
            },
          },
        },
      ],
    });

    service = runInInjectionContext(injector, () => injector.get(BlockConfigTemplateService));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads once via ensureLoaded; property-edit style re-calls stay cached', async () => {
    const first = service.ensureLoaded();
    expect(service.loading()).toBe(true);
    expect(selectOrderCalls).toBe(1);

    // Concurrent ensureLoaded shares the same in-flight request.
    const second = service.ensureLoaded();
    expect(selectOrderCalls).toBe(1);

    resolveSelect({ data: [], error: null });
    await Promise.all([first, second]);

    expect(service.loading()).toBe(false);
    expect(selectOrderCalls).toBe(1);

    // Simulate many block property edits calling ensureLoaded again.
    for (let i = 0; i < 10; i += 1) {
      await service.ensureLoaded();
    }
    expect(selectOrderCalls).toBe(1);
    expect(service.loading()).toBe(false);
  });

  it('reloadTemplates forces a new network load', async () => {
    const initial = service.ensureLoaded();
    resolveSelect({ data: [], error: null });
    await initial;
    expect(selectOrderCalls).toBe(1);

    selectPromise = new Promise((resolve) => {
      resolveSelect = resolve;
    });

    const reload = service.reloadTemplates();
    expect(service.loading()).toBe(true);
    expect(selectOrderCalls).toBe(2);

    resolveSelect({ data: [], error: null });
    await reload;
    expect(service.loading()).toBe(false);
    expect(selectOrderCalls).toBe(2);
  });
});
