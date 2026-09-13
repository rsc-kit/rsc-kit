import { getListingCount, getListings } from '../../queries'
import { Listings } from './listings'
import { Unseeded } from './listings'

export const metadata = { title: 'Queries' }

/**
 * The first page of data, resolved here and streamed with the document.
 *
 * `getListings` is the same function the client component reads. Awaiting it
 * in a server component runs it in process — no HTTP — and handing the answer
 * down seeds the client cache under the key the read would have built. So the
 * browser renders it immediately and asks for nothing.
 *
 * There is no key to serialise, no fetcher to write and no endpoint behind it.
 */
export default async function QueriesPage() {
  const [stays, total] = await Promise.all([getListings('stay'), getListingCount()])

  return (
    <main>
      <h1>Reading over GET</h1>

      <h2>Seeded by the server</h2>
      <p>Rendered from the document. Open the network panel: nothing is requested.</p>
      <Listings kind="stay" initial={stays} initialTotal={total} />

      <h2>Read by the browser</h2>
      <p>
        Not seeded, so this one asks. Three reads across two components, two of
        them for the same thing — one request, and the repeat is handed the
        answer the first is already waiting for.
      </p>
      <Unseeded kind="experience" />
    </main>
  )
}
