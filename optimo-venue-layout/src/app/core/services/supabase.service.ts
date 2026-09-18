import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient;

  constructor() {
    const { url, publishableKey } = environment.supabase;

    if (!url || !publishableKey || publishableKey.includes('PASTE_')) {
      console.warn(
        '[Supabase] Missing publishable key. Copy environment.local.example.ts → environment.local.ts and paste your key.',
      );
    }

    this.client = createClient(url, publishableKey);
  }

  /** Refresh the current user session. Returns false if there is no session or refresh fails. */
  async refreshSession(): Promise<boolean> {
    try {
      const { error } = await this.client.auth.refreshSession();
      return error == null;
    } catch {
      return false;
    }
  }
}
