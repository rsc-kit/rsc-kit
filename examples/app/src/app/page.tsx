import { Counter } from '../components/Counter'
import { stats } from '../data'

export const metadata = { title: 'Home' }

// A server component: async, runs only on the server, ships no JavaScript.
// Its data is an ordinary import — src/data.ts is never bundled for the browser.
export default async function HomePage() {
  const { users, uptime } = await stats()

  return (
    <>
      <h1>React Server Components, on Hono</h1>
      <p>
        This page is a server component. It rendered on the server and arrived as
        markup — the only JavaScript below is the counter.
      </p>

      <dl className="stats">
        <div><dt>Users</dt><dd>{users}</dd></div>
        <div><dt>Uptime</dt><dd>{uptime}</dd></div>
      </dl>

      <Counter />
    </>
  )
}
