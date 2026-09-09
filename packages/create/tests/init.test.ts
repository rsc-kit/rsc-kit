/**
 * Adding rsc-kit to a project that already exists.
 *
 * Every test here is about restraint. init writes into someone's working
 * project, and the failures that matter are not crashes — they are a vite
 * config quietly replaced, a `dev` script repointed at something else, a
 * committed hot file sending every other machine to a dev server that is not
 * running there. So most of these assert what it left alone.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { detect, initialise } from '../src/init'
import type { Options } from '../src/options'

const made: string[] = []

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A directory holding the files a project of this shape would have. */
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rsc-init-'))

  made.push(dir)

  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path)

    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, contents)
  }

  return dir
}

/** What a Laravel application looks like on disk, as far as detection cares. */
const LARAVEL = {
  artisan: '#!/usr/bin/env php',
  'composer.json': '{"name":"laravel/laravel"}',
  'package.json': JSON.stringify({
    private: true,
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build' },
    devDependencies: { vite: '^7.0.4', 'laravel-vite-plugin': '^2.0.0' },
  }),
  'vite.config.js': "import laravel from 'laravel-vite-plugin'\nexport default {}",
  '.gitignore': '/vendor\n/node_modules\n',
}

const options = (dir: string, over: Partial<Options> = {}): Options => ({
  dir,
  name: 'app',
  host: 'laravel',
  compiler: 'none',
  tailwind: false,
  lint: false,
  sourceDir: 'resources/js/rsc',
  install: false,
  git: false,
  core: '^0.1.0',
  backend: 'http://my-app.test',
  ...over,
})

const run = (dir: string, over: Partial<Options> = {}) => {
  const found = detect(dir)

  return { found, steps: initialise(options(dir, { host: found.host ?? 'bun', ...over }), found, dir) }
}

const pkg = (dir: string) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))

describe('detection', () => {
  test('an application with artisan and composer.json is Laravel', () => {
    const found = detect(project(LARAVEL))

    expect(found.laravel).toBe(true)
    expect(found.host).toBe('laravel')
  })

  test('artisan alone is not, and neither is composer.json alone', () => {
    // `artisan` is a name anything could use, and a composer.json alone is any
    // PHP project. Guessing wrong here generates the wrong server entirely.
    const base = { 'package.json': '{}' }

    expect(detect(project({ ...base, artisan: '' })).laravel).toBe(false)
    expect(detect(project({ ...base, 'composer.json': '{}' })).laravel).toBe(false)
  })

  test('the route tree gets its own directory under resources/js', () => {
    // Not resources/js itself: a Laravel app already keeps app.js there, and a
    // route tree rooted at that directory would make it a page.
    expect(detect(project(LARAVEL)).sourceDir).toBe('resources/js/rsc')
  })

  test('a Laravel app that also depends on hono is still Laravel', () => {
    const found = detect(
      project({ ...LARAVEL, 'package.json': JSON.stringify({ dependencies: { hono: '^4.0.0' } }) }),
    )

    expect(found.host).toBe('laravel')
  })
})

describe('what it does not touch', () => {
  test("leaves the app's own vite config alone and writes its own", () => {
    const dir = project(LARAVEL)
    const before = readFileSync(join(dir, 'vite.config.js'), 'utf-8')

    run(dir)

    expect(readFileSync(join(dir, 'vite.config.js'), 'utf-8')).toBe(before)
    expect(existsSync(join(dir, 'vite.rsc.config.ts'))).toBe(true)
  })

  test('keeps npm run dev meaning one command, doing both', () => {
    // The asset pipeline still runs, and the renderer runs beside it. Asking
    // a Laravel developer to learn a second command for the thing they
    // already have a command for is how the one they know silently stops
    // being enough.
    const dir = project(LARAVEL)

    run(dir)

    const scripts = pkg(dir).scripts

    expect(scripts.dev).toContain('"vite"')
    expect(scripts.dev).toContain('--config vite.rsc.config.ts')
    expect(scripts.build).toBe(
      'vite build && php artisan rsc:action-manifest && vite build --config vite.rsc.config.ts',
    )
  })

  test('never touches a script somebody wrote, and says where the RSC one went', () => {
    const dir = project({
      ...LARAVEL,
      'package.json': JSON.stringify({
        scripts: { dev: 'vite --host 0.0.0.0', build: 'tsc && vite build' },
      }),
    })

    const { steps } = run(dir)
    const scripts = pkg(dir).scripts

    expect(scripts.dev).toBe('vite --host 0.0.0.0')
    expect(scripts.build).toBe('tsc && vite build')
    expect(scripts['rsc:dev']).toContain('--config vite.rsc.config.ts')
    expect(steps.some((s) => s.kind === 'manual' && s.detail?.includes('rsc:dev'))).toBe(true)
  })

  test('declares concurrently when it generated a command that needs it', () => {
    const dir = project({
      ...LARAVEL,
      'package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: {} }),
    })

    run(dir)

    expect(pkg(dir).devDependencies.concurrently).toBeDefined()
  })

  test('leaves the concurrently already there at the version it is', () => {
    // Laravel ships it for `composer run dev`, so this is the usual case.
    const dir = project({
      ...LARAVEL,
      'package.json': JSON.stringify({
        scripts: { dev: 'vite' },
        devDependencies: { concurrently: '^9.0.1' },
      }),
    })

    run(dir)

    expect(pkg(dir).devDependencies.concurrently).toBe('^9.0.1')
  })

  test('does not rewrite a route tree that is already there', () => {
    const dir = project({ ...LARAVEL, 'resources/js/rsc/app/page.tsx': 'export default () => null' })

    const { steps } = run(dir)

    expect(readFileSync(join(dir, 'resources/js/rsc/app/page.tsx'), 'utf-8')).toBe(
      'export default () => null',
    )
    expect(steps.some((s) => s.kind === 'skipped' && s.what.includes('app'))).toBe(true)
  })

  test('running twice changes nothing the first run wrote', () => {
    const dir = project(LARAVEL)

    run(dir)

    const after = readFileSync(join(dir, 'vite.rsc.config.ts'), 'utf-8')
    const ignore = readFileSync(join(dir, '.gitignore'), 'utf-8')

    run(dir)

    expect(readFileSync(join(dir, 'vite.rsc.config.ts'), 'utf-8')).toBe(after)
    expect(readFileSync(join(dir, '.gitignore'), 'utf-8')).toBe(ignore)
  })
})

