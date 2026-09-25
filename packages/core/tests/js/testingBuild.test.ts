// createTestApp builds with the project's own build script, on the runtime
// the tests run under. It used to run `npx vite build` whatever package.json
// said - on a Bun project that built under Node and failed at the first
// `import 'bun'`, in the one place the guide promised "your own build".
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCommand } from '../../src/testing'

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
