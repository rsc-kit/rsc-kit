// Plain server-side data access. No rpc, no host global — the server component
// and this module run in the same process, so it is an ordinary import.
const posts = new Map([
  ['direct-import', { title: 'Imported, not rpc-ed', body: 'This came from src/data.ts.' }],
  ['frozen', { title: 'Rendered once, at build time', body: 'Served from disk, never re-rendered.' }],
])

/** The slugs that exist. Read by generateStaticParams to decide what to build. */
export function allSlugs(): string[] {
  return [...posts.keys()]
}

export async function findPost(slug: string) {
  // Where a real app would await its database.
  await new Promise((r) => setTimeout(r, 10))

  return posts.get(slug) ?? null
}

export const SECRET = 'this string must never reach the browser'
