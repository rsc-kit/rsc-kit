import { getSeatsLeft } from '../../queries'
import { Providers } from '../providers'
import { Seats } from './seats'
import type { Metadata } from '@rsc-kit/core/metadata'

export const metadata: Metadata = { title: 'Polling' }

/**
 * Data that changes while you watch, without a streaming primitive.
 *
 * A read that can be repeated already covers this: the cache library polls, and
 * each poll is an ordinary GET that batches and caches like any other. A live
 * connection only earns its place where polling is genuinely wasteful — many
 * viewers, or changes far more often than a poll interval can follow.
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
