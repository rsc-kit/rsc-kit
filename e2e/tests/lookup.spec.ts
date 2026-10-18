import { expect, test, type Page } from '@playwright/test'
import { hydrated } from './helpers'

// Searching on the page you are on. The form's action is this route, so there
// is no other page whose shell could stand in while the results load: the old
// results stay, and the button says it is working, until the new ones replace
// them. A skeleton in between is the page forgetting what it just showed.

/** Whether the skeleton was ever in the document, from the page's own clock. */
async function watchSkeleton(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __skeleton: boolean }
    w.__skeleton = false
    new MutationObserver(() => {
      if (document.querySelector('#skeleton')) w.__skeleton = true
    }).observe(document.body, { childList: true, subtree: true })
  })
}

const sawSkeleton = (page: Page) => page.evaluate(() => (window as unknown as { __skeleton: boolean }).__skeleton)

for (const hovered of [true, false]) {
  test(`a search on the page keeps the old results on screen until the new ones land (${hovered ? 'after a hover' : 'cold'})`, async ({ page }) => {
    await page.goto('/lookup?q=alpha')
    await hydrated(page)
    await expect(page.locator('#results:visible')).toHaveText('results for alpha')
    await watchSkeleton(page)

    if (hovered) await page.hover('form')
    await page.fill('#q:visible', 'beta')
    await page.click('#search:visible')

    // Working, and still showing what it had.
    await expect(page.locator('#search:visible')).toHaveText('Searching…')
    await expect(page.locator('#results:visible')).toHaveText('results for alpha')
    await expect(page.locator('#q:visible')).toHaveValue('beta')

    await expect(page.locator('#results:visible')).toHaveText('results for beta')
    await expect(page).toHaveURL(/\/lookup\?q=beta$/)
    await expect(page.locator('#search:visible')).toHaveText('Search')
    expect(await sawSkeleton(page)).toBe(false)

    // Back is the page before the search.
    await page.goBack()
    await expect(page.locator('#results:visible')).toHaveText('results for alpha')
    await expect(page).toHaveURL(/\/lookup\?q=alpha$/)
  })
}

// An app that wants a skeleton where the results are, not the old results,
// styles them from the form's own data-pending: the form works, the results
// area shows what the app drew for waiting, and neither is the page's shell.
test('a skeleton the page draws from data-pending stands in for the results while a search runs', async ({ page }) => {
  await page.goto('/lookup-skeleton?q=alpha')
  await hydrated(page)
  await expect(page.locator('#results:visible')).toHaveText('results for alpha')
  await expect(page.locator('#results-skeleton:visible')).toHaveCount(0)
  await watchSkeleton(page)

  await page.fill('#q:visible', 'beta')
  await page.click('#search:visible')

  await expect(page.locator('#results-skeleton:visible')).toHaveText('searching…')
  await expect(page.locator('#results:visible')).toHaveCount(0)

  await expect(page.locator('#results:visible')).toHaveText('results for beta')
  await expect(page.locator('#results-skeleton:visible')).toHaveCount(0)
  expect(await sawSkeleton(page)).toBe(false)
})
