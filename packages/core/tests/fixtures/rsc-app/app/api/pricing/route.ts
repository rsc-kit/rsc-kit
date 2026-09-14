// Reads nothing from the request, so the build can answer it once.
export async function GET() {
  return Response.json({ tiers: ['free', 'pro'] }, { headers: { 'X-Fixture': 'pricing' } })
}
