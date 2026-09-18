import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-dashboard-page',
  template: `
    <section>
      <h2 class="m-0 mb-2 text-xl font-semibold text-slate-900 dark:text-slate-100 sm:text-2xl">Dashboard</h2>
      <p class="m-0 max-w-2xl text-[0.9375rem] leading-relaxed text-slate-500 dark:text-slate-400">
        Welcome to Optimo Venue Layout. Use Venue Layouts to create and manage venue designs.
      </p>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {}