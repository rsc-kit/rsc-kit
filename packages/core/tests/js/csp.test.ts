/**
 * The policy the engine sends: the author's, with the document's own inline
 * code added as hashes, and a nonce on a response that streams.
 */

import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  devContentSecurityPolicy,
  inlineHashes,
  newNonce,
  normaliseContentSecurityPolicy,
  policyHeaderName,
  policyMeta,
  policyValue,
  withPolicyMeta,
} from '../../src/csp'

const hash = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`
const policy = (directives?: Record<string, string | string[]>, reportOnly?: boolean) =>
  normaliseContentSecurityPolicy({ directives, reportOnly })!

describe('inlineHashes', () => {
  test('every inline script a browser runs, and every style', async () => {
    const html = [
      '<style>a{color:red}</style>',
      '<script>boot()</script>',
      '<script type="module">import "x"</script>',
      '<script type="importmap">{"imports":{}}</script>',
      '<script src="/a.js"></script>',
      '<script type="module" src="/b.js">ignored()</script>',
      '<script type="application/json" data-rsc>"0:a"</script>',
      '<script type="application/ld+json">{"@type":"Thing"}</script>',
      '<script></script>',
    ].join('')

    expect(await inlineHashes(html)).toEqual({
      scripts: [hash('boot()'), hash('import "x"'), hash('{"imports":{}}')].sort(),
      styles: [hash('a{color:red}')],
    })
  })

  test('a > inside a quoted attribute does not end the tag', async () => {
    const { scripts } = await inlineHashes(`<script data-x="a>b">run()</script>`)

    expect(scripts).toEqual([hash('run()')])
  })

  test('line breaks hash as the parser leaves them', async () => {
    const { scripts } = await inlineHashes('<script>a()\r\nb()\rc()</script>')

    expect(scripts).toEqual([hash('a()\nb()\nc()')])
  })

  test('a style written inside a script is part of the script', async () => {
    const { styles } = await inlineHashes(`<script>x='<style>p{}</style>'</script>`)

    expect(styles).toEqual([])
  })

  test('one hash for a script written twice', async () => {
    const { scripts } = await inlineHashes('<script>a()</script><script>a()</script>')

    expect(scripts).toEqual([hash('a()')])
  })
})

describe('policyValue', () => {
  test('the default policy, with a script-src copied from default-src', () => {
    const value = policyValue(policy(), { hashes: { scripts: ["'sha256-A'"], styles: ["'sha256-B'"] } })

    expect(value).toBe(
      "default-src 'self'; base-uri 'self'; object-src 'none'; style-src-attr 'unsafe-inline'; " +
        "script-src 'self' 'sha256-A'; style-src 'self' 'sha256-B'",
    )
  })

  test('a nonce goes on scripts and styles beside the hashes', () => {
    const value = policyValue(policy({ 'script-src': ["'self'", 'https://cdn.example'] }), {
      hashes: { scripts: ["'sha256-A'"], styles: [] },
      nonce: 'abc',
    })

    expect(value).toBe("script-src 'self' https://cdn.example 'sha256-A' 'nonce-abc'")
  })

  test("a directive with 'unsafe-inline' is left as written: a hash beside it would switch it off", () => {
    const value = policyValue(policy({ 'default-src': "'self'", 'style-src': "'self' 'unsafe-inline'" }), {
      hashes: { scripts: ["'sha256-A'"], styles: ["'sha256-B'"] },
    })

    expect(value).toBe("default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'sha256-A'")
  })

  test('a policy that says nothing about scripts is not given a script-src', () => {
    const value = policyValue(policy({ 'img-src': "'self'" }), { hashes: { scripts: ["'sha256-A'"], styles: [] } })

    expect(value).toBe("img-src 'self'")
  })

  test('the -elem directives get them too, when the author wrote one', () => {
    const value = policyValue(policy({ 'script-src': "'self'", 'script-src-elem': "'self'" }), {
      hashes: { scripts: ["'sha256-A'"], styles: [] },
    })

    expect(value).toBe("script-src 'self' 'sha256-A'; script-src-elem 'self' 'sha256-A'")
  })

  test('a directive with no sources is written bare', () => {
    expect(policyValue(policy({ 'upgrade-insecure-requests': [] }))).toBe('upgrade-insecure-requests')
  })
})

describe('normaliseContentSecurityPolicy', () => {
  test('nothing given is no policy', () => {
    expect(normaliseContentSecurityPolicy(undefined)).toBeUndefined()
  })

  test('strings and lists, names lowercased', () => {
    expect(policy({ 'Img-Src': "'self'  data:" }).directives).toEqual([['img-src', ["'self'", 'data:']]])
  })

  test('report-only names the other header', () => {
    expect(policyHeaderName(policy(undefined, true))).toBe('Content-Security-Policy-Report-Only')
    expect(policyHeaderName(policy())).toBe('Content-Security-Policy')
  })

  for (const [what, raw, message] of [
    ['a nonce in the config', { directives: { 'script-src': "'nonce-abc'" } }, 'no nonce at all'],
    ['two sources in one entry', { directives: { 'img-src': ["'self' data:"] } }, 'not one source'],
    ['a semicolon', { directives: { 'img-src': ["'self';"] } }, 'not one source'],
    ['an unknown option', { policy: {} }, 'is not an option'],
    ['a directive named twice', { directives: { 'img-src': "'self'", 'IMG-SRC': 'data:' } }, 'named twice'],
    ['reportOnly that is not a boolean', { reportOnly: 'yes' }, 'true or false'],
  ] as const) {
    test(`refuses ${what}`, () => {
      expect(() => normaliseContentSecurityPolicy(raw as never)).toThrow(message)
    })
  }
})

describe('the <meta> a static export carries', () => {
  test('without what only a header can carry, escaped, after the charset', () => {
    const p = policy({ 'default-src': "'self'", 'frame-ancestors': "'none'", 'report-uri': '/r?a=1&b=2' })
    const meta = policyMeta(p, { scripts: ["'sha256-A'"], styles: [] })

    expect(meta).toBe(`<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'sha256-A'; style-src 'self'">`)
    expect(withPolicyMeta('<html><head><meta charset="utf-8"><script>a()</script>', meta)).toBe(
      `<html><head><meta charset="utf-8">${meta}<script>a()</script>`,
    )
  })

  test('none for a report-only policy, which a <meta> cannot be', () => {
    expect(policyMeta(policy(undefined, true), { scripts: [], styles: [] })).toBe('')
  })

  test('at the top of <head> when there is no charset', () => {
    expect(withPolicyMeta('<html><head lang="en"><title>x</title>', '<meta>')).toBe('<html><head lang="en"><meta><title>x</title>')
  })
})

