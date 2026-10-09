/**
 * The names a region refreshes on: its list, or its function's, made unique -
 * and a region that ends up with none is said, in development.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { namesFor } from '../../src/js/refreshOn'

const input = { params: { team: '7' }, searchParams: new URLSearchParams() } as never
let warnings: string[] = []
const warn = console.warn

beforeEach(() => {
  warnings = []
  console.warn = (message: string) => void warnings.push(message)
})

afterEach(() => {
  console.warn = warn
})

test('a function is given the input; the names come back unique, empty ones dropped', async () => {
  const names = await namesFor<{ params: Promise<{ team: string }> }>('repos', ({ params }) => [`team:${params.team}`, `team:${params.team}`, ''], input)

  expect(names).toEqual(['team:7'])
  expect(warnings).toHaveLength(0)
})

test('none at all is said once per region in development - a param read under the wrong name looks like working code', async () => {
  const wrongParam = ({ params }: { params: Record<string, string | undefined> }) => (params.teamId ? [`team:${params.teamId}`] : [])

  expect(await namesFor('members', wrongParam, input)).toEqual([])
  expect(await namesFor('members', wrongParam, input)).toEqual([])
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain('"members"')
})

test('in production nothing is said', async () => {
  const before = process.env.NODE_ENV

  process.env.NODE_ENV = 'production'

  try {
    expect(await namesFor('quiet', [], input)).toEqual([])
    expect(warnings).toHaveLength(0)
  } finally {
    process.env.NODE_ENV = before
  }
})

// The region's own probe runs the page's refreshOn per request, and a page that
// does not exist throws notFound() from the same read. That is the page's
// answer, not a region that cannot say what it refreshes on, and it logged a
// line for every missing record.
test('a missing page is not a warning, and any other failure still is', async () => {
  const { withRequest } = await import('../../src/request')
  const { notFound } = await import('../../src/notFound')
  const { RefreshOn } = await import('../../src/js/refreshOn')

  const resolve = async (list: () => string[]) => {
    const element = RefreshOn({ target: 'page', refreshOn: list as never, props: {} as never }) as unknown as {
      props: { children: { type: (props: unknown) => Promise<unknown>; props: unknown } }
    }
    const { type, props } = element.props.children

    return await withRequest(new Request('http://x/'), () => type(props))
  }

  expect(await resolve(() => notFound())).toBeNull()
  expect(warnings).toHaveLength(0)

  expect(await resolve(() => { throw new Error('the version store is down') })).toBeNull()
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain('the version store is down')
})
