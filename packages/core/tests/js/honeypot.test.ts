// A <Honeypot /> trap: a post with it filled in is a bot's, answered as a
// success and never run. What is pinned is that the trap and its marker never
// reach the action, and that only a form that rendered the trap is checked.

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { sprung, sprungForm, TRAP_FIELD } from '../../src/honeypot'
import { Honeypot } from '../../src/js/Honeypot'

function form(entries: [string, string][]): FormData {
  const data = new FormData()
  for (const [key, value] of entries) data.append(key, value)
  return data
}

describe('sprungForm', () => {
  test('a filled trap is caught, and both fields are taken out', () => {
    const data = form([['email', 'a@b.c'], ['homepage', 'http://spam'], [TRAP_FIELD, 'homepage']])

    expect(sprungForm(data)).toBe(true)
    expect([...data.keys()]).toEqual(['email'])
  })

  test('an empty trap passes, and the action still sees only its own fields', () => {
    const data = form([['email', 'a@b.c'], ['homepage', ''], [TRAP_FIELD, 'homepage']])

    expect(sprungForm(data)).toBe(false)
    expect([...data.keys()]).toEqual(['email'])
  })

  test('without the marker, a field named homepage is an ordinary field', () => {
    const data = form([['homepage', 'https://example.com']])

    expect(sprungForm(data)).toBe(false)
    expect(data.get('homepage')).toBe('https://example.com')
  })

  test('the trap may be renamed', () => {
    const data = form([['website', 'x'], [TRAP_FIELD, 'website']])

    expect(sprungForm(data)).toBe(true)
    expect(data.has('website')).toBe(false)
  })
})

describe('sprung', () => {
  test('looks past a bound argument and a previous state to the form', () => {
    const data = form([['name', 'Ann'], ['homepage', 'spam'], [TRAP_FIELD, 'homepage']])

    expect(sprung(['bound', null, data])).toBe(true)
    expect([...data.keys()]).toEqual(['name'])
  })

  test('a form decoded as a plain object is checked and cleaned too', () => {
    const fields: Record<string, unknown> = { name: 'Ann', homepage: 'spam', [TRAP_FIELD]: 'homepage' }

    expect(sprung([fields])).toBe(true)
    expect(fields).toEqual({ name: 'Ann' })
  })

  test('arguments with no form are left alone', () => {
    expect(sprung(['id-1', { homepage: 'x' }])).toBe(false)
  })
})

describe('<Honeypot />', () => {
  test('renders a hidden, untabbable, unfilled trap and the marker naming it', () => {
    const html = renderToStaticMarkup(createElement(Honeypot))

    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('name="homepage"')
    expect(html).toContain('tabindex="-1"')
    expect(html.toLowerCase()).toContain('autocomplete="off"')
    expect(html).toContain(`name="${TRAP_FIELD}" value="homepage"`)
  })

  test('takes the trap name', () => {
    expect(renderToStaticMarkup(createElement(Honeypot, { name: 'website' }))).toContain(`name="${TRAP_FIELD}" value="website"`)
  })
})
