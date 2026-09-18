import { inject, Injectable } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';

import { VenueLayoutConfig } from '../../../core/models/venue-layout-config.model';

const STORAGE_PREFIX = 'ovl-layout-draft:';
const LEGACY_NEW_KEY = `${STORAGE_PREFIX}new`;
/** Points at the last draft key written — used if URL session (`t`) is lost on reload. */
const ACTIVE_KEY_POINTER = `${STORAGE_PREFIX}active-key`;

/** Browser draft for the designer — survives page refresh (localStorage). */
export interface LayoutDesignerDraft {
  version: 1;
  templateId: string | null;
  templateName: string;
  description: string;
  layoutConfig: VenueLayoutConfig;
  zoom: number;
  cameraX: number;
  cameraY: number;
  selectedId: string | null;
  /** Block customization workspace the user was inside when the draft saved. */
  blockWorkspaceId?: string | null;
  savedAt: string;
}

@Injectable({ providedIn: 'root' })
export class LayoutDraftService {
  private readonly router = inject(Router);

  private navigationCount = 0;
  private clientNavigationSinceLoad = false;
  private readonly initialLoadWasReload: boolean;

  constructor() {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    this.initialLoadWasReload = entry?.type === 'reload';

    this.router.events
      .pipe(filter((event): event is NavigationStart => event instanceof NavigationStart))
      .subscribe(() => {
        this.navigationCount++;
        if (this.navigationCount > 1) {
          this.clientNavigationSinceLoad = true;
        }
      });
  }

  storageKey(templateId: string | null, sessionId?: string | null): string {
    if (templateId) {
      return `${STORAGE_PREFIX}edit:${templateId}`;
    }
    if (sessionId) {
      return `${STORAGE_PREFIX}new:${sessionId}`;
    }
    return LEGACY_NEW_KEY;
  }

  /** Remember which draft the tab was last editing (helps recover after reload). */
  rememberActiveKey(key: string): void {
    try {
      sessionStorage.setItem(ACTIVE_KEY_POINTER, key);
    } catch {
      // ignore
    }
  }

  readActiveKey(): string | null {
    try {
      return sessionStorage.getItem(ACTIVE_KEY_POINTER);
    } catch {
      return null;
    }
  }

  clearActiveKey(): void {
    try {
      sessionStorage.removeItem(ACTIVE_KEY_POINTER);
    } catch {
      // ignore
    }
  }

  /**
   * Saves the draft. On quota failure, retries without the blueprint dataUrl so
   * elements / camera / workspace still survive refresh.
   */
  save(key: string, draft: LayoutDesignerDraft): boolean {
    const payload = JSON.stringify(draft);
    try {
      localStorage.setItem(key, payload);
      this.rememberActiveKey(key);
      return true;
    } catch {
      // Large reference images often blow past ~5MB localStorage quota.
    }

    const stripped = this.stripReferenceDataUrl(draft);
    if (!stripped) {
      return false;
    }
    try {
      localStorage.setItem(key, JSON.stringify(stripped));
      this.rememberActiveKey(key);
      return true;
    } catch {
      return false;
    }
  }

  load(key: string): LayoutDesignerDraft | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as LayoutDesignerDraft;
      if (parsed.version !== 1 || !parsed.layoutConfig?.elements) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  clear(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
    if (this.readActiveKey() === key) {
      this.clearActiveKey();
    }
  }

  clearLegacyNewDraft(): void {
    this.clear(LEGACY_NEW_KEY);
  }

  hasMeaningfulContent(draft: LayoutDesignerDraft): boolean {
    return (
      draft.templateName.trim().length > 0 ||
      draft.description.trim().length > 0 ||
      draft.layoutConfig.elements.length > 0 ||
      Boolean(draft.layoutConfig.referenceImage?.dataUrl) ||
      Boolean(draft.layoutConfig.referenceImage?.storagePath)
    );
  }

  /**
   * Prefer restoring the local draft whenever it exists with content.
   * Previously this only ran on F5 (`reload`) and cleared drafts on other loads,
   * which wiped unsaved work when the address bar was re-entered.
   */
  shouldRestoreDraft(): boolean {
    // Still skip restore only after a later client-side navigation within the SPA
    // has moved away from the initial entry — in practice edit/new always restore
    // on full page load (reload or cold open of the same URL).
    return !this.clientNavigationSinceLoad || this.initialLoadWasReload;
  }

  private stripReferenceDataUrl(draft: LayoutDesignerDraft): LayoutDesignerDraft | null {
    const ref = draft.layoutConfig.referenceImage;
    if (!ref?.dataUrl) {
      return null;
    }
    return {
      ...draft,
      layoutConfig: {
        ...draft.layoutConfig,
        referenceImage: {
          ...ref,
          dataUrl: '',
        },
      },
    };
  }
}
