import { events } from '../../../../../../src/events'

// Three ticks, then a named one, then done. The generator notices the
// browser leaving through `signal`, which the disconnect test relies on.
export const GET = events(async function* ({ searchParams, signal }) {
  const count = Number((await searchParams).get('count') ?? 3)

  for (let i = 1; i <= count; i++) {
    if (signal.aborted) return

    yield { tick: i }
    await new Promise((r) => setTimeout(r, 5))
  }

  yield { event: 'done', id: 'last', data: { total: count } }
})
