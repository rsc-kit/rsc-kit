import { Suspense } from 'react'
import { cookies } from '@rsc-kit/core/request'

// A dashboard's shape: the chrome is stored, the numbers are the visitor's and
// arrive in the hole a moment after the shell has painted - quickly, the way
// a nearby database answers. What this page is for is how long the
// placeholder stays up once the numbers are already there.
async function Numbers() {
  const visits = Number((await cookies()).get('visits')?.value ?? 0)

  await new Promise((resolve) => setTimeout(resolve, 150))

  return <p id="dash-data">{visits} visits</p>
}

export default function Dash() {
  return (
    <main>
      <h1>Dashboard</h1>
      <Suspense fallback={<p id="dash-skeleton">loading…</p>}>
        <Numbers />
      </Suspense>
    </main>
  )
}
