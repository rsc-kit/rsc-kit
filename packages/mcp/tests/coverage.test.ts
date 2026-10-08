// Whether what we publish for agents still says what the framework does.
//
// The recipes are hand-written copies of the guides, and a copy is only as
// current as the last person who remembered. This is the memory: every
// behaviour an app author can observe or has to act on is a line in FACTS, with
// the text that proves the recipe and the guide each say it. Add a line in the
// same PR as the change - CLAUDE.md, "What Agents Are Told Is Part of the
// Change". The Boost skill (rsc-kit/laravel) keeps the same list for its side
// in tests/Unit/BoostSkillTest.php.

import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { TOPICS, howTo } from '../src/recipes'

const REPO = join(import.meta.dir, '../../..')
const DOCS = join(REPO, 'docs/src/content/docs')

function read(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .map((entry) =>
      entry.isDirectory()
        ? read(join(dir, entry.name))
        : /\.mdx?$/.test(entry.name)
          ? readFileSync(join(dir, entry.name), 'utf-8')
          : '',
    )
    .join('\n')
}

const recipes = TOPICS.map((topic) => howTo(topic)).join('\n')
const guides = read(DOCS)

interface Fact {
  /** What an agent must be told, as a person would say it. */
  fact: string
  /** Text the recipes must contain. */
  recipe: RegExp
  /** Text the guides must contain. */
  guide: RegExp
}

const FACTS: Fact[] = [
  { fact: 'refuse(message, data) declines on purpose, with data the page acts on', recipe: /refuse\(message, data\)/, guide: /refuse\(/ },
  { fact: 'a backend refusal with a status keeps its message, and an abort() without one says "Refused."', recipe: /Refused\./, guide: /Refused\./ },
  { fact: 'formRefusal is typed from the form\'s action, with no cast', recipe: /formRefusal, typed from the form's/, guide: /formRefusal/ },
  { fact: 'a redirected call to a backend action resolves { redirected }; narrow it with isRedirected', recipe: /isRedirected/, guide: /isRedirected/ },
  { fact: 'a page never answers an image, script, stylesheet or font request', recipe: /Sec-Fetch-Dest/, guide: /Sec-Fetch-Dest/ },
  { fact: 'app.markup(path) is the page without its scripts, for asserting on what is shown', recipe: /markup\(/, guide: /markup\(/ },
  { fact: 'a notFound() decided after the shell shows not-found.tsx where the page was, and error.tsx never sees it', recipe: /where the page was/, guide: /where the page was/ },
  { fact: 'through a generated stub a backend refusal reaches the form as its message, and its data does not', recipe: /Through a generated stub/, guide: /Through a generated stub/ },
  { fact: 'a not-found.tsx beside a layout answers notFound() from the pages under it, inside that layout; the nearest wins', recipe: /nearest one above the page wins/, guide: /nearest one above the page that said so wins/ },
  { fact: 'a crawler is answered once the page has finished, so it gets the real 404', recipe: /crawler/, guide: /crawler/i },
  { fact: 'type-aware lint rules catch a Redirected read as text', recipe: /restrict-template-expressions/, guide: /restrict-template-expressions/ },
  { fact: 'a client component is tested by mounting it, with the DOM registered by the file\'s first import', recipe: /import '\.\/dom'/, guide: /import '\.\/dom'/ },
  { fact: 'createTestApp refuses to run while a DOM is registered globally', recipe: /createTestApp then refuses|refuses to run/, guide: /refuses to run while a DOM/ },
]

describe('what agents are told', () => {
  for (const { fact, recipe, guide } of FACTS) {
    test(fact, () => {
      expect(recipes, `how_to does not say it: ${recipe}`).toMatch(recipe)
      expect(guides, `no guide says it: ${guide}`).toMatch(guide)
    })
  }
})

describe('every public entry point is written down somewhere', () => {
  const exported = Object.keys(
    (JSON.parse(readFileSync(join(REPO, 'packages/core/package.json'), 'utf-8')) as { exports: Record<string, unknown> }).exports,
  ).filter((key) => key !== '.' && !key.endsWith('package.json'))

  // Entry points no recipe or guide names today. A ratchet: it can only get
  // shorter. A new entry point must be named in a guide or a recipe, or be
  // added here with a reason it is plumbing - and naming one of these removes
  // it, which the second test insists on.
  const PLUMBING = new Set([
    './build', './runtime', './client', './host-calls', './routing', './headers', './export', './files',
    './RedirectBoundary', './conformance', './typegen', './embed', './form-encoding', './useField', './openapi',
  ])

  const named = (key: string) => {
    const name = `@rsc-kit/core/${key.slice(2)}`

    return recipes.includes(name) || guides.includes(name)
  }

  test('a new one is named in a guide or a recipe', () => {
    const unnamed = exported.filter((key) => !named(key) && !PLUMBING.has(key))

    expect(unnamed, 'name these in a guide or a recipe, or list them as plumbing here').toEqual([])
  })

  test('and one that has been named leaves the list', () => {
    const stale = [...PLUMBING].filter((key) => named(key))

    expect(stale, 'now documented: remove from PLUMBING').toEqual([])
  })
})
