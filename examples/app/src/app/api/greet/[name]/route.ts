/**
 * A dynamic segment, bound the same way a page's is.
 *
 * Awaited, not spread — the same shape a page's props have. This read
 * `params.name` synchronously for three releases after params became a
 * promise, answered "Hello, undefined" to everyone, and nothing noticed
 * because nothing tested it. See tests/api.test.ts.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const { name } = await params

  return Response.json({ greeting: `Hello, ${name}` })
}
