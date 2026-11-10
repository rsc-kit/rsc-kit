import { expect, test } from '@playwright/test'
import { hydrated } from './helpers'

// An action is a fetch from a page already on screen, and a failure in the
// backend left it as the server's generic 500: the page said nothing, and the
// PHP that failed was in the terminal. In development it opens Vite's overlay
// with the backend's exception and the app's own frame.
test('in development, an action the backend failed opens the overlay with its exception', async ({ page }) => {
  await page.goto('http://localhost:4620/action-error')
  await hydrated(page)

  await page.locator('#notify').click()

  const overlay = page.locator('vite-error-overlay')

  await expect(overlay).toHaveCount(1)
  await expect(overlay.locator('.message-body')).toContainText('MassAssignmentException: Add [email] to fillable property')
  await expect(overlay.locator('.file')).toContainText('app/Rsc/Actions/Notification.php:20')
  await expect(overlay.locator('.stack')).toContainText('In the backend:')
  await expect(overlay.locator('.stack')).not.toContainText('vendor/laravel')
  // The caller still sees it fail, with what failed rather than a status.
  await expect(page.locator('#notify')).toContainText('Host call "Notification" failed')
})

test('in production, nothing about the failure reaches the page', async ({ page }) => {
  await page.goto('/action-error')
  await hydrated(page)

  const answer = page.waitForResponse((r) => r.url().endsWith('/_rsc/action'))

  await page.locator('#notify').click()

  const response = await answer

  expect(response.headers()['x-rsc-dev-error']).toBeUndefined()
  expect(await response.text()).not.toContain('MassAssignmentException')
  await expect(page.locator('#notify')).toHaveText('failed: Server action failed with 500')
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
})
