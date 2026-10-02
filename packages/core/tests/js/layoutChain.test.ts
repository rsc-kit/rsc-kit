import { describe, expect, test } from 'bun:test'
import { layoutChain, paramsFor, segmentNames } from '../../src/routing'

describe('a layout\'s params', () => {
  test('are its own segments\' and those above it, never a deeper one\'s', () => {
    const all = { team: 'acme', project: 'web' }

    expect(paramsFor('app/[team]/layout', all)).toEqual({ team: 'acme' })
    expect(paramsFor('app/[team]/[project]/layout', all)).toEqual(all)
    expect(paramsFor('app/(marketing)/layout', all)).toEqual({})
  })

  test('catch-all names are read too', () => {
    expect(segmentNames('app/docs/[...slug]/layout')).toEqual(['slug'])
    expect(segmentNames('app/[[...rest]]/layout')).toEqual(['rest'])
  })
})

describe('the chain a client holds', () => {
  test('names a layout under a segment by its value, so another value is another layout', () => {
    const layouts = ['app/layout', 'app/[team]/layout']

    expect(layoutChain(layouts, { team: 'acme' })).not.toEqual(layoutChain(layouts, { team: 'globex' }))
  })

  test('and keeps one above the segment the same, so it stays mounted', () => {
    const layouts = ['app/layout', 'app/[team]/layout']

    expect(layoutChain(layouts, { team: 'acme' })[0]).toBe('app/layout')
    expect(layoutChain(layouts, { team: 'globex' })[0]).toBe('app/layout')
  })

  test('never puts a comma in an entry, which is the chain\'s separator', () => {
    expect(layoutChain(['app/[q]/layout'], { q: 'a,b' })[0]).not.toContain(',')
  })
})
