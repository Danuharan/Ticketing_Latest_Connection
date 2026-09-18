/**
 * Minimal Deno ambient types so the IDE can check this Edge Function.
 */
declare namespace Deno {
  namespace env {
    function get(key: string): string | undefined;
  }
  function serve(
    handler: (request: Request) => Response | Promise<Response>,
  ): void;
}
