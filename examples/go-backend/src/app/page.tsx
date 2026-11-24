import { Suspense } from 'react'
import { CreateOrder } from './CreateOrder'

/**
 * A server component whose data lives in Go.
 *
 * rpc() is a global the renderer installs and the build declares. The build
 * asks Go, and an answer that is the same for everyone is stored with the page.
 * One that reads the visitor leaves as POST /__rsc/host-call to RSC_BACKEND
 * instead, under their cookie, and the render resumes with the JSON.
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
 * Stored whole, as Orders.recent is the same for everyone. The boundary is for
 * the day it is not: the heading and the form would still paint at once.
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
