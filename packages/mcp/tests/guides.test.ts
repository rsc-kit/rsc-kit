import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundleGuides, toMarkdown, searchGuides } from '../src/bundleGuides'

const REPO = join(import.meta.dir, '..', '..', '..')
const GUIDES = join(REPO, 'docs/src/content/docs/guides')

describe('bundling the guides', () => {
  test('turns frontmatter into a heading and drops the component imports', () => {
    const { entry, body } = toMarkdown(
      '---\ntitle: Forms\ndescription: Submitting things.\n---\nimport CodeFromFile from "@/components/CodeFromFile.astro";\n\nHello.\n',
      REPO,
    )

    expect(entry).toEqual({ title: 'Forms', description: 'Submitting things.' })
    expect(body).toBe('# Forms\n\n> Submitting things.\n\nHello.\n')
  })

  test('inlines the file a CodeFromFile names, cut to its region', () => {
    const { body } = toMarkdown(
      '---\ntitle: T\n---\n<CodeFromFile file="examples/app/src/components/Nav.tsx" region="links" title="src/components/Nav.tsx" />\n',
      REPO,
    )

    expect(body).toContain('```tsx title="src/components/Nav.tsx"')
    expect(body).toContain('satisfies { href: Href')
    expect(body).not.toContain('#region')
    expect(body).not.toContain('CodeFromFile')
  })

  test('writes every guide and an index, with nothing left unexpanded', () => {
    const out = mkdtempSync(join(tmpdir(), 'guides-'))
    const index = bundleGuides(GUIDES, out, REPO)

    expect(index.length).toBeGreaterThan(20)
    expect(index.find((g) => g.slug === 'server-actions')?.title).toBeTruthy()

    for (const { slug } of index) {
      const md = readFileSync(join(out, `${slug}.md`), 'utf-8')

      expect(md.startsWith('# ')).toBe(true)
      expect(md).not.toContain('<CodeFromFile')
      expect(md).not.toContain('@/components/')
    }

    expect(existsSync(join(out, 'index.json'))).toBe(true)
  })
})

describe('searching the guides', () => {
  test('finds the lines and names the guide, once the bundle exists', () => {
    // The bundle is a build output; without it the answer says so rather than
    // pretending the phrase is absent.
    const answer = searchGuides('fieldErrors')

    if (answer.startsWith('No guides are bundled')) return

    expect(answer).toContain('server-actions:')
    expect(answer).toContain('fieldErrors')
    expect(searchGuides('zzz-not-a-thing')).toContain('Nothing in the guides')
    expect(searchGuides('  ')).toContain('Give a word')
  })
})
