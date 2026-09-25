import type { ReactNode } from 'react'
import type { Metadata } from '@rsc-kit/core/metadata'
import './styles.css'

// Three faces, latin only, declared here rather than through Fontsource's
// stylesheets: those declare every script of every family, and this page
// sets English. The headline face is `swap` - the brand, and preloaded, so
// it arrives with the document. The two Plex faces are `optional`: the text
// paints once, in the fallback on a cold load over a slow network and in
// Plex when it is cached or quick, and never re-lays out for a font. That
// is the difference between a page that measures 99 and one that measures
// 100 on a throttled phone, and it is the honest trade for a landing page.
import fraunces from '@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2?url'
import plexSans from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?url'
import plexMono from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url'

const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'

const FACES = `
@font-face { font-family: 'Fraunces Variable'; font-style: normal; font-weight: 100 900; font-display: swap; src: url(${fraunces}) format('woff2-variations'); unicode-range: ${LATIN}; }
@font-face { font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 400 500; font-display: optional; src: url(${plexSans}) format('woff2'); unicode-range: ${LATIN}; }
@font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 400 500; font-display: optional; src: url(${plexMono}) format('woff2'); unicode-range: ${LATIN}; }
`

export const metadata: Metadata = {
  metadataBase: 'https://rsc-kit.dev',
  title: 'rsc-kit',
  description:
    'React Server Components as a Vite plugin. The build renders every route and says what it did — and this page ships no JavaScript.',
  openGraph: {
    title: 'rsc-kit',
    description: 'React Server Components as a Vite plugin, whose build tells you the truth.',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="color-scheme" content="light dark" />
        {[fraunces, plexSans, plexMono].map((href) => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
        <style>{FACES}</style>
      </head>
      <body>{children}</body>
    </html>
  )
}
