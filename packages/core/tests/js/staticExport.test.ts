/**
 * Where a payload lives when there is no server to negotiate with.
 *
 * A page and its payload normally share a url and are told apart by the X-RSC
 * header. A host that serves files cannot act on a header — ask for the page
 * with it and you get the page — so an exported build gives payloads their own
 * addresses and the client asks for those.
 */

import { registerDom } from './dom'

registerDom()

import { afterEach, describe, expect, test } from 'bun:test'
import { payloadUrl, setStaticPayloads } from '../../src/js/navigate'

afterEach(() => {
  setStaticPayloads(null)
})

describe('the payload url', () => {
  test('is the page itself when a server is answering', () => {
    // Nothing changes for an ordinary deployment: the header does the work.
    expect(payloadUrl('/docs/rsc')).toBe('/docs/rsc')
  })

  test('is a file beside the page once exported', () => {
    setStaticPayloads('index.rsc')

    expect(payloadUrl('/docs/rsc')).toBe('/docs/rsc/index.rsc')
  })

  test('does not double the separator on a directory url', () => {
    // Exported pages are directories with an index, so this is the shape the
    // browser is actually on.
    setStaticPayloads('index.rsc')

    expect(payloadUrl('/docs/rsc/')).toBe('/docs/rsc/index.rsc')
  })

  test('keeps a query string, which is part of what is being asked for', () => {
    setStaticPayloads('index.rsc')

    expect(payloadUrl('/search?q=routing')).toBe('/search/index.rsc?q=routing')
  })

  test('handles the root', () => {
    setStaticPayloads('index.rsc')

    expect(payloadUrl('/')).toBe('/index.rsc')
  })
})
