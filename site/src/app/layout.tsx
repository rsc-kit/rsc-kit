import type { ReactNode } from 'react'
import type { Metadata } from '@rsc-kit/core/metadata'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles.css'

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
      </head>
      <body>{children}</body>
    </html>
  )
}
