import { Suspense } from 'react'
import { getSeatsLeft } from '../../queries'
import { Providers } from '../providers'
import { Seats } from './seats'
import type { Metadata } from '@rsc-kit/core/metadata'

export const metadata: Metadata = { title: 'Polling' }

// The first reading, on the server; the client polls from there.
async function InitialSeats() {
  const first = await getSeatsLeft()

  return <Seats initial={first} />
}

/**
 * Data that changes while you watch, by reading it again.
 *
 * A read that can be repeated covers most of this: the cache library polls, and
 * each poll is an ordinary GET that caches like any other - a CDN collapses
 * many tabs into one origin read per interval. A pushed stream earns its place
 * where the server has a source of change and holds connections cheaply; /live
 * is the same value, pushed, for the comparison.
 */
export default function PollingPage() {
  return (
    <main>
      <h1>Watching a value change</h1>
      <p>
        Read once on the server, then re-read every two seconds by TanStack.
        No live connection, no new primitive — just the same GET, repeated.
      </p>

      <Providers>
        <Suspense fallback={<p aria-busy="true"><strong>&nbsp;</strong> seats left</p>}>
          <InitialSeats />
        </Suspense>
      </Providers>
    </main>
  )
}
