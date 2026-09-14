import { Suspense } from 'react'
import { connection } from '@rsc-kit/core/request'
import type { Metadata } from '@rsc-kit/core/metadata'

export const metadata: Metadata = { title: 'Breaks' }

/**
 * The realistic failure: fine at build time, broken at request time.
 *
 * `connection()` never resolves during the build, so the throw below it never
 * happens there and the page is stored as a shell. Per request it resolves, the
 * component throws, and the error.tsx beside this file renders instead.
 */
async function Orders(): Promise<React.ReactNode> {
  await connection()

  throw new Error('the orders service is down')
}

export default function BreaksPage() {
  return (
    <main>
      <h1>Orders</h1>
      <Suspense fallback={<p>Loading orders…</p>}>
        <Orders />
      </Suspense>
    </main>
  )
}
