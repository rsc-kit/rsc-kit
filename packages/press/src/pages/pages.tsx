import { Suspense, cache } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { fieldErrors } from '@rsc-kit/core/action'
import type { GenerateMetadata, Metadata } from '@rsc-kit/core/metadata'
import { notFound } from '@rsc-kit/core/not-found'
import type { StandardSchemaV1 } from '@rsc-kit/core/standardSchema'
import { Blocks } from '../blocks.js'
import type { Block, BlockValue } from '../blocks.js'
import { defineResource } from '../resource.js'
import type { DataSource } from '../resource.js'

/** A page as it is stored. */
export interface PageRow {
  id: string | number
  title: string
  /** Its address without the leading slash: about, pricing/teams. */
  slug: string
  description?: string
  published: boolean
  blocks: BlockValue[]
}

/** What an editor saves. */
export type PageValues = Omit<PageRow, 'id'>

export interface PagesDefinition {
  /** The resource's name in the panel, and its url segment there. pages by default. */
  name?: string
  /** The kinds of block a page is built from, in the order an editor is offered them. */
  blocks: Block<any>[]
  /**
   * Where pages are kept. Its list() is also how a page is found by its
   * address: it is asked for filters: { slug }, and must honour it.
   */
  source: DataSource<PageRow, PageValues>
  /** The slug served at the catch-all's root - the site's home page. home by default. */
  home?: string
  /** The sidebar's icon in the panel. */
  icon?: ComponentType
  /** What shows while a page is looked up. Nothing by default. */
  fallback?: ReactNode
}

const SLUG = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/

type Issue = { message: string; path: string[] }

const issue = (field: string, message: string): Issue => ({ message, path: [field] })

/**
 * A page's schema, written out rather than taken from a validation library,
 * which press does not depend on. It says what it is as JSON Schema too, so
 * the form gets the same browser checks a zod schema's would.
 */
const pageSchema: StandardSchemaV1<Record<string, unknown>, PageValues> & {
  '~standard': { jsonSchema: { input: () => unknown } }
} = {
  '~standard': {
    version: 1,
    vendor: '@rsc-kit/press',
    validate(input) {
      const value = (input ?? {}) as Record<string, unknown>
      const issues: Issue[] = []
      const title = typeof value.title === 'string' ? value.title.trim() : ''
      const slug = typeof value.slug === 'string' ? value.slug : ''
      const description = typeof value.description === 'string' ? value.description : undefined

      if (title === '') issues.push(issue('title', 'A page needs a title.'))
      else if (title.length > 200) issues.push(issue('title', 'Keep the title under 200 characters.'))
      if (!SLUG.test(slug)) issues.push(issue('slug', 'Lowercase letters, digits and dashes, with / between parts: pricing/teams.'))
      if (description !== undefined && description.length > 300) issues.push(issue('description', 'Keep the description under 300 characters.'))
      if (!Array.isArray(value.blocks)) issues.push(issue('blocks', 'A page is a list of blocks.'))

      if (issues.length > 0) return { issues }

      return {
        value: {
          title,
          slug,
          ...(description ? { description } : {}),
          published: value.published === true,
          blocks: value.blocks as BlockValue[],
        },
      }
    },
    jsonSchema: {
      input: () => ({
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          slug: { type: 'string', pattern: SLUG.source },
          description: { type: 'string', maxLength: 300 },
          published: { type: 'boolean' },
          blocks: { type: 'array' },
        },
        required: ['title', 'slug', 'published', 'blocks'],
      }),
    },
  },
}

/**
 * Pages an editor builds in the panel from the app's blocks - a landing
 * page, an about page, a pricing page - served by one catch-all route:
 *
 *     // src/app/[...path]/page.tsx
 *     export default site.Page
 *     export const generateMetadata = site.generateMetadata
 *
 *     // src/app/[...path]/middleware.ts
 *     export default site.middleware
 *
 *     // the panel
 *     resources: [site.resource, ...]
 *
 * A page is read from the source on every request, so a save is live on the
 * next visit; nothing is rebuilt.
 */
