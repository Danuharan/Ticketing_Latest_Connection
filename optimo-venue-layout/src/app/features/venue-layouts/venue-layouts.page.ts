import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { ParkingLayoutTemplateLink } from '../../core/models/parking-layout-template.model';
import { VenueLayoutTemplateSummary } from '../../core/models/venue-layout-template.model';
import { ToastService } from '../../core/services/toast.service';
import { TemplateThumbnailComponent } from './components/template-thumbnail/template-thumbnail.component';
import { ParkingTemplateService } from './services/parking-template.service';
import { venueTemplateKeys } from './services/venue-template.keys';
import { VenueTemplateService } from './services/venue-template.service';

type DeleteUiState = 'idle' | 'confirm' | 'deleting';

/** First API page size when opening Venue Layouts. */
const INITIAL_TEMPLATE_PAGE_SIZE = 2;
/** How many more templates each "See more" click fetches. */
const TEMPLATE_PAGE_SIZE = 3;

@Component({
  selector: 'app-venue-layouts-page',
  imports: [RouterLink, TemplateThumbnailComponent],
  templateUrl: './venue-layouts.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VenueLayoutsPage {
  private readonly templates = inject(VenueTemplateService);
  private readonly parkingTemplates = inject(ParkingTemplateService);
  private readonly toast = inject(ToastService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  private readonly firstPageQuery = injectQuery(() => ({
    queryKey: [...venueTemplateKeys.list(), 'page', INITIAL_TEMPLATE_PAGE_SIZE] as const,
    queryFn: () => this.templates.listMyTemplatesPage(0, INITIAL_TEMPLATE_PAGE_SIZE),
  }));

  private readonly deleteMutation = injectMutation(() => ({
    mutationFn: (id: string) => this.templates.deleteTemplate(id),
    onSuccess: () => {
      this.resetPagination();
      this.queryClient.invalidateQueries({ queryKey: venueTemplateKeys.list() });
    },
  }));

  /** Templates loaded after the first page (via "See more"). */
  private readonly extraItems = signal<VenueLayoutTemplateSummary[]>([]);
  private readonly parkingByVenue = signal<Map<string, ParkingLayoutTemplateLink[]>>(new Map());
  private readonly parkingLoadedVenueIds = new Set<string>();
  protected readonly loadingMore = signal(false);

  protected readonly items = computed(() => [
    ...(this.firstPageQuery.data()?.items ?? []),
    ...this.extraItems(),
  ]);
  protected readonly totalCount = computed(() => this.firstPageQuery.data()?.total ?? 0);
  protected readonly remainingCount = computed(() =>
    Math.max(0, this.totalCount() - this.items().length),
  );
  protected readonly hasMore = computed(() => this.remainingCount() > 0);
  protected readonly loading = computed(
    () => this.firstPageQuery.isPending() && this.items().length === 0,
  );
  /** Center the row when only two templates exist and nothing left to load. */
  protected readonly gridPairLayout = computed(
    () => this.items().length === 2 && !this.hasMore() && !this.loadingMore(),
  );
  /** Skeleton slots shown while the next batch is loading. */
  protected readonly loadingSlots = computed(() => {
    if (!this.loadingMore()) {
      return [];
    }
    const count = Math.min(TEMPLATE_PAGE_SIZE, this.remainingCount());
    return Array.from({ length: count }, (_, index) => index);
  });
  protected readonly error = computed(() => {
    if (!this.firstPageQuery.isError()) {
      return null;
    }
    const err = this.firstPageQuery.error();
    return err instanceof Error ? err.message : 'Failed to load templates.';
  });

  protected readonly deleteUi = signal<Record<string, DeleteUiState>>({});
  protected readonly navigatingTemplateId = signal<string | null>(null);

  constructor() {
    effect(() => {
      const venueIds = this.items().map((item) => item.id);
      if (venueIds.length === 0) {
        return;
      }
      untracked(() => void this.ensureParkingForVenues(venueIds));
    });
  }

  protected parkingLayoutsFor(venueId: string): ParkingLayoutTemplateLink[] {
    return this.parkingByVenue().get(venueId) ?? [];
  }

  protected onDeleteClick(id: string, name: string): void {
    const state = this.deleteUi()[id] ?? 'idle';

    if (state === 'idle') {
      this.deleteUi.update((map) => ({ ...map, [id]: 'confirm' }));
      return;
    }

    if (state === 'confirm') {
      void this.performDelete(id, name);
    }
  }

  protected deleteLabel(id: string): string {
    switch (this.deleteUi()[id]) {
      case 'confirm':
        return 'Confirm delete?';
      case 'deleting':
        return 'Deleting…';
      default:
        return 'Delete';
    }
  }

  protected isDeleteBusy(id: string): boolean {
    return this.deleteUi()[id] === 'deleting';
  }

  protected isDeleteConfirm(id: string): boolean {
    return this.deleteUi()[id] === 'confirm';
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleString('en-LK', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  protected openNewBlankLayout(): void {
    void this.router.navigate(['/venue-layouts/new'], {
      queryParams: { t: Date.now().toString() },
    });
  }

  /** Warm the edit page and template JSON while the user hovers Edit. */
  protected prefetchEditExperience(id: string): void {
    this.prefetchTemplate(id);
    void import('../layout-designer/layout-designer.page');
  }

  protected openEdit(id: string): void {
    this.navigatingTemplateId.set(id);
    this.prefetchEditExperience(id);
    void this.router.navigate(['/venue-layouts', id, 'edit']).finally(() => {
      this.navigatingTemplateId.set(null);
    });
  }

  /** Warm the edit-page cache while the user hovers an Edit link. */
  protected prefetchTemplate(id: string): void {
    void this.queryClient.prefetchQuery({
      queryKey: venueTemplateKeys.detail(id),
      queryFn: () => this.templates.getTemplateById(id),
      staleTime: 60_000,
    });
  }

  protected showMoreTemplates(): void {
    if (this.loadingMore() || !this.hasMore()) {
      return;
    }

    void this.loadMoreTemplates();
  }

  private async loadMoreTemplates(): Promise<void> {
    this.loadingMore.set(true);

    try {
      const page = await this.templates.listMyTemplatesPage(this.items().length, TEMPLATE_PAGE_SIZE);
      if (page.items.length === 0) {
        return;
      }
      this.extraItems.update((current) => [...current, ...page.items]);
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : 'Failed to load more templates.');
    } finally {
      this.loadingMore.set(false);
    }
  }

  private async ensureParkingForVenues(venueIds: string[]): Promise<void> {
    const missing = venueIds.filter((id) => !this.parkingLoadedVenueIds.has(id));
    if (missing.length === 0) {
      return;
    }

    for (const id of missing) {
      this.parkingLoadedVenueIds.add(id);
    }

    try {
      const links = await this.parkingTemplates.listLinksForVenues(missing);
      this.parkingByVenue.update((current) => {
        const next = new Map(current);
        for (const link of links) {
          const list = next.get(link.venue_layout_template_id);
          if (list) {
            list.push(link);
          } else {
            next.set(link.venue_layout_template_id, [link]);
          }
        }
        for (const venueId of missing) {
          if (!next.has(venueId)) {
            next.set(venueId, []);
          }
        }
        return next;
      });
    } catch {
      for (const id of missing) {
        this.parkingLoadedVenueIds.delete(id);
      }
    }
  }

  private resetPagination(): void {
    this.extraItems.set([]);
    this.parkingByVenue.set(new Map());
    this.parkingLoadedVenueIds.clear();
    this.loadingMore.set(false);
  }

  private async performDelete(id: string, name: string): Promise<void> {
    this.deleteUi.update((map) => ({ ...map, [id]: 'deleting' }));

    try {
      await this.deleteMutation.mutateAsync(id);
      this.extraItems.update((current) => current.filter((item) => item.id !== id));
      this.parkingByVenue.update((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      this.parkingLoadedVenueIds.delete(id);
      this.clearDeleteState(id);
      this.toast.success(`"${name}" deleted successfully.`);
    } catch (err) {
      this.clearDeleteState(id);
      this.toast.error(err instanceof Error ? err.message : 'Failed to delete template.');
    }
  }

  private clearDeleteState(id: string): void {
    this.deleteUi.update((map) => {
      const next = { ...map };
      delete next[id];
      return next;
    });
  }
}
