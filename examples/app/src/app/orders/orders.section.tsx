import { section } from '@rsc-kit/core/section'
import { listOrders } from '../../orders'

// A named region. section() registers it under a name the client can refresh
// and an action can mark, so this list re-renders without the page around it
// being touched.
async function Orders() {
  const orders = await listOrders()

  return (
    <ul className="orders">
      {orders.map((order) => (
        <li key={order.id}>{order.item}</li>
      ))}
    </ul>
  )
}

export default section('orders', Orders)
