import { expect, test } from '@playwright/test'

// The same build served two ways - as built, and compiled into one binary -
// must fill a partially prerendered page's holes at the origin. A smoke check
// that the binary serves and resumes at all.
//
// It does NOT guard the rename that once broke every resume in a binary: which
// same-named component a scope merge renames depends on the app's shape, and
// this app's never lands on a slot the replay compares. binary-resume.sh
// checks that on a fresh scaffold, where it reproduced every time.
const BINARY = 'http://localhost:4601'

for (const server of ['http://localhost:4600', BINARY]) {
  test(`the hole is filled at the origin - ${server === BINARY ? 'compiled binary' : 'built server'}`, async ({ request }) => {
    for (const product of ['one', 'two', 'three']) {
      const html = await (await request.get(`${server}/c/clay/travel/${product}`)).text()

      // In the document itself, not left for the browser to render.
      expect(html).toMatch(new RegExp(`Detail for (<!-- -->)?${product}`))
      // React's mark for a boundary it gave up on and client-renders.
      expect(html).not.toContain('<!--$!-->')
    }
  })
}
