import { expect, test } from '@playwright/test'
import { hydrated } from './helpers'

// "Try again" on an error page is for a failure that might not happen twice -
// a service that was down for a moment. Redrawing the copy that already failed
// cannot recover from that: the retry has to ask the server again.

test.beforeEach(async ({ request }) => {
  await request.delete('/api/flaky')
})

test('Try again asks the server for the page again, and shows it once it answers', async ({ page, request }) => {
  await page.goto('/flaky')
  await hydrated(page)
  await expect(page.locator('[data-rsc-kit-error]')).toBeVisible()

  // The service is back.
  await request.post('/api/flaky')

  const asked = page.waitForRequest((r) => new URL(r.url()).pathname.startsWith('/flaky') && r.headers()['x-rsc'] === 'true')
  await page.getByRole('button', { name: 'Try again' }).click()
  await asked

  await expect(page.locator('#report')).toHaveText('the report')
  await expect(page.locator('[data-rsc-kit-error]')).toHaveCount(0)
  await expect(page.locator('h1:visible')).toHaveText('Flaky')
  await expect(page).toHaveURL(/\/flaky$/)
})

test('Try again while it is still failing shows the error again, and a later one still recovers', async ({ page, request }) => {
  await page.goto('/flaky')
  await hydrated(page)
  await expect(page.locator('[data-rsc-kit-error]')).toBeVisible()

  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('[data-rsc-kit-error]')).toBeVisible()

  await request.post('/api/flaky')
  await page.getByRole('button', { name: 'Try again' }).click()

  await expect(page.locator('#report')).toHaveText('the report')
})
