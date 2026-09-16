import type { Metadata } from '../../../../../src/metadata'

// Every share-card shape at once, so one page proves the rendering rules:
// og: is property=, twitter: is name=, relative urls get the base, an image
// object gets its size tags, and icons are links.
export const metadata: Metadata = {
  title: 'Share',
  metadataBase: 'https://fixture.test',
  openGraph: {
    title: 'A page worth sharing',
    url: '/share',
    images: [{ url: '/card.png', width: 1200, height: 630, alt: 'The card' }],
  },
  twitter: { card: 'summary_large_image', images: '/card.png' },
  icons: { icon: '/icon.svg', apple: [{ url: '/apple.png', sizes: '180x180' }] },
  // The old flat spelling still renders, and renders correctly.
  'og:type': 'article',
  other: { 'fb:app_id': '123', 'theme-color': '#000' },
}

export default function SharePage() {
  return <main>share</main>
}
