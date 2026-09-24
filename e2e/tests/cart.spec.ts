import { expect, test } from '@playwright/test'
import { hydrated, showing, slowCpu, tapLink } from './helpers'

const PRODUCT = '/c/brushes/basic/one'

// Add to cart, then the brand link. Twice this came back as home in the url
// with the product on screen: once when the action's answer landed after the
// tap, once when the tap landed after the answer - on a product reached by
// tapping through from home, which is how it was reached on the phone.
for (const gap of [0, 300, 1500]) {
  test(`add to cart, then home ${gap} ms later, from a product loaded directly`, async ({ page }) => {
    await slowCpu(page)
    await page.goto(PRODUCT)
    await hydrated(page)
    await page.locator('#add').tap()
    await page.waitForTimeout(gap)
    await tapLink(page, '/')
    await showing(page, '/')
    // And still, once the action's answer has certainly landed.
    await page.waitForTimeout(2000)
    await showing(page, '/')
  })
}

test('add to cart on a product reached by tapping from home, then home', async ({ page }) => {
  await slowCpu(page)
  await page.goto('/')
  await hydrated(page)

  for (const href of ['/c/brushes', '/c/brushes/basic', PRODUCT]) {
    await tapLink(page, href)
    await showing(page, href)
  }

  await page.locator('#add').tap()
  await expect(page.locator('#added:visible')).toHaveText('Added one')
  await tapLink(page, '/')
  await showing(page, '/')
  await page.waitForTimeout(2000)
  await showing(page, '/')
})

test('the cart count, rendered in a hole, moves with the action', async ({ page }) => {
  await page.goto(PRODUCT)
  await hydrated(page)
  await expect(page.locator('#cart-count')).toHaveText('0')
  await page.locator('#add').tap()
  await expect(page.locator('#cart-count')).toHaveText('1')
})
