/**
 * The pictures a prefetched page shows, fetched before the click.
 */

import { registerDom } from './dom'

registerDom()

import { afterEach, describe, expect, test } from 'bun:test'
import { imagesIn, preloadImages } from '../../src/js/imagePreload'

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
})
