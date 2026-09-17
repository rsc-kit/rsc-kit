import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { PRODUCTS } from '../data'

const getUser = createServerFn().handler(() => getCookie('user') ?? 'stranger')

export const Route = createFileRoute('/dynamic')({
  loader: () => getUser(),
  component: DynamicPage,
})

function DynamicPage() {
  const user = Route.useLoaderData()

  return (
    <main>
      <h1>Products</h1>
      <p>Hello, {user}</p>
      <ul>
        {PRODUCTS.map((p) => (
          <li key={p.id}>
            {p.name} — ${p.price} — {p.stock} in stock
          </li>
        ))}
      </ul>
    </main>
  )
}
