// The route eventsTypes.check.ts opens, registered as /api/orders/[id]/events.
import { events, named } from '../../src/events'

export type Order = { id: string; status: 'paid' | 'shipped' }

export const GET = events(async function* ({ params }) {
  const { id } = await params

  yield { id, status: 'paid' } as Order
  yield named('done', { total: 3 })
})
