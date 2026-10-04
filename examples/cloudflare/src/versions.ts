import { sqlVersions } from '@rsc-kit/core/changed'

type D1 = {
  prepare(text: string): { bind(...params: unknown[]): { all(): Promise<{ results: Record<string, unknown>[] }> } }
}

/**
 * The D1 binding, imported where it is used rather than at the top. The build
 * prerenders in Node, which runs register() and cannot import
 * `cloudflare:workers`; imported here, it is only ever loaded inside a
 * request on the Worker.
 */
const db = async (): Promise<D1> => ((await import('cloudflare:workers')).env as unknown as { DB: D1 }).DB

/** refreshOn's versions in D1, shared by every isolate. */
export const versions = () =>
  sqlVersions({
    dialect: 'sqlite',
    query: async (text, params) => (await (await db()).prepare(text).bind(...params).all()).results,
  })

/** The stock the /live page shows, and the restock webhook changes. */
export async function stockLeft(): Promise<number> {
  const { results } = await (await db()).prepare('SELECT left_count FROM stock WHERE id = 1').bind().all()

  return Number(results[0]?.left_count ?? 0)
}

export async function restock(count: number): Promise<void> {
  await (await db()).prepare('UPDATE stock SET left_count = left_count + ? WHERE id = 1').bind(count).all()
}
