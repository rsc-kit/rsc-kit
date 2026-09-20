// The generated entries import every route file under an identifier made
// from its path. Two paths, one identifier, and the entry declares an import
// twice - which is how app/agent-account/page.tsx beside app/agent/account/
// page.tsx broke a build.

import { describe, expect, test } from 'bun:test'
import { toAlias } from '../../src/vite'

describe('the alias a route file is imported as', () => {
  test('a hyphen and a slash are not the same character', () => {
    expect(toAlias('app/agent-account/page')).not.toBe(toAlias('app/agent/account/page'))
  })

  test('is a valid identifier whatever the path holds', () => {
    for (const name of [
      'app/(marketing)/[slug]/page',
      'app/api/[...rest]/route',
      'app/my_dir/my.file/page',
      'app/@slot/default',
    ]) {
      expect(toAlias(name)).toMatch(/^[A-Za-z_$][\w$]*$/)
    }
  })

  test('distinct paths get distinct aliases', () => {
    const names = ['app/a-b/page', 'app/a/b/page', 'app/a_b/page', 'app/a.b/page', 'app/(a)/b/page', 'app/[a]/b/page']
    const aliases = new Set(names.map(toAlias))

    expect(aliases.size).toBe(names.length)
  })

  test('the common case still reads as the path', () => {
    expect(toAlias('app/orders/page')).toBe('_c_app_orders_page')
  })
})
