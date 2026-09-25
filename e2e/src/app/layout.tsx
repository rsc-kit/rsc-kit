import type { ReactNode } from 'react'
import './styles.css'

// The root: no client component and nothing read from the request, so a page
// under it alone - /about - is stored whole and ships no JavaScript at all.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
