/**
 * Inside `src/app/guarded/`, which has a middleware.ts.
 *
 * Nothing here checks anything. The guard on the directory covers it, the same
 * way it covers the page beside it.
 */
export function GET(): Response {
  return Response.json({ secret: 'only for the allowed' })
}
