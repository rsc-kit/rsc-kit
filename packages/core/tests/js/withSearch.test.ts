import { describe, expect, test } from 'bun:test'
import { href, searchString, withSearch } from '../../src/routes'

describe('a query string from an object', () => {
  test('stringifies scalars, repeats arrays, drops null and undefined', () => {
    expect(searchString({ q: 'shoes', page: 2, on: true, none: null, missing: undefined, tags: ['a', 'b'] })).toBe(
      'q=shoes&page=2&on=true&tags=a&tags=b',
    )
  })

  test('encodes what needs encoding', () => {
    expect(searchString({ q: 'a b&c' })).toBe('q=a+b%26c')
  })
})

describe('putting it on a path', () => {
  test('keeps a query and a hash already there', () => {
    expect(withSearch('/search', { q: 'x' })).toBe('/search?q=x')
    expect(withSearch('/search?lang=en', { q: 'x' })).toBe('/search?lang=en&q=x')
    expect(withSearch('/search#top', { q: 'x' })).toBe('/search?q=x#top')
    expect(withSearch('/search?lang=en#top', { q: 'x' })).toBe('/search?lang=en&q=x#top')
  })

  test('is the path itself when there is nothing to add', () => {
    expect(withSearch('/search', undefined)).toBe('/search')
    expect(withSearch('/search#top', {})).toBe('/search#top')
    expect(withSearch('/search', { q: undefined })).toBe('/search')
  })

  test('href() is the same thing, typed', () => {
    expect(href('/search' as never, { q: 'x' } as never)).toBe('/search?q=x')
  })
})
