// Reads nothing, sets a cookie. An answer for one visitor: never stored.
export async function GET() {
  return Response.json({ id: 'v-1' }, { headers: { 'Set-Cookie': 'visitor=v-1; Path=/' } })
}
