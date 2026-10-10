/**
 * The prefixes an app says belong to its backend.
 *
 * A dynamic root route such as [team]/[app] matches every two-segment url, so the
 * backend's /gitlab/connect was this app's not-found page: a page that says
 * notFound() is never handed on. Naming the prefixes forwards them before any page
 * is matched. What is checked here is the part that can quietly go wrong in a
 * config: a mistake that would send the whole app, or its own endpoints, to the
 * backend is refused where it is written.
 */

import { describe, expect, test } from 'bun:test'
import { normaliseBackendPaths } from '../../src/vite'

describe('backendPaths', () => {
  test('reads each as a prefix: a leading slash, no trailing one, no repeats', () => {
    expect(normaliseBackendPaths(['/auth', '/github/', '  /gitlab  ', '/auth'])).toEqual(['/auth', '/github', '/gitlab'])
    expect(normaliseBackendPaths(undefined)).toEqual([])
    expect(normaliseBackendPaths([])).toEqual([])
  })

  test('refuses what is not a path', () => {
    for (const bad of ['auth', '', '  ', 'https://api.example.com/auth']) {
      expect(() => normaliseBackendPaths([bad])).toThrow('is not a path')
    }
  })

  test('refuses "/", which is every url and leaves nothing for the app', () => {
    expect(() => normaliseBackendPaths(['/'])).toThrow('every url')
    expect(() => normaliseBackendPaths(['///'])).toThrow('every url')
  })

  test("refuses the renderer's own endpoint, which the backend cannot answer", () => {
    expect(() => normaliseBackendPaths(['/_rsc'])).toThrow('own endpoint')
    expect(() => normaliseBackendPaths(['/_rsc/action'])).toThrow('own endpoint')
  })

  test('refuses a pattern: it is a prefix, and a wildcard would be silently literal', () => {
    for (const bad of ['/auth/*', '/auth?x=1', '/auth#top']) {
      expect(() => normaliseBackendPaths([bad])).toThrow('prefix, not a pattern')
    }
  })
})
