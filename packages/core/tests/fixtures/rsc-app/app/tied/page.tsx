import type { Metadata } from '../../../../../src/metadata'

// An image file and an exported image in the same folder: the file is the
// nearer declaration, as it is in Next, and it wins.
export const metadata: Metadata = {
  title: 'Tied',
  openGraph: { images: '/exported-card.png' },
}

export default function TiedPage() {
  return <main>tied</main>
}
