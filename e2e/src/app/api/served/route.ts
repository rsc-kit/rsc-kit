// What instrumentation.ts's onRequest() was told, for one trace.
export async function GET(request: Request): Promise<Response> {
  const trace = new URL(request.url).searchParams.get('trace')
  const log = (globalThis as { __served?: Array<{ headers: Record<string, string> }> }).__served ?? []

  return Response.json(log.filter((served) => served.headers['x-trace'] === trace))
}
