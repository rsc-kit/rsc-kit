'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchQuery } from '@rsc-kit/core/queryClient'
import { getSeatsLeft } from '../../queries'

export function Seats({ initial }: { initial: { left: number; readAt: string } }) {
  const { data, isFetching } = useQuery({
    queryKey: ['seats'],
    queryFn: () => fetchQuery(getSeatsLeft, []),
    initialData: initial,

    // Polling. The only line that makes this "live".
    refetchInterval: 2_000,

    // TanStack pauses the interval while the tab is hidden, which is almost
    // always what you want — a backgrounded tab polling every two seconds is
    // battery and bandwidth nobody asked for. Opted out here only so this page
    // keeps ticking in a tab you are not looking at, which is the whole point
    // of a demonstration.
    refetchIntervalInBackground: true,

    // Otherwise the seed is stale at once and it reads immediately on mount,
    // instead of waiting for the first interval.
    staleTime: 2_000,
  })

  return (
    <>
      <p>
        <strong>{data.left}</strong> seats left
      </p>
      <p>
        server read at {data.readAt} {isFetching ? '(reading…)' : ''}
      </p>
    </>
  )
}
