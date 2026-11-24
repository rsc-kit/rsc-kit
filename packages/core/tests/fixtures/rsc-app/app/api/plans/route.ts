// Reads from the backend and nothing else: the same for everyone, when the
// build can ask.
export async function GET() {
  return Response.json({ plans: await (globalThis as any).rpc('Plans.all') })
}
