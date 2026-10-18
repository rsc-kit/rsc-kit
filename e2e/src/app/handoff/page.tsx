import Link from '@rsc-kit/core/Link'

// Where a page sends someone out of the app: to a url the backend owns (named
// in backendPaths, and bouncing on to another site, as an OAuth start does) or
// straight to another site, decided before the page's boundary or inside it.
export default function Handoff() {
  return (
    <main>
      <h1>Handoff</h1>
      <ul>
        <li><Link href="/handoff/early/backend">early, to the backend</Link></li>
        <li><Link href="/handoff/early/external">early, to another site</Link></li>
        <li><Link href="/handoff/late/backend">late, to the backend</Link></li>
        <li><Link href="/handoff/late/external">late, to another site</Link></li>
      </ul>
    </main>
  )
}
