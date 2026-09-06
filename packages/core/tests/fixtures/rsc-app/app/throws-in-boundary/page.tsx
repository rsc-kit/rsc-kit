import { Suspense } from 'react'

// Stands in for a database the build machine cannot reach. The rejection
// happens INSIDE a boundary, which is the case that used to be invisible:
// React catches it, keeps the fallback, and the render finishes as though the
// page were complete.
async function Unreachable() {
  throw new Error('connection refused')
}

export default function ThrowsInBoundaryPage() {
  return (
    <>
      <h1>Needs something that is not here</h1>
      <Suspense fallback={<p id="still-loading">loading…</p>}>
        <Unreachable />
      </Suspense>
    </>
  )
}
