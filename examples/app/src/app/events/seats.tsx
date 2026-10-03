'use client'

import { useEvents } from '@rsc-kit/core/useEvents'

type Seats = { left: number; at: string }

export function LiveSeats({ initial }: { initial: Seats }) {
  // No library: the hook is the state. `latest` is null until the first
  // message, so the server-rendered value shows meanwhile. Its type is the
  // route's: what the generator yields, read by the build.
  const { latest, status } = useEvents('/api/seats/events')
  const seats = latest ?? initial

  return (
    <>
      <p>
        <strong>{seats.left}</strong> seats left, as of {seats.at}
      </p>
      <p>
        <small>
          stream: {status}
          {status === 'connecting' && ' — reconnecting on its own'}
        </small>
      </p>
    </>
  )
}
