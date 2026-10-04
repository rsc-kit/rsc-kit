import { expect, test } from '@playwright/test'
import { hydrated } from './helpers'

// A rename moved the page; the action re-rendered the old address, which
// redirected from inside a Suspense boundary. The redirect arrived without
// its digest, the boundary could not tell it from a crash, and the error page
// showed instead of the new address - until a reload.
test('an action whose re-render redirects follows the redirect, not the error page', async ({ page, context }) => {
  await context.clearCookies()
  await page.goto('/projects/first')
  await hydrated(page)
  await expect(page.locator('h1:visible')).toHaveText('Project first')

  await page.locator('#rename:visible').click()

  await expect(page).toHaveURL(/\/projects\/second$/)
  await expect(page.locator('h1:visible')).toHaveText('Project second')
})
