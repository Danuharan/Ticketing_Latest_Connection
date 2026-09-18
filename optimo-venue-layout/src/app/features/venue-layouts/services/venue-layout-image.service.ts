import { Injectable, inject } from '@angular/core';

import { ReferenceImageConfig, VenueLayoutConfig } from '../../../core/models/venue-layout-config.model';
import { AuthService } from '../../../core/services/auth.service';
import { SupabaseService } from '../../../core/services/supabase.service';

const BUCKET = 'venue-layouts';
const SIGNED_URL_TTL_SEC = 60 * 60;

@Injectable({ providedIn: 'root' })
export class VenueLayoutImageService {
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);

  /**
   * Uploads blueprint dataUrl to Storage (if needed) and returns a layout_config
   * safe to persist: referenceImage keeps storagePath + metadata, never dataUrl.
   */
  async prepareLayoutForPersist(
    layout: VenueLayoutConfig,
    templateId: string | null,
  ): Promise<VenueLayoutConfig> {
    const next = structuredClone(layout);
    const ref = next.referenceImage;
    if (!ref) {
      return next;
    }

    const userId = this.requireUserId();
    if (ref.dataUrl?.startsWith('data:')) {
      const folder = templateId?.trim() || crypto.randomUUID();
      const fileName = this.buildFileName(ref);
      const path = `${userId}/${folder}/${fileName}`;
      await this.uploadDataUrl(path, ref.dataUrl);
      ref.storagePath = path;
    }

    // Never store the giant base64 blob in layout_config JSONB.
    delete ref.dataUrl;
    if (!ref.storagePath) {
      delete next.referenceImage;
    }
    return next;
  }

  /** Resolves storagePath → signed URL into dataUrl for canvas display. */
  async hydrateLayoutForDisplay(layout: VenueLayoutConfig): Promise<VenueLayoutConfig> {
    const next = structuredClone(layout);
    const ref = next.referenceImage;
    if (!ref?.storagePath) {
      return next;
    }
    if (ref.dataUrl?.startsWith('data:') || ref.dataUrl?.startsWith('http')) {
      return next;
    }

    const { data, error } = await this.supabase.storage
      .from(BUCKET)
      .createSignedUrl(ref.storagePath, SIGNED_URL_TTL_SEC);

    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? 'Unable to load blueprint image from storage.');
    }

    ref.dataUrl = data.signedUrl;
    return next;
  }

  private async uploadDataUrl(path: string, dataUrl: string): Promise<void> {
    const blob = await (await fetch(dataUrl)).blob();
    const contentType = blob.type || this.mimeFromPath(path) || 'image/jpeg';
    const { error } = await this.supabase.storage.from(BUCKET).upload(path, blob, {
      upsert: true,
      contentType,
      cacheControl: '3600',
    });
    if (error) {
      throw new Error(`Blueprint upload failed: ${error.message}`);
    }
  }

  private buildFileName(ref: ReferenceImageConfig): string {
    const raw = (ref.name ?? 'blueprint').trim() || 'blueprint';
    const cleaned = raw.replace(/[^\w.\-()+ ]+/g, '_').replace(/\s+/g, '-').slice(0, 120);
    if (/\.(jpe?g|png|webp|gif)$/i.test(cleaned)) {
      return cleaned;
    }
    const ext = this.extFromDataUrl(ref.dataUrl) ?? 'jpg';
    return `${cleaned}.${ext}`;
  }

  private extFromDataUrl(dataUrl: string | undefined): string | null {
    if (!dataUrl?.startsWith('data:')) {
      return null;
    }
    const mime = dataUrl.slice(5, dataUrl.indexOf(';')).toLowerCase();
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    return null;
  }

  private mimeFromPath(path: string): string | null {
    const lower = path.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    return null;
  }

  private requireUserId(): string {
    const id = this.auth.user()?.id;
    if (!id) {
      throw new Error('You must be logged in to upload blueprint images.');
    }
    return id;
  }
}
