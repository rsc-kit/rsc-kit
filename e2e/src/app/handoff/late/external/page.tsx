import { Suspense } from 'react'
import { ELSEWHERE, Leave } from '../../../../handoff'

export default function Late() {
  return (
    <main>
      <Suspense fallback={<p>leaving…</p>}>
        <Leave to={ELSEWHERE} />
      </Suspense>
    </main>
  )
}
