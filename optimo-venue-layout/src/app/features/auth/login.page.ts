import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login-page',
  imports: [FormsModule],
  templateUrl: './login.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.redirectIfLoggedIn();
  }

  protected async submit(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);

    const message = await this.auth.signIn(this.email().trim(), this.password());
    this.loading.set(false);

    if (message) {
      this.error.set(message);
      return;
    }

    await this.router.navigate(['/dashboard']);
  }

  private async redirectIfLoggedIn(): Promise<void> {
    if (await this.auth.hasSession()) {
      await this.router.navigate(['/dashboard']);
    }
  }
}
