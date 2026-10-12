// Share images, per route.
//
// An opengraph-image.png in app/ is the site's card. A page that has its own
// says so by putting one beside it, or by exporting one, and the nearer one
// replaces the site's rather than following it - a scraper reads the first
// og:image it finds, so a second tag after the site's is a card that never
// changes however many pages declare one.

import { beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { allAppAssets, appAssets, assetFile } from '../../src/appAssets'
import { createRscHandler } from '../../src/host'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('shareImages.test.ts')

let handle: (request: Request) => Promise<Response | null>

beforeAll(async () => {
  const { buildFixtureOnce, bundlePath } = await import('./goHost')

  await buildFixtureOnce()

  const engine: any = await import(bundlePath)

  handle = createRscHandler({
    engine: { ...engine, manifest: engine.manifest },
    manifest: engine.manifest(),
  } as never) as never
}, 300_000)

async function head(path: string) {
  const html = await (await handle(new Request('https://app.test' + path)))!.text()
  const content = (attr: string, name: string) =>
    [...html.matchAll(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`, 'g'))].map((m) => m[1])

  return {
    html,
    og: content('property', 'og:image'),
    twitter: content('name', 'twitter:image'),
    card: content('name', 'twitter:card'),
  }
}

describe('the site\'s image', () => {
  test('a page with nothing of its own gets the one in app/', async () => {
    const page = await head('/nested/')

    expect(page.og).toEqual(['https://fixture.test/_app/opengraph-image.png'])
  })

  test('an openGraph that names no image leaves the image to the file', async () => {
    const page = await head('/titled')

    expect(page.og).toEqual(['https://fixture.test/_app/opengraph-image.png'])
  })
})

describe('a file in the page\'s own folder', () => {
  test('replaces the site\'s, in a route group the url never shows', async () => {
    const page = await head('/promo')

    expect(page.og).toEqual(['https://fixture.test/_app/(marketing)/promo/opengraph-image.png'])
  })

  test('under a dynamic folder, for every page the folder answers', async () => {
    const page = await head('/painting-supplies')

    expect(page.og).toEqual(['https://fixture.test/_app/%5Bcollection%5D/opengraph-image.png'])
  })

  test('each kind is its own: a twitter image does not replace the og one', async () => {
    const page = await head('/nested/')

    expect(page.twitter).toEqual(['https://fixture.test/_app/nested/twitter-image.png'])
    expect(page.og).toEqual(['https://fixture.test/_app/opengraph-image.png'])
    expect(page.card).toEqual(['summary_large_image'])
  })

  test('the nearest folder wins, not the first found', async () => {
    const page = await head('/trail/deeper')

    expect(page.og).toEqual(['https://fixture.test/_app/trail/deeper/opengraph-image.png'])
  })
})

describe('an image the page exports', () => {
  test('replaces the site\'s instead of following it', async () => {
    const page = await head('/share')

    expect(page.og).toEqual(['https://fixture.test/card.png'])
    expect(page.twitter).toEqual(['https://fixture.test/card.png'])
  })

  test('says what card it is once, however many places imply one', async () => {
    const page = await head('/share')

    expect(page.card).toEqual(['summary_large_image'])
  })

  test('a layout\'s beats the site\'s, which is further away', async () => {
    const page = await head('/trail')

    expect(page.og).toEqual(['https://fixture.test/layout-card.png'])
  })

  test('and a file in a folder beneath the layout beats the layout\'s', async () => {
    const page = await head('/trail/deeper')

    expect(page.og).not.toContain('https://fixture.test/layout-card.png')
  })

  test('against a file in the same folder, the file wins, as it does in Next', async () => {
    const page = await head('/tied')

    expect(page.og).toEqual(['https://fixture.test/_app/tied/opengraph-image.png'])
  })
})

describe('what the build copies and the dev server answers', () => {
  // Both read the same list: the file under app/, and the href it is served at.
  // A nested image is the case where the two could part - the folder is in the
  // file's path and in the url, and a flat name would let one folder's image
  // overwrite another's.
  test('every image is at a url that keeps its folder, from a file that exists', async () => {
    const { appDir } = await import('./goHost')
    const found = allAppAssets(appAssets(join(appDir, 'app')))
    const hrefs = found.map((asset) => asset.href)

    for (const href of [
      '/_app/opengraph-image.png',
      '/_app/(marketing)/promo/opengraph-image.png',
      '/_app/%5Bcollection%5D/opengraph-image.png',
      '/_app/trail/deeper/opengraph-image.png',
      '/_app/nested/twitter-image.png',
    ]) {
      expect(hrefs).toContain(href)
    }

    for (const asset of found) {
      expect(existsSync(join(appDir, 'app', asset.file))).toBe(true)
      // And back: the build writes, and the dev server reads, the file the url names.
      expect(assetFile(asset.href)).toBe('/_app/' + asset.file)
    }

    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})
