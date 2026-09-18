import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTanStackQuery } from '@tanstack/angular-query-experimental';

import { createAppQueryClient } from './core/query/query-client.config';
import { AuthService } from './core/services/auth.service';
import { ThemeService } from './core/services/theme.service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideTanStackQuery(createAppQueryClient()),
    provideAppInitializer(() => {
      inject(ThemeService).init();
      return inject(AuthService).init();
    }),
  ],
};
