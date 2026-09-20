// A webhook's verification handshake, written the way a Next port writes it:
// the query read off request.url rather than the awaited searchParams. The
// probe cannot see that read the way it sees searchParams, so reading the url
// at all must leave the route alone - stored, this 403 would be the answer to
// every real handshake.
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams

  if (query.get('hub.mode') !== 'subscribe') return new Response('Forbidden', { status: 403 })

  return new Response(query.get('hub.challenge') ?? '', { status: 200 })
}
