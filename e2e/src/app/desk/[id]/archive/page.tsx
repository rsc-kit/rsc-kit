import { Suspense } from 'react'
import { refreshDeskHeader } from '../../../../actions'

let renders = 0

async function Slow() {
  await new Promise((resolve) => setTimeout(resolve, 800))

  return <p id="tab-content">archive render #{++renders}</p>
}

export default function ArchivePage() {
  return (
    <>
      <h1>Archive</h1>
      <form action={refreshDeskHeader}>
        <button id="refresh-header" type="submit">
          Refresh the header
        </button>
      </form>
      <Suspense fallback={<p id="tab-loading">loading</p>}>
        <Slow />
      </Suspense>
    </>
  )
}
