import { Suspense } from 'react'
import Link from '@rsc-kit/core/Link'
import { CATEGORIES, SUBS, headingFor } from '../../../../data'

// Reads its params inside a boundary: one stored shell for every category,
// resumed per url - the pattern shell the demo's category pages are.
async function Subcategories({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params

  return (
    <>
      <h1>{headingFor(`/c/${category}`)}</h1>
      <ul>
        {SUBS.map((sub) => (
          <li key={sub}>
            <Link href={`/c/${category}/${sub}`}>{sub}</Link>
          </li>
        ))}
      </ul>
      {/* Straight to another category: the same layout file, another value. */}
      <Link id="next-category" href={`/c/${CATEGORIES[(CATEGORIES.indexOf(category) + 1) % CATEGORIES.length]}`}>
        next category
      </Link>
    </>
  )
}

export default function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  return (
    <Suspense fallback={<p className="loading">loading</p>}>
      <Subcategories params={params} />
    </Suspense>
  )
}