export function definePages(definition: PagesDefinition) {
  const home = definition.home ?? 'home'
  const blocks = definition.blocks
  const source = definition.source
  const everywhere = { tenant: null }

  if (!SLUG.test(home)) throw new Error(`[press] home is a slug: ${JSON.stringify(home)}`)

  for (const [index, block] of blocks.entries()) {
    if (blocks.findIndex((candidate) => candidate.name === block.name) !== index) throw new Error(`[press] two blocks are named ${block.name}`)
  }

  const bySlug = async (slug: string): Promise<PageRow | null> =>
    (await source.list({ dir: 'asc', page: 1, perPage: 1, filters: { slug }, searchable: [] }, everywhere)).rows.find((row) => row.slug === slug) ?? null

  // An address is one page's. Checked here, so a memory or rpc source need
  // not, and refused under the field like the schema's own refusals.
  const unique = async (slug: string, id: string | null) => {
    const taken = await bySlug(slug)

    if (taken && String(taken.id) !== id) fieldErrors({ slug: `${taken.title} is already at /${slug}.` })
  }

  const guarded: DataSource<PageRow, PageValues> = {
    list: (query, context) => source.list(query, context),
    find: (id, context) => source.find(id, context),
    create: async (values, context) => {
      await unique(values.slug, null)

      return source.create(values, context)
    },
    update: async (id, values, context) => {
      await unique(values.slug, id)

      return source.update(id, values, context)
    },
    delete: (id, context) => source.delete(id, context),
  }

  const resource = defineResource<PageRow>()({
    name: definition.name ?? 'pages',
    key: 'id',
    title: 'title',
    ...(definition.icon ? { icon: definition.icon } : {}),
    description: 'Built from blocks, and live at their address once published.',
    source: guarded,
    table: (col) => [col.text('title').searchable().sortable(), col.text('slug').searchable().sortable(), col.boolean('published').sortable()],
    form: pageSchema,
    fields: {
      slug: { description: `Its address, without the leading slash. ${home} is the home page.` },
      description: { type: 'textarea', description: 'For search engines and link previews.' },
      blocks: { label: 'Content', blocks },
    },
  })

  /** The page at a catch-all's path, published, or null. Once per request, however many ask. */
  const find = cache(async (path: string): Promise<PageRow | null> => {
    // The home page lives at the root, not also at /home.
    if (path === home) return null

    const page = await bySlug(path === '' ? home : path)

    return page?.published ? page : null
  })

  const pathOf = async (params: Promise<Record<string, string | undefined>>) => String(Object.values(await params)[0] ?? '')

  async function Content({ params }: { params: Promise<Record<string, string | undefined>> }) {
    const page = await find(await pathOf(params))

    if (!page) notFound()

    return <Blocks blocks={blocks} value={page.blocks} />
  }

  /** The catch-all route's page. Its param may have any name. */
  function Page({ params }: { params: Promise<Record<string, string | undefined>> }) {
    return (
      <Suspense fallback={definition.fallback ?? null}>
        <Content params={params} />
      </Suspense>
    )
  }

  /**
   * The same lookup before anything is sent, so an address with no page is
   * a real 404. The page's own notFound() is under the shell, which a stored
   * route sends with a 200 before the lookup has answered.
   */
  async function middleware(params: Record<string, string | undefined>) {
    if (!(await find(String(Object.values(params ?? {})[0] ?? '')))) notFound()
  }

  const generateMetadata: GenerateMetadata<Record<string, string | undefined>> = async ({ params }) => {
    const page = await find(await pathOf(params))

    if (!page) return {}

    return { title: page.title, ...(page.description ? { description: page.description } : {}) } satisfies Metadata
  }

  return { resource, Page, generateMetadata, middleware, find, blocks }
}

export type Pages = ReturnType<typeof definePages>
