import { expect, test } from '@playwright/test'
import { hydrated, showing } from './helpers'

// A layout reads its own params. Kept mounted by file name alone, the
// category layout went on showing the category it was first rendered for:
// /c/inks to /c/canvas shared every layout, so it was never asked again.
test('a layout under a dynamic segment renders again for another value', async ({ page }) => {
  await page.goto('/c/inks')
  await hydrated(page)
  await expect(page.locator('#layout-category:visible')).toHaveText('in inks')

  await page.locator('#next-category:visible').click()
  await showing(page, '/c/canvas')
  await expect(page.locator('#layout-category:visible')).toHaveText('in canvas')

  // And one above the segment is still kept: the cart count's boundary is
  // in the shop layout, which a category change does not render again.
  await page.goBack()
  await showing(page, '/c/inks')
  await expect(page.locator('#layout-category:visible')).toHaveText('in inks')
})
