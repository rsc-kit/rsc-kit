import { Suspense } from 'react'
import { connection } from '@rsc-kit/core/request'
import { LookupForm } from '../../components/Lookup'

// The whole view - the form and its results - waits for its data inside one
// boundary, as a page of a real app does. The skeleton is what the stored
// shell shows; a search on this page must not bring it back.
async function Domains({ searchParams }: { searchParams: Promise<URLSearchParams> }) {
  await connection()

  const q = (await searchParams).get('q') ?? ''

  await new Promise((resolve) => setTimeout(resolve, 500))

  return (
    <section>
      <LookupForm q={q} />
      <p id="results">results for {q || 'nothing'}</p>
    </section>
  )
}

export default function LookupPage({ searchParams }: { searchParams: Promise<URLSearchParams> }) {
  return (
    <main>
      <h1>Lookup</h1>
      <Suspense fallback={<p id="skeleton">loading…</p>}>
        <Domains searchParams={searchParams} />
      </Suspense>
    </main>
  )
}
