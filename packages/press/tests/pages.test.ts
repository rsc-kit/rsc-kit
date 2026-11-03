import { beforeEach, describe, expect, test } from 'bun:test'
import * as z from 'zod'
import { isActionValidationError } from '@rsc-kit/core/action'
import { installCacheStore, memoryCacheStore } from '@rsc-kit/core/cache'
import { changed, installVersionSource, memoryVersions } from '@rsc-kit/core/changed'
import { defineBlock } from '../src/blocks'
import { memorySource } from '../src/memory'
import { definePages } from '../src/pages/pages'
import type { PageRow, PageValues } from '../src/pages/pages'
import { parse } from '../src/resource'

const hero = defineBlock({
  name: 'hero',
  form: z.object({ heading: z.string().min(3), wide: z.boolean(), columns: z.number().int().optional() }),
  render: () => null,
})
const quote = defineBlock({ name: 'quote', form: z.object({ text: z.string().min(1) }), render: () => null })

const submit = (values: Record<string, string>) => {
  const data = new FormData()

  for (const [key, value] of Object.entries(values)) data.set(key, value)

  return data
}

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (isActionValidationError(error) ? error.errors : null),
  )

// Pages are kept between requests, so each test starts with nothing kept.
beforeEach(() => {
  installCacheStore(memoryCacheStore())
  installVersionSource(memoryVersions())
})

const site = (rows: PageRow[] = [], options: { revalidate?: number | false } = {}) => {
  const source = memorySource<PageRow, PageValues>(rows, 'id', (id, values) => ({ id, ...values }))

  return { source, pages: definePages({ blocks: [hero, quote], source, ...options }) }
}

/** The same site, counting how often its source is asked for a page. */
const counting = (rows: PageRow[], options: { revalidate?: number | false } = {}) => {
  const source = memorySource<PageRow, PageValues>(rows, 'id', (id, values) => ({ id, ...values }))
  let asked = 0
  const counted = { ...source, list: (...args: Parameters<typeof source.list>) => (asked++, source.list(...args)) }
  const pages = definePages({ blocks: [hero, quote], source: counted, ...options })

  return { pages, asked: () => asked }
}

const page = (overrides: Partial<PageRow>): PageRow => ({ id: 1, title: 'About', slug: 'about', published: true, blocks: [], ...overrides })

describe('a blocks field', () => {
  test('offers its kinds to the form as plain data', () => {
    const { pages } = site()
    const content = pages.resource.fields.find((field) => field.name === 'blocks')!

    expect(content).toMatchObject({ type: 'blocks', label: 'Content' })
    expect(content.blocks!.map((kind) => [kind.name, kind.label, kind.fields.map((field) => field.name)])).toEqual([
      ['hero', 'Hero', ['heading', 'wide', 'columns']],
      ['quote', 'Quote', ['text']],
    ])
    // Nothing that cannot cross to the browser.
    expect(JSON.parse(JSON.stringify(content))).toEqual(content)
  })

  test('reads each block from its numbered names, converted as its own fields are', async () => {
    const { pages } = site()
    const parsed = await parse(
      pages.resource,
      submit({
        title: 'About',
        slug: 'about',
        'blocks.0.type': 'quote',
        'blocks.0.text': 'Hello',
        'blocks.1.type': 'hero',
        'blocks.1.heading': 'Welcome',
        'blocks.1.wide': 'on',
        'blocks.1.columns': '3',
      }),
    )

    expect(parsed).toEqual({
      ok: true,
      values: {
        title: 'About',
        slug: 'about',
        published: false,
        blocks: [
          { type: 'quote', data: { text: 'Hello' } },
          { type: 'hero', data: { heading: 'Welcome', wide: true, columns: 3 } },
        ],
      },
    })
  })

  test('refuses a block by its own schema, under the field it numbered', async () => {
    const { pages } = site()
    const parsed = await parse(
      pages.resource,
      submit({ title: 'About', slug: 'About Us', 'blocks.0.type': 'hero', 'blocks.0.heading': 'Hi', 'blocks.1.type': 'gone' }),
    )

    expect(parsed.ok).toBe(false)
    expect(Object.keys(parsed.ok ? {} : parsed.errors).sort()).toEqual(['blocks.0.heading', 'blocks.1', 'slug'])
  })

  test('needs the kinds it offers, and blocks do not nest', () => {
    expect(() => defineBlock({ name: 'Bad Name', form: z.object({}), render: () => null })).toThrow('lowercase')
    expect(() =>
      defineBlock({ name: 'outer', form: z.object({ inner: z.array(z.any()) }), fields: { inner: { blocks: [hero] } }, render: () => null }),
    ).toThrow('blocks do not nest')
    expect(() => definePages({ blocks: [hero, hero], source: site().source })).toThrow('two blocks are named hero')
  })
})

