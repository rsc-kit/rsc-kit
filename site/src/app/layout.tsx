import type { ReactNode } from 'react'
import type { Metadata } from '@rsc-kit/core/metadata'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles.css'

// The three faces the first paint needs, preloaded so they leave with the
// document rather than after the stylesheet that names them. The rest of
// each family's subsets load on demand, as Fontsource declares them.
import fraunces from '@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2?url'
import plexSans from '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2?url'
import plexMono from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url'

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
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        {[fraunces, plexSans, plexMono].map((href) => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
      </head>
      <body>{children}</body>
    </html>
  )
}
