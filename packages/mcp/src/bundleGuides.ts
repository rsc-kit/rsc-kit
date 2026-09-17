// The guides, as files an agent can read without leaving its editor.
//
// how_to answers are short and opinionated, and they are copies — of the
// guides at rsc-kit.dev, by hand, which is how a recipe once said <Form> worked
// without javascript when it did not yet. The guides are the source. This
// bundles them into the package at build time so read_guide answers with the
// same text the site shows, and a recipe can point at the full version instead
// of restating it.
//
// MDX to markdown is three edits: the frontmatter becomes a heading, the
// component imports go, and <CodeFromFile> becomes the code it names — cut the
// same way the site cuts it, region and all.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

export interface GuideEntry {
  slug: string
  title: string
  description: string
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/
const COMPONENT_IMPORT = /^import .* from ["']@\/components\/.*["'];?\n/gm
const CODE_FROM_FILE = /<CodeFromFile\s+([^>]*?)\/>/g

function attribute(attrs: string, name: string): string | undefined {
  return new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1]
}

function frontmatterField(block: string, name: string): string {
  const match = new RegExp(`^${name}:\\s*(.*)$`, 'm').exec(block)

  return (match?.[1] ?? '').trim().replace(/^["'](.*)["']$/, '$1')
}

/** The lines between `#region <name>` and its `#endregion`, dedented. */
function region(source: string, name: string, file: string): string {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => new RegExp(`#region\\s+${name}\\b`).test(line))

  if (start === -1) throw new Error(`No region "${name}" in ${file}`)

  const end = lines.findIndex((line, i) => i > start && /#endregion\b/.test(line))

  if (end === -1) throw new Error(`Region "${name}" in ${file} is never closed`)

  const body = lines.slice(start + 1, end).filter((line) => !/#(region|endregion)\b/.test(line))
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length))

  return body.map((line) => line.slice(indent)).join('\n')
}

/** One guide's MDX as markdown, with the samples it names inlined. */
export function toMarkdown(mdx: string, repoRoot: string): { entry: Omit<GuideEntry, 'slug'>; body: string } {
  const fm = FRONTMATTER.exec(mdx)
  const title = fm ? frontmatterField(fm[1]!, 'title') : ''
  const description = fm ? frontmatterField(fm[1]!, 'description') : ''

  let body = mdx.replace(FRONTMATTER, '').replace(COMPONENT_IMPORT, '')

  body = body.replace(CODE_FROM_FILE, (_, attrs: string) => {
    const file = attribute(attrs, 'file')!
    const source = readFileSync(join(repoRoot, file), 'utf-8')
    const name = attribute(attrs, 'region')
    const code = name ? region(source, name, file) : source.trimEnd()
    const lang = attribute(attrs, 'lang') ?? extname(file).slice(1)
    const heading = attribute(attrs, 'title') ?? file

    return `\`\`\`${lang} title="${heading}"\n${code}\n\`\`\``
  })

  return {
    entry: { title, description },
    body: `# ${title}\n\n${description ? `> ${description}\n\n` : ''}${body.trim()}\n`,
  }
}

/**
 * Every page under each of `from`, written as markdown into `into`, with an
 * index. The top-level pages - installation, coming from Next - and the
 * guides land in one flat list, because a slug is what an agent asks for and
 * which directory the site keeps it in is not its concern.
 */
export function bundleGuides(from: string | string[], into: string, repoRoot: string): GuideEntry[] {
  rmSync(into, { recursive: true, force: true })
  mkdirSync(into, { recursive: true })

  const index: GuideEntry[] = []

  for (const dir of Array.isArray(from) ? from : [from]) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.mdx')).sort()) {
      const slug = basename(file, '.mdx')
      const { entry, body } = toMarkdown(readFileSync(join(dir, file), 'utf-8'), repoRoot)

      writeFileSync(join(into, `${slug}.md`), body)
      index.push({ slug, ...entry })
    }
  }

  index.sort((a, b) => a.slug.localeCompare(b.slug))

  writeFileSync(join(into, 'index.json'), JSON.stringify(index, null, 2) + '\n')

  return index
}

/** Where the bundled guides are, beside dist — or nowhere, before a build. */
export function guidesDir(): string | null {
  const dir = new URL('../guides/', import.meta.url).pathname

  return existsSync(join(dir, 'index.json')) ? dir : null
}

export function listGuides(): string {
  const dir = guidesDir()

  if (!dir) return 'No guides are bundled in this install. They are at https://docs.rsc-kit.dev.'

  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf-8')) as GuideEntry[]
  const width = Math.max(...index.map((g) => g.slug.length))

  return [
    'The guides, as published. Read one with read_guide({ slug }).',
    '',
    ...index.map((g) => `${g.slug.padEnd(width)}  ${g.description || g.title}`),
  ].join('\n')
}

export function readGuide(slug: string): string {
  const dir = guidesDir()

  if (!dir) return `No guides are bundled in this install. This one is at https://docs.rsc-kit.dev/guides/${slug}.`

  const file = join(dir, `${basename(slug)}.md`)

  if (!existsSync(file)) return `No guide called "${slug}". list_guides has the names.`

  return readFileSync(file, 'utf-8')
}

/**
 * Lines matching a phrase across every bundled guide, with the guide and a
 * little context. A grep, deliberately - the guides are 250 KB and an agent
 * asking "where is fieldErrors mentioned" wants the lines, not a ranking.
 */
export function searchGuides(phrase: string, limit = 40): string {
  const dir = guidesDir()

  if (!dir) return 'No guides are bundled in this install. Search https://docs.rsc-kit.dev instead.'

  const needle = phrase.trim().toLowerCase()

  if (!needle) return 'Give a word or phrase to search for.'

  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf-8')) as GuideEntry[]
  const hits: string[] = []

  for (const { slug } of index) {
    const lines = readFileSync(join(dir, `${slug}.md`), 'utf-8').split('\n')

    for (let i = 0; i < lines.length && hits.length < limit; i++) {
      if (!lines[i]!.toLowerCase().includes(needle)) continue

      hits.push(`${slug}:${i + 1}  ${lines[i]!.trim()}`)
    }

    if (hits.length >= limit) break
  }

  if (hits.length === 0) return `Nothing in the guides mentions "${phrase}".`

  return [
    `${hits.length}${hits.length === limit ? '+' : ''} lines mention "${phrase}". Read a guide with read_guide({ slug }).`,
    '',
    ...hits,
  ].join('\n')
}