describe('a page', () => {
  test('is found by its path, the root being the home page, and only once published', async () => {
    const { pages } = site([
      page({ id: 1, slug: 'home', title: 'Home' }),
      page({ id: 2, slug: 'pricing/teams', title: 'Teams' }),
      page({ id: 3, slug: 'draft', published: false }),
    ])

    expect((await pages.find(''))?.title).toBe('Home')
    expect((await pages.find('pricing/teams'))?.title).toBe('Teams')
    expect(await pages.find('home')).toBeNull()
    expect(await pages.find('draft')).toBeNull()
    expect(await pages.find('nowhere')).toBeNull()
  })

  test('that is not there is refused by the middleware, before anything is sent', async () => {
    const { pages } = site([page({ slug: 'about' }), page({ id: 2, slug: 'draft', published: false })])
    const outcome = (params: Record<string, string>) =>
      pages.middleware(params).then(
        () => 'rendered',
        (error: unknown) => (error instanceof Error ? error.name : String(error)),
      )

    expect(await outcome({ path: 'about' })).toBe('rendered')
    expect(await outcome({ path: 'draft' })).toBe('NotFoundSignal')
    expect(await outcome({ path: 'nowhere' })).toBe('NotFoundSignal')
  })

  test('is titled and described by what was saved', async () => {
    const { pages } = site([page({ description: 'Who we are.' })])

    expect(await pages.generateMetadata({ params: Promise.resolve({ path: 'about' }), searchParams: Promise.resolve(new URLSearchParams()) })).toEqual({
      title: 'About',
      description: 'Who we are.',
    })
  })

  test('has an address no other page has', async () => {
    const { pages } = site([page({ id: 1, slug: 'about' })])
    const values: PageValues = { title: 'Also about', slug: 'about', published: true, blocks: [] }

    expect(await refusal(pages.resource.source.create(values, { tenant: null }))).toEqual({ slug: ['About is already at /about.'] })
    // Saving a page at its own address is not a clash.
    expect(await refusal(pages.resource.source.update('1', { ...values, title: 'About us' }, { tenant: null }))).toBeNull()
  })

  test('is looked up once, then served without asking the source', async () => {
    const { pages, asked } = counting([page({ slug: 'about' })])

    await pages.find('about')
    await pages.find('about')
    await pages.find('about')

    expect(asked()).toBe(1)
  })

  test('saved in the panel, is live on the next visit', async () => {
    const { pages } = counting([page({ slug: 'about' }), page({ id: 2, slug: 'team', title: 'Team' })])
    const values = (overrides: Partial<PageValues>): PageValues => ({ title: 'About', slug: 'about', published: true, blocks: [], ...overrides })

    expect((await pages.find('about'))?.title).toBe('About')

    await pages.resource.source.update('1', values({ title: 'About us' }), { tenant: null })
    expect((await pages.find('about'))?.title).toBe('About us')

    // Moved: the old address is gone at once, not when it expires.
    await pages.resource.source.update('1', values({ title: 'About us', slug: 'company' }), { tenant: null })
    expect(await pages.find('about')).toBeNull()
    expect((await pages.find('company'))?.title).toBe('About us')

    // Unpublished, or deleted.
    await pages.resource.source.update('1', values({ slug: 'company', published: false }), { tenant: null })
    expect(await pages.find('company')).toBeNull()
    await pages.resource.source.delete('2', { tenant: null })
    expect(await pages.find('team')).toBeNull()
  })

  test('changed around the panel, is live when the app says so', async () => {
    const { pages, asked } = counting([page({ slug: 'about' })])

    await pages.find('about')
    await changed('press:pages')
    await pages.find('about')

    expect(asked()).toBe(2)
  })

  test('with revalidate: false, is asked for on every request', async () => {
    const { pages, asked } = counting([page({ slug: 'about' })], { revalidate: false })

    await pages.find('about')
    await pages.find('about')

    expect(asked()).toBe(2)
    expect(() => site([], { revalidate: 0 })).toThrow('revalidate is seconds')
  })
})
