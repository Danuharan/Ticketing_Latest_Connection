import { Injectable, signal } from '@angular/core';

import type { SessionUser } from '../models/session-user.model';

@Injectable({ providedIn: 'root' })
export class SessionUserService {
  /**
   * Mock session user until Optimo auth API is connected.
   * Call setUser() with the API response when login is implemented.
   */
  readonly user = signal<SessionUser>({
    id: 'mock-1',
    displayName: 'Kalai',
    initials: 'K',
    email: 'kalai@optimo.dev',
  });

  /** Updates the header user from a real auth/session API response. */
  setUser(user: SessionUser): void {
    this.user.set(user);
  }
}
