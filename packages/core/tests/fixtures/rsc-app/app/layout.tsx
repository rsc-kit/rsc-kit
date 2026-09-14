import './app.css'
import type { ReactNode } from 'react'
import { Nav } from '../Nav'

export const metadata = { title: { template: '%s · RSC', default: 'RSC Docs' }, description: 'default description' }

export default function Layout({ children, modal }: { children: ReactNode; modal?: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body>
        <Nav />
        {modal}
        {children}
      </body>
    </html>
  )
}
