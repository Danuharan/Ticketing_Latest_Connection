import { Injectable, inject } from '@angular/core';

import { SupabaseService } from '../../../core/services/supabase.service';
import type {
  BlueprintAnalysisRequest,
  BlueprintAnalysisResult,
} from '../models/blueprint-analysis.model';

import type { OcrToken } from '../lib/assign-ocr-labels';
import { BLUEPRINT_IMAGE_SPEC } from '../lib/blueprint-image-spec';

const EDGE_FUNCTION = 'analyze-blueprint';
const MAX_FILE_BYTES = BLUEPRINT_IMAGE_SPEC.maxFileMb * 1024 * 1024;

/** Thrown for user-actionable failures (bad file, function missing, model error). */
export class BlueprintAnalysisError extends Error {}

@Injectable({ providedIn: 'root' })
export class BlueprintAnalyzerService {
  private readonly supabase = inject(SupabaseService);

  /** Azure OCR only — used with client-side block polygon detection. */
  async fetchOcr(file: File): Promise<OcrToken[]> {
    if (!file.type.startsWith('image/')) {
      throw new BlueprintAnalysisError('Please choose an image file (PNG, JPG, or WEBP).');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new BlueprintAnalysisError(
        `Image is too large. Use a file under ${BLUEPRINT_IMAGE_SPEC.maxFileMb} MB ` +
          `(recommended ${BLUEPRINT_IMAGE_SPEC.recommendedFileMinMb}–${BLUEPRINT_IMAGE_SPEC.recommendedFileMaxMb} MB).`,
      );
    }

    const { base64: imageBase64, mimeType } = await toOcrCompatibleImage(file);
    const { data, error } = await this.supabase.client.functions.invoke<{
      ocrTokens?: OcrToken[];
      error?: string;
      meta?: { ocrError?: string; ocrTokenCount?: number };
    }>(EDGE_FUNCTION, {
      body: { imageBase64, mimeType, ocrOnly: true },
    });

    if (error) {
      throw new BlueprintAnalysisError(this.describeInvokeError(error));
    }
    if (!data) {
      return [];
    }
    if (data.error) {
      throw new BlueprintAnalysisError(this.describeOcrError(data.error));
    }
    if (data.meta?.ocrError) {
      throw new BlueprintAnalysisError(this.describeOcrError(data.meta.ocrError));
    }
    return data.ocrTokens ?? [];
  }

  /** Uploads the image to the edge function and returns the analysis result. */
  async analyze(
    file: File,
    options: { includeSeats?: boolean } = {},
  ): Promise<BlueprintAnalysisResult> {
    if (!file.type.startsWith('image/')) {
      throw new BlueprintAnalysisError('Please choose an image file (PNG, JPG, or WEBP).');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new BlueprintAnalysisError(
        `Image is too large. Use a file under ${BLUEPRINT_IMAGE_SPEC.maxFileMb} MB ` +
          `(recommended ${BLUEPRINT_IMAGE_SPEC.recommendedFileMinMb}–${BLUEPRINT_IMAGE_SPEC.recommendedFileMaxMb} MB).`,
      );
    }

    const imageBase64 = await fileToBase64(file);
    const payload: BlueprintAnalysisRequest = {
      imageBase64,
      mimeType: file.type,
      includeSeats: options.includeSeats ?? false,
    };

    const { data, error } = await this.supabase.client.functions.invoke<
      BlueprintAnalysisResult & { error?: string }
    >(EDGE_FUNCTION, { body: payload });

    if (error) {
      throw new BlueprintAnalysisError(this.describeInvokeError(error));
    }
    if (!data) {
      throw new BlueprintAnalysisError('The analyzer returned an empty response.');
    }
    if (data.error) {
      throw new BlueprintAnalysisError(data.error);
    }
    if (!Array.isArray(data.tiers)) {
      throw new BlueprintAnalysisError('The analyzer returned an unexpected response.');
    }

    return data;
  }

  private describeInvokeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|404|failed to send a request|failed to fetch|networkerror/i.test(message)) {
      return 'AI analyzer is not reachable. The analyze-blueprint edge function is most likely not deployed yet — deploy it first (see docs/AI_DETECTION_SETUP.md).';
    }
    return `AI analysis failed: ${message}`;
  }

  private describeOcrError(message: string): string {
    if (/AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT/i.test(message)) {
      return 'Azure OCR endpoint is not set in Supabase secrets (AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT).';
    }
    if (/AZURE_DOCUMENT_INTELLIGENCE_KEY/i.test(message)) {
      return 'Azure OCR key is not set in Supabase secrets (AZURE_DOCUMENT_INTELLIGENCE_KEY).';
    }
    return `Azure OCR failed: ${message}`;
  }
}

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('Could not read the image file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Azure Document Intelligence supports JPEG/PNG/BMP/TIFF/HEIF but NOT WEBP/GIF.
 * Re-encode unsupported formats to PNG in the browser so OCR always runs.
 */
const OCR_SUPPORTED_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/bmp',
  'image/tiff',
  'image/heif',
]);

async function toOcrCompatibleImage(file: File): Promise<{ base64: string; mimeType: string }> {
  if (OCR_SUPPORTED_TYPES.has(file.type.toLowerCase())) {
    return { base64: await fileToBase64(file), mimeType: file.type };
  }
  try {
    const pngBlob = await reencodeToPng(file);
    return { base64: await fileToBase64(pngBlob), mimeType: 'image/png' };
  } catch {
    // Fall back to the original bytes; OCR may still reject but geometry works.
    return { base64: await fileToBase64(file), mimeType: file.type };
  }
}

function reencodeToPng(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not create a conversion canvas.'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('PNG conversion failed.'))),
        'image/png',
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load the image for conversion.'));
    };
    img.src = url;
  });
}
