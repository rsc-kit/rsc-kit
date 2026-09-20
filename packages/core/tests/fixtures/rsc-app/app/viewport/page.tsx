// Next's viewport export, on a page with no layout of its own writing the
// tag: the engine renders it, and themeColor and colorScheme with it.
import type { Viewport } from '../../../../../src/metadata'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
  colorScheme: 'dark light',
}

export default function ViewportPage() {
  return <main>Fits the phone</main>
}
