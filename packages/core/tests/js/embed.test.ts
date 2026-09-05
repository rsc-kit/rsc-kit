/**
 * Putting the build output inside the binary.
 *
 * `bun build --compile` bundles the JavaScript it can see and nothing else, so
 * without this a compiled server starts, answers every route, and 404s every
 * stylesheet and client chunk. The page arrives unstyled and never hydrates,
 * and nothing on the server side says so.
 */

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeEmbedModule } from '../../src/embed'

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'rsc-embed-'))

  mkdirSync(join(dir, 'assets/nested'), { recursive: true })
  mkdirSync(join(dir, 'static/docs'), { recursive: true })
  writeFileSync(join(dir, 'assets/app.css'), 'body{color:red}')
  writeFileSync(join(dir, 'assets/nested/chunk.js'), 'export const a = 1')
  writeFileSync(join(dir, 'static/index.html'), '<p>home</p>')
  writeFileSync(join(dir, 'static/docs/index.html'), '<p>docs</p>')

  return dir
}

describe('the generated module', () => {
  test('imports every file, which is what embeds it', async () => {
    // A path read at runtime would not be embedded: --compile follows imports,
    // not strings. So each file has to appear as one.
    const dir = fixture()
    const out = join(dir, 'embedded.ts')

    const found = writeEmbedModule({ assets: join(dir, 'assets'), prerendered: join(dir, 'static'), out })

    expect(found).toEqual({ assets: 2, prerendered: 2 })

    const source = readFileSync(out, 'utf-8')

    expect(source).toContain("with { type: 'file' }")
    expect((source.match(/with \{ type: 'file' \}/g) ?? []).length).toBe(4)

    // Relative, never absolute. An absolute path is only true on the machine
    // that wrote it, so a build that moves — a container, CI — would compile a
    // binary whose every asset points at somewhere that does not exist.
    expect(source).not.toContain(dir)
    expect(source).toContain('from "./assets/app.css"')

    rmSync(dir, { recursive: true, force: true })
  })

  test('serves assets under their url, and pages under their name', async () => {
    const dir = fixture()
    const out = join(dir, 'embedded.ts')

    writeEmbedModule({ assets: join(dir, 'assets'), prerendered: join(dir, 'static'), out })

    const { assets, prerendered } = (await import(out)) as {
      assets: (p: string) => Promise<Response | null>
      prerendered: (n: string) => Promise<string | null>
    }

    // Nested files keep their path — a flat map would collide two chunks with
    // the same basename and serve one of them for both.
    expect(await (await assets('/assets/nested/chunk.js'))!.text()).toBe('export const a = 1')
    expect((await assets('/assets/app.css'))!.headers.get('Content-Type')).toContain('text/css')
    expect(await prerendered('docs/index.html')).toBe('<p>docs</p>')

    rmSync(dir, { recursive: true, force: true })
  })

  test('anything it does not have is a miss, not an error', async () => {
    // The host falls through to rendering when a page is not stored, so a
    // throw here would turn an ordinary miss into a 500.
    const dir = fixture()
    const out = join(dir, 'embedded.ts')

    writeEmbedModule({ assets: join(dir, 'assets'), prerendered: join(dir, 'static'), out })

    const { assets, prerendered } = (await import(out)) as {
      assets: (p: string) => Promise<Response | null>
      prerendered: (n: string) => Promise<string | null>
    }

    expect(await assets('/assets/nope.js')).toBeNull()
    expect(await prerendered('nope.html')).toBeNull()

    rmSync(dir, { recursive: true, force: true })
  })

  test('the same input writes the same module', () => {
    // Sorted, so a binary built twice from one tree is the same binary.
    const dir = fixture()
    const a = join(dir, 'a.ts')
    const b = join(dir, 'b.ts')
    const args = { assets: join(dir, 'assets'), prerendered: join(dir, 'static') }

    writeEmbedModule({ ...args, out: a })
    writeEmbedModule({ ...args, out: b })

    expect(readFileSync(a, 'utf-8')).toBe(readFileSync(b, 'utf-8'))

    rmSync(dir, { recursive: true, force: true })
  })

  test('an absent directory is empty rather than fatal', async () => {
    const dir = fixture()

    const found = writeEmbedModule({
      assets: join(dir, 'assets'),
      prerendered: join(dir, 'never-prerendered'),
      out: join(dir, 'embedded.ts'),
    })

    expect(found).toEqual({ assets: 2, prerendered: 0 })

    rmSync(dir, { recursive: true, force: true })
  })
})
