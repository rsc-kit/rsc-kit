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
import { backendPathSource, backendPrefixes, normaliseBackendPaths, pageUnderBackendPath } from '../../src/vite'

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

  // A proxy sends these prefixes to the backend from outside; the host-call
  // endpoint is for the renderer alone.
  test('refuses the host-call endpoint, or a prefix over it', () => {
    for (const bad of ['/__rsc', '/__rsc/', '/__rsc/host-call']) {
      expect(() => normaliseBackendPaths([bad])).toThrow('host-call endpoint')
    }

    expect(() => normaliseBackendPaths(['/internal'], '/internal/calls')).toThrow('host-call endpoint')
    expect(normaliseBackendPaths(['/__rsc'], '/internal/calls')).toEqual(['/__rsc'])
    expect(normaliseBackendPaths(['/__rsc-docs'])).toEqual(['/__rsc-docs'])
  })

  test('refuses a pattern: it is a prefix, and a wildcard would be silently literal', () => {
    for (const bad of ['/auth/*', '/auth?x=1', '/auth#top']) {
      expect(() => normaliseBackendPaths([bad])).toThrow('prefix, not a pattern')
    }
  })

  test('takes a whole segment in brackets as any one segment', () => {
    expect(normaliseBackendPaths(['/login/[provider]', '/t/[team]/hooks/'])).toEqual(['/login/[provider]', '/t/[team]/hooks'])
  })

  test('refuses a bracket that is not a whole segment, and a catch-all', () => {
    for (const bad of ['/a]', '/auth/x[provider]', '/auth/[...rest]', '/auth/[]', '/auth/[a-b]']) {
      expect(() => normaliseBackendPaths([bad])).toThrow('not a whole segment')
    }
  })

  // '/[team]' would be every url of one segment and what is under it.
  test('refuses a dynamic first segment, which leaves the app nothing at that depth', () => {
    expect(() => normaliseBackendPaths(['/[team]'])).toThrow('starts with a dynamic segment')
    expect(() => normaliseBackendPaths(['/[team]/hooks'])).toThrow('starts with a dynamic segment')
  })
})

describe('a backend path, as the server tests a url', () => {
  const on = (path: string, url: string) => new RegExp(backendPathSource(path)).test(url)

  test('a prefix is itself and what is under it, at a segment boundary', () => {
    expect(on('/auth', '/auth')).toBe(true)
    expect(on('/auth', '/auth/')).toBe(true)
    expect(on('/auth', '/auth/github/callback')).toBe(true)
    expect(on('/auth', '/authors')).toBe(false)
    expect(on('/.well-known', '/xwell-known/acme')).toBe(false)
  })

  test('a dynamic segment is any one segment, and not none', () => {
    expect(on('/login/[provider]', '/login/google')).toBe(true)
    expect(on('/login/[provider]', '/login/google/callback')).toBe(true)
    expect(on('/login/[provider]', '/login')).toBe(false)
    expect(on('/login/[provider]', '/login/')).toBe(false)
    expect(on('/login/[provider]', '/logins/google')).toBe(false)
    expect(on('/t/[team]/hooks', '/t/acme/hooks/stripe')).toBe(true)
    expect(on('/t/[team]/hooks', '/t/acme/settings')).toBe(false)
  })
})

describe('what a proxy in front is told', () => {
  // routes.json and the build report say "a path equal to one or under it".
  test('is the plain prefixes; a dynamic one reaches the backend through the renderer', () => {
    expect(backendPrefixes(['/auth', '/login/[provider]', '/gitlab'])).toEqual(['/auth', '/gitlab'])
  })
})

describe('a page a dynamic backend path would take', () => {
  const page = (component: string, ...values: string[]) => ({
    component,
    segments: values.map((value) =>
      value.startsWith('[') ? { type: 'param' as const, value: value.slice(1, -1) } : { type: 'static' as const, value },
    ),
  })

  test('stops the app where it starts, naming both', () => {
    const said = pageUnderBackendPath([page('app/login/page', 'login'), page('app/login/forgot/page', 'login', 'forgot')], ['/login/[provider]'])

    expect(said).toContain('"/login/[provider]" takes /login/forgot (app/login/forgot/page)')
  })

  test('the page above it is left alone, and so is everything a plain prefix covers', () => {
    expect(pageUnderBackendPath([page('app/login/page', 'login')], ['/login/[provider]'])).toBeNull()
    expect(pageUnderBackendPath([page('app/auth/page', 'auth')], ['/auth'])).toBeNull()
  })

  test('a page that only might match is not one it takes', () => {
    expect(pageUnderBackendPath([page('app/[team]/[app]/page', '[team]', '[app]')], ['/login/[provider]'])).toBeNull()
  })
})
