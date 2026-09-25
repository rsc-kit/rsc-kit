export async function generateStaticParams() {
  return [{ id: '1' }]
}

export default async function ShelfPage({ params }: { params: Promise<{ id?: string }> }) {
  const { id } = await params

  return <main id="shelf-page">Shelf page {id}</main>
}
