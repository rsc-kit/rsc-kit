import { expect, test } from '@playwright/test'
import { hydrated } from './helpers'

// A page rendered per request has the visitor's query on the server, so a
// client component reading useSearchParams() is in the server's HTML. It
// used to be refused there on every request and rendered in the browser
// after a flash - a settings form reading ?root= lost its server render.
test('a per-request page renders the query on the server', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()

  await page.goto('/filters?root=%2Fapps%2Fweb')
  await expect(page.locator('#root-picker')).toHaveText('root: /apps/web')

  // The same component in the stored part of the page: the server has no
  // query for it, and the fallback is what it sends.
  await expect(page.locator('#shell-loading')).toHaveText('reading…')
  await expect(page.locator('#shell-picker')).toHaveCount(0)
  await context.close()
})

test('and hydrates on it without a mismatch', async ({ page }) => {
  const errors: string[] = []

  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/filters?root=%2Fapps%2Fweb')
  await hydrated(page)
  await expect(page.locator('#root-picker')).toHaveText('root: /apps/web')
  await expect(page.locator('#shell-picker')).toHaveText('root: /apps/web')
  expect(errors).toEqual([])
})
