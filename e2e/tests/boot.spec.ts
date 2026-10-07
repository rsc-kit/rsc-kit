import { expect, test } from '@playwright/test'

// One render per visit. The document's render makes the payload the browser
// hydrates from; the boot fetch redeems it rather than rendering the page a
// second time. The header says which happened. A pattern shell is the one
// exception for now - its resume carries no page key - so these use the
// home page, a shell stored for its own url.
test('the hydration fetch is answered from the document render, not a second one', async ({ page }) => {
  const boot = page.waitForResponse((r) => r.request().headers()['x-rsc-boot'] !== undefined)

  await page.goto('/')

  const response = await boot

  expect(response.status()).toBe(200)
  expect(response.headers()['x-rsc-kit']).toBe('held')
  expect(response.headers()['x-rsc-segment-depth']).toBe('0')
})

test('a stored shell carries the token after itself, before its holes', async ({ request }) => {
  const html = await (await request.get('/')).text()
  const at = html.indexOf('<script>self.__rsc_boot="')

  expect(at).toBeGreaterThan(0)
  // After the shell's own bootstrap script, with the resumed segments after it.
  expect(html.lastIndexOf('import(', at)).toBeGreaterThan(0)
  expect(html.length).toBeGreaterThan(at + 80)
})
