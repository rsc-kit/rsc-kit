import { Suspense, type ReactNode } from 'react'

// The layout a category adds, and home does not have. Revealing home after a
// category left this layout's chain on the wire, and the next category's
// payload landed inside the hidden one: url changed, page did not.
//
// It reads its own param, under a boundary: the route lists no urls, so the
// stored shell has no category to show. Kept mounted by file name alone, it
// went on showing the category it was first rendered for after a link to
// another one.
async function Category({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params

  return <p id="layout-category">in {category}</p>
}

export default function CategoryLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ category: string }>
}) {
  return (
    <section id="category">
      <Suspense fallback={<p id="layout-category">in …</p>}>
        <Category params={params} />
      </Suspense>
      {children}
    </section>
  )
}
