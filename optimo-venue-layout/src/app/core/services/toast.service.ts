import { Injectable, signal } from '@angular/core';

export type ToastTone = 'info' | 'success' | 'error';

/** App-wide toast messages (bottom-right). */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly message = signal<string | null>(null);
  readonly tone = signal<ToastTone>('info');

  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  show(text: string, tone: ToastTone = 'info', durationMs = 3000): void {
    this.message.set(text);
    this.tone.set(tone);

    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
    }

    this.hideTimer = setTimeout(() => {
      this.message.set(null);
      this.hideTimer = null;
    }, durationMs);
  }

  success(text: string): void {
    this.show(text, 'success');
  }

  error(text: string): void {
    this.show(text, 'error', 4000);
  }
}
