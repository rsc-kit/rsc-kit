import { expect, test, type Page } from '@playwright/test'
import { hydrated } from './helpers'

// A <Honeypot /> filled in is a bot's post: answered as though it worked and
// never run. Filled by a person it is invisible, and neither the trap nor its
// marker reaches the action. Checked with the runtime and without it, because
// the two arrive at different decoders.

async function springTrap(page: Page) {
  await page.locator('input[name="homepage"]').evaluate((input: HTMLInputElement) => {
    input.value = 'http://spam.example'
  })
}

for (const javaScriptEnabled of [true, false]) {
  test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript', () => {
    test.use({ javaScriptEnabled })

    test('a person\'s post runs the action with only their own fields', async ({ page }) => {
      await page.goto('/honeypot')
      if (javaScriptEnabled) await hydrated(page)

      await page.locator('#subscribe').click()

      await expect(page.locator('#saw')).toHaveText('saw: email')
    })

    test('a filled trap is dropped before the action runs', async ({ page }) => {
      await page.goto('/honeypot')
      if (javaScriptEnabled) await hydrated(page)

      await springTrap(page)
      await page.locator('#subscribe').click()
      await page.waitForLoadState('networkidle')

      await expect(page.locator('#saw')).toHaveText('nothing yet')
      expect((await page.context().cookies()).some((cookie) => cookie.name === 'subscribed')).toBe(false)
    })
  })
}
