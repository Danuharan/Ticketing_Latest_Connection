/**
 * Dining suggestion engine routing.
 * Normal path = Supabase generate-dining-layouts.
 * Legacy 12-recipe generator is never used by the Dining wizard.
 */
export const DINING_LAYOUT_ENGINE = {
  useEdgeFunction: true,
  useLegacyFallback: false,
  suggestionCount: 6,
  maxSessionFingerprints: 40,
} as const;
