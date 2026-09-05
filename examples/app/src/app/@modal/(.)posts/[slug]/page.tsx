import { Suspense } from 'react'
import { ModalShell } from '../../../../components/ModalShell'
import { findPost } from '../../../../data'

async function Body({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await findPost(slug)

  return (
    <>
      <h2>{post?.title ?? slug}</h2>
      <p>{post?.body ?? 'No such post.'}</p>
    </>
  )
}

// Intercepts /posts/:slug when navigated to from within the app: the post
// opens over whatever page you were on. A hard reload gets the real page.
//
// Reads the same source the page does. Pointing an interceptor at different
// data than the page it stands in for is its own bug, and one that looks
// exactly like a broken interception: the modal opens correctly and says the
// post does not exist.
export default function PostModal({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <ModalShell>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Body params={params} />
      </Suspense>
    </ModalShell>
  )
}
