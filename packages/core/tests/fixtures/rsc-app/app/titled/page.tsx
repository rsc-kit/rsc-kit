import type { Metadata } from '../../../../../src/metadata'

// An openGraph that says nothing about images leaves the image to the file.
export const metadata: Metadata = {
  title: 'Titled',
  openGraph: { title: 'Titled for sharing' },
}

export default function TitledPage() {
  return <main>titled</main>
}
