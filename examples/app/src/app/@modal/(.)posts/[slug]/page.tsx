import { ModalShell } from '../../../../components/ModalShell'

// Intercepts /posts/:slug when navigated to from within the app: the post
// opens over whatever page you were on. A hard reload gets the real page.
//
// Reads the same source the page does. Pointing an interceptor at different
// data than the page it stands in for is its own bug, and one that looks
// exactly like a broken interception: the modal opens correctly and says the
// post does not exist.
export default async function PostModal({ slug }: { slug: string }) {
  const post = await rpc<{ title: string; body: string } | null>('post', slug)

  return (
    <ModalShell>
      <h2>{post?.title ?? slug}</h2>
      <p>{post?.body ?? 'No such post.'}</p>
    </ModalShell>
  )
}
