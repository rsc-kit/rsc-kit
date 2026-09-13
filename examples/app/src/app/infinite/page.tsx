import { getFeed } from '../../queries'
import { Providers } from '../providers'
import { Feed } from './feed'

export const metadata = { title: 'Infinite' }

/**
 * The first page resolved on the server, the rest by the browser.
 *
 * This is the shape the whole primitive was scoped against: page one comes down
 * with the document and costs no request, and "load more" is an ordinary read
 * with a different cursor. There is no REST endpoint behind it and no key to
 * serialise — `useInfiniteQuery` calls `readQuery`, and the cursor is just an
 * argument.
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
