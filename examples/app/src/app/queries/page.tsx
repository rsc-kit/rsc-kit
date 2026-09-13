import { Suspense } from 'react'
import { getListings } from '../../queries'
import { Streamed, BrowserRead } from './listings'

export const metadata = { title: 'Queries' }

/**
 * Two ways to read, and the first one needs no cache at all.
 *
 * `getListings('stay')` is NOT awaited here. The promise itself goes down as a
 * prop; React serialises it as a pending row in the payload, and the client
 * component resolves it with `use()`. The read runs on the server, in process,
 * and streams — so the browser makes no request and nothing had to be seeded.
 *
 * Reach for the second shape when the BROWSER decides what to read: a filter, a
 * page of results, a refresh. That is what `readQuery` is for, and what a cache
 * library sits on top of.
 */
export default function QueriesPage() {
  const stays = getListings('stay')

  return (
    <main>
      <h1>Reading from the server</h1>

      <h2>Streamed with the page</h2>
      <p>The promise went down as a prop. No request, no cache, no seeding.</p>
      <Suspense fallback={<p>Loading…</p>}>
        <Streamed listings={stays} />
      </Suspense>

      <h2>Asked for by the browser</h2>
      <p>
        Started by a click, because <code>readQuery</code> during render only
        works in the browser. Two reads leave together as one GET, and the
        repeat is handed the answer the first is already waiting for.
      </p>
      <Suspense fallback={<p>Loading…</p>}>
        <BrowserRead />
      </Suspense>
    </main>
  )
}
