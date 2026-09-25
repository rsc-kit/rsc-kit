import { getSeatsLeft } from '../../queries'
import { Providers } from '../providers'
import { Seats } from './seats'
import type { Metadata } from '@rsc-kit/core/metadata'

export const metadata: Metadata = { title: 'Polling' }

/**
 * Data that changes while you watch, by reading it again.
 *
 * A read that can be repeated covers most of this: the cache library polls, and
 * each poll is an ordinary GET that caches like any other - a CDN collapses
 * many tabs into one origin read per interval. A pushed stream earns its place
 * where the server has a source of change and holds connections cheaply; /live
 * is the same value, pushed, for the comparison.
 */
export default async function PollingPage() {
  const first = await getSeatsLeft()

  return (
    <main>
      <h1>Watching a value change</h1>
      <p>
        Read once on the server, then re-read every two seconds by TanStack.
        No live connection, no new primitive — just the same GET, repeated.
      </p>

      <Providers>
        <Seats initial={first} />
      </Providers>
    </main>
  )
}
