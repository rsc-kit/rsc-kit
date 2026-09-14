/**
 * An api route: `src/app/api/health/route.ts` answers `/api/health`.
 *
 * The export name is the method, the argument is an ordinary `Request`, and a
 * `Response` goes back. Anything you did not export gets a 405 naming what you
 * did; HEAD is answered by GET without a body. Neither is written out here.
 *
 * For callers that are not this app's own client — a webhook, an uptime check,
 * anything that cannot import a server function. Its own client should use a
 * query or a server action, which are typed and need no url.
 */
export function GET(request: Request): Response {
  return Response.json({ ok: true, method: request.method, at: new Date().toISOString() })
}
