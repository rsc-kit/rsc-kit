/**
 * The boot script's reader: the document's payload blocks onto the queue the
 * runtime reads, in order, each once the parser has finished it.
 */

import { registerDom } from './dom'

registerDom()

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { READ_BLOCKS } from '../../src/inlineFlight'

const w = window as unknown as { __rsc_f?: unknown[]; __rsc_l?: string }
const block = (json: string, layouts = false) => {
  const s = document.createElement('script')

  s.type = 'application/json'
  s.setAttribute('data-rsc', layouts ? 'l' : '')
  s.textContent = json

  return s
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

let loading = true

beforeEach(() => {
  loading = true
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => (loading ? 'loading' : 'complete') })
  document.body.innerHTML = ''
  delete w.__rsc_f
  delete w.__rsc_l
})

afterEach(() => {
  // Each test's reader stops as a page's does, so none sees the next test.
  loading = false
  document.dispatchEvent(new Event('DOMContentLoaded'))
  delete (document as { readyState?: unknown }).readyState
})

test('blocks parsed before it runs, then each one after, in document order', async () => {
  document.body.append(block('"app/layout"', true), block('"0:a"'), document.createComment(''))
  new Function(READ_BLOCKS)()

  expect(w.__rsc_l).toBe('app/layout')
  expect(w.__rsc_f).toEqual(['0:a'])

  document.body.append(block('"1:b"'), block('{"b":"//4="}'), document.createComment(''))
  await settle()

  expect(w.__rsc_f).toEqual(['0:a', '1:b', { b: '//4=' }])
})

test('a block the parser may still be writing waits for the node after it', async () => {
  new Function(READ_BLOCKS)()
  document.body.append(block('"0:a"'))
  await settle()

  expect(w.__rsc_f).toBeUndefined()

  document.body.append(document.createComment(''))
  await settle()

  expect(w.__rsc_f).toEqual(['0:a'])
})

test('at DOMContentLoaded the document is whole, and so is the last block', async () => {
  new Function(READ_BLOCKS)()
  document.body.append(block('null'))
  await settle()
  loading = false
  document.dispatchEvent(new Event('DOMContentLoaded'))

  expect(w.__rsc_f).toEqual([null])
})

test('a push the runtime installed receives what follows', async () => {
  const taken: unknown[] = []

  document.body.append(block('"0:a"'), document.createComment(''))
  new Function(READ_BLOCKS)()
  w.__rsc_f!.push = (chunk: unknown) => taken.push(chunk)
  document.body.append(block('"1:b"'), document.createComment(''))
  await settle()

  expect(taken).toEqual(['1:b'])
})

test('a page with no blocks is left with no queue, so the runtime fetches its payload', async () => {
  document.body.append(document.createElement('main'))
  new Function(READ_BLOCKS)()
  await settle()

  expect(w.__rsc_f).toBeUndefined()
})
