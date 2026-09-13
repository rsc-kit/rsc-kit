'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { readQuery } from '@rsc-kit/core/queryClient'
import { getFeed, type Page } from '../../queries'

export function Feed({ initial }: { initial: Page }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['feed'],
    // The cursor is an ordinary argument. Nothing here knows about HTTP.
    queryFn: ({ pageParam }) => readQuery(getFeed, [pageParam]),
    initialPageParam: null as number | null,
    getNextPageParam: (last: Page) => last.nextCursor,

    // Page one, already resolved by the server component above.
    initialData: { pages: [initial], pageParams: [null as number | null] },

    // Not optional. TanStack treats initialData as stale at its default
    // staleTime of 0, so without this it refetches page one on mount and the
    // round trip the server just saved you happens anyway.
    staleTime: 60_000,
  })

  const items = data.pages.flatMap((page) => page.items)

  return (
    <>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.title} — {item.parish}
          </li>
        ))}
      </ul>

      <p>{items.length} of 43 loaded</p>

      {hasNextPage ? (
        <button type="button" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      ) : (
        <p>That is all of them.</p>
      )}
    </>
  )
}
