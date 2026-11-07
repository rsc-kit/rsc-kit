import { Suspense } from 'react'

async function OrderNumber({ params }: { params: Promise<{ order: string }> }) {
  const { order } = await params

  return <h1 id="host-guard-order">order {order}</h1>
}

export default function HostGuardOrderPage({ params }: { params: Promise<{ order: string }> }) {
  return (
    <Suspense fallback={<p>loading</p>}>
      <OrderNumber params={params} />
    </Suspense>
  )
}
