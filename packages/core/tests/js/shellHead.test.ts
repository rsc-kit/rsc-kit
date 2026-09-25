/**
 * The head of a stored shell, corrected for the url it is served for.
 */

import { describe, expect, test } from 'bun:test'
import { withHead } from '../../src/shellHead'

const shell = '<html><head><meta charSet="utf-8"/><title>Site</title><meta name="description" content="About the site"/></head><body>x</body></html>'

describe('writing a page\'s title and description into a shell', () => {
  test('replaces the ones the build wrote', () => {
    const out = withHead(shell, { title: 'Post · Site', description: 'About the post' })

    expect(out).toBe(
      '<html><head><meta charSet="utf-8"/><title>Post · Site</title><meta name="description" content="About the post"/></head><body>x</body></html>',
    )
  })

  test('adds them when the build wrote none', () => {
    const out = withHead('<html><head><meta charSet="utf-8"/></head><body>x</body></html>', {
      title: 'Post',
      description: 'About',
    })

    expect(out).toBe(
      '<html><head><meta charSet="utf-8"/><title>Post</title><meta name="description" content="About"/></head><body>x</body></html>',
    )
  })

  test('escapes what a title could carry into the markup', () => {
    const out = withHead(shell, { title: '<script>x</script> & "q"' })

    expect(out).toContain('<title>&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot;</title>')
    expect(out).not.toContain('<script>')
  })

  test('leaves the shell alone with nothing to write', () => {
    expect(withHead(shell, null)).toBe(shell)
    expect(withHead(shell, {})).toBe(shell)
    // A description alone leaves the title as the build wrote it.
    expect(withHead(shell, { description: 'Only this' })).toContain('<title>Site</title>')
  })
})
