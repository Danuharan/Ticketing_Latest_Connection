/// <reference path="./deno.d.ts" />

/**
 * analyze-blueprint — Supabase Edge Function (Deno).
 *
 * Hybrid blueprint analysis pipeline:
 *   1. Azure Document Intelligence  -> exact text labels + bounding boxes (OCR)
 *   2. OpenRouter vision model      -> tier/ring geometry + semantics, anchored
 *                                      to the OCR tokens so names are not guessed
 *   3. Normalize                    -> safe BlueprintAnalysisResult JSON
 *
 * Secrets (set with `supabase secrets set ...`):
 *   AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
 *   AZURE_DOCUMENT_INTELLIGENCE_KEY
 *   OPENROUTER_API_KEY
 *   BLUEPRINT_MODEL                 (optional, defaults to google/gemini-2.5-flash)
 */

import { corsHeaders, jsonResponse } from './cors.ts';
import { runAzureOcr, type OcrToken } from './azure-ocr.ts';
import { buildAnalysisPrompt } from './prompt.ts';
import {
  callOpenRouterVision,
  callOpenRouterVisionImages,
  parseModelJson,
  VisionTimeoutError,
} from './openrouter.ts';
import { normalizeResult } from './normalize.ts';
import { parseSeatingSpecFromOcr } from './parse-seating-spec.ts';
import { buildVerificationPrompt, type VerifyBlockSummary } from './verify-prompt.ts';
import { normalizeVerification } from './normalize-verify.ts';

const DEFAULT_MODEL = 'google/gemini-2.5-flash';

interface RequestBody {
  imageBase64?: string;
  mimeType?: string;
  includeSeats?: boolean;
  /** When true, run Azure OCR only — skip the vision LLM (used by client-side CV pipeline). */
  ocrOnly?: boolean;
  /** When true, OCR + parse structured seating spec (block sides, rows, gaps). */
  seatingSpecOnly?: boolean;
  /** When true, audit detected blocks against the blueprint (skips OCR). */
  verifyBlocks?: boolean;
  /** Composite overlay image (blueprint + numbered detected outlines), base64. */
  overlayBase64?: string;
  /** Detected block summary table matching the overlay badge numbers. */
  blocks?: VerifyBlockSummary[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const azureEndpoint = Deno.env.get('AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT');
  const azureKey = Deno.env.get('AZURE_DOCUMENT_INTELLIGENCE_KEY');

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  const imageBase64 = stripDataUrl(body.imageBase64 ?? '');
  const mimeType = body.mimeType ?? 'image/png';
  const includeSeats = body.includeSeats ?? false;
  const ocrOnly = body.ocrOnly ?? false;
  const seatingSpecOnly = body.seatingSpecOnly ?? false;

  if (!imageBase64) {
    return jsonResponse({ error: 'imageBase64 is required.' }, 400);
  }

  if (seatingSpecOnly && !azureEndpoint) {
    return jsonResponse({
      error: 'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT is not configured.',
    }, 500);
  }

  const startedAt = Date.now();

  // Verification audit — vision LLM only, no OCR needed.
  if (body.verifyBlocks) {
    const verifyKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!verifyKey) {
      return jsonResponse({ error: 'OPENROUTER_API_KEY is not configured.' }, 500);
    }
    const overlayBase64 = stripDataUrl(body.overlayBase64 ?? '');
    if (!overlayBase64) {
      return jsonResponse({ error: 'overlayBase64 is required for verifyBlocks.' }, 400);
    }
    // Flash only — keep verification on google/gemini-2.5-flash.
    // Override with BLUEPRINT_VERIFY_MODEL if needed.
    const verifyModel = Deno.env.get('BLUEPRINT_VERIFY_MODEL') ?? DEFAULT_MODEL;
    const prompt = buildVerificationPrompt(body.blocks ?? []);
    const images = [
      { mimeType, base64: imageBase64 },
      { mimeType, base64: overlayBase64 },
    ];
    // Per-attempt cap; retry transient timeouts/overloads so the client only
    // sees a failure when the call is genuinely slow across every attempt.
    const VERIFY_TIMEOUT_MS = 55_000;
    const MAX_ATTEMPTS = 2;
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const rawText = await callOpenRouterVisionImages(
          verifyKey,
          verifyModel,
          images,
          prompt,
          { timeoutMs: VERIFY_TIMEOUT_MS, maxTokens: 4000 },
        );
        const verification = normalizeVerification(parseModelJson<unknown>(rawText));
        return jsonResponse({
          verification,
          meta: {
            llmModel: verifyModel,
            processingTimeMs: Date.now() - startedAt,
            attempts: attempt,
          },
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error(
          `[analyze-blueprint] verification attempt ${attempt}/${MAX_ATTEMPTS} with ${verifyModel} failed:`,
          lastError,
        );
        const transient =
          err instanceof VisionTimeoutError ||
          // Garbled JSON answers are a per-response fluke — a retry usually
          // yields clean JSON, so treat them like transient provider errors.
          err instanceof SyntaxError ||
          /\b(429|502|503|504)\b|overloaded|rate limit|timed? ?out|JSON/i.test(lastError);
        if (!transient || attempt === MAX_ATTEMPTS) {
          break;
        }
      }
    }
    return jsonResponse({ error: lastError || 'Verification failed.' }, 502);
  }

