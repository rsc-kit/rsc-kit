import { Suspense } from 'react'
import { connection } from '@rsc-kit/core/request'

// A page whose stream takes a while to finish: the shell first, the rest a
// second later. Long enough for a visitor to leave in the middle.
async function Late() {
  await connection()
  await new Promise((resolve) => setTimeout(resolve, 1000))

  return <p id="late">arrived</p>
}

export default function SlowPage() {
  return (
    <main>
      <h1>Slow</h1>
      <Suspense fallback={<p id="late-loading">loading…</p>}>
        <Late />
      </Suspense>
    </main>
  )
}
