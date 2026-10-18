import { Suspense } from 'react'
import { BACKEND, Leave } from '../../../../handoff'

export default function Late() {
  return (
    <main>
      <Suspense fallback={<p>leaving…</p>}>
        <Leave to={BACKEND} />
      </Suspense>
    </main>
  )
}
