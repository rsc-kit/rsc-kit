// Reads nothing, answers with the time. Stored - and warned about.
export async function GET() {
  return Response.json({ at: Date.now() })
}
