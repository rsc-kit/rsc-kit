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
  /**
   * Text the Boost skill in rsc-kit/laravel must contain - the same needle its
   * BoostSkillTest holds. Null only with a `why`: a fact Laravel apps never meet.
   */
  boost: string | null
  why?: string
}

const FACTS: Fact[] = [
  { fact: 'refuse(message, data) declines on purpose, with data the page acts on', recipe: /refuse\(message, data\)/, guide: /refuse\(/, boost: 'Rsc::refuse(' },
  { fact: 'a backend refusal with a status keeps its message, and an abort() without one says "Refused."', recipe: /Refused\./, guide: /Refused\./, boost: 'Refused.' },
  { fact: 'formRefusal is typed from the form\'s action, with no cast', recipe: /formRefusal, typed from the form's/, guide: /formRefusal/, boost: 'formRefusal' },
  { fact: 'a redirected call to a backend action resolves { redirected }; narrow it with isRedirected', recipe: /isRedirected/, guide: /isRedirected/, boost: 'isRedirected' },
  { fact: 'a page never answers an image, script, stylesheet or font request', recipe: /Sec-Fetch-Dest/, guide: /Sec-Fetch-Dest/, boost: 'Sec-Fetch-Dest' },
  { fact: 'app.markup(path) is the page without its scripts, for asserting on what is shown', recipe: /markup\(/, guide: /markup\(/, boost: 'app.markup(path)' },
  { fact: 'a notFound() decided after the shell shows not-found.tsx where the page was, and error.tsx never sees it', recipe: /where the page was/, guide: /where the page was/, boost: 'where the page was' },
  { fact: 'through a generated stub a backend refusal reaches the form as its message, and its data does not', recipe: /Through a generated stub/, guide: /Through a generated stub/, boost: 'Through a generated stub' },
  { fact: 'a not-found.tsx beside a layout answers notFound() from the pages under it, inside that layout; the nearest wins', recipe: /nearest one above the page wins/, guide: /nearest one above the page that said so wins/, boost: 'the nearest one above the page wins' },
  { fact: 'a stub awaited directly rejects with ActionRefusedError when the backend refuses it', recipe: /ActionRefusedError/, guide: /ActionRefusedError/, boost: 'ActionRefusedError' },
  { fact: 'a stub whose input was refused rejects with ServerValidationError; only a redirect resolves', recipe: /ServerValidationError \(@rsc-kit\/core\/errors/, guide: /ServerValidationError. with `\.fieldErrors`/, boost: 'ServerValidationError' },
  { fact: 'a server-only engine module in the browser bundle fails the build, and your own server files use import \'server-only\'', recipe: /ended up in the\s+browser bundle/, guide: /A server module in the browser bundle/, boost: 'ended up in the browser bundle' },
  { fact: 'error() and clearErrors() are typed from the action\'s input, so a typo fails tsc', recipe: /TYPED from the action's input/, guide: /### Field names|\[Field names\]/, boost: 'FieldNamesOf' },
  { fact: 'a wrapper around a stub declares its form fields with FormFields<N> on its parameter', recipe: /FormFields<'id' \| 'name'>/, guide: /FormFields<'id' \| 'name'>/, boost: 'FormFields' },
  { fact: 'a team-scoped stub is a form action as stub.bind(null, team), bound into a const; a form that posts nothing names fields with the fields prop', recipe: /stub\.bind\(null, team\)[\s\S]*fields=\{\['size'\]\}/, guide: /Bind into a `const` first/, boost: 'bind(null, team)' },
  { fact: 'a change made straight in the database says nothing to open tabs; the writer calls changed(), or a trigger moves the version row', recipe: /A DIRECT DATABASE EDIT/, guide: /A change made straight in the database/, boost: 'straight in the database' },
  { fact: 'backendPaths forwards a backend prefix before any page is matched, so a dynamic root route cannot shadow it', recipe: /backendPaths: \['\/auth'/, guide: /backendPaths: \['\/auth'/, boost: 'backendPaths' },
  { fact: 'a page\'s own share image is an opengraph-image file in its folder (nearest wins), and an exported openGraph.images replaces the site\'s instead of following it', recipe: /A page's OWN share image is a file beside it/, guide: /### A page's own share image/, boost: 'opengraph-image' },
  { fact: 'a file in src/commands is a release step or a worker, run as ./app <name> or node .output/server/commands.mjs <name>; its return value is the exit code, and instrumentation.ts\'s register() runs only for one that exports register = true', recipe: /export const register = true/, guide: /export const register = true/, boost: 'src/commands' },
  { fact: 'a section beside a layout is refreshed by name from any page under that layout, so what every tab shares (a header, a status) lives in the layout and does not go away between tabs; a page\'s own section of a name shadows its layout\'s', recipe: /A LAYOUT'S REGION/, guide: /beside each of its layouts/, boost: 'beside its layouts' },
  { fact: 'a section is exported by a name (const Repos = section(...); export default Repos), because an editor offers an import by the name a default export has and a call has none', recipe: /offered as reposSection/, guide: /OrdersSection/, boost: 'export default Repos' },
  { fact: 'a command\'s second argument is the context { signal, deadline }, typed CommandContext from @rsc-kit/core/commands (defineCommand types a command); deadline is a getter, so it is read as context.deadline and never destructured, and signal can already be aborted when the command starts, so signal.aborted is checked before waiting on abort', recipe: /do NOT destructure it/, guide: /Do not destructure deadline/, boost: null, why: 'a Laravel app\'s workers and release steps are artisan\'s; the skill describes src/commands only as the renderer\'s own occasional work and does not teach the worker API' },
  { fact: 'a stop before the first line of a compiled binary is the default action (143), and Bun parses the whole binary first, so a binary that runs workers is compiled with --splitting', recipe: /--splitting/, guide: /--splitting/, boost: null, why: 'only a worker run from a compiled binary meets it, and a Laravel app drains its queue with artisan, so the skill does not teach compiling workers' },
  { fact: 'a stop reaches a command before it starts (the signal is already aborted and its event has fired) or after (the event fires while it runs), so a command that waits checks signal.aborted as it starts AND listens for abort', recipe: /needs BOTH/, guide: /needs both/, boost: null, why: 'a Laravel app\'s workers are artisan\'s; the skill does not teach the worker API' },
  { fact: '--sourcemap with --compile writes .map files beside the binary (one per chunk with --splitting), which the binary does not read, so only dist/app is shipped', recipe: /rm -f dist\/\*\.map/, guide: /rm -f dist\/\*\.map/, boost: null, why: 'only a compiled binary meets it, and a Laravel app\'s renderer is not usually shipped as one, so the skill does not teach compiling' },
  { fact: 'a GET <Form> whose action is the page on screen keeps that page and its old results up while the query runs, with pending true until the new results land (no shell, no skeleton); a Link or visit() to the same path is still a page of its own', recipe: /A SEARCH ON THE PAGE IT IS ON/, guide: /### A search on the page it is on/, boost: 'search on the page it is on' },
  { fact: 'a query takes its schema\'s input, and cannot redirect', recipe: /a query cannot redirect/, guide: /A query cannot redirect/, boost: 'It cannot redirect' },
  { fact: 'a crawler is answered once the page has finished, so it gets the real 404', recipe: /crawler/, guide: /crawler/i, boost: 'crawler' },
  { fact: 'type-aware lint rules catch a Redirected read as text', recipe: /restrict-template-expressions/, guide: /restrict-template-expressions/, boost: 'restrict-template-expressions' },
  { fact: 'a client component is tested by mounting it, with the DOM registered by the file\'s first import', recipe: /import '\.\/dom'/, guide: /import '\.\/dom'/, boost: 'import \'./dom\'' },
  { fact: 'createTestApp refuses to run while a DOM is registered globally', recipe: /createTestApp then refuses|refuses to run/, guide: /refuses to run while a DOM/, boost: '`createTestApp` refuses to run' },
  { fact: 'a url named in backendPaths is a document load in the browser, never a page: a Link, visit() or redirect() to it loads the document and is never prefetched, so the backend route may bounce on to another site; unnamed, the router fetches it as a payload and the bounce fails with nothing happening; a redirect to another site works as written, and the url that redirected is replaced in history', recipe: /A named prefix is also a DOCUMENT LOAD/, guide: /## Leaving the app/, boost: 'never a page in the browser' },
  { fact: 'a prefix named in backendPaths is typed as a Route (RegisterBackend in the generated rsc-routes.d.ts), so a Link or redirect() to it needs no cast; the prefix is a segment boundary, so /gitlabs is still refused', recipe: /no `as Route`/, guide: /## The backend's urls/, boost: 'needs no cast' },
]

describe('what agents are told', () => {
  for (const { fact, recipe, guide } of FACTS) {
    test(fact, () => {
      expect(recipes, `how_to does not say it: ${recipe}`).toMatch(recipe)
      expect(guides, `no guide says it: ${guide}`).toMatch(guide)
    })
  }
})

describe('Boost is decided for every fact', () => {
  test('each one names what the Boost skill says, or says why Laravel apps never meet it', () => {
    for (const { fact, boost, why } of FACTS) {
      expect(boost !== null || (why ?? '').length > 10, `FACTS needs a boost needle, or a why: ${fact}`).toBe(true)
    }
  })

  // The skill lives in rsc-kit/laravel, and describes a feature only once it is
  // released, so this cannot run in CI between a merge and a release. Run it
  // when the Boost PR has merged:
  //
  //   RSC_BOOST=~/Herd/lara-bun/resources/boost/skills/laravel-rsc-development/SKILL.md bun test coverage
  const skill = process.env.RSC_BOOST
  const checkSkill = skill ? test : test.skip

  checkSkill('and the skill at RSC_BOOST says all of it', () => {
    const text = readFileSync(skill!.replace(/^~/, process.env.HOME ?? '~'), 'utf-8').replace(/\s+/g, ' ')

    for (const { fact, boost } of FACTS) {
      if (boost !== null) expect(text, `the Boost skill does not say it: ${fact}`).toContain(boost)
    }
  })
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
