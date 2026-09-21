import { notFound } from '../../../../../src/notFound'

// A parameter at the top of app/ that is not a host: /painting-supplies is a
// collection, the way Next reads app/[collection]. Only [domain] binds a host.
// Any other single segment is not a collection, and says so.
const COLLECTIONS = new Set(['painting-supplies'])

export async function generateStaticParams() {
  return [{ collection: 'painting-supplies' }]
}

export default async function CollectionPage({ params }: { params: Promise<{ collection?: string }> }) {
  const { collection } = await params

  if (!collection || !COLLECTIONS.has(collection)) notFound()

  return <main id="collection">Collection {collection}</main>
}
