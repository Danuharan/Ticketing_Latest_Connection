/** Central query keys for parking layout template Supabase reads. */
export const parkingTemplateKeys = {
  all: ['parking-templates'] as const,
  listMine: () => [...parkingTemplateKeys.all, 'list-mine'] as const,
  listForVenue: (venueId: string) => [...parkingTemplateKeys.all, 'list-for-venue', venueId] as const,
  linksForVenues: (venueIds: string[]) =>
    [...parkingTemplateKeys.all, 'links-for-venues', ...venueIds.sort()] as const,
  detail: (id: string) => [...parkingTemplateKeys.all, 'detail', id] as const,
};
