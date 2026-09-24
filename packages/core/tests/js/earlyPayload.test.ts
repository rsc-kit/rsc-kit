/**
 * The page's payload, asked for by the document.
 *
 * The runtime used to fetch it after its own script had downloaded and run,
 * and the chunks it names after that: three trips in a line. The bootstrap
 * script starts it as the document is parsed, and the runtime takes it.
 */

import { registerDom } from './dom'

registerDom()

import { beforeEach, describe, expect, test } from 'bun:test'
import { EARLY_PAYLOAD, takeEarlyPayload } from '../../src/js/earlyPayload'

let asked: { url: string; headers: Record<string, string> }[]

beforeEach(() => {
  asked = []
  history.replaceState({}, '', '/products/pens?sort=new')
  ;(globalThis as any).fetch = (url: string, init: { headers: Record<string, string> }) => {
    asked.push({ url, headers: init.headers })

    return Promise.resolve(new Response('PAYLOAD'))
  }
  delete (window as any).__rsc_boot
})

describe('the bootstrap script', () => {
  test('asks for this url\'s payload, once, as the document is parsed', () => {
    new Function(EARLY_PAYLOAD)()

    expect(asked).toEqual([{ url: location.href, headers: { 'X-RSC': '1' } }])
  })

  test('has no backticks, because it is written into a template', () => {
    expect(EARLY_PAYLOAD).not.toContain('`')
  })
})

describe('the runtime', () => {
  test('takes the request the document made rather than making another', async () => {
    new Function(EARLY_PAYLOAD)()

    const early = takeEarlyPayload(location.href)

    expect(await (await early!).text()).toBe('PAYLOAD')
    expect(asked).toHaveLength(1)
  })

  test('takes it once: a later refresh fetches again', () => {
    new Function(EARLY_PAYLOAD)()

    expect(takeEarlyPayload(location.href)).not.toBeNull()
    expect(takeEarlyPayload(location.href)).toBeNull()
  })

  test('not for another url - the address changed before the runtime ran', () => {
    new Function(EARLY_PAYLOAD)()

    expect(takeEarlyPayload(location.origin + '/elsewhere')).toBeNull()
  })

  test('and without one, fetches as before', () => {
    expect(takeEarlyPayload(location.href)).toBeNull()
  })
})
