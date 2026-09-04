import { Counter } from '../components/Counter'

export const metadata = { title: 'Home' }

// A server component: async, runs only on the server, ships no JavaScript.
// `rpc` reaches the host functions registered in server.ts.
export default async function HomePage() {
  const stats = await rpc<{ users: number; uptime: string }>('stats')

  return (
    <>
      <h1>React Server Components, on Hono</h1>
      <p>
        This page is a server component. It rendered on the server and arrived as
        markup — the only JavaScript below is the counter.
      </p>

      <dl className="stats">
        <div><dt>Users</dt><dd>{stats.users}</dd></div>
        <div><dt>Uptime</dt><dd>{stats.uptime}</dd></div>
      </dl>

      <Counter />
    </>
  )
}
