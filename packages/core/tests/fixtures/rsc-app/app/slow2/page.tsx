import { Suspense } from 'react'

async function SlowPart() {
  const data = (await (globalThis as any).rpc('slowData', 3000)) as { value: string }

  return <p id="slow2-content">{data.value}</p>
}

// A single slow boundary and nothing else pending — isolates whether React
// emits the Suspense fallback before the child resolves.
export default function Slow2Page() {
  return (
    <main>
      <h1 id="slow2-shell">Shell</h1>
      <Suspense fallback={<div id="slow2-fallback">loading…</div>}>
        <SlowPart />
      </Suspense>
    </main>
  )
}
