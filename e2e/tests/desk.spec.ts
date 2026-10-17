import { expect, test } from '@playwright/test'
import { hydrated, tapLink } from './helpers'

// A tabbed screen. The header is the layout's, and a section: it must not go
// away when a tab is clicked, and it must still be current. Before a page could
// reach a section beside its layouts it was one or the other - in each page it
// blinked to its skeleton on every switch, in the layout it never refreshed.
const HEADER = '#desk-header'
const header = (page: import('@playwright/test').Page) => page.locator(`${HEADER}:visible`)
const renderOf = async (page: import('@playwright/test').Page) =>
  Number(/render #(\d+)/.exec((await header(page).textContent()) ?? '')?.[1])

test('a tab switch keeps the header on screen, and the tab is the only thing loading', async ({ page }) => {
  await page.goto('/desk/7/inbox')
  await hydrated(page)
  await expect(page.locator('#tab-content:visible')).toContainText('inbox render')

  // The very element, not another one like it.
  await page.evaluate((selector) => {
    ;(document.querySelector(selector) as unknown as { __kept: boolean }).__kept = true
  }, HEADER)
  const before = await renderOf(page)

  await tapLink(page, '/desk/7/archive')

  // The tab's content is loading and the header never left.
  await expect(page.locator('#tab-loading:visible')).toBeVisible()
  await expect(header(page)).toBeVisible()
  await expect(page.locator('#tab-content:visible')).toContainText('archive render')
  expect(await page.evaluate((s) => (document.querySelector(s) as unknown as { __kept?: boolean }).__kept, HEADER)).toBe(true)
  // And not rendered again: a tab switch is not a reason to ask for it.
  expect(await renderOf(page)).toBe(before)
})

test('an action called on a tab refreshes the layout\'s header by name, and only that', async ({ page }) => {
  await page.goto('/desk/7/archive')
  await hydrated(page)
  await expect(page.locator('#tab-content:visible')).toContainText('archive render')

  const header0 = await renderOf(page)
  const tab0 = await page.locator('#tab-content:visible').textContent()

  await page.locator('#refresh-header').click()

  await expect.poll(() => renderOf(page)).toBeGreaterThan(header0)
  // The page below was not rendered again.
  await expect(page.locator('#tab-content:visible')).toHaveText(tab0!)
  // The params it was rendered with first are the ones the refresh renders it with.
  await expect(header(page)).toContainText('desk 7')
})

test('a change from outside refreshes the header on whichever tab is open', async ({ page, request }) => {
  await page.goto('/desk/7/inbox')
  await hydrated(page)
  await expect(page.locator('#tab-content:visible')).toContainText('inbox render')
  await tapLink(page, '/desk/7/archive')
  await expect(page.locator('#tab-content:visible')).toContainText('archive render')

  const before = await renderOf(page)
  // Give the tab time to open its stream before the change is announced.
  await page.waitForTimeout(1000)

  expect((await request.post('/api/desk')).status()).toBe(204)

  await expect.poll(() => renderOf(page), { timeout: 10_000 }).toBeGreaterThan(before)
  await expect(header(page)).toContainText('desk 7')
})
