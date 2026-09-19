import type { Metadata } from '@rsc-kit/core/metadata'
import { LiveSeats } from './seats'

export const metadata: Metadata = { title: 'Live' }

/**
 * Data that changes while you watch, pushed.
 *
 * /polling reads the same value again every two seconds through a query -
 * cacheable, no connection held, the right default until something can push.
 * This page holds one connection per tab and hears each change the moment it
 * happens: better per update, and only worth it when the server has a source
 * of change to yield from. See api/seats/events/route.ts.
 */
export default function LivePage() {
  return (
    <main>
      <h1>Watching a value change, pushed</h1>
      <p>
        Rendered once on the server, then every change arrives over a
        server-sent event stream from <code>/api/seats/events</code>. No
        library — the hook is the state.
      </p>

      <LiveSeats initial={{ left: 40, at: 'load' }} />
    </main>
  )
}
