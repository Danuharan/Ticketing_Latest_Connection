import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./layout/admin-shell/admin-shell.component').then((m) => m.AdminShellComponent),
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'venue-layouts',
        loadComponent: () =>
          import('./features/venue-layouts/venue-layouts.page').then((m) => m.VenueLayoutsPage),
      },
      {
        path: 'venue-layouts/new',
        loadComponent: () =>
          import('./features/layout-designer/layout-designer.page').then((m) => m.LayoutDesignerPage),
      },
      {
        path: 'venue-layouts/:id/edit',
        loadComponent: () =>
          import('./features/layout-designer/layout-designer.page').then((m) => m.LayoutDesignerPage),
      },
      {
        path: 'venue-layouts/:venueId/parking/new',
        loadComponent: () =>
          import('./features/parking-layouts/parking-layout-designer.page').then(
            (m) => m.ParkingLayoutDesignerPage,
          ),
      },
      {
        path: 'venue-layouts/:venueId/parking/:parkingId/edit',
        loadComponent: () =>
          import('./features/parking-layouts/parking-layout-designer.page').then(
            (m) => m.ParkingLayoutDesignerPage,
          ),
      },
    ],
  },
];
