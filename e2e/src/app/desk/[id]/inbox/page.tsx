import { Suspense } from 'react'

let renders = 0

async function Slow() {
  await new Promise((resolve) => setTimeout(resolve, 800))

  return <p id="tab-content">inbox render #{++renders}</p>
}

export default function InboxPage() {
  return (
    <>
      <h1>Inbox</h1>
      <Suspense fallback={<p id="tab-loading">loading</p>}>
        <Slow />
      </Suspense>
    </>
  )
}
