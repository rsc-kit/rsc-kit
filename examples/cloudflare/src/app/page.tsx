import Link from '@rsc-kit/core/Link'
import { Counter } from '../components/Counter'
import type { Metadata } from '@rsc-kit/core/metadata'

export const metadata: Metadata = { title: 'Home' }

// Nothing here reads the request, so the build stores the whole page. On the
// Worker it is a static asset: no render runs when someone opens it.
export default function HomePage() {
  return (
    <>
      <h1 className="text-3xl font-bold">rsc-kit on Cloudflare Workers</h1>
      <p className="mt-4 text-slate-600">
        This page was rendered once, at build time, and is served as an asset. The only
        JavaScript on it is the counter, the one client component.
      </p>

      <Counter />

      <ul className="mt-6 list-disc pl-6 text-slate-600">
        <li>
          <Link href="/visitor" className="underline">/visitor</Link> reads the request: a stored shell,
          with the part about you rendered by the Worker.
        </li>
        <li>
          <a href="/api/time" className="underline">/api/time</a> is a route.ts, answered as JSON.
        </li>
      </ul>
    </>
  )
}
