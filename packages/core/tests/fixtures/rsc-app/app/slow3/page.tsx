// Dynamic page: awaits a slow rpc() call. The Suspense boundary comes from
// loading.tsx (the engine's `loadings` chain), which is the canonical shape.
export default async function Slow3Page() {
  const data = (await (globalThis as any).rpc('slowData', 3000)) as { value: string }

  return (
    <main>
      <h1 id="slow3-content">{data.value}</h1>
    </main>
  )
}
