import { Suspense } from 'react'
import { Counter } from '../components/Counter'
import { stats } from '../data'
import type { Metadata } from '@rsc-kit/core/metadata'

export const metadata: Metadata = { title: 'Home' }

// A slot: the one part of the page that waits for data, under its own
// boundary. Its data is an ordinary import — src/data.ts is never bundled for
// the browser.
async function Stats() {
  const { users, uptime } = await stats()

  return (
    <dl className="stats">
      <div><dt>Users</dt><dd>{users}</dd></div>
      <div><dt>Uptime</dt><dd>{uptime}</dd></div>
    </dl>
  )
}

// A server component that paints at once: the heading and the copy are the
// page, and only the numbers wait. It ships no JavaScript but the counter's.
export default function HomePage() {
  return (
    <>
      <h1>React Server Components, as a Vite plugin</h1>
      <p>
        This page is a server component. It rendered on the server and arrived as
        markup — the only JavaScript below is the counter.
      </p>

      {/* The same frame with the values blank, so nothing moves when they land. */}
      <Suspense
        fallback={
          <dl className="stats" aria-busy="true">
            <div><dt>Users</dt><dd>&nbsp;</dd></div>
            <div><dt>Uptime</dt><dd>&nbsp;</dd></div>
          </dl>
        }
      >
        <Stats />
      </Suspense>

      <Counter />
    </>
  )
}
