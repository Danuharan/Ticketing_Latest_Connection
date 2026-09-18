export interface VisionImage {
  mimeType: string;
  base64: string;
}

export interface VisionCallOptions {
  /** Hard cap on how long we wait for OpenRouter before aborting (ms). */
  timeoutMs?: number;
  /** Cap on generated tokens — keeps the JSON response fast. */
  maxTokens?: number;
}

/** Calls an OpenRouter vision model with one or more images, returns raw text. */
export async function callOpenRouterVisionImages(
  apiKey: string,
  model: string,
  images: VisionImage[],
  prompt: string,
  options: VisionCallOptions = {},
): Promise<string> {
  const { timeoutMs = 60_000, maxTokens = 4000 } = options;
  // Own the timeout instead of letting the platform/upstream abort with an
  // opaque "Signal timed out" — this only fires when a call is genuinely slow,
  // and the caller can retry it transparently.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://optimo-venue-layout.app',
        'X-Title': 'Optimo Venue Layout',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...images.map((img) => ({
                type: 'image_url',
                image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
              })),
            ],
          },
        ],
      }),
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new VisionTimeoutError(`OpenRouter timed out after ${timeoutMs}ms.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OpenRouter request failed (${res.status}): ${extractErrorMessage(detail)}`);
  }

  const data = await res.json();
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('OpenRouter returned an empty response.');
  }
  // A "length" finish means the model was cut off mid-JSON — surface that
  // clearly instead of failing later with an opaque JSON parse error.
  const finishReason: string | undefined = data?.choices?.[0]?.finish_reason;
  if (finishReason === 'length') {
    throw new Error(
      `OpenRouter response was truncated at the ${maxTokens}-token limit — raise max_tokens.`,
    );
  }
  return text;
}

/** Thrown when a vision call exceeds its timeout — callers may retry it. */
export class VisionTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisionTimeoutError';
  }
}

/**
 * Pulls the human-readable message out of an OpenRouter error body so callers
 * see one sentence instead of the full nested JSON (which repeats the same
 * message once per upstream provider attempt).
 */
function extractErrorMessage(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } };
    const message = parsed?.error?.message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message.trim();
    }
  } catch {
    // Not JSON — return the raw body below.
  }
  return detail;
}

/** Calls an OpenRouter vision model and returns the raw text response. */
export function callOpenRouterVision(
  apiKey: string,
  model: string,
  mimeType: string,
  base64Image: string,
  prompt: string,
): Promise<string> {
  return callOpenRouterVisionImages(apiKey, model, [{ mimeType, base64: base64Image }], prompt);
}

/** Extracts the first JSON object from a model response (handles ``` fences). */
export function parseModelJson<T>(raw: string): T {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('Model response did not contain a JSON object.');
  }
  const slice = text.slice(first, last + 1);
  try {
    return JSON.parse(slice) as T;
  } catch (err) {
    // Models occasionally emit almost-JSON (trailing commas, smart quotes,
    // raw newlines in strings). Try a repaired copy before giving up.
    try {
      return JSON.parse(repairModelJson(slice)) as T;
    } catch {
      throw err; // Surface the original, position-bearing parse error.
    }
  }
}

/** Best-effort cleanup of common LLM JSON mistakes. */
function repairModelJson(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    let ch = text[i];
    if (inString) {
      if (ch === '\\') {
        out += ch + (text[i + 1] ?? '');
        i += 1;
        continue;
      }
      // Raw line breaks are invalid inside JSON strings — escape them.
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\r') {
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      out += ch;
      continue;
    }
    // Smart quotes used as string delimiters.
    if (ch === '“' || ch === '”') {
      ch = '"';
    }
    if (ch === '"') {
      inString = true;
    }
    out += ch;
  }
  // Trailing commas before a closing brace/bracket.
  return out.replace(/,\s*([}\]])/g, '$1');
}
