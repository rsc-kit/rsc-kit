import type { ReactNode } from 'react'
import type { Metadata } from '../../../../../src/metadata'

// A layout that names an image of its own: nearer than the one in app/, and
// further than a file in a folder beneath it.
export const metadata: Metadata = {
  openGraph: { images: '/layout-card.png' },
}

export default function TrailLayout({ children }: { children: ReactNode }) {
  return <section>{children}</section>
}
