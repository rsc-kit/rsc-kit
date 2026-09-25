import { expect, test } from '@playwright/test'
import { hydrated, showing, tapLink } from './helpers'

// Back reveals the page that was left, with what was typed into it: pages are
// held, not rebuilt. And forward returns to the one after.
test('back and forward keep what was typed', async ({ page }) => {
  const first = '/c/inks/studio/one'
  const second = '/c/inks/studio/two'

  await page.goto(first)
  await hydrated(page)
  await page.locator('#note:visible').fill('kept')
  await tapLink(page, second)
  await showing(page, second)

  await page.goBack()
  await showing(page, first)
  await expect(page.locator('#note:visible')).toHaveValue('kept')

  await page.goForward()
  await showing(page, second)
})
