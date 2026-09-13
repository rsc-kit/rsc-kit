import { getFeed } from '../../queries'
import { Providers } from '../providers'
import { Feed } from './feed'

export const metadata = { title: 'Infinite' }

/**
 * The first page resolved on the server, the rest by the browser.
 *
 * Page one comes down with the document and costs no request; "load more" is an
 * ordinary call with a different cursor. There is no REST endpoint behind it:
 * `useInfiniteQuery` calls the server function directly, and the cursor is just
 * an argument.
 *
 * Note the arrow in `queryFn`. TanStack calls a bare queryFn with its own
 * context — `{ client, queryKey, meta, signal }` — and a server function
 * serialises whatever it is handed, so passing it unwrapped would try to send
 * an AbortSignal over the wire. The arrow is where you choose what travels.
 */
export default async function InfinitePage() {
  const first = await getFeed(null)

  return (
    <main>
      <h1>Infinite loading</h1>
      <p>
        Page one was rendered into this document. Open the network panel before
        you scroll: nothing has been requested yet.
      </p>

      <Providers>
        <Feed initial={first} />
      </Providers>
    </main>
  )
}
