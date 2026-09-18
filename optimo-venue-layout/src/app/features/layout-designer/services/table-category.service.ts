import { Injectable, signal } from '@angular/core';

import { TableCategoryTemplate } from '../models/table-category-template.model';
import { DiningTableShape } from '../models/layout-element.model';

const STORAGE_KEY = 'ovl-table-categories';

let categoryCounter = 0;

function nextCategoryId(): string {
  categoryCounter += 1;
  return `tblcat-${Date.now().toString(36)}-${categoryCounter.toString(36)}`;
}

export interface SaveTableCategoryInput {
  name: string;
  shape: DiningTableShape;
  tableWidthM: number;
  tableDepthM: number;
  tableSeats: number;
  chairWidthM: number;
  chairLengthM: number;
  tableGapM: number;
  existingId?: string | null;
}

@Injectable({ providedIn: 'root' })
export class TableCategoryService {
  private readonly categoriesState = signal<TableCategoryTemplate[]>(this.loadFromStorage());

  readonly categories = this.categoriesState.asReadonly();

  list(): TableCategoryTemplate[] {
    return [...this.categories()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getById(id: string): TableCategoryTemplate | null {
    return this.categories().find((item) => item.id === id) ?? null;
  }

  save(input: SaveTableCategoryInput): TableCategoryTemplate {
    const trimmed = input.name.trim();
    if (!trimmed) {
      throw new Error('Table category name is required.');
    }

    const now = new Date().toISOString();
    const payload = {
      name: trimmed,
      shape: input.shape,
      tableWidthM: Math.max(0.1, input.tableWidthM),
      tableDepthM: Math.max(0.1, input.tableDepthM),
      tableSeats: Math.max(1, Math.round(input.tableSeats)),
      chairWidthM: Math.max(0.1, input.chairWidthM),
      chairLengthM: Math.max(0.1, input.chairLengthM),
      tableGapM: Math.max(0, input.tableGapM),
    };

    const existingId = input.existingId?.trim() || null;
    const existing = existingId ? this.getById(existingId) : null;
    if (existing) {
      const updated: TableCategoryTemplate = { ...existing, ...payload, updatedAt: now };
      this.categoriesState.update((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      );
      this.persist();
      return updated;
    }

    const created: TableCategoryTemplate = {
      id: nextCategoryId(),
      ...payload,
      createdAt: now,
      updatedAt: now,
    };
    this.categoriesState.update((items) => [...items, created]);
    this.persist();
    return created;
  }

  delete(id: string): void {
    this.categoriesState.update((items) => items.filter((item) => item.id !== id));
    this.persist();
  }

  private loadFromStorage(): TableCategoryTemplate[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as TableCategoryTemplate[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.categories()));
    } catch {
      // Quota exceeded — keep in-memory list for this session.
    }
  }
}
