// The file that makes an app installable.
//
// Most of what can go wrong here is silent: a manifest with no icon is valid,
// links correctly, sets the theme colour, and never once produces an install
// prompt. So the assertions are as much about what the build SAYS as what it
// writes.

import { describe, expect, test } from 'bun:test'
import { manifestWarning, sizeOf, webManifest } from '../../src/webManifest'

const base = { name: 'Orders', icons: ['icon-192.png', 'icon-512.png'] }

describe('what gets written', () => {
  test('is the spec\'s names, not ours', () => {
    const json = JSON.parse(webManifest({ ...base, shortName: 'Ord', themeColor: '#0b0b0c' }))

    expect(json.short_name).toBe('Ord')
    expect(json.theme_color).toBe('#0b0b0c')
    expect(json.start_url).toBe('/')
    expect(json.display).toBe('standalone')
  })

  test('short_name falls back to the name rather than being absent', () => {
    // A home screen needs one. Omitting it means the browser picks, and what
    // it picks is the full name truncated wherever it happens to end.
    expect(JSON.parse(webManifest(base)).short_name).toBe('Orders')
  })

  test('icon sizes come from the filename, so they cannot disagree', () => {
    const [first] = JSON.parse(webManifest(base)).icons

    expect(first).toEqual({
      src: '/icon-192.png',
      type: 'image/png',
      sizes: '192x192',
      purpose: 'any maskable',
    })
  })

  test('maskable as well as any', () => {
    // Without it Android crops a square icon into a circle and takes the
    // corners off whatever was in them.
    for (const icon of JSON.parse(webManifest(base)).icons) {
      expect(icon.purpose).toContain('maskable')
    }
  })

  test('an svg icon keeps its own media type', () => {
    expect(JSON.parse(webManifest({ ...base, icons: ['icon.svg'] })).icons[0].type).toBe(
      'image/svg+xml',
    )
  })

  test('anything the spec allows can be passed through', () => {
    const json = JSON.parse(webManifest({ ...base, other: { categories: ['business'] } }))

    expect(json.categories).toEqual(['business'])
  })
})

describe('reading a size out of a filename', () => {
  test('both spellings', () => {
    expect(sizeOf('icon-192.png')).toBe(192)
    expect(sizeOf('icon-192x192.png')).toBe(192)
  })

  test('and nothing when there is nothing to read', () => {
    expect(sizeOf('logo.png')).toBeNull()
  })
})

describe('what the build says about it', () => {
  test('nothing, when the icons are the ones a browser wants', () => {
    expect(manifestWarning(base)).toBeNull()
  })

  test('no icons at all is the one worth saying loudly', () => {
    // This is the silent failure: everything is valid and nothing ever offers
    // to install. Someone who wrote `manifest: {…}` meant installable.
    expect(manifestWarning({ name: 'Orders' })).toContain('no browser will offer to install')
  })

  test('too small is named with the fix, since the size comes from the name', () => {
    const said = manifestWarning({ name: 'Orders', icons: ['icon-64.png'] })

    expect(said).toContain('192px')
    expect(said).toContain('icon-192.png')
  })

  test('and a missing 512 is worth a word without being a problem', () => {
    expect(manifestWarning({ name: 'Orders', icons: ['icon-192.png'] })).toContain('splash')
  })
})

describe('reading a manifest declared beside the routes', () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = require('node:fs')
  const { join } = require('node:path')
  const { tmpdir } = require('node:os')

  const appWith = (contents: string, name = 'manifest.ts') => {
    const dir = join(mkdtempSync(join(tmpdir(), 'mf-')), 'app')

    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name), contents)

    return dir
  }

  test('a plain object literal', async () => {
    const { declaredManifest } = await import('../../src/vite')
    const dir = appWith(`export default { name: 'Orders', icons: ['icon-192.png'] }`)

    expect(declaredManifest(dir)).toEqual({ name: 'Orders', icons: ['icon-192.png'] })
  })

  test('one written with satisfies, which is how it will actually be written', async () => {
    // Getting this wrong would refuse the spelling the documentation
    // recommends, which is the worst kind of parser to ship.
    const { declaredManifest } = await import('../../src/vite')
    const dir = appWith(
      `import type { WebManifest } from '@rsc-kit/core/manifest-file'\n` +
        `export default {\n  name: 'Orders', // a comment\n  icons: ['icon-192.png'],\n} satisfies WebManifest\n`,
    )

    expect(declaredManifest(dir)).toEqual({ name: 'Orders', icons: ['icon-192.png'] })
  })

  test('nothing, when the app declared none', async () => {
    const { declaredManifest } = await import('../../src/vite')

    expect(declaredManifest(appWith('', 'page.tsx'))).toBeNull()
  })

  test('and a computed one is refused out loud', async () => {
    // Read before there is a module graph to evaluate it in. Silently ignoring
    // it would leave an app that is simply not installable with nothing said.
    const { declaredManifest } = await import('../../src/vite')
    const dir = appWith(`import { name } from './config'\nexport default buildIt(name)\n`)

    expect(() => declaredManifest(dir)).toThrow('object literal')
  })
})
