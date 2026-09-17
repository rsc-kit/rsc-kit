import type { ReactNode } from 'react'
import type { Metadata } from '@rsc-kit/core/metadata'

export const metadata: Metadata = { title: 'bench' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
