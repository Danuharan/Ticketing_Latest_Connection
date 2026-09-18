import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Prototype-style icon tile for start options and element tools. */
@Component({
  selector: 'app-tool-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="tool-icon" [class]="'tool-icon--' + kind()" aria-hidden="true">
      @switch (kind()) {
        @case ('start-ai') {
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l1.2 4.2L17.5 7 13.2 8.2 12 12.5 10.8 8.2 6.5 7l4.3-.8L12 2zm0 11.5l.9 3.1 3.2.6-2.6 1.5-.9 3.1-.9-3.1-2.6-1.5 3.2-.6.9-3.1z" />
          </svg>
        }
        @case ('start-upload') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <rect x="4" y="5" width="16" height="14" rx="2" />
            <path d="m8 14 2.5-2.5L14 15l2-2 3 3" stroke-linecap="round" stroke-linejoin="round" />
            <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
          </svg>
        }
        @case ('start-manual') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M4 18h16M7 14l3-9 3 5 4-7" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        }
        @case ('start-parking') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <path d="M9.5 16V8h3a2.5 2.5 0 0 1 0 5h-3" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        }
        @case ('custom-piece') {
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3 4 9v12h16V9l-8-6zm0 3.2L17 11v8H7v-8l5-4.8z" />
          </svg>
        }
        @case ('center-piece') {
          <svg viewBox="0 0 24 24">
            <ellipse cx="12" cy="12" rx="7" ry="5" fill="#34d399" />
          </svg>
        }
        @case ('layer-ring') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="3.5" />
          </svg>
        }
        @case ('layer-rect') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <rect x="5" y="7" width="14" height="10" rx="1" />
            <path d="M5 12h14M12 7v10" />
          </svg>
        }
        @case ('block-grid') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="5" y="5" width="14" height="14" rx="1" />
            <path d="M10 5v14M15 5v14M5 10h14M5 15h14" />
          </svg>
        }
        @case ('seat-section') {
          <svg viewBox="0 0 24 24" fill="currentColor">
            <circle cx="8" cy="9" r="1.2" />
            <circle cx="12" cy="9" r="1.2" />
            <circle cx="16" cy="9" r="1.2" />
            <circle cx="8" cy="13" r="1.2" />
            <circle cx="12" cy="13" r="1.2" />
            <circle cx="16" cy="13" r="1.2" />
            <circle cx="10" cy="17" r="1.2" />
            <circle cx="14" cy="17" r="1.2" />
          </svg>
        }
        @case ('aisle') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 4v16M14 4v16" stroke-linecap="round" />
          </svg>
        }
        @case ('label') {
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 6h10v2.5H12v9H10v-9H7V6z" />
          </svg>
        }
        @case ('stage') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M5 16h14M7 16V9c0-1.5 2.2-3 5-3s5 1.5 5 3v7" stroke-linecap="round" />
            <path d="M6 19h12" stroke-linecap="round" />
          </svg>
        }
        @case ('exit') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 7h5v10h-5M10 12h9M7 9l-3 3 3 3" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        }
        @case ('entrance') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 7H5v10h5M14 12H5M17 9l3 3-3 3" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        }
        @case ('canteen') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M8 6v8M11 6v8M8 10h3" stroke-linecap="round" />
            <path d="M15 6c1.5 0 2 1.2 2 2.5S16.5 11 15 11" stroke-linecap="round" />
            <path d="M6 18h12" stroke-linecap="round" />
          </svg>
        }
        @case ('shop') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M7 9V7a5 5 0 0 1 10 0v2" />
            <rect x="6" y="9" width="12" height="10" rx="1.5" />
            <path d="M10 13h4" stroke-linecap="round" />
          </svg>
        }
      }
    </span>
  `,
})
export class ToolIconComponent {
  readonly kind = input.required<string>();
}
