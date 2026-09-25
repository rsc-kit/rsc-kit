// The share card, rendered.
//
// Two of these were bugs for as long as the feature existed: og: tags went out
// as name= (which Facebook, Slack and LinkedIn all ignore), and icons in
// metadata rendered as <meta name="icons" content="[object Object]">. Neither
// showed in a browser, because a browser does not read either.

import { beforeAll, describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('shareMetadata.test.ts')

let html: string

beforeAll(async () => {
  const { buildFixtureOnce, bundlePath } = await import('./goHost')

  await buildFixtureOnce()

  const engine: any = await import(bundlePath)
  const handle = createRscHandler({
    engine: { ...engine, manifest: engine.manifest },
    manifest: engine.manifest(),
  } as never)

  html = await (await handle(new Request('https://app.test/share')))!.text()
}, 300_000)

const tags = (attr: string, prefix: string) =>
  [...html.matchAll(new RegExp(`<meta ${attr}="(${prefix}[^"]*)" content="([^"]*)"`, 'g'))].map(
    (m) => [m[1], m[2]],
  )

describe('opengraph', () => {
  test('goes out as property=, which is what the scrapers read', () => {
    expect(tags('property', 'og:')).toContainEqual(['og:title', 'A page worth sharing'])
    // And never as name=. That was the bug.
    expect(tags('name', 'og:')).toEqual([])
  })

  test('a relative url is made absolute with metadataBase', () => {
    expect(tags('property', 'og:url')).toContainEqual(['og:url', 'https://fixture.test/share'])
    expect(tags('property', 'og:image')).toContainEqual(['og:image', 'https://fixture.test/card.png'])
  })

  test('an image object brings its size and alt', () => {
    const og = tags('property', 'og:image')

    expect(og).toContainEqual(['og:image:width', '1200'])
    expect(og).toContainEqual(['og:image:height', '630'])
    expect(og).toContainEqual(['og:image:alt', 'The card'])
  })

  test('the old flat spelling still renders, correctly', () => {
    expect(tags('property', 'og:type')).toContainEqual(['og:type', 'article'])
  })
})

describe('twitter', () => {
  test('goes out as name=, which is what X reads', () => {
    expect(tags('name', 'twitter:')).toContainEqual(['twitter:card', 'summary_large_image'])
    expect(tags('name', 'twitter:image')).toContainEqual(['twitter:image', 'https://fixture.test/card.png'])
  })
})

describe('icons', () => {
  test('are links, not meta', () => {
    expect(html).toContain('<link rel="icon" href="https://fixture.test/icon.svg"')
    expect(html).toContain('rel="apple-touch-icon" href="https://fixture.test/apple.png"')
    expect(html).toContain('sizes="180x180"')
    expect(html).not.toContain('[object Object]')
  })
})

describe('other', () => {
  test('a property-shaped key is property, a plain one is name', () => {
    expect(tags('property', 'fb:')).toContainEqual(['fb:app_id', '123'])
    expect(tags('name', 'theme-color')).toContainEqual(['theme-color', '#000'])
  })
})

describe('robots', () => {
  test('the object Next takes renders as the words a crawler reads', () => {
    // { index: false, follow: false, 'max-snippet': -1 }: the no- forms, then
    // the limit as name:value. It used to fall through the catch-all as
    // "[object Object]" - on the one page that asked not to be indexed.
    expect(html).toContain('<meta name="robots" content="noindex, nofollow, max-snippet:-1"')
    expect(html).not.toContain('[object Object]')
  })

  test('googleBot is its own tag, in the same words', () => {
    expect(html).toContain('<meta name="googlebot" content="noindex, noimageindex"')
    expect(html).not.toContain('name="googleBot"')
  })
})

describe('a Next app\'s metadata, verbatim', () => {
  let page: string

  beforeAll(async () => {
    const { bundlePath } = await import('./goHost')
    const engine: any = await import(bundlePath)
    const handle = createRscHandler({
      engine: { ...engine, manifest: engine.manifest },
      manifest: engine.manifest(),
    } as never)

    page = await (await handle(new Request('https://app.test/branded')))!.text()
  })

  const read = (attr: string, key: string) =>
    new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`).exec(page)?.[1]

  test('renders every field it declares, with the right attribute for each', () => {
    // The whole object, copied from the app being ported. Nothing renamed.
    expect(page).toContain('<title>Example — a page with a full share card')
    expect(read('name', 'description')).toContain('Bring damaged family photos')

    expect(read('property', 'og:title')).toBe('Example — the same title, for a share card')
    expect(read('property', 'og:description')).toContain('Private, print-ready, yours forever.')
    expect(read('property', 'og:type')).toBe('website')

    expect(read('name', 'twitter:card')).toBe('summary_large_image')
    expect(read('name', 'twitter:title')).toBe('Example — the same title, for a share card')
    expect(read('name', 'twitter:description')).toBe('Repair damaged family photos and restore them in color.')
  })

  test('appleWebApp, in Next\'s shape, becomes the tags Safari reads', () => {
    // Both capable names: Safari reads the apple- one, Chrome warns about it
    // and reads the plain one.
    expect(read('name', 'mobile-web-app-capable')).toBe('yes')
    expect(read('name', 'apple-mobile-web-app-capable')).toBe('yes')
    expect(read('name', 'apple-mobile-web-app-title')).toBe('Example')
    expect(read('name', 'apple-mobile-web-app-status-bar-style')).toBe('black-translucent')

    // A bare url is one launch screen for every device; an object carries
    // its media query. Both made absolute against metadataBase.
    expect(page).toMatch(/<link rel="apple-touch-startup-image" href="https:\/\/example\.com\/splash\.png"\/?>/)
    expect(page).toContain('href="https://example.com/splash-1179x2556.png" media="(device-width: 393px) and (-webkit-device-pixel-ratio: 3)"')
    // And no stray <meta name="appleWebApp" content="[object Object]">.
    expect(page).not.toContain('name="appleWebApp"')
  })

  test('and metadataBase reaches the image found in app/', () => {
    // The page declares no image; the fixture has an opengraph-image.png in
    // app/ that the build found. metadataBase is what makes it absolute.
    const image = read('property', 'og:image')

    if (image) expect(image.startsWith('https://example.com/')).toBe(true)
  })

  test('and nothing leaks into the html as a stray tag', () => {
    // metadataBase, openGraph and twitter are structure, not tags. A loop that
    // did not know that would emit <meta name="openGraph" content="[object
    // Object]"> - which is what icons used to do.
    expect(page).not.toContain('name="metadataBase"')
    expect(page).not.toContain('name="openGraph"')
    expect(page).not.toContain('name="twitter"')
    expect(page).not.toContain('[object Object]')
  })
})
