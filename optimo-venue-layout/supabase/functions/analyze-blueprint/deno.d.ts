/**
 * Minimal Deno ambient types so the IDE (Node TypeScript) can check
 * this Supabase Edge Function without the Deno language server.
 */
declare namespace Deno {
  namespace env {
    function get(key: string): string | undefined;
  }

  function serve(
    handler: (request: Request) => Response | Promise<Response>,
  ): void;
}
