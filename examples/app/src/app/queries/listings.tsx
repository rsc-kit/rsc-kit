'use client'

import { useQuery } from '@rsc-kit/core/useQuery'
import { getListingCount, getListings } from '../../queries'

/**
 * The seeded read.
 *
 * `initialData` is the answer the page already awaited. It goes into the cache
 * under the same key this read builds, so the first render has data and
 * `isLoading` is false from the start — there is no loading branch to write and
 * no request to make.
 */
export function Listings({
  kind,
  initial,
  initialTotal,
}: {
  kind: string
  initial: string[]
  initialTotal: number
}) {
  const listings = useQuery<string[]>(getListings, [kind], { initialData: initial })
  const total = useQuery<number>(getListingCount, [], { initialData: initialTotal })

  return (
    <>
      <ul>
        {listings.data?.map((listing) => (
          <li key={listing}>{listing}</li>
        ))}
      </ul>
      <p>{total.data} in total</p>
      <button type="button" onClick={listings.refresh}>
        Refresh
      </button>
    </>
  )
}

/** The same query, nothing handed down. Reads after hydration. */
export function Unseeded({ kind }: { kind: string }) {
  const listings = useQuery<string[]>(getListings, [kind])

  if (listings.error) return <p role="alert">{listings.error.message}</p>
  if (listings.isLoading) return <p>Loading…</p>

  return (
    <>
      <ul>
        {listings.data?.map((listing) => (
          <li key={listing}>{listing}</li>
        ))}
      </ul>
      <Same kind={kind} />
    </>
  )
}

/** The same read again, from a second component. Must not be a second request. */
function Same({ kind }: { kind: string }) {
  const listings = useQuery<string[]>(getListings, [kind])

  return <p>{listings.data?.length ?? 0} shown, read twice, fetched once</p>
}
