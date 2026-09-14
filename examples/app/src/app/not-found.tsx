import Link from '@rsc-kit/core/Link'
import type { Metadata } from '@rsc-kit/core/metadata'

export const metadata: Metadata = { title: 'Not found' }

/**
 * The page for a url nothing answers.
 *
 * Rendered through the root layout like any other page, and served with a real
 * 404 — a page that says "not found" under a 200 is a page search engines
 * index.
 */
export default function NotFound() {
  return (
    <main>
      <h1>No such page</h1>
      <p>
        Nothing answers that url. <Link href="/">Go home</Link>.
      </p>
    </main>
  )
}
