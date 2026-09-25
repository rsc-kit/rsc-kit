import type { ReactNode } from 'react'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui', maxWidth: 40 + 'rem', margin: '3rem auto' }}>
        <nav style={{ display: 'flex', gap: '1rem' }}>
          <a href="/">Orders</a>
          <a href="/admin">Admin</a>
        </nav>
        {children}
      </body>
    </html>
  )
}
