import { expect, test } from '@playwright/test'

// A page with no client component ships no JavaScript - in its markup, and in
// its headers. The second half is the one that got away: the markup was clean
// while a Link header hinted the whole runtime as a modulepreload, and every
// visitor downloaded it. Checked against the server that answers production,
// on the stored file, not a rendering of it.
test('a stored page with no client component ships no JavaScript at all', async ({ request, page }) => {
  const response = await request.get('/about')
  const html = await response.text()
  const link = response.headers()['link'] ?? ''

  expect(response.headers()['x-rsc-kit']).toBe('stored')
  expect(html).not.toContain('<script')
  expect(link).not.toContain('modulepreload')
  expect(link).not.toContain('.js')

  // And the browser requests none.
  const scripts: string[] = []

  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(r.url())
  })
  await page.goto('/about')
  await expect(page.locator('h1')).toHaveText('About')
  expect(scripts).toEqual([])
})
