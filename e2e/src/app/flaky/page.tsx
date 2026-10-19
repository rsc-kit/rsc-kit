import { Suspense } from 'react'
import { connection } from '@rsc-kit/core/request'

// A page whose data fails until something outside says it is back: a backend
// that was down for a moment. What "Try again" is for.
const state = globalThis as { __flakyHealed?: boolean }

async function Report() {
  await connection()

  if (!state.__flakyHealed) throw new Error('the report service is down')

  return <p id="report">the report</p>
}

export default function FlakyPage() {
  return (
    <main>
      <h1>Flaky</h1>
      <Suspense fallback={<p id="report-loading">loading…</p>}>
        <Report />
      </Suspense>
    </main>
  )
}
