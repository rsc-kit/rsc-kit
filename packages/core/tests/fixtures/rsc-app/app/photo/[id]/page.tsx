// Declares which urls exist for this route, the way a real app would list its
// slugs. Nothing else about the page changes: whether it can be frozen is
// still decided by rendering it.
export async function generateStaticParams() {
  return [{ id: '1' }, { id: '2' }]
}

export default function PhotoPage({ id }: { id?: string }) {
  return <main id="photo-full">Full photo {id}</main>
}
