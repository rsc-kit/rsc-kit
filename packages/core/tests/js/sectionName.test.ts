/**
 * A section has one name: its file's. section('admin-table') in a
 * table.section.tsx typechecked as admin-table, was found by the renderer as
 * table, and a refresh either failed or landed where no boundary was waiting.
 */

import { describe, expect, test } from 'bun:test'
import { sectionNameMismatch } from '../../src/vite'

describe('a section name', () => {
  test('the same as its file is fine', () => {
    expect(sectionNameMismatch('/app/src/app/orders/orders.section.tsx', "export default section('orders', Orders)")).toBeNull()
    expect(sectionNameMismatch('/app/src/app/x/repos.section.tsx', 'const Repos = section(\n  "repos",\n  ReposList, { refreshOn: [] })')).toBeNull()
  })

  test('a different one is refused, naming the file and both fixes', () => {
    const message = sectionNameMismatch('/app/src/app/admin/table.section.tsx', "const T = section('admin-table', Body)")

    expect(message).toContain('/app/src/app/admin/table.section.tsx')
    expect(message).toContain('Rename the file to admin-table.section.tsx')
    expect(message).toContain('pass "table" to section()')
  })

  test('a query on the id is not part of the name', () => {
    expect(sectionNameMismatch('/app/src/app/orders/orders.section.tsx?v=1', "section('orders', O)")).toBeNull()
  })

  test('a name computed at runtime is not read', () => {
    expect(sectionNameMismatch('/app/src/app/orders/orders.section.tsx', 'section(name, O)')).toBeNull()
  })
})
