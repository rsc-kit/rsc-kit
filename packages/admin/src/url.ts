/**
 * The url schemas a panel's route files export. Standard Schemas written by
 * hand, so the panel depends on no validation library: the engine reads a
 * page's params and searchParams through `~standard`, whichever made it.
 */
import type { StandardSchemaV1 } from '@rsc-kit/core/standardSchema'

type Result<T> = { value: T } | { issues: { message: string; path: string[] }[] }

function schema<T>(validate: (value: Record<string, unknown>) => Result<T>): StandardSchemaV1<Record<string, unknown>, T> {
  return {
    '~standard': {
      version: 1,
      vendor: '@rsc-kit/admin',
      validate: (value) =>
        typeof value === 'object' && value !== null ? validate(value as Record<string, unknown>) : { issues: [{ message: 'Expected an object', path: [] }] },
      types: undefined as never,
    },
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined)

export type ListSearch = {
  q?: string
  sort?: string
  dir: 'asc' | 'desc'
  page: number
  /** A filter: any other key. */
  [filter: string]: string | number | undefined
}

/** A resource's list page reads these from its url. A filter is any other key. */
export const listSearch = schema<ListSearch>((value) => {
  const out: ListSearch = { dir: 'asc', page: 1 }

  for (const [key, raw] of Object.entries(value)) {
    const given = text(raw)

    if (given === undefined) continue

    if (key === 'dir') out.dir = given === 'desc' ? 'desc' : 'asc'
    else if (key === 'page') {
      const page = Number(given)

      // A page that is not one is the first, rather than a 400: an old link
      // or a hand-edited url should still show the table.
      out.page = Number.isInteger(page) && page >= 1 ? page : 1
    } else out[key] = given
  }

  return { value: out }
})

const params = <K extends string>(...keys: K[]) =>
  schema<Record<K, string>>((value) => {
    const missing = keys.filter((key) => text(value[key]) === undefined)

    if (missing.length) return { issues: missing.map((key) => ({ message: 'Required', path: [key] })) }

    return { value: Object.fromEntries(keys.map((key) => [key, text(value[key])!])) as Record<K, string> }
  })

export const resourceParams = params('resource')

export const recordParams = params('resource', 'id')

export type PluginsSearch = {
  /** A manifest url under review. */
  review?: string
}

/** The plugins page reads the manifest it is reviewing from its url. */
export const pluginsSearch = schema<PluginsSearch>((value) => {
  const review = text(value.review)

  return { value: review ? { review } : {} }
})
