// create --pwa: an app that is installable the moment it exists.
//
// Verified by hand against Chrome's own installability check
// (Page.getInstallabilityErrors: none) and offline with the network cut. These
// pin what the scaffold writes, and that the starter icons are real images of
// the size their names claim - the build reads the size from the name.

import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STARTER_ICONS } from '../src/icons'

const CREATE = join(import.meta.dir, '../src/index.ts')

function scaffold(...flags: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'create-pwa-'))
  const run = spawnSync('bun', [CREATE, 'app', '--yes', '--host=bun', '--no-install', '--no-git', ...flags], {
    cwd: root,
    encoding: 'utf-8',
  })

  expect(run.status).toBe(0)

  return join(root, 'app')
}

/** A PNG's width, height and colour type, from its IHDR. */
function header(bytes: Uint8Array): { width: number; height: number; colour: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  return { width: view.getUint32(16), height: view.getUint32(20), colour: bytes[25]! }
}

describe('create --pwa', () => {
  test('turns on offline and writes the manifest, the offline page and the icons', () => {
    const dir = scaffold('--pwa')

    expect(readFileSync(join(dir, 'vite.config.ts'), 'utf-8')).toContain('offline: true')

    const manifest = readFileSync(join(dir, 'src/app/manifest.ts'), 'utf-8')

    expect(manifest).toContain("name: 'App'")
    // Identity that survives a startUrl change.
    expect(manifest).toContain("id: '/'")
    // Android's splash screen is white without it.
    expect(manifest).toContain('backgroundColor:')
    expect(manifest).toContain('satisfies WebManifest')

    // Static: a fallback renders with no request to render it for.
    const offline = readFileSync(join(dir, 'src/app/offline/page.tsx'), 'utf-8')

    const code = offline.split('\n').filter((line) => !line.trimStart().startsWith('//')).join('\n')

    expect(code).not.toMatch(/cookies\(|headers\(|import /)

    for (const name of Object.keys(STARTER_ICONS)) expect(existsSync(join(dir, 'src/app', name))).toBe(true)
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).toContain('## Installable')
  }, 60_000)

  test('without it, none of that - a service worker is a decision to take on purpose', () => {
    const dir = scaffold()

    expect(readFileSync(join(dir, 'vite.config.ts'), 'utf-8')).not.toContain('offline')
    expect(existsSync(join(dir, 'src/app/manifest.ts'))).toBe(false)
    expect(existsSync(join(dir, 'src/app/icon-512.png'))).toBe(false)
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).not.toContain('## Installable')
  }, 60_000)
})

describe('the starter icons', () => {
  test('are the size their names claim, since that is how the build reads them', () => {
    for (const [name, bytes] of Object.entries(STARTER_ICONS)) {
      const { width, height } = header(bytes())
      const claimed = Number(/(\d+)/.exec(name)?.[1] ?? 180)

      expect([name, width, height]).toEqual([name, claimed, claimed])
    }
  })

  test('the apple icon is 180px, the size iOS asks for', () => {
    const { width } = header(STARTER_ICONS['apple-icon.png']!())

    expect(width).toBe(180)
  })
})
