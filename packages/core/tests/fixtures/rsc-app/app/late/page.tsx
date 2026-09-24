// Data of its own that lands well after the render has gone quiet: no host
// call, nothing request-bound, just a slow read. The build's probe hands its
// slot back while this waits, and must still store the page whole.
export const metadata = { title: 'Late Page' }

async function Late() {
  const value = await new Promise<string>((resolve) => setTimeout(() => resolve('arrived late'), 300))

  return <p id="late">{value}</p>
}

export default function LatePage() {
  return (
    <main>
      <Late />
    </main>
  )
}
