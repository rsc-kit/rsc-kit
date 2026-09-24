import type { ReactNode } from 'react'

// The layout a category adds, and home does not have. Revealing home after a
// category left this layout's chain on the wire, and the next category's
// payload landed inside the hidden one: url changed, page did not.
export default function CategoryLayout({ children }: { children: ReactNode }) {
  return <section id="category">{children}</section>
}
