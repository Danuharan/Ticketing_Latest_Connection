/// <reference path="./deno.d.ts" />

/**
 * generate-dining-layouts — constraint-based dining table suggestion engine.
 * No LLM. Seeded RNG + families + hard validation + scoring + diversity.
 */

import { GENERATOR_VERSION, generateDiningLayouts } from './candidate-generator.ts';
import { corsHeaders, jsonResponse } from './cors.ts';
import { normalizeRules } from './rules.ts';
import type { GenerateDiningLayoutsRequest, GenerateDiningLayoutsResponse } from './types.ts';
import { DEFAULT_DINING_LAYOUT_RULES } from './types.ts';

function withVersion(
  payload: Omit<GenerateDiningLayoutsResponse, 'generatorVersion'>,
  status = 200,
): Response {
  return jsonResponse(
    {
      ...payload,
      generatorVersion: GENERATOR_VERSION,
      supportsTableMix: true,
    } satisfies GenerateDiningLayoutsResponse,
    status,
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.', generatorVersion: GENERATOR_VERSION }, 405);
  }

  let body: GenerateDiningLayoutsRequest;
  try {
    body = (await req.json()) as GenerateDiningLayoutsRequest;
  } catch {
    return withVersion({ ok: false, layouts: [], error: 'Invalid JSON body.' }, 400);
  }

  if (!body?.block?.polygon || body.block.polygon.length < 3) {
    return withVersion(
      { ok: false, layouts: [], error: 'block.polygon with at least 3 points is required.' },
      400,
    );
  }
  if (!body.tableCatalogue?.length) {
    return withVersion({ ok: false, layouts: [], error: 'tableCatalogue is required.' }, 400);
  }

  body.rules = normalizeRules(body.rules ?? DEFAULT_DINING_LAYOUT_RULES);
  body.generation = {
    suggestionCount: body.generation?.suggestionCount ?? 6,
    seed: body.generation?.seed ?? Date.now(),
    excludeFingerprints: body.generation?.excludeFingerprints ?? [],
    timeBudgetMs: body.generation?.timeBudgetMs,
    candidateLimit: body.generation?.candidateLimit,
    relocateFeatures: body.generation?.relocateFeatures,
    mode: body.generation?.mode,
  };
  const capacityMode = body.generation.mode === 'capacity';
  const feasibilityMode = body.generation.mode === 'feasibility';
  const mixLanes = (body.target?.mix ?? []).filter((lane) => (lane?.count ?? 0) > 0);
  if (!capacityMode && mixLanes.length > 0) {
    const unknown = mixLanes.find(
      (lane) => !body.tableCatalogue.some((type) => type.id === lane.catalogueId),
    );
    if (unknown) {
      return withVersion(
        { ok: false, layouts: [], error: `target.mix references unknown catalogueId "${unknown.catalogueId}".` },
        400,
      );
    }
    const mixTotal = mixLanes.reduce((sum, lane) => sum + Math.round(lane.count), 0);
    body.target = { ...body.target, mix: mixLanes, tableCount: mixTotal };
  }
  if (capacityMode) {
    body.target = {
      ...(body.target ?? {}),
      tableCount: undefined,
      targetCapacity: undefined,
      mix: undefined,
    };
    body.generation.suggestionCount = 1;
    body.generation.timeBudgetMs = body.generation.timeBudgetMs ?? 2500;
  }
  if (feasibilityMode) {
    body.generation.suggestionCount = 1;
    body.generation.timeBudgetMs = body.generation.timeBudgetMs ?? 1800;
  }
  body.accessPoints = {
    entrances: body.accessPoints?.entrances ?? [],
    exits: body.accessPoints?.exits ?? [],
    emergencyExits: body.accessPoints?.emergencyExits ?? [],
  };
  body.features = body.features ?? {};

  try {
    const result = generateDiningLayouts(body);
    const requested = capacityMode ? undefined : (body.target?.tableCount ?? result.requestedTableCount);
    const activeMix = capacityMode ? [] : mixLanes;
    const matchesMix = (layout: { tables: { catalogueId: string }[] }): boolean => {
      if (activeMix.length === 0) {
        return true;
      }
      const counts = new Map<string, number>();
      for (const table of layout.tables) {
        counts.set(table.catalogueId, (counts.get(table.catalogueId) ?? 0) + 1);
      }
      return activeMix.every((lane) => (counts.get(lane.catalogueId) ?? 0) === Math.round(lane.count));
    };
    const layouts = result.layouts.filter(
      (layout) => (requested == null || layout.tableCount === requested) && matchesMix(layout),
    );
    const feasibleCount = result.validatedFeasibleTableCount;
    const provenMax = result.provenMaximumTableCount;
    const maximumProven = result.maximumProven;
    const witnessCount = result.witnessLayout?.tables.length ?? 0;
    const witnessValidated = Boolean(result.witnessLayout && witnessCount === feasibleCount && feasibleCount > 0);
    const failureKind =
      layouts.length > 0
        ? 'EXACT_FOUND'
        : requested != null && maximumProven && provenMax != null && provenMax < requested
          ? 'OPERATIONAL_MAX_BELOW_REQUEST'
          : requested != null && layouts.length === 0
            ? 'NOT_FOUND_YET'
            : result.failureKind;

    const hints: string[] = [];
    if (layouts.length === 0) {
      const reasons = result.rejectionReasons;
      if (failureKind === 'OPERATIONAL_MAX_BELOW_REQUEST') {
        hints.push(`${requested} tables cannot fit. Proven operational maximum: ${provenMax}.`);
      } else if (requested != null) {
        hints.push(`No valid ${requested}-table arrangement was found within the current search.`);
      }
      if ((reasons['feature-overlap'] ?? 0) > 0) {
        hints.push('Entrance/Exit/Stage/Food Prep clearance leaves insufficient area.');
      }
      if ((reasons['outside-block'] ?? 0) > 0) {
        hints.push('Table footprint (table + chairs + clearance) is too large.');
      }
      if ((reasons['aisle-blocked'] ?? 0) > 0) {
        hints.push('Aisle constraints are too restrictive.');
      }
    }

    const message =
      layouts.length === 0
        ? failureKind === 'OPERATIONAL_MAX_BELOW_REQUEST'
          ? `${requested} tables cannot fit. Proven operational maximum: ${provenMax}.`
          : requested != null
            ? `No valid ${requested}-table arrangement was found within the current search.`
            : 'No valid layout found under current rules.'
        : undefined;

    const responseMode = capacityMode ? 'capacity' : feasibilityMode ? 'feasibility' : 'generate';
    return withVersion({
      ok: capacityMode ? feasibleCount > 0 || maximumProven : layouts.length > 0,
      mode: responseMode,
      maximumTableCount: capacityMode && maximumProven ? provenMax ?? undefined : undefined,
      validatedFeasibleTableCount: feasibleCount,
      provenMaximumTableCount: provenMax,
      maximumProven,
      basicGeometricUpperBound: result.basicGeometricUpperBound,
      feasible: result.feasible,
      layouts,
      diagnostics: {
        candidateCount: result.candidateCount,
        validCount: result.validCount,
        durationMs: result.durationMs,
        rejectionReasons: result.rejectionReasons,
        message,
        hints: hints.length > 0 ? hints : undefined,
        requestedTableCount: requested,
        estimatedOperationalMaxTableCount: capacityMode && maximumProven ? provenMax ?? undefined : undefined,
        operationalMaxTableCount: capacityMode && maximumProven ? provenMax ?? undefined : undefined,
        witnessTableCount: witnessCount,
        witnessValidated,
        failureKind,
        validatedFeasibleTableCount: feasibleCount,
        provenMaximumTableCount: provenMax,
        maximumProven,
        basicGeometricUpperBound: result.basicGeometricUpperBound,
        feasible: result.feasible,
        generationDebug: result.generationDebug,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Layout generation failed.';
    return withVersion({ ok: false, layouts: [], error: message }, 500);
  }
});
