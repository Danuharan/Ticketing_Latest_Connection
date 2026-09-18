/** Central query keys for venue template Supabase reads. */
export const venueTemplateKeys = {
  all: ['venue-templates'] as const,
  list: () => [...venueTemplateKeys.all, 'list'] as const,
  detail: (id: string) => [...venueTemplateKeys.all, 'detail', id] as const,
};
