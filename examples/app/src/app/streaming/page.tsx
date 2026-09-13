import { Suspense } from 'react'
import { connection } from '@rsc-kit/core/request'
import { getRegion } from '../../queries'
import { Region, Clock } from './region'

export const metadata = { title: 'Streaming' }

/**
 * One response, three arrival times.
 *
 * The queries are STARTED here and not awaited. Each promise goes down as a
 * prop, React serialises it as a pending row in the payload, and the client
 * component resolves it with `use()`. So the shell is written immediately, each
 * boundary fills when its own query answers, and the browser never asks for
 * anything — open the network panel and there is no /_rsc/query request at all.
 *
 * `await connection()` forces a per-request render. Without it this page has
 * nothing request-dependent in it and the build would freeze it, which would
 * make the whole demonstration a lie: the timings would be the build machine's.
 */
export default async function StreamingPage() {
  await connection()

  // Both started before either is awaited — the same discipline as Promise.all.
  const north = getRegion('north')
  const south = getRegion('south')

  return (
    <main>
      <h1>Streamed in one response</h1>
      <Clock />

      <p>
        Nothing below was fetched by the browser. The shell arrived first, then
        each list when its own query finished — all inside the document's own
        response.
      </p>

      <h2>North — 600ms</h2>
      <Suspense fallback={<p className="pending">waiting on the server…</p>}>
        <Region listings={north} />
      </Suspense>

      <h2>South — 1800ms</h2>
      <Suspense fallback={<p className="pending">waiting on the server…</p>}>
        <Region listings={south} />
      </Suspense>

      <p>
        The fast one did not wait for the slow one, and neither held up the
        heading above it.
      </p>
    </main>
  )
}
