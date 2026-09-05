import { Suspense } from 'react'
import { findPost } from '../../../data'

export const metadata = { title: 'Post' }

async function Body({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await findPost(slug)

  if (!post) return <h1>No such post: {slug}</h1>

  return (
    <>
      <h1>{post.title}</h1>
      <p>{post.body}</p>
    </>
  )
}

// The url segment is awaited, not spread. Read above every boundary it would
// block the whole page from being prerendered; read below one, the shell
// freezes for the pattern and serves every slug.
export default function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<p className="muted">Loading post…</p>}>
      <Body params={params} />
    </Suspense>
  )
}
