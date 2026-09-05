import type { ReactNode } from 'react'

// Chrome only, and skippable — which is the point. The check is in middleware.ts.
export default function GuardedLayout({ children }: { children: ReactNode }) {
  return <section>{children}</section>
}
