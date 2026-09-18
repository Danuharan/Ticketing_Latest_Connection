import { DiningTableShape } from './layout-element.model';

/** Reusable table + chair measurement preset for dining layout wizards. */
export interface TableCategoryTemplate {
  id: string;
  name: string;
  shape: DiningTableShape;
  tableWidthM: number;
  tableDepthM: number;
  tableSeats: number;
  chairWidthM: number;
  chairLengthM: number;
  tableGapM: number;
  createdAt: string;
  updatedAt: string;
}
