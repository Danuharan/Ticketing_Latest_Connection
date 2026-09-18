/**
 * Azure Document Intelligence — prebuilt-layout OCR.
 *
 * Returns every detected text token with a normalized centre (0–100 canvas %)
 * so the vision model can be anchored to *real* labels instead of hallucinating
 * block names and positions.
 */

export interface OcrToken {
  text: string;
  xPct: number;
  yPct: number;
  /** Glyph height as a % of page height — used to drop tiny aisle numbers. */
  hPct?: number;
}

const API_VERSION = '2024-11-30';
const MAX_POLLS = 30;
const POLL_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function polygonCentre(polygon: number[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  const points = polygon.length / 2;
  for (let i = 0; i < polygon.length; i += 2) {
    sx += polygon[i];
    sy += polygon[i + 1];
  }
  return { x: sx / points, y: sy / points };
}

function polygonHeight(polygon: number[]): number {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < polygon.length; i += 2) {
    minY = Math.min(minY, polygon[i]);
    maxY = Math.max(maxY, polygon[i]);
  }
  return maxY > minY ? maxY - minY : 0;
}

/**
 * Runs layout OCR and returns normalized text tokens. Throws on hard failures so
 * the caller can decide whether to continue with the vision model alone.
 */
export async function runAzureOcr(
  endpoint: string,
  apiKey: string,
  base64Image: string,
): Promise<OcrToken[]> {
  const base = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
  const analyzeUrl =
    `${base}documentintelligence/documentModels/prebuilt-layout:analyze` +
    `?api-version=${API_VERSION}`;

  const start = await fetch(analyzeUrl, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ base64Source: base64Image }),
  });

  if (!start.ok) {
    const detail = await start.text();
    throw new Error(`Azure OCR start failed (${start.status}): ${detail}`);
  }

  const operationLocation = start.headers.get('Operation-Location');
  if (!operationLocation) {
    throw new Error('Azure OCR did not return an Operation-Location header.');
  }

  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    await sleep(POLL_DELAY_MS);
    const poll = await fetch(operationLocation, {
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
    });
    if (!poll.ok) {
      const detail = await poll.text();
      throw new Error(`Azure OCR poll failed (${poll.status}): ${detail}`);
    }
    const data = await poll.json();
    const status = data?.status;
    if (status === 'succeeded') {
      return extractTokens(data?.analyzeResult);
    }
    if (status === 'failed') {
      throw new Error(
        `Azure OCR analysis failed: ${JSON.stringify(data?.error ?? {})}`,
      );
    }
  }

  throw new Error('Azure OCR timed out before completing.');
}

function extractTokens(analyzeResult: unknown): OcrToken[] {
  const tokens: OcrToken[] = [];
  const pages = (analyzeResult as { pages?: unknown[] })?.pages;
  if (!Array.isArray(pages)) {
    return tokens;
  }

  for (const page of pages) {
    const p = page as {
      width?: number;
      height?: number;
      words?: { content?: string; polygon?: number[] }[];
    };
    const width = p.width ?? 0;
    const height = p.height ?? 0;
    if (!width || !height || !Array.isArray(p.words)) {
      continue;
    }
    for (const word of p.words) {
      const content = (word.content ?? '').trim();
      if (!content || !Array.isArray(word.polygon) || word.polygon.length < 8) {
        continue;
      }
      const centre = polygonCentre(word.polygon);
      tokens.push({
        text: content,
        xPct: Math.round((centre.x / width) * 1000) / 10,
        yPct: Math.round((centre.y / height) * 1000) / 10,
        hPct: Math.round((polygonHeight(word.polygon) / height) * 1000) / 10,
      });
    }
  }

  return tokens;
}
