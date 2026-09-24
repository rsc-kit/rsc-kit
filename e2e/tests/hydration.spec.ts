import { test } from '@playwright/test'
import { showing } from './helpers'

// A tap before the runtime has arrived is held by the page's inline script
// and played once it hydrates - never lost, never a document load of the
// wrong page. On a phone the runtime can take seconds; this makes it take
// three.
test('a tap before hydration lands on the page it was aimed at', async ({ page }) => {
  await page.route('**/assets/*.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    await route.continue()
  })

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('a[href="/c/paper"]').first().tap()
  await showing(page, '/c/paper')
})
