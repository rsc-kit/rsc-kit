/**
 * useEvents types a message from the route it opens, checked by the typechecker.
 *
 * What it pins: the hook's `latest` is what the route's generator yields,
 * named events apart from the unnamed stream; a url no route answers does
 * not compile; and a stream with nothing to read its type from - another
 * site's, or a GET that is not events() - is unknown until it is named.
 *
 * `bun run typecheck` runs it in routeTypes.tsconfig's program, where
 * eventsRoute.fixture.ts is registered as /api/orders/[id]/events.
 */
import { useEvents } from '../../src/js/useEvents'
import type { Order } from './eventsRoute.fixture'

export function Watch({ id }: { id: string }) {
  // Inferred from the route: no type argument.
  const { latest, all } = useEvents(`/api/orders/${id}/events`)
  const status: 'paid' | 'shipped' | undefined = latest?.status
  const first: Order | undefined = all[0]

  // @ts-expect-error a field the route never sends
  latest?.total

  // A named event is its own message.
  const done = useEvents(`/api/orders/${id}/events`, { event: 'done' })
  const total: number | undefined = done.latest?.total

  // @ts-expect-error the unnamed message's field, not this one's
  done.latest?.status

  useEvents(`/api/orders/${id}/events`, {
    onMessage: (m) => {
      const s: 'paid' | 'shipped' = m.status
      void s
    },
  })

  // @ts-expect-error no route answers this url
  useEvents('/api/order/42/events')

  // Nothing to read a type from: another site's stream, or a GET that is not events().
  const elsewhere = useEvents('https://example.com/stream')
  const unknownMessage: unknown = elsewhere.latest
  // @ts-expect-error unknown until named
  elsewhere.latest?.anything

  const health = useEvents('/api/health')
  // @ts-expect-error unknown: /api/health is not events()
  health.latest?.anything

  // Named by hand, for those.
  const named = useEvents<{ ok: boolean }>('https://example.com/stream')
  const ok: boolean | undefined = named.latest?.ok

  return { status, first, total, unknownMessage, ok }
}