describe('versions', () => {
  test('reports a dependency too old to build with, rather than upgrading it', () => {
    // Every Laravel application ships a Vite, and none of them ship the one
    // the engine needs. Left silently, the install ends in a build failing on
    // a plugin API that does not exist yet — an error naming neither Vite nor
    // this package.
    const { steps } = run(project(LARAVEL))

    const reported = steps.find((s) => s.kind === 'manual' && s.what.includes('cannot build'))

    expect(reported?.detail).toContain('vite ^7.0.4')
    expect(pkg(project(LARAVEL)).devDependencies.vite).toBe('^7.0.4')
  })

  test('says nothing about a version that is new enough', () => {
    const dir = project({
      ...LARAVEL,
      'package.json': JSON.stringify({ devDependencies: { vite: '^8.2.0' } }),
    })

    const { steps } = run(dir)

    expect(steps.some((s) => s.what.includes('cannot build'))).toBe(false)
  })

  test('leaves a spec it cannot read a version out of', () => {
    // file:, workspace:*, a git url — all mean someone decided deliberately.
    const dir = project({
      ...LARAVEL,
      'package.json': JSON.stringify({ devDependencies: { vite: 'workspace:*' } }),
    })

    const { steps } = run(dir)

    expect(steps.some((s) => s.what.includes('cannot build'))).toBe(false)
    expect(pkg(dir).devDependencies.vite).toBe('workspace:*')
  })
})

describe('the files the build writes', () => {
  test('ignores the hot file, which is the worst one to commit', () => {
    // It names a dev server on the machine that wrote it. Committed, every
    // other machine follows it to a port with nothing listening.
    const dir = project(LARAVEL)

    run(dir)

    const ignored = readFileSync(join(dir, '.gitignore'), 'utf-8')

    expect(ignored).toContain('public/rsc-hot')
    expect(ignored).toContain('bootstrap/rsc/vite')
    expect(ignored).toContain('.rsc-kit/')
  })

  test('writes a tsconfig where there is none, and never over one', () => {
    const dir = project(LARAVEL)

    run(dir)

    expect(JSON.parse(readFileSync(join(dir, 'tsconfig.json'), 'utf-8')).include).toContain(
      'resources/js/rsc/**/*',
    )

    writeFileSync(join(dir, 'tsconfig.json'), '{"mine":true}')
    run(dir)

    expect(readFileSync(join(dir, 'tsconfig.json'), 'utf-8')).toBe('{"mine":true}')
  })

  test('says what an existing tsconfig is missing, rather than rewriting it', () => {
    const dir = project(LARAVEL)

    // With a comment in it, which is legal here and which reprinting the file
    // would eat — the reason this is reported rather than merged.
    writeFileSync(join(dir, 'tsconfig.json'), '{\n  // mine\n  "include": ["src/**/*"]\n}\n')

    const step = run(dir).steps.find((s) => s.what === 'tsconfig.json')

    expect(step?.kind).toBe('manual')
    expect(step?.detail).toContain('.rsc-kit/**/*')
    expect(readFileSync(join(dir, 'tsconfig.json'), 'utf-8')).toContain('// mine')
  })

  test('and says nothing when it already covers them', () => {
    const dir = project(LARAVEL)

    writeFileSync(join(dir, 'tsconfig.json'), '{"include":["src/**/*",".rsc-kit/**/*"]}')

    expect(run(dir).steps.find((s) => s.what === 'tsconfig.json')?.kind).toBe('skipped')
  })
})
