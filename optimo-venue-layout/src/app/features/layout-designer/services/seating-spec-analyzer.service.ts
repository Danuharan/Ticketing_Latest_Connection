import { Injectable } from '@angular/core';

import { environment } from '../../../../environments/environment';
import type { SeatingChartSpec, SeatingSpecAnalysisResult } from '../models/seating-spec.model';
import {
  isLocalSpecFile,
  readFileAsText,
  textFromSvgMarkup,
} from '../lib/local-spec-file';
import {
  parseSeatingSpecFromOcrTokens,
  parseSeatingSpecFromRawText,
  type OcrTokenLike,
} from '../lib/parse-seating-spec';

const EDGE_FUNCTION = 'analyze-blueprint';
const MAX_FILE_BYTES = 8 * 1024 * 1024;

interface SeatingSpecEdgeResponse {
  spec?: SeatingChartSpec | null;
  parseNotes?: string[];
  error?: string;
  meta?: {
    ocrTokenCount?: number;
    modelUsed?: string;
    processingTimeMs?: number;
  };
}

interface OcrEdgeResponse {
  ocrTokens?: OcrTokenLike[];
  error?: string;
  meta?: {
    ocrTokenCount?: number;
    modelUsed?: string;
    processingTimeMs?: number;
    ocrError?: string;
  };
}

export class SeatingSpecAnalysisError extends Error {}

@Injectable({ providedIn: 'root' })
export class SeatingSpecAnalyzerService {
  async analyzeFile(file: File): Promise<SeatingSpecAnalysisResult> {
    const mimeType = file.type || guessMimeType(file.name);
    const allowed =
      mimeType.startsWith('image/') ||
      mimeType === 'application/pdf' ||
      mimeType === 'text/plain' ||
      file.name.toLowerCase().endsWith('.pdf') ||
      file.name.toLowerCase().endsWith('.txt') ||
      file.name.toLowerCase().endsWith('.svg');
    if (!allowed) {
      throw new SeatingSpecAnalysisError('Please choose an image (PNG, JPG, WEBP, SVG), PDF, or TXT.');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new SeatingSpecAnalysisError('File is too large. Use a file under 8 MB.');
    }

    if (isLocalSpecFile(file)) {
      return this.analyzeLocalSpecFile(file);
    }

    const imageBase64 = await fileToBase64(file);
    try {
      return await this.invokeSeatingSpec(imageBase64, mimeType);
    } catch (primaryErr) {
      if (mimeType.startsWith('image/') && mimeType !== 'image/svg+xml') {
        try {
          return await this.invokeOcrFallback(imageBase64, mimeType);
        } catch {
          /* use primary error below */
        }
      }
      throw primaryErr;
    }
  }

  parseSampleText(text: string): SeatingChartSpec | null {
    return parseSeatingSpecFromRawText(text).spec;
  }

  private async analyzeLocalSpecFile(file: File): Promise<SeatingSpecAnalysisResult> {
    const raw = await readFileAsText(file);
    const text =
      file.name.toLowerCase().endsWith('.svg') || file.type === 'image/svg+xml'
        ? textFromSvgMarkup(raw)
        : raw;
    const { spec, notes } = parseSeatingSpecFromRawText(text);
    if (!spec) {
      throw new SeatingSpecAnalysisError(
        'Could not read seating specification from this file. Check the format matches the sample sheet.',
      );
    }
    return {
      spec,
      ocrTokenCount: 0,
      modelUsed: 'local-text-parser',
      processingTimeMs: 0,
      parseNotes: notes,
    };
  }

