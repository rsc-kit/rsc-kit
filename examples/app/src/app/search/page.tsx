import { Suspense } from 'react'
import Link from '@rsc-kit/core/Link'
import { Query } from '../../components/Query'
import type { Metadata } from '@rsc-kit/core/metadata'
import { z } from 'zod'

export const metadata: Metadata = { title: 'Search' }

// What the query string means, declared once. The page parses with it, and
// a <Link href="/search" search={…}> anywhere in the app is typed by it: a key
// this page never reads, or a page number written as text, does not compile.
export const searchParams = z.object({
  q: z.string().default(''),
  page: z.coerce.number().int().min(1).default(1),
})

// The query string is not knowable when the shell is stored, so the boundary
// is what makes this page storable at all: the fallback goes in the file and
// the real value arrives in the browser.
export default function SearchPage() {
  return (
    <>
      <h1>Search</h1>
      <Suspense fallback={<p className="muted">Reading the query…</p>}>
        <Query />
      </Suspense>
      {/* Typed by the schema above: `page` must be a number, and `sort` would not compile. */}
      <p>
        <Link href="/search" search={{ q: 'shoes', page: 2 }}>
          Page 2 of shoes
        </Link>
      </p>
    </>
  )
}
