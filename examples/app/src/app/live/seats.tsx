'use client'

import { useEvents } from '@rsc-kit/core/useEvents'

type Seats = { left: number; at: string }

export function LiveSeats({ initial }: { initial: Seats }) {
  // No library: the hook is the state. `latest` is null until the first
  // message, so the server-rendered value shows meanwhile.
  const { latest, status } = useEvents<Seats>('/api/seats/events')
  const seats = latest ?? initial

  return (
    <>
      <p>
        <strong>{seats.left}</strong> seats left, as of {seats.at}
      </p>
      <p>
        <small>
          stream: {status}
          {status === 'connecting' && ' — the browser reconnects on its own'}
        </small>
      </p>
    </>
  )
}
