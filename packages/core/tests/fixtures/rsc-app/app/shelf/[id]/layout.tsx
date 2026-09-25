import type { ReactNode } from 'react'

// A title in the layout, read from the params - where NextFaster keeps a
// category's. The page below has none, so this is the title of the page.
export async function generateMetadata({ params }: { params: Promise<{ id?: string }> }) {
  const { id } = await params

  return { title: `Shelf ${id}`, description: `Everything on shelf ${id}` }
}

export default function ShelfLayout({ children }: { children: ReactNode }) {
  return <section id="shelf">{children}</section>
}
