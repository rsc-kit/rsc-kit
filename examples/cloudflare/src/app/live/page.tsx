import { Suspense } from 'react'
import type { Metadata } from '@rsc-kit/core/metadata'
import Stock from './stock.section'

export const metadata: Metadata = { title: 'Live' }

/**
 * A section that refreshes when the data changes - on any isolate - with
 * nothing polling. POST /api/restock stands in for a supplier's webhook.
 */
export default function LivePage() {
  return (
    <main>
      <h1 className="text-2xl font-semibold">Live stock</h1>
      <Suspense fallback={<p className="mt-4">…</p>}>
        <Stock />
      </Suspense>
    </main>
  )
}
