import { CreateOrder } from './CreateOrder'

interface Order {
  id: number
  total: number
}

/**
 * A server component whose data lives in Go.
 *
 * rpc() is a global the renderer installs and the build declares; the call
 * leaves as POST /__rsc/host-call to RSC_BACKEND, under the visitor's own
 * cookie, and the render resumes with the JSON.
 */
export default async function Orders() {
  const orders = await rpc<Order[]>('Orders.recent', 5)

  return (
    <main>
      <h1>Recent orders</h1>
      <ul>
        {orders.map((o) => (
          <li key={o.id}>
            #{o.id} — ${(o.total / 100).toFixed(2)}
          </li>
        ))}
      </ul>
      <CreateOrder />
    </main>
  )
}
