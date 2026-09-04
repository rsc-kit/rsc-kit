import { Suspense } from 'react'

export const metadata = { title: 'Slow Page' }

async function SlowPart({ ms, label }: { ms: number; label: string }) {
  const data = (await (globalThis as any).rpc('slowData', ms)) as { value: string }

  return <p id={label}>{label}: {data.value}</p>
}

// Renders an instant shell plus two independently-suspending children, so the
// stream timeline shows whether chunks arrive as each resolves.
export default function SlowPage() {
  return (
    <main>
      <h1 id="slow-shell">Shell rendered immediately</h1>
      <Suspense fallback={<div id="fast-fallback">loading fast…</div>}>
        <SlowPart ms={500} label="fast" />
      </Suspense>
      <Suspense fallback={<div id="slow-fallback">loading slow…</div>}>
        <SlowPart ms={3000} label="slow" />
      </Suspense>
    </main>
  )
}