test('a nonce is 128 random bits, different every time', () => {
  const a = newNonce()

  expect(atob(a)).toHaveLength(16)
  expect(newNonce()).not.toBe(a)
})

describe('the policy in vite dev', () => {
  const dev = (p: ReturnType<typeof policy>, origin?: string) => policyValue(devContentSecurityPolicy(p, { origin }))

  test("the default, with 'unsafe-eval' for React's development build", () => {
    expect(dev(policy())).toBe(
      "default-src 'self'; base-uri 'self'; object-src 'none'; style-src-attr 'unsafe-inline'; script-src 'self' 'unsafe-eval'; style-src 'self'",
    )
  })

  test("the dev server's origin and its socket, when the page comes from another one", () => {
    expect(dev(policy(), 'http://localhost:5173/some/path')).toBe(
      "default-src 'self' http://localhost:5173; base-uri 'self'; object-src 'none'; style-src-attr 'unsafe-inline'; " +
        "script-src 'self' 'unsafe-eval' http://localhost:5173; connect-src 'self' http://localhost:5173 ws://localhost:5173; style-src 'self' http://localhost:5173",
    )
  })

  test("the author's own directives get it, and one closed with 'none' stays closed", () => {
    const value = dev(policy({ 'script-src': "'self'", 'style-src': "'self'", 'font-src': "'none'" }), 'https://vite.test')

    expect(value).toBe("script-src 'self' 'unsafe-eval' https://vite.test; style-src 'self' https://vite.test; font-src 'none'")
  })

  test('the policy it was given is left as it was', () => {
    const p = policy()

    devContentSecurityPolicy(p, { origin: 'http://localhost:5173' })
    expect(p).toEqual(policy())
  })
})
