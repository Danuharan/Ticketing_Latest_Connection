import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { ThemeService } from '../../core/services/theme.service';

interface NavItem {
  label: string;
  route?: string;
  comingSoon?: boolean;
}

@Component({
  selector: 'app-admin-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminShellComponent {
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);
  protected readonly auth = inject(AuthService);
  protected readonly toast = inject(ToastService);

  /** Desktop: narrow icon-only sidebar when true. */
  protected readonly collapsed = signal(false);

  /** Mobile: slide-out navigation drawer when true. */
  protected readonly mobileNavOpen = signal(false);

  /** True on the full-screen layout designer (reduced chrome padding). */
  protected readonly isDesignerView = signal(this.isDesignerRoute(this.router.url));

  /** Current page title for the top bar (derived from the active route). */
  protected readonly pageTitle = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => {
        this.applyRouteShellState(event.urlAfterRedirects);
        return this.resolvePageTitle(event.urlAfterRedirects);
      }),
      startWith(this.resolvePageTitle(this.router.url)),
    ),
    { initialValue: 'Dashboard' },
  );

  protected readonly navItems: NavItem[] = [
    { label: 'Dashboard', route: '/dashboard' },
    { label: 'Events', comingSoon: true },
    { label: 'Venue Layouts', route: '/venue-layouts' },
    { label: 'Sponsors', comingSoon: true },
    { label: 'Members', comingSoon: true },
    { label: 'Memberships', comingSoon: true },
    { label: 'Agents', comingSoon: true },
    { label: 'Reports', comingSoon: true },
  ];

  constructor() {
    this.applyRouteShellState(this.router.url);
  }

  protected toggleSidebar(): void {
    this.collapsed.update((value) => !value);
  }

  protected toggleMobileNav(): void {
    this.mobileNavOpen.update((value) => !value);
  }

  protected toggleTheme(): void {
    this.theme.toggle();
  }

  protected async logout(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigate(['/login']);
  }

  /** Closes the mobile drawer after navigation or backdrop tap. */
  protected closeMobileNav(): void {
    this.mobileNavOpen.set(false);
  }

  /** Shows a temporary toast for menu items that are not implemented yet. */
  protected showComingSoon(label: string): void {
    this.closeMobileNav();
    this.toast.show(`${label} — Coming soon`);
  }

  private resolvePageTitle(url: string): string {
    if (url.includes('/venue-layouts/new')) {
      return 'New Venue Layout';
    }
    if (url.includes('/venue-layouts/') && url.includes('/edit')) {
      return 'Edit Venue Layout';
    }
    if (url.startsWith('/venue-layouts')) {
      return 'Venue Layouts';
    }
    if (url.startsWith('/dashboard')) {
      return 'Dashboard';
    }
    return 'Admin';
  }

  /** Collapses sidebar on designer routes and toggles full-bleed layout. */
  private applyRouteShellState(url: string): void {
    const designer = this.isDesignerRoute(url);
    this.isDesignerView.set(designer);
    if (designer) {
      this.collapsed.set(true);
      this.mobileNavOpen.set(false);
    }
  }

  private isDesignerRoute(url: string): boolean {
    return url.includes('/venue-layouts/new') || /\/venue-layouts\/[^/]+\/edit/.test(url);
  }
}
