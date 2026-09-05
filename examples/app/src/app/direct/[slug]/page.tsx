import { Suspense } from 'react'
import { allSlugs, findPost, SECRET } from '../../../data'

// Which urls exist. The one thing the build cannot work out for itself — and
// the reason this route is frozen per url, while /posts/[slug], which declares
// nothing, is frozen once as a shell.
export function generateStaticParams() {
  return allSlugs().map((slug) => ({ slug }))
}

export const metadata = { title: 'Direct import' }

async function Body({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await findPost(slug)

  // Referenced so the bundler cannot tree-shake the module away — the point is
  // that it is in the server graph and not the client one.
  const proof = SECRET.length

  if (!post) return <h1>No such post: {slug}</h1>

  return (
    <>
      <h1>{post.title}</h1>
      <p>{post.body}</p>
      <p className="muted">secret length on the server: {proof}</p>
    </>
  )
}

export default function DirectPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Body params={params} />
    </Suspense>
  )
}
