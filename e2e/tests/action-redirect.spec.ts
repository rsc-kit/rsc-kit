import { expect, test } from '@playwright/test'
import { hydrated, showing, tapLink } from './helpers'

// An action redirected to a page the router was holding, and the held copy
// was revealed: rendered before the action set its cookie, so the page said
// "signed in: no" until a reload. A redirect that answers an action fetches
// its page, because the action may have changed anything the page reads.
test('an action redirecting to a held page shows it as the action left it', async ({ page }) => {
  const first = '/c/inks/studio/one'
  const second = '/c/inks/studio/two'

  await page.goto(first)
  await hydrated(page)
  await expect(page.locator('#signed-in:visible')).toHaveText('signed in: no')

  await tapLink(page, second)
  await showing(page, second)

  await page.locator('#sign-in:visible').click()
  await showing(page, first)
  await expect(page.locator('#signed-in:visible')).toHaveText('signed in: yes')
})
