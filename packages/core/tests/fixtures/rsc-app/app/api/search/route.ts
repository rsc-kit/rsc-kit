// Reads the query string but nothing else, so the build stores one answer and
// the host serves it only for the bare url.
export async function GET(_request: Request, { searchParams }: any) {
  const q = (await searchParams).get('q') ?? 'nothing'

  return Response.json({ q })
}
