import { expect, test } from '@playwright/test'

// One render per visit. The document's render makes the payload the browser
// hydrates from; the boot fetch redeems it rather than rendering the page a
// second time. The header says which happened.
test('the hydration fetch is answered from the document render, not a second one', async ({ page }) => {
  const boot = page.waitForResponse((r) => r.request().headers()['x-rsc-boot'] !== undefined)

  await page.goto('/c/clay/travel/two')

  const response = await boot

  expect(response.status()).toBe(200)
  expect(response.headers()['x-rsc-kit']).toBe('held')
  expect(response.headers()['x-rsc-segment-depth']).toBe('0')

  // And the page hydrated against it: the hole is filled and interactive.
  await expect(page.locator('#detail')).toHaveText('Detail for two')
})

test('a stored shell carries the token after itself, before its holes', async ({ request }) => {
  const html = await (await request.get('/c/clay/travel/one')).text()
  const at = html.indexOf('self.__rsc_boot=')

  expect(at).toBeGreaterThan(0)
  // After the shell's own bootstrap script, before the resumed segments.
  expect(html.lastIndexOf('import(', at)).toBeGreaterThan(0)
  expect(html.indexOf('<template', at)).toBeGreaterThan(at)
})
