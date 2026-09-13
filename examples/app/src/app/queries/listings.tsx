'use client'

import { useQuery } from '@rsc-kit/core/useQuery'
import { getListingCount, getListings } from '../../queries'

/**
 * Two reads, one request.
 *
 * `useQuery` rather than `use(readQuery(...))`: React refuses a server-function
 * call during server rendering, and reaching a query's id means calling its
 * reference. So this renders a loading state in the HTML and reads once the
 * browser has it. Both reads start in the same tick, so they leave together as
 * a single GET to /_rsc/query.
 */
export function Listings({ kind }: { kind: string }) {
  const listings = useQuery<string[]>(getListings, [kind])
  const total = useQuery<number>(getListingCount, [])

  if (listings.error) return <p role="alert">{listings.error.message}</p>
  if (listings.isLoading || !listings.data) return <p>Loading…</p>

  return (
    <>
      <ul>
        {listings.data.map((listing) => (
          <li key={listing}>{listing}</li>
        ))}
      </ul>
      <p>{total.data ?? '…'} in total</p>
      <Same kind={kind} />
      <button type="button" onClick={listings.refresh}>
        Refresh
      </button>
    </>
  )
}

/** The same read again, from a second component. Must not be a second request. */
function Same({ kind }: { kind: string }) {
  const listings = useQuery<string[]>(getListings, [kind])

  return <p>{listings.data?.length ?? 0} shown, read twice, fetched once</p>
}
