import { Suspense } from 'react'

// Right for a visitor whose backend is down, and wrong to store for everyone.
async function Plans() {
  try {
    return <p>{String(await (globalThis as any).rpc('Plans.all'))}</p>
  } catch {
    return <p>unavailable</p>
  }
}

export default function Page() {
  return (
    <Suspense fallback={<p>loading plans</p>}>
      <Plans />
    </Suspense>
  )
}
