import { Suspense } from 'react'
import { Query } from '../../components/Query'

export const metadata = { title: 'Search' }

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
    </>
  )
}
