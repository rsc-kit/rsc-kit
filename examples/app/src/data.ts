// Plain server-side data access. The page and this module run in the same
// process, so reading data is an ordinary import — there is no fetching API to
// learn and nothing to register.
//
// None of this reaches the browser. The module never enters the client graph,
// so neither do the secrets it holds.
const posts = new Map([
  ['hello-world', { title: 'Hello, world', body: 'Rendered on the server, streamed to the browser.' }],
  ['direct-import', { title: 'Imported, not fetched', body: 'This came from src/data.ts.' }],
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

export async function stats() {
  return { users: 1_284, uptime: '18d 4h' }
}

/**
 * Deliberately slower than the prerender budget (RSC_PPR_TIMEOUT_MS, 2s).
 *
 * That is what makes /dashboard come out as PPR rather than frozen whole: the
 * probe gives up waiting, so the shell it captured — including the Suspense
 * fallback standing in for this list — is what gets stored.
 */
export async function activity() {
  await new Promise((r) => setTimeout(r, 2_500))

  return [
    { at: '09:14', what: 'deployed build 4a1c' },
    { at: '08:02', what: 'invited three teammates' },
  ]
}

export const SECRET = 'this string must never reach the browser'