  private async invokeSeatingSpec(
    imageBase64: string,
    mimeType: string,
  ): Promise<SeatingSpecAnalysisResult> {
    const data = await this.postEdgeFunction<SeatingSpecEdgeResponse>({
      imageBase64,
      mimeType,
      seatingSpecOnly: true,
    });

    if (data.error && !data.spec) {
      throw new SeatingSpecAnalysisError(this.humanizeServerError(data.error));
    }

    return {
      spec: data.spec ?? null,
      ocrTokenCount: data.meta?.ocrTokenCount ?? 0,
      modelUsed: data.meta?.modelUsed ?? 'azure-ocr',
      processingTimeMs: data.meta?.processingTimeMs ?? 0,
      parseNotes: data.parseNotes,
      error: data.error,
    };
  }

  private async invokeOcrFallback(
    imageBase64: string,
    mimeType: string,
  ): Promise<SeatingSpecAnalysisResult> {
    const data = await this.postEdgeFunction<OcrEdgeResponse>({
      imageBase64,
      mimeType,
      ocrOnly: true,
    });

    if (data.error) {
      throw new SeatingSpecAnalysisError(this.humanizeServerError(data.error));
    }

    const tokens = data.ocrTokens ?? [];
    if (!tokens.length) {
      const ocrError = data.meta?.ocrError;
      throw new SeatingSpecAnalysisError(
        ocrError
          ? this.humanizeServerError(ocrError)
          : 'Azure OCR returned no text. Use a clearer image or the sample TXT/SVG sheet.',
      );
    }

    const { spec, notes } = parseSeatingSpecFromOcrTokens(tokens);
    if (!spec) {
      throw new SeatingSpecAnalysisError(
        'Azure read the image but could not find rows, seats, and side lengths. Use the sample format or Load sample (offline).',
      );
    }

    return {
      spec,
      ocrTokenCount: tokens.length,
      modelUsed: 'azure-ocr+local-parser',
      processingTimeMs: data.meta?.processingTimeMs ?? 0,
      parseNotes: notes,
    };
  }

  private async postEdgeFunction<T>(body: Record<string, unknown>): Promise<T> {
    const { url, publishableKey } = environment.supabase;
    if (!url || !publishableKey || publishableKey.includes('PASTE_')) {
      throw new SeatingSpecAnalysisError(
        'Supabase is not configured. Set publishableKey in environment.ts.',
      );
    }

    const response = await fetch(`${url}/functions/v1/${EDGE_FUNCTION}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${publishableKey}`,
        apikey: publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    let payload: T & { error?: string };
    try {
      payload = (await response.json()) as T & { error?: string };
    } catch {
      payload = {} as T & { error?: string };
    }

    if (!response.ok) {
      const serverError = payload?.error ?? `HTTP ${response.status}`;
      throw new SeatingSpecAnalysisError(this.humanizeServerError(serverError, response.status));
    }

    return payload;
  }

  private humanizeServerError(message: string, status?: number): string {
    if (/AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT/i.test(message)) {
      return 'Azure Document Intelligence endpoint is not set in Supabase secrets. Run: supabase secrets set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=… (see AI_DETECTION_SETUP.md).';
    }
    if (/AZURE_DOCUMENT_INTELLIGENCE_KEY/i.test(message)) {
      return 'Azure Document Intelligence API key is not set in Supabase secrets. Run: supabase secrets set AZURE_DOCUMENT_INTELLIGENCE_KEY=…';
    }
    if (/OPENROUTER_API_KEY/i.test(message)) {
      return 'Edge function needs redeploying with seatingSpecOnly support. Run: supabase functions deploy analyze-blueprint';
    }
    if (/Azure OCR/i.test(message)) {
      return `Azure OCR failed: ${message}. For the demo sheet, upload auto-seat-spec-example.svg or use Load sample (offline).`;
    }
    if (status === 404) {
      return 'analyze-blueprint edge function not found. Deploy it: supabase functions deploy analyze-blueprint';
    }
    return message;
  }
}

function guessMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  if (lower.endsWith('.pdf')) {
    return 'application/pdf';
  }
  if (lower.endsWith('.txt')) {
    return 'text/plain';
  }
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  return 'application/octet-stream';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}
