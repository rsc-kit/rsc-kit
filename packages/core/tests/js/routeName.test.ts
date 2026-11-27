import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { routeNameOf, sameRouteName } from '../../src/vite'

const dir = mkdtempSync(join(tmpdir(), 'route-name-'))
let n = 0
const file = (source: string) => {
  const path = join(dir, `page${n++}.tsx`)
  writeFileSync(path, source + '\nexport default function Page() { return null }\n')
  return path
}

describe('export const name', () => {
  test('is read from the page', () => {
    expect(routeNameOf(file("export const name = 'verification.verify'"))).toEqual({ routeName: 'verification.verify' })
    expect(routeNameOf(file('export const name = `password.reset`'))).toEqual({ routeName: 'password.reset' })
    expect(routeNameOf(file("export const name = 'login' as const"))).toEqual({ routeName: 'login' })
  })

  test('a page that declares none has none', () => {
    expect(routeNameOf(file('export const revalidate = 60'))).toEqual({})
    // Prose, a comment or a local are not the export.
    expect(routeNameOf(file("// export const name = 'x'\nconst name = 'y'"))).toEqual({})
  })

  test('one the build cannot read is refused, not dropped', () => {
    expect(() => routeNameOf(file("const n = 'a'\nexport const name = n"))).toThrow("export const name must be a route name the build can read")
    expect(() => routeNameOf(file("export const name = 'has space'"))).toThrow("like 'verification.verify'")
    expect(() => routeNameOf(file("export const name = ''"))).toThrow()
  })

  test('two routes cannot declare one name', () => {
    expect(sameRouteName([
      { file: 'app/a/page', routeName: 'login' },
      { file: 'app/b/page' },
      { file: 'app/c/route', routeName: 'login' },
    ])).toContain("app/a/page and app/c/route both export const name = 'login'")
    expect(sameRouteName([{ file: 'app/a/page', routeName: 'a' }, { file: 'app/b/page', routeName: 'b' }])).toBeNull()
  })
})
