/**
 * The pictures a prefetched page shows, fetched before the click.
 */

import { registerDom } from './dom'

registerDom()

import { afterEach, describe, expect, test } from 'bun:test'
import { imagesIn, picturesReady, preloadImages } from '../../src/js/imagePreload'

// A flight payload's rows for a product page: two eager pictures, one lazy,
// one with a srcSet and sizes, and a nested object in the props.
const PAYLOAD =
  '0:["$","div",null,{"className":"p","children":[' +
  '["$","img","a",{"src":"/i/a@256.webp","srcSet":"/i/a@256.webp 1x, /i/a@512.webp 2x","sizes":"256px","alt":"a","loading":"eager","style":{"width":"2px"}}],' +
  '["$","img",null,{"src":"/i/b@48.webp","alt":"{brace} in \\"quotes\\""}],' +
  '["$","img","c",{"src":"/i/c@48.webp","loading":"lazy"}]' +
  ']}]\n'

describe('reading the pictures out of a payload', () => {
  test('finds every img row with its src, srcSet, sizes and loading', () => {
    const images = imagesIn(PAYLOAD)

    expect(images.map((i) => i.src)).toEqual(['/i/a@256.webp', '/i/b@48.webp', '/i/c@48.webp'])
    expect(images[0]!.srcSet).toBe('/i/a@256.webp 1x, /i/a@512.webp 2x')
    expect(images[0]!.sizes).toBe('256px')
    expect(images[1]!.alt).toBe('{brace} in "quotes"')
    expect(images[2]!.loading).toBe('lazy')
  })

  test('a payload with no pictures has none', () => {
    expect(imagesIn('0:["$","p",null,{"children":"text"}]\n')).toEqual([])
  })
})

describe('asking the browser for them', () => {
  const created: { src: string; srcset: string; sizes: string; fetchPriority?: string }[] = []
  const RealImage = (globalThis as { Image: unknown }).Image

  afterEach(() => {
    ;(globalThis as { Image: unknown }).Image = RealImage
    created.length = 0
  })

  test('the eager ones, once each, at low priority, sizes before srcset before src', () => {
    const order: string[] = []

    ;(globalThis as { Image: unknown }).Image = class {
      decoding = ''
      fetchPriority = ''
      _sizes = ''
      _srcset = ''
      _src = ''
      set sizes(v: string) {
        this._sizes = v
        order.push('sizes')
      }
      set srcset(v: string) {
        this._srcset = v
        order.push('srcset')
      }
      set src(v: string) {
        this._src = v
        order.push('src')
        created.push({ src: v, srcset: this._srcset, sizes: this._sizes, fetchPriority: this.fetchPriority })
      }
    }

    expect(preloadImages(PAYLOAD)).toBe(2)
    expect(created.map((c) => c.src)).toEqual(['/i/a@256.webp', '/i/b@48.webp'])
    expect(created[0]).toMatchObject({ srcset: '/i/a@256.webp 1x, /i/a@512.webp 2x', sizes: '256px', fetchPriority: 'low' })
    expect(order.slice(0, 3)).toEqual(['sizes', 'srcset', 'src'])

    // The same page prefetched again asks for nothing.
    expect(preloadImages(PAYLOAD)).toBe(0)
  })

  test('touched, the same pictures are asked for again as urgent - and only once', () => {
    ;(globalThis as { Image: unknown }).Image = class {
      decoding = ''
      fetchPriority = ''
      set sizes(_: string) {}
      set srcset(_: string) {}
      set src(v: string) {
        created.push({ src: v, srcset: '', sizes: '', fetchPriority: this.fetchPriority })
      }
    }

    // Already asked for at low priority by the test above, in this document.
    expect(preloadImages(PAYLOAD, 'high')).toBe(2)
    expect(created.map((c) => c.fetchPriority)).toEqual(['high', 'high'])

    // A second touch, or the sight preload landing after the touch: nothing more.
    expect(preloadImages(PAYLOAD, 'high')).toBe(0)
    expect(preloadImages(PAYLOAD)).toBe(0)
  })
})

describe('how many', () => {
  test('the first six eager pictures of a payload, and no more', () => {
    const rows = Array.from({ length: 12 }, (_, i) => `["$","img",null,{"src":"/many/${i}.webp"}]`).join(',')
    const payload = `0:["$","div",null,{"children":[${rows}]}]\n`
    const created: string[] = []

    ;(globalThis as { Image: unknown }).Image = class {
      set src(v: string) {
        created.push(v)
      }
      set srcset(_: string) {}
      set sizes(_: string) {}
    }

    expect(preloadImages(payload)).toBe(6)
    expect(created).toEqual(['/many/0.webp', '/many/1.webp', '/many/2.webp', '/many/3.webp', '/many/4.webp', '/many/5.webp'])
  })
})

describe('a navigation waiting for the pictures', () => {
  const RealImage = (globalThis as { Image: unknown }).Image
  const live: { src: string; fetchPriority: string; complete: boolean; settle: () => void }[] = []

  afterEach(() => {
    ;(globalThis as { Image: unknown }).Image = RealImage
    live.length = 0
  })

  function stub() {
    ;(globalThis as { Image: unknown }).Image = class {
      decoding = ''
      fetchPriority = ''
      complete = false
      resolve: () => void = () => {}
      decoded = new Promise<void>((r) => {
        this.resolve = r
      })
      set sizes(_: string) {}
      set srcset(_: string) {}
      set src(_: string) {
        live.push(this as never)
      }
      decode() {
        return this.decoded
      }
      settle() {
        this.complete = true
        this.resolve()
      }
    }
  }

  const page = (name: string) => `0:["$","img",null,{"loading":"eager","src":"/wait/${name}.webp"}]\n`

  test('resolves when the pictures asked for earlier are decoded', async () => {
    stub()
    preloadImages(page('a'))
    expect(live.length).toBe(1)

    let ready = false
    const wait = picturesReady(page('a'), 1000).then(() => {
      ready = true
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(ready).toBe(false)

    live[0].settle()
    await wait
    expect(ready).toBe(true)
  })

  test('gives up after the budget, so a slow picture cannot hold the page', async () => {
    stub()
    preloadImages(page('b'))

    const started = Date.now()
    await picturesReady(page('b'), 30)

    expect(Date.now() - started).toBeGreaterThanOrEqual(25)
    expect(Date.now() - started).toBeLessThan(500)
  })

  test('a picture never asked for is asked for now, as urgent', async () => {
    stub()

    const wait = picturesReady(page('c'), 1000)

    expect(live.map((i) => i.fetchPriority)).toEqual(['high'])
    live[0].settle()
    await wait
  })

  test('nothing to wait for when they are already complete, or the page has no pictures', async () => {
    stub()
    preloadImages(page('d'))
    live[0].settle()

    const started = Date.now()
    await picturesReady(page('d'), 1000)
    await picturesReady('0:["$","p",null,{"children":"text"}]\n', 1000)

    expect(Date.now() - started).toBeLessThan(50)
  })
})
