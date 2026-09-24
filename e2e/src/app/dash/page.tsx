import { Suspense } from 'react'
import { cookies } from '@rsc-kit/core/request'

// A dashboard's shape: the chrome is stored, the numbers are the visitor's and
// arrive in the hole a moment after the shell has painted - quickly, the way
// a nearby database answers. What this page is for is how long the
// placeholder stays up once the numbers are already there.
async function Numbers() {
  const visits = Number((await cookies()).get('visits')?.value ?? 0)

  await new Promise((resolve) => setTimeout(resolve, 150))

  return (
    <div id="dash-data" style={card}>
      <strong>{visits} visits</strong>
      <span>this month</span>
    </div>
  )
}

// Shaped like the dashboard it stands in for: a card, and a grey card of the
// same size while it loads - so a phone shows the swap the way the app does.
const card = { display: 'grid', gap: 8, height: 96, padding: 16, borderRadius: 12, background: '#1f2937', color: '#f9fafb' }
const skeleton = { ...card, background: '#4b5563' }

export default function Dash() {
  return (
    <main>
      <h1>Dashboard</h1>
      <Suspense fallback={<div id="dash-skeleton" style={skeleton} />}>
        <Numbers />
      </Suspense>
    </main>
  )
}
