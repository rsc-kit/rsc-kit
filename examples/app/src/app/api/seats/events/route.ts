import { events, named } from '@rsc-kit/core/events'

// The live counterpart of /polling: the same seat count, pushed.
//
// An ordinary route.ts, so it sits beside the pages and runs the middleware
// above it. Each yield is one message; the generator ends when the browser
// leaves, which `signal` tells it. Compare /polling, which reads a query
// again every two seconds instead: cacheable, no held connection, and the
// right default until something can push.
let left = 40

export const GET = events<Record<string, string>, { left: number; at: string }>(async function* ({ signal }) {
  while (!signal.aborted && left > 0) {
    await new Promise((r) => setTimeout(r, 1_500))
    left = Math.max(0, left - 1)

    yield { left, at: new Date().toISOString().slice(11, 23) }
  }

  yield named('sold-out', { left: 0 })
})
