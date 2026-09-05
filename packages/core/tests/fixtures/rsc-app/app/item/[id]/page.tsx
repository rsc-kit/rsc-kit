import { Suspense } from 'react'

// The param-dependent part, behind a boundary. This is what makes one shell
// correct for every id: the shell holds the fallback, never the value.
async function ItemDetail({ params }: { params: Promise<{ id?: string }> }) {
  const { id } = await params
  const data = (await (globalThis as any).rpc('slowData', 10)) as { value: string }

  return <p id="item-detail">{id}: {data.value}</p>
}

export default function ItemPage({ params }: { params: Promise<{ id?: string }> }) {
  return (
    <main>
      <h1 id="item-shell">Item</h1>
      <Suspense fallback={<div id="item-fallback">loading item…</div>}>
        <ItemDetail params={params} />
      </Suspense>
    </main>
  )
}
