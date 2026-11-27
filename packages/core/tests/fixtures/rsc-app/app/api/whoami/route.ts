// Reads the request, so every caller gets a different answer and the build
// must leave it alone.
export const name = 'api.whoami'

export async function GET(request: Request) {
  return Response.json({ agent: request.headers.get('User-Agent') })
}
