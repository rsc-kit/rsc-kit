import { Listings } from './listings'

export const metadata = { title: 'Queries' }

export default function QueriesPage() {
  return (
    <main>
      <h1>Reading over GET</h1>
      <p>
        Three reads across two components, two of them for the same thing. They
        leave as one request to <code>/_rsc/query</code>, and the repeated read
        is handed the answer the first one is already waiting for.
      </p>

      <Listings kind="stay" />
    </main>
  )
}
