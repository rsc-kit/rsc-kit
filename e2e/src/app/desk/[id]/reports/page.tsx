import { Suspense } from 'react'

let renders = 0

// Slower than the archive tab, so the wait is long enough to tell a page that
// was shown from one that was held back for it.
async function Slow() {
  await new Promise((resolve) => setTimeout(resolve, 1500))

  return <p id="tab-content">reports render #{++renders}</p>
}

export default function ReportsPage() {
  return (
    <>
      <h1>Reports</h1>
      <Suspense fallback={<p id="tab-loading">loading</p>}>
        <Slow />
      </Suspense>
    </>
  )
}
