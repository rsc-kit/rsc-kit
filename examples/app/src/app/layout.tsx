import './styles.css'
import type { ReactNode } from 'react'
import { Nav } from '../components/Nav'
import type { Metadata } from '@rsc-kit/core/metadata'

export const metadata: Metadata = {
  title: { template: '%s · rsc-kit', default: 'rsc-kit' },
  description: 'React Server Components as a Vite plugin',
  // Once, here. A share-card scraper needs an absolute image url, and this is
  // what turns the opengraph-image.png in app/ into one.
  metadataBase: new URL('https://example.rsc-kit.dev'),
  openGraph: {
    siteName: 'rsc-kit example',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@rsckit',
  },
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
