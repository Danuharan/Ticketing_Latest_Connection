import { QueryClient } from '@tanstack/angular-query-experimental';

/** Shared TanStack Query client — caches Supabase reads (Redis-like TTL on the client). */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
    },
  });
}
