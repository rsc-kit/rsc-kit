import type { ReactNode } from 'react'

// Chrome only. The check lives in middleware.ts beside this file, so a navigation
// within this section skips this layout — and its data fetching — while the
// check still runs.
export default function GuardedLayout({ children }: { children: ReactNode }) {
  return <section>{children}</section>
}
