'use client'

import { useState } from 'react'

/**
 * Stands in for the supplier: posts to the webhook the way their system
 * would. Nothing here touches the stock section - it refreshes because the
 * route said the name changed, exactly as it would from another tab, a job,
 * or a server across the world.
 */
export function Restock() {
  const [sent, setSent] = useState(0)

  return (
    <button
      type="button"
      onClick={async () => {
        await fetch('/api/stock/restock', { method: 'POST' })
        setSent((n) => n + 1)
      }}
    >
      Deliver 5 more{sent > 0 && ` (webhook sent ×${sent})`}
    </button>
  )
}
