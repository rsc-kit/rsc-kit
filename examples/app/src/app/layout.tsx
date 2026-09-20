import './styles.css'
// Preloaded so the browser finds it before the stylesheet does. ?url is Vite's
// and hands back the hashed path the build serves.
import frauncesLatin from '@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2?url'
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
        <link rel="preload" href={frauncesLatin} as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <Nav />
        <main>{children}</main>
        {modal}
      </body>
    </html>
  )
}
