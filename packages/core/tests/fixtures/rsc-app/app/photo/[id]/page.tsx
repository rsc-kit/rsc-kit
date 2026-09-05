// Declares which urls exist for this route, the way a real app would list its
// slugs. Nothing else about the page changes: whether it can be frozen is
// still decided by rendering it.
export async function generateStaticParams() {
  return [{ id: '1' }, { id: '2' }]
}

// Awaits its param at the top level with no boundary above it. For a listed
// url that is fine — the build renders it for a real id. For a route that
// listed none there would be nothing to paint, and the build says so.
export default async function PhotoPage({ params }: { params: Promise<{ id?: string }> }) {
  const { id } = await params

  return <main id="photo-full">Full photo {id}</main>
}
