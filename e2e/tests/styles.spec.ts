import { expect, test } from '@playwright/test'
import { hydrated, showing, tapLink } from './helpers'

// A small stylesheet is inlined into a stored page, so the first paint waits
// on nothing but the document - including a page that hydrates. React finds
// its stylesheets by link[rel=stylesheet][href] and inserts one it cannot
// find, fetching the file the page was spared; so the link stays, as print,
// where React finds it and the screen ignores it.
test('a page that hydrates paints from its inlined stylesheet, and React does not fetch it again', async ({ request, page }) => {
  const response = await request.get('/')
  const html = await response.text()

  expect(html).toMatch(/<style>[^<]*rgb\(1, 2, 3\)|<style>[^<]*#010203/)
  expect(html).toMatch(/<link rel="stylesheet"[^>]*media="print"/)
  // Not hinted either: that would fetch at the highest priority what the
  // page asked for at the lowest.
  expect(response.headers()['link'] ?? '').not.toContain('.css')

  const sheets: string[] = []

  page.on('request', (r) => {
    if (r.resourceType() === 'stylesheet') sheets.push(r.url())
  })

  await page.goto('/')
  await hydrated(page)
  await expect(page.locator('h1:visible')).toHaveCSS('color', 'rgb(1, 2, 3)')

  await tapLink(page, '/c/paper')
  await showing(page, '/c/paper')
  await expect(page.locator('h1:visible')).toHaveCSS('color', 'rgb(1, 2, 3)')

  // One link per sheet - React adopted the print one rather than adding its
  // own - and at most the one low-priority fetch it makes.
  const hrefs = await page.$$eval('link[rel="stylesheet"]', (links) => links.map((l) => l.getAttribute('href')))

  expect(new Set(hrefs).size).toBe(hrefs.length)
  expect(sheets.length).toBeLessThanOrEqual(1)
})
