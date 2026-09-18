/**
 * The answer, in development, to a render that failed because Vite
 * re-optimised a dependency underneath it.
 *
 * When the server environments' pre-bundles change - a new dependency was
 * discovered, the lockfile changed - Vite throws ERR_OUTDATED_OPTIMIZED_DEP
 * from the import that hit the old one, with a message ending "a page reload
 * is going to ask for it". For the browser's own requests Vite answers 504
 * and its client reloads; for a render running in the server module runner
 * nothing does, and the visitor gets an error page for a condition that is
 * over by the time they read it.
 *
 * So the page is asked to reload itself. A document gets a refresh; a
 * payload request gets a 503 that is not a payload, which the router
 * answers by loading the document instead - and the document reloads.
 */
export const OUTDATED_OPTIMIZED_DEP = "ERR_OUTDATED_OPTIMIZED_DEP";

export function isOutdatedOptimizedDep(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === OUTDATED_OPTIMIZED_DEP;
}

export function outdatedDepResponse(request: Request): Response {
  const headers = {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
  };

  if (request.headers.get("X-RSC")) {
    return new Response(
      "Dependencies were re-optimized; load the page again.",
      { status: 503, headers },
    );
  }

  return new Response(
    '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0">' +
      "<title>Reloading</title><p>Vite re-optimized dependencies; reloading…</p>",
    { status: 503, headers },
  );
}
