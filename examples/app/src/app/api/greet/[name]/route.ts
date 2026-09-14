/**
 * A dynamic segment, bound the same way a page's is.
 *
 * The second argument carries them, which is the shape the App Router uses —
 * so what is learned on a page transfers here.
 */
export function GET(_request: Request, { params }: { params: { name: string } }): Response {
  return Response.json({ greeting: `Hello, ${params.name}` })
}
