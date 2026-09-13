import { Suspense } from 'react'
import { Activity } from '../../components/Activity'
import type { Metadata } from '@rsc-kit/core/metadata'

export const metadata: Metadata = { title: 'Dashboard' }

export default function DashboardPage() {
  return (
    <>
      <h1>Dashboard</h1>
      <p>
        The list below is behind a Suspense boundary, so the page paints
        immediately and the slow part streams in after it.
      </p>

      <Suspense fallback={<p className="muted">Loading activity…</p>}>
        <Activity />
      </Suspense>
    </>
  )
}
