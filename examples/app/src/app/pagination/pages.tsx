'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { fetchQuery } from '@rsc-kit/core/queryClient'
import { getPage, type NumberedPage } from '../../queries'
import { useState } from 'react'

export function Pages({ initial }: { initial: NumberedPage }) {
  const [page, setPage] = useState(1)

  const { data, isPlaceholderData } = useQuery({
    queryKey: ['page', page],
    queryFn: () => fetchQuery(getPage, [page]),

    // The previous page stays on screen while the next is read, so the list
    // does not collapse to a spinner and back on every click.
    placeholderData: keepPreviousData,

    // Only page one was rendered into the document; every other page is a read.
    initialData: page === 1 ? initial : undefined,
    staleTime: 60_000,
  })

  const current = data ?? initial

  return (
    <>
      <ul style={{ opacity: isPlaceholderData ? 0.5 : 1 }}>
        {current.items.map((item) => (
          <li key={item.id}>
            {item.title} — {item.parish}
          </li>
        ))}
      </ul>

      <p>
        Page {current.page} of {current.pageCount}
      </p>

      <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
        Previous
      </button>{' '}
      <button
        type="button"
        onClick={() => setPage((p) => Math.min(current.pageCount, p + 1))}
        disabled={page >= current.pageCount}
      >
        Next
      </button>
    </>
  )
}
