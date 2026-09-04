import './styles.css'
import type { ReactNode } from 'react'
import { Nav } from '../components/Nav'

export const metadata = {
  title: { template: '%s · RSC on Hono', default: 'RSC on Hono' },
  description: 'React Server Components served by a Hono backend',
}

// `modal` is a parallel slot: the @modal directory beside this file fills it.
// It renders alongside children, not instead of them.
export default function RootLayout({ children, modal }: { children: ReactNode; modal?: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <Nav />
        <main>{children}</main>
        {modal}
      </body>
    </html>
  )
}
