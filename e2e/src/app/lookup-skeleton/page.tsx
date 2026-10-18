import { Suspense } from 'react'
import { connection } from '@rsc-kit/core/request'
import { LookupForm } from '../../components/Lookup'

// A search that shows a skeleton where the results are. The form sets
// data-pending while it works, so the page styles the results from it: no
// client wrapper, and the results stay out of the form.
async function Domains({ searchParams }: { searchParams: Promise<URLSearchParams> }) {
  await connection()

  const q = (await searchParams).get('q') ?? ''

  await new Promise((resolve) => setTimeout(resolve, 500))

  return (
    <section>
      <style>{`
        #results-skeleton { display: none }
        section:has(form[data-pending]) #results { display: none }
        section:has(form[data-pending]) #results-skeleton { display: block }
      `}</style>
      <LookupForm q={q} action="/lookup-skeleton" />
      <p id="results">results for {q || 'nothing'}</p>
      <p id="results-skeleton">searching…</p>
    </section>
  )
}

export default function LookupSkeletonPage({ searchParams }: { searchParams: Promise<URLSearchParams> }) {
  return (
    <main>
      <h1>Lookup</h1>
      <Suspense fallback={<p id="skeleton">loading…</p>}>
        <Domains searchParams={searchParams} />
      </Suspense>
    </main>
  )
}
