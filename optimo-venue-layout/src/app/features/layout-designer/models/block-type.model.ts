/** Venue block usage type — drives which customization tools are available. */
export type BlockTypeId =
  | 'seating'
  | 'general-admission'
  | 'private-suite'
  | 'dining-table'
  | 'merchandise'
  | 'third-party-shop'
  | 'parking';

export interface BlockTypeOption {
  id: BlockTypeId;
  label: string;
}

export const BLOCK_TYPE_OPTIONS: BlockTypeOption[] = [
  { id: 'seating', label: 'Seating' },
  { id: 'general-admission', label: 'General Admission' },
  { id: 'private-suite', label: 'Private Suite' },
  { id: 'dining-table', label: 'Dining & Table' },
  { id: 'merchandise', label: 'Merchandise' },
  { id: 'third-party-shop', label: '3rd party shop' },
];

export function blockTypeLabel(id: BlockTypeId | undefined | null): string {
  if (!id) {
    return 'Select block type';
  }
  return BLOCK_TYPE_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

/** Block types that currently have a customization workspace. */
export function blockTypeHasTools(id: BlockTypeId | undefined | null): boolean {
  return id === 'seating' || id === 'dining-table' || id === 'general-admission';
}

/** Block types that use the full VIEW POINT → configure → edit → save workspace flow. */
export function blockTypeHasCustomizationFlow(id: BlockTypeId | undefined | null): boolean {
  return id === 'seating' || id === 'dining-table';
}

/** GA blocks have their own side-label + max-participants flow (no viewpoint or seat tools). */
export function blockTypeHasGaFlow(id: BlockTypeId | undefined | null): boolean {
  return id === 'general-admission';
}

/** Block types that label each side with the shared side-card configure UI. */
export function blockTypeUsesSideLabelConfigureUi(id: BlockTypeId | undefined | null): boolean {
  return blockTypeHasCustomizationFlow(id) || blockTypeHasGaFlow(id);
}
