import './styles.css'
import type { ReactNode } from 'react'
import type { Metadata } from '@rsc-kit/core/metadata'

export const metadata: Metadata = {
  title: { template: '%s · admin', default: 'admin' },
}

// The root layout owns <html>. Everything below it is a segment the router can
// replace on its own without re-rendering this. The charset and viewport meta
// are written into every document by the build; export const viewport changes it.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-svh bg-background text-foreground antialiased">{children}</body>
    </html>
  )
}
