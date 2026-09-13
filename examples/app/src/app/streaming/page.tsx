import { Suspense } from 'react'
import { connection } from '@rsc-kit/core/request'
import { getRegion } from '../../queries'
import { Clock, Region } from './region'

export const metadata = { title: 'Streaming' }

/**
 * One response, three arrival times.
 *
 * Each query is STARTED and not awaited. Its promise goes down as a prop, React
 * serialises it as a pending row in the payload, and the client component
 * resolves it with `use()`. So the shell is written immediately, each boundary
 * fills when its own read answers, and the browser never asks for anything —
 * open the network panel and there is no data request at all.
 */
export default function StreamingPage() {
  return (
    <main>
      <h1>Streamed in one response</h1>
      <Clock />

      <p>
        Nothing below was fetched by the browser. The shell arrived first, then
        each list when its own query finished — all inside the document&apos;s
        own response.
      </p>

      <h2>North — 600ms</h2>
      <Suspense fallback={<p className="pending">waiting on the server…</p>}>
        <LiveRegion region="north" />
      </Suspense>

      <h2>South — 1800ms</h2>
      <Suspense fallback={<p className="pending">waiting on the server…</p>}>
        <LiveRegion region="south" />
      </Suspense>

      <p>
        The fast one did not wait for the slow one, and neither held up the
        heading above it.
      </p>
    </main>
  )
}

/**
 * `connection()` here rather than at the top of the page, and the difference is
 * the whole shell.
 *
 * It never resolves at build time, so whatever encloses it cannot be frozen.
 * At the top of the page that is the page — every heading above included — and
 * the shell this route ships is the fallback the whole app shares, which the
 * build says so about. Down here only the region is unfreezable: the headings
 * and the copy are prerendered, and each boundary is a hole the request fills.
 *
 * Without it the build would freeze these lists outright, and the timings you
 * would see in a browser would be the build machine's rather than a render's —
 * which would make the whole demonstration a lie.
 */
async function LiveRegion({ region }: { region: string }) {
  await connection()

  return <Region listings={getRegion(region)} />
}
