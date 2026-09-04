// An inner layout that declares no slots. The @modal slot is declared at app/,
// so the ROOT layout owns it — this one must never receive it.
import type { ReactNode } from 'react'

export default function NestedLayout({ children }: { children: ReactNode }) {
  return <section id="nested-layout">{children}</section>
}
