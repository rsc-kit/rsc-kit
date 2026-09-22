/**
 * The Link header a document answers with, for a CDN to send ahead.
 *
 * Cloudflare turns it into 103 Early Hints and caches them at the edge, so
 * the stylesheet, the client entry and the fonts are downloading while the
 * HTML is still being written. The critical set only: a hint promotes what
 * it names, and naming every chunk demotes the document behind them.
 */

import { describe, expect, test } from 'bun:test'
import { criticalAssetsOf, linkHeader, mergeAssets } from '../../src/earlyHints'

const DOCUMENT = `<!DOCTYPE html><html><head><meta charSet="utf-8"/>
<link rel="preload" href="/assets/geist-latin-BgDaEnEv.woff2" as="font" type="font/woff2" crossorigin="anonymous"/>
<link rel="preload" href="https://cdn.example/other.woff2" as="font" crossorigin="anonymous"/>
<link rel="preload" as="image" href="/assets/poster.webp" fetchPriority="high"/>
<link rel="stylesheet" href="/assets/index-D_il52MF.css" data-precedence="vite-rsc/importer-resources"/>
<link rel="modulepreload" href="/assets/PathnameProvider-3PEhDqJK.js" crossorigin="" fetchPriority="low"/>
<link rel="icon" href="/_app/icon.png"/>
</head><body><main>hi</main><script id="_R_">(function(){})();import("/assets/index-C-u4Ll0r.js")</script></body></html>`

describe('what a stored document names', () => {
  test('its stylesheet, its entry and its same-origin fonts; not the chunks, the poster or a foreign font', () => {
    expect(criticalAssetsOf(DOCUMENT)).toEqual({
      styles: ['/assets/index-D_il52MF.css'],
      modules: ['/assets/index-C-u4Ll0r.js'],
      fonts: ['/assets/geist-latin-BgDaEnEv.woff2'],
    })
  })
})

describe('the header', () => {
  test('is the shape Cloudflare reads, one entry per asset', () => {
    expect(linkHeader(criticalAssetsOf(DOCUMENT))).toBe(
      '</assets/index-D_il52MF.css>; rel=preload; as=style, ' +
        '</assets/index-C-u4Ll0r.js>; rel=modulepreload, ' +
        '</assets/geist-latin-BgDaEnEv.woff2>; rel=preload; as=font; crossorigin',
    )
  })

  test('is empty for a document with nothing to name', () => {
    expect(linkHeader({ styles: [], modules: [], fonts: [] })).toBe('')
  })

  test("a rendered document takes the build's stylesheet and entry, and has no fonts to name", () => {
    const build = { styles: ['/assets/index-abc.css'], modules: ['/assets/index-def.js'], fonts: [] }

    // Nothing was read: the head does not exist until after the headers go.
    expect(mergeAssets(null, build)).toEqual(build)
    // A document that was read is the authority on itself.
    expect(mergeAssets(criticalAssetsOf(DOCUMENT), build)).toEqual(criticalAssetsOf(DOCUMENT))
  })

  test('a page that ships no JavaScript is never hinted the build\'s entry', () => {
    // The landing page: no client component, so no bootstrap script - and
    // its stylesheet inlined, so no stylesheet link either. Hinting the
    // build's entry made every visitor fetch 82 KB of runtime the page
    // never runs, and Lighthouse put it on the critical path.
    const noJs = `<!DOCTYPE html><html><head><style>body{color:red}</style>
<link rel="preload" href="/assets/font.woff2" as="font" crossorigin=""/>
</head><body><main>hi</main></body></html>`
    const build = { styles: ['/assets/index-abc.css'], modules: ['/assets/index-def.js'], fonts: [] }
    const read = criticalAssetsOf(noJs)

    expect(read.modules).toEqual([])
    expect(mergeAssets(read, build)).toEqual(read)
    expect(linkHeader(mergeAssets(read, build))).toBe('</assets/font.woff2>; rel=preload; as=font; crossorigin')
  })
})
