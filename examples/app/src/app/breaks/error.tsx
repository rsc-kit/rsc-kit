'use client'

import type { RouteErrorProps } from '@rsc-kit/core/RouteErrorBoundary'

/**
 * The nearest error.tsx catches, the same way the nearest loading.tsx is the
 * fallback. It must be a client component — the build refuses it otherwise.
 */
export default function BreaksError({ error, reset }: RouteErrorProps) {
  return (
    <section>
      <h1>That did not work</h1>
      <p>{error.message}</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </section>
  )
}
