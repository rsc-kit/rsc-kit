// The docs sidebar lists the guides by hand, grouped by when a reader needs
// them. A list by hand forgets: a guide added without a line here exists and
// is linked from nowhere a reader browses. This holds it to the directory.

import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DOCS = join(import.meta.dir, '../../../docs')

test('every guide is in the sidebar exactly once, and nothing else is', () => {
  const config = readFileSync(join(DOCS, 'astro.config.ts'), 'utf-8')
  const listed = [...config.matchAll(/link: "\/guides\/([^"]+)"/g)].map((m) => m[1]!)
  const guides = readdirSync(join(DOCS, 'src/content/docs/guides'))
    .filter((f) => f.endsWith('.mdx'))
    .map((f) => f.replace(/\.mdx$/, ''))

  expect(listed.filter((slug, i) => listed.indexOf(slug) !== i), 'listed twice').toEqual([])
  expect(guides.filter((g) => !listed.includes(g)), 'guides missing from the sidebar').toEqual([])
  expect(listed.filter((g) => !guides.includes(g)), 'sidebar links to no guide').toEqual([])
})
