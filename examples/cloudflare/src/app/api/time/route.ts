import { connection } from '@rsc-kit/core/request'

// An api route: a Request in, a Response out, answered by the Worker.
// connection() says it answers per request; without it the build would store
// the answer it got at build time, and every visitor would see that moment.
export async function GET(): Promise<Response> {
  await connection()

  return Response.json({ now: new Date().toISOString(), runtime: 'workerd' })
}
