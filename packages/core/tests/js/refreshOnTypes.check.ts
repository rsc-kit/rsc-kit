// refreshOn's types, as a page and a section write them. Compiled by the
// typecheck, never run: a wrong type here fails `bun run typecheck`.

import { z } from 'zod'
import { section, type PageRefreshOn, type RefreshOnList } from '../../src/js/section'

export const params = z.object({ team: z.string(), page: z.coerce.number() })

// A page with a schema: params arrive parsed, typed from it.
export const refreshOn: PageRefreshOn<typeof params> = ({ params }) => {
  const team: string = params.team
  const page: number = params.page

  return [`team:${team}:repos:${page}`]
}

// A page without one: a record of strings.
export const untyped: PageRefreshOn = ({ params }) => [`team:${params.team}`]

// @ts-expect-error - not a param the schema has
export const wrong: PageRefreshOn<typeof params> = ({ params }) => [params.nope]

// A section's own props stay its own.
export const repos = section('repos', async ({ team }: { team: string }) => team, {
  refreshOn: ({ team, params }) => [`team:${team}`, `x:${params.anything}`],
})

export const names: RefreshOnList<{ team: string }> = ['a', 'b']

// A section whose props have no params is still given the page's, as strings.
export const site = section('stock', async () => null, {
  refreshOn: ({ params }) => {
    const value: string | undefined = params.site

    return [`warehouse:${value ?? 'main'}`]
  },
})
