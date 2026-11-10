import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unloadedShadcnCss } from '../src/shadcn'

const made: string[] = []

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rsc-shadcn-'))

  made.push(dir)

  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), contents)
  }

  return dir
}

const components = (css: string) => JSON.stringify({ tailwind: { css } })
const STYLES = 'resources/js/app/styles.css'

describe("the stylesheet components.json names", () => {
  test('named but never loaded: Laravel\'s app.css beside a styles.css that does not import it', () => {
    const dir = project({
      'components.json': components('resources/css/app.css'),
      'resources/css/app.css': "@import 'tailwindcss';\n.dark {}\n",
      [STYLES]: "@import 'tailwindcss';\n@source '../';\n",
    })

    expect(unloadedShadcnCss(dir, STYLES)).toBe('resources/css/app.css')
  })

  test('loaded: the app stylesheet itself, or one it imports', () => {
    expect(unloadedShadcnCss(project({ 'components.json': components(STYLES), [STYLES]: '' }), STYLES)).toBeNull()

    const imported = project({
      'components.json': components('resources/css/app.css'),
      'resources/css/app.css': "@import 'tailwindcss';\n",
      [STYLES]: "@import '../../css/app.css';\n@source '../';\n",
    })

    expect(unloadedShadcnCss(imported, STYLES)).toBeNull()
  })

  test('nothing to say without a components.json or a css path', () => {
    expect(unloadedShadcnCss(project({ [STYLES]: '' }), STYLES)).toBeNull()
    expect(unloadedShadcnCss(project({ 'components.json': '{"tailwind":{}}' }), STYLES)).toBeNull()
  })
})