  // Layer 1 — OCR (best-effort).
  let ocrTokens: OcrToken[] = [];
  let ocrError: string | null = null;
  if (azureEndpoint && azureKey) {
    try {
      ocrTokens = await runAzureOcr(azureEndpoint, azureKey, imageBase64);
    } catch (err) {
      ocrError = err instanceof Error ? err.message : String(err);
      console.error('[analyze-blueprint] OCR failed:', ocrError);
    }
  }

  if (ocrOnly) {
    if (!azureEndpoint || !azureKey) {
      ocrError = !azureEndpoint
        ? 'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT is not configured.'
        : 'AZURE_DOCUMENT_INTELLIGENCE_KEY is not configured.';
    }
    return jsonResponse({
      ocrTokens,
      meta: {
        modelUsed: ocrTokens.length > 0 ? 'azure-ocr' : 'none',
        ocrTokenCount: ocrTokens.length,
        processingTimeMs: Date.now() - startedAt,
        ...(ocrError ? { ocrError } : {}),
      },
    });
  }

  if (seatingSpecOnly) {
    if (!azureKey) {
      return jsonResponse({
        error: 'AZURE_DOCUMENT_INTELLIGENCE_KEY is not configured.',
      }, 500);
    }
    if (ocrError) {
      return jsonResponse({ error: ocrError }, 502);
    }
    const { spec, notes } = parseSeatingSpecFromOcr(ocrTokens);
    return jsonResponse({
      spec,
      parseNotes: notes,
      meta: {
        modelUsed: 'azure-ocr+seating-spec-parser',
        ocrTokenCount: ocrTokens.length,
        processingTimeMs: Date.now() - startedAt,
      },
      ...(spec ? {} : { error: 'Could not read seating specification from the image.' }),
    });
  }

  const openRouterKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!openRouterKey) {
    return jsonResponse({ error: 'OPENROUTER_API_KEY is not configured.' }, 500);
  }
  const model = Deno.env.get('BLUEPRINT_MODEL') ?? DEFAULT_MODEL;

  // Layer 2 + 3 — vision model anchored to OCR, then normalize.
  try {
    const prompt = buildAnalysisPrompt(ocrTokens, includeSeats);
    const rawText = await callOpenRouterVision(
      openRouterKey,
      model,
      mimeType,
      imageBase64,
      prompt,
    );
    const parsed = parseModelJson<unknown>(rawText);
    const result = normalizeResult(parsed, includeSeats);

    return jsonResponse({
      ...result,
      meta: {
        modelUsed: ocrTokens.length > 0 ? 'azure-ocr+openrouter' : 'openrouter',
        ocrTokenCount: ocrTokens.length,
        llmModel: model,
        processingTimeMs: Date.now() - startedAt,
        ...(ocrError ? { ocrError } : {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[analyze-blueprint] analysis failed:', message);
    return jsonResponse({ error: message }, 502);
  }
});

function stripDataUrl(value: string): string {
  const comma = value.indexOf(',');
  return value.startsWith('data:') && comma !== -1
    ? value.slice(comma + 1)
    : value;
}
