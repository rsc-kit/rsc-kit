import { Suspense } from 'react'
import { CreateOrder } from './CreateOrder'

/**
 * A server component whose data lives in Go.
 *
 * rpc() is a global the renderer installs and the build declares; the call
 * leaves as POST /__rsc/host-call to RSC_BACKEND, under the visitor's own
 * cookie, and the render resumes with the JSON.
 */
async function RecentOrders() {
  // Typed from Go: Order[] without a type argument.
  const orders = await rpc('Orders.recent', 5)

  return (
    <ul>
      {orders.map((o) => (
        <li key={o.id}>
          #{o.id} — ${(o.total / 100).toFixed(2)}
        </li>
      ))}
    </ul>
  )
}

/**
 * The page paints at once - the heading and the form are in the stored
 * shell - and only the list waits for Go, under its own boundary.
 */
export default function Orders() {
  return (
    <main>
      <h1>Recent orders</h1>
      <Suspense fallback={<ul aria-busy="true" />}>
        <RecentOrders />
      </Suspense>
      <CreateOrder />
    </main>
  )
}
