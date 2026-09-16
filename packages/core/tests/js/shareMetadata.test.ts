// The share card, rendered.
//
// Two of these were bugs for as long as the feature existed: og: tags went out
// as name= (which Facebook, Slack and LinkedIn all ignore), and icons in
// metadata rendered as <meta name="icons" content="[object Object]">. Neither
// showed in a browser, because a browser does not read either.

import { beforeAll, describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'

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
