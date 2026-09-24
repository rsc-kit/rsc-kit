/**
 * A prefetched page's client components, loaded before the tap.
 *
 * On a phone, the first product page of a visit showed its skeleton for a
 * quarter of a second: the payload had arrived, but the chunk for the form
 * inside it only started downloading at the touch, and React waited for the
 * code. Every later product found it cached. These pin what is read from a
 * payload and how much is loaded.
 */

import { registerDom } from './dom'

registerDom()

import { afterEach, describe, expect, test } from 'bun:test'
import { clientIdsIn, preloadChunks, setChunkLoader } from '../../src/js/chunkPreload'

const PAYLOAD = [
  '2:I["71a431604fec",[],"$1",1]',
  '3:I["ee312e11f6a1",[],"DocumentTitle",1]',
  'a:I["b2742f3fbb28",[],"AddToCartForm",1]',
  '0:["$","main",null,{"children":"$La"}]',
].join('\n')

afterEach(() => setChunkLoader(null))

describe('reading a payload', () => {
  test('the client components it renders, by id, in order, once each', () => {
    expect(clientIdsIn(PAYLOAD + '\nb:I["b2742f3fbb28",[],"AddToCartForm",1]')).toEqual([
      '71a431604fec',
      'ee312e11f6a1',
      'b2742f3fbb28',
    ])
  })

  test('a payload with no client component has none', () => {
    expect(clientIdsIn('0:["$","p",null,{"children":"text"}]\n')).toEqual([])
  })

  test('the first eight a page renders, and no more', () => {
    const many = Array.from({ length: 20 }, (_, i) => `${i.toString(16)}:I["id${i}",[],"C${i}",1]`).join('\n')

    expect(clientIdsIn(many)).toHaveLength(8)
  })
})

describe('loading them', () => {
  test('at idle, through the map the runtime uses, and each id once per document', async () => {
    const loaded: string[] = []

    setChunkLoader(async (id) => {
      loaded.push(id)
    })

    const unique = `9:I["only-here-${Date.now()}",[],"Form",1]`

    expect(preloadChunks(unique)).toBe(1)
    // Not synchronously: the page on screen goes first.
    expect(loaded).toEqual([])

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(loaded).toHaveLength(1)

    // Asked for once; a second prefetch naming it loads nothing.
    expect(preloadChunks(unique)).toBe(0)
  })

  test('nothing without a loader - a development server, a test', () => {
    expect(preloadChunks(PAYLOAD)).toBe(0)
  })

  test('nothing for a visitor who asked for less data', () => {
    setChunkLoader(async () => {})

    const real = Object.getOwnPropertyDescriptor(navigator, 'connection')

    Object.defineProperty(navigator, 'connection', { configurable: true, get: () => ({ saveData: true }) })

    try {
      expect(preloadChunks(`c:I["saver-${Date.now()}",[],"X",1]`)).toBe(0)
    } finally {
      if (real) Object.defineProperty(navigator, 'connection', real)
      else delete (navigator as { connection?: unknown }).connection
    }
  })

  test('a chunk that fails to load is not a rejection anyone has to catch', async () => {
    setChunkLoader(() => Promise.reject(new Error('offline')))

    expect(preloadChunks(`d:I["failing-${Date.now()}",[],"X",1]`)).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
})
