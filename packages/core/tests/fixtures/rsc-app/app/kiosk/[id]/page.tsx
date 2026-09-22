import { Suspense } from 'react'

// The shape that broke a port in production: a page whose own structure
// depends on a param, above its boundary. /kiosk/new is a form, every other
// id is a record - two different components in the same slot. A pattern
// shell can only be frozen for one of them, so the resume has to render the
// tree the shell froze and fill the hole; rendered for the real id here,
// React finds <Record> where it postponed <Frame> and gives up on every
// hole, and the page arrives inert.
function Creating() {
  return <form id="kiosk-create">New</form>
}

function Viewing() {
  return <article id="kiosk-view">Existing</article>
}

async function Detail({ params }: { params: Promise<{ id?: string }> }) {
  const { id } = await params

  return <p id="kiosk-detail">Kiosk {id}</p>
}

export default async function KioskPage({ params }: { params: Promise<{ id?: string }> }) {
  // Read above the boundary on purpose: at build the params never settle, so
  // this postpones and the whole page is the hole.
  const { id } = await params

  return (
    <section id="kiosk">
      {id === 'new' ? <Creating /> : <Viewing />}
      <Suspense fallback={<i id="kiosk-fallback">loading</i>}>
        <Detail params={params} />
      </Suspense>
    </section>
  )
}
