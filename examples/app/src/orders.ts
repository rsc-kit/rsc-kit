// Server-side state, imported directly. No rpc: the page and the data are in
// the same process.
const orders: { id: number; item: string }[] = [{ id: 1, item: 'A rubber duck' }]

export async function listOrders() {
  return orders
}

export async function addOrder(item: string) {
  orders.push({ id: orders.length + 1, item })
}
