/**
 * What a redirect is allowed to say.
 *
 * The destination reaches location.href, location.replace and an inline
 * script. Every one of those runs a javascript: url rather than navigating to
 * it, and the value is routinely computed — read from a cookie, handed over by
 * middleware — so it is exactly the kind of string that arrives from outside.
 */

import { describe, expect, test } from 'bun:test'
import { isSafeRedirect } from '../../src/safeUrl'

describe('somewhere to go', () => {
  test.each([
    '/orders',
    'orders',
    '/posts/hello?page=2',
    '/orders#top',
    'https://example.com/callback',
    'http://localhost:3000/x',
  ])('%s is a url', (value) => {
    expect(isSafeRedirect(value)).toBe(true)
  })
})

describe('something to run', () => {
  // Spelled with escapes rather than literals: the obfuscations are the point,
  // and a literal control character in a source file is invisible.
  test.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\nscript:alert(1)',
    'java\tscript:alert(1)',
    '\u0000javascript:alert(1)',
    '  javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'blob:https://example.com/x',
    'file:///etc/passwd',
  ])('%j is refused', (value) => {
    expect(isSafeRedirect(value)).toBe(false)
  })
})
