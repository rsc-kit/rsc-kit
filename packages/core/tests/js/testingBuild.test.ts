// createTestApp builds with the project's own build script, on the runtime
// the tests run under. It used to run `npx vite build` whatever package.json
// said - on a Bun project that built under Node and failed at the first
// `import 'bun'`, in the one place the guide promised "your own build".
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCommand, buildIsFresh } from '../../src/testing'

const project = (pkg: unknown) => {
  const root = mkdtempSync(join(tmpdir(), 'rsc-build-cmd-'))
  if (pkg !== null) writeFileSync(join(root, 'package.json'), JSON.stringify(pkg))
  return root
}

describe('the build createTestApp runs', () => {
  // These tests run under Bun, so the runtime half of the decision is Bun's.
  test('is the project\'s own build script, through the package manager of the runtime', () => {
    expect(buildCommand(project({ scripts: { build: 'bun --bun vite build' } }))).toEqual(['bun', ['run', 'build']])
  })

  test('without a script, is Vite on the runtime the tests use', () => {
    expect(buildCommand(project({ scripts: {} }))).toEqual(['bun', ['--bun', 'vite', 'build']])
    expect(buildCommand(project(null))).toEqual(['bun', ['--bun', 'vite', 'build']])
  })
})

// The harness loads the rsc service, which routes and renders; Nitro's
// static layer, which serves .output/public in production, it does not. A
// test that asked for /sw.js or /manifest.webmanifest got the router's 404
// for a file the deployment serves fine.
describe('files the build wrote', () => {
  test('are answered from .output/public, with a content type, for GET and HEAD only', async () => {
    const { staticFile } = await import('../../src/testing')
    const root = mkdtempSync(join(tmpdir(), 'rsc-static-'))
    const pub = join(root, '.output/public')
    mkdirSync(join(pub, 'assets'), { recursive: true })
    writeFileSync(join(pub, 'sw.js'), 'self.addEventListener("fetch", () => {})')
    writeFileSync(join(pub, 'manifest.webmanifest'), '{"name":"x"}')
    writeFileSync(join(pub, 'assets/app-abc.css'), 'body{}')

    const get = (path: string, method = 'GET') => staticFile(root, new Request('https://app.test' + path, { method }))

    expect(get('/sw.js')?.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8')
    expect(await get('/sw.js')?.text()).toContain('fetch')
    expect(get('/manifest.webmanifest')?.headers.get('Content-Type')).toBe('application/manifest+json')
    expect(get('/assets/app-abc.css')?.status).toBe(200)
    expect(get('/sw.js', 'HEAD')?.status).toBe(200)
    expect(await get('/sw.js', 'HEAD')?.text()).toBe('')

    // Not a file: the handler's. A directory, a page, a POST.
    expect(get('/assets')).toBeNull()
    expect(get('/orders')).toBeNull()
    expect(get('/sw.js', 'POST')).toBeNull()
    // Never outside the directory.
    expect(get('/../package.json')).toBeNull()
    expect(get('/assets/../../server/index.mjs')).toBeNull()
  })
})

describe('a build createTestApp reuses', () => {
  const built = () => {
    const root = project({})
    const old = new Date(Date.now() - 60_000)

    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/page.tsx'), '')
    utimesSync(join(root, 'src/page.tsx'), old, old)
    utimesSync(join(root, 'package.json'), old, old)

    const bundle = join(root, 'node_modules/.nitro/vite/services/rsc/index.js')

    mkdirSync(join(root, 'node_modules/.nitro/vite/services/rsc'), { recursive: true })
    writeFileSync(bundle, '')
    mkdirSync(join(root, '.output/public'), { recursive: true })

    return { root, bundle }
  }

  test('is one newer than its source, with its .output', () => {
    const { root, bundle } = built()

    expect(buildIsFresh(root, bundle)).toBe(true)
  })

  test('is rebuilt when .output is gone, though the bundle is newer than the source', () => {
    const { root, bundle } = built()

    rmSync(join(root, '.output'), { recursive: true })

    expect(buildIsFresh(root, bundle)).toBe(false)
  })

  test('is rebuilt when the source changed after it', () => {
    const { root, bundle } = built()

    writeFileSync(join(root, 'src/page.tsx'), 'changed')
    utimesSync(bundle, new Date(Date.now() - 30_000), new Date(Date.now() - 30_000))

    expect(buildIsFresh(root, bundle)).toBe(false)
  })
})
