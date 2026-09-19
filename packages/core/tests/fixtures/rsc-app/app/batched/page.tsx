// Three siblings, each reading from the host. React renders them
// concurrently, so their rpc() calls are issued in the same tick - which is
// what lets the transport send them as one request.
async function Orders() {
  const orders = await (globalThis as any).rpc('Orders.recent', 2)

  return <p id="orders">{orders.length} orders</p>
}

async function Who() {
  const user = await (globalThis as any).rpc('getUser', 'ada')

  return <p id="who">{user.display}</p>
}

async function Session() {
  const cookie = await (globalThis as any).rpc('Me.session')

  return <p id="session">{cookie || 'nobody'}</p>
}

export default function BatchedPage() {
  return (
    <main>
      <Orders />
      <Who />
      <Session />
    </main>
  )
}
