/**
 * Two methods, two exports. There is no dispatch to write.
 *
 * Reading a body is the web api — `request.json()`, `.formData()`, `.text()`.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as { name?: string }

  if (!body.name) return Response.json({ error: 'name is required' }, { status: 422 })

  return Response.json({ greeting: `Hello, ${body.name}` }, { status: 201 })
}

export function GET(): Response {
  return Response.json({ usage: 'POST { "name": "…" }' })
}
