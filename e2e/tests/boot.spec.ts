import { expect, test } from '@playwright/test'
import { hydrated } from './helpers'

// One render per visit. The document streams its render's payload into
// itself and the browser hydrates from that: no request for its own
// payload, no hydration error.
for (const [what, url] of [
  ['a shell stored for its own url', '/'],
  ['a pattern shell, one for every product', '/c/clay/travel/two'],
  ['a page rendered per request', '/projects/first'],
] as const) {
  test(`hydrates from the payload in the document - ${what}`, async ({ page }) => {
    const ownPayload: string[] = []
    const errors: string[] = []

    page.on('request', (r) => {
      if (r.headers()['x-rsc'] !== undefined && new URL(r.url()).pathname === url) ownPayload.push(r.url())
    })
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(url)

    await hydrated(page)

    expect(ownPayload).toEqual([])
    expect(errors).toEqual([])

    if (url === '/c/clay/travel/two') {
      await expect(page.locator('#detail:visible')).toHaveText('Detail for two')
      await page.locator('#note:visible').fill('kept')
      await page.locator('a[href="/c/clay/travel/one"]').first().click()
      await expect(page.locator('#detail:visible')).toHaveText('Detail for one')
      await page.goBack()
      await expect(page.locator('#note:visible')).toHaveValue('kept')
      await expect(page.locator('#detail:visible')).toHaveText('Detail for two')
    }
  })
}
