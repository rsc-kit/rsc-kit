export const metadata = { title: 'Post' }

// The url segment arrives as a prop: /posts/hello → slug="hello".
export default async function PostPage({ slug }: { slug: string }) {
  const post = await rpc<{ title: string; body: string } | null>('post', slug)

  if (!post) return <h1>No such post: {slug}</h1>

  return (
    <>
      <h1>{post.title}</h1>
      <p>{post.body}</p>
    </>
  )
}
