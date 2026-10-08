import { expect, test } from '@playwright/test'
import { hydrated } from './helpers'

// A url no route owns is answered by not-found.tsx, rendered after the host
// has declined the url. It read the visitor's cookies outside the request -
// "No request in scope" - whenever the async context it inherited had gone,
// which under concurrent requests it intermittently had. Lighthouse's
// /favicon.ico request found it, as a pair of errors per run.
test('the not-found page reads the request it is answering', async ({ request }) => {
  const answers = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      request.get(`/no-such-page-${i}`, { headers: { Cookie: 'signed-in=yes', Accept: 'text/html' } }),
    ),
  )

  for (const answer of answers) {
    expect(answer.status()).toBe(404)
    expect(await answer.text()).toMatch(/signed in: (<!-- -->)?yes/)
  }
})

// A request that cannot show a page - an image, a script - is answered at
// once, without rendering not-found.tsx and every layout above it.
test('a missing asset is a plain 404, not a rendered page', async ({ request }) => {
  for (const headers of [
    { 'Sec-Fetch-Dest': 'image', Accept: 'image/avif,image/webp,*/*' },
    { 'Sec-Fetch-Dest': 'script', Accept: '*/*' },
    { Accept: '*/*' },
  ]) {
    const answer = await request.get('/favicon-that-does-not-exist.ico', { headers })

    expect(answer.status()).toBe(404)
    expect(await answer.text()).toBe('Not found')
  }

  // A navigation to the same url is shown the app's page.
  const page = await request.get('/favicon-that-does-not-exist.ico', {
    headers: { 'Sec-Fetch-Dest': 'document', Accept: 'text/html' },
  })

  expect(page.status()).toBe(404)
  expect(await page.text()).toContain('id="not-found"')
})

// notFound() called inside a Suspense boundary is decided after the shell went
// out, so the status is 200 and the page says noindex. What a PERSON sees was
// the error screen - "Something went wrong ... RSC_NOT_FOUND" - over a record
// that simply does not exist, because the boundary around the page took the
// mark for a failure. It is the app's not-found.tsx now, asked for by the
// boundary and put where the page was.
//
// And it is the NEAREST one: the missing product is in the (shop) group, whose
// own not-found.tsx renders inside the shop's layout, header and all. A url no
// route owns, or a page outside the group, gets the root one.
const MISSING = '/c/clay/travel/nope'

async function shopNotFound(page: import('@playwright/test').Page) {
  await expect(page.locator('#shop-not-found:visible')).toHaveText('Nothing in the shop')
  // The shop's layout is still around it.
  await expect(page.locator('#brand:visible')).toBeVisible()
  await expect(page.getByText('Something went wrong')).toHaveCount(0)
  await expect(page.getByText('RSC_NOT_FOUND')).toHaveCount(0)
}

async function rootNotFound(page: import('@playwright/test').Page) {
  await expect(page.locator('#not-found:visible')).toHaveText('Nothing here')
  await expect(page.locator('#brand:visible')).toHaveCount(0)
}

test('a missing record decided inside a boundary shows the nearest not-found.tsx, on a fresh load', async ({ page }) => {
  const response = await page.goto(MISSING)

  expect(response?.status()).toBe(200)
  await shopNotFound(page)
  await expect(page).toHaveURL(new RegExp(`${MISSING}$`))
})

test('and when reached by a link, with the url and history as they were', async ({ page }) => {
  await page.goto('/c/clay/travel')
  await hydrated(page)

  const before = await page.evaluate(() => history.length)

  await page.evaluate((to) => (window as { __rsc_navigate?: (url: string) => Promise<void> }).__rsc_navigate!(to), MISSING)
  await shopNotFound(page)
  await expect(page).toHaveURL(new RegExp(`${MISSING}$`))

  // One entry for the url, not one for the page and one for its not-found.
  expect(await page.evaluate(() => history.length)).toBe(before + 1)
})

test('Back and Forward restore it, and asking again later is not an error', async ({ page }) => {
  await page.goto('/c/clay/travel')
  await hydrated(page)

  const go = (to: string) => page.evaluate((url) => (window as { __rsc_navigate?: (u: string) => Promise<void> }).__rsc_navigate!(url), to)

  await go(MISSING)
  await shopNotFound(page)

  // Held pages stay in the DOM, hidden: it is what is visible that counts.
  await page.goBack()
  await expect(page).toHaveURL(/\/c\/clay\/travel$/)
  await expect(page.locator('#shop-not-found:visible')).toHaveCount(0)

  await page.goForward()
  await shopNotFound(page)

  // Away to a page that exists, then to the missing one again: a first time again.
  await go('/c/clay/travel')
  await expect(page.locator('#shop-not-found:visible')).toHaveCount(0)
  await go(MISSING)
  await shopNotFound(page)
})

// Decided before anything was sent: a real 404, from the nearest file, whichever
// way it is asked for.
test('decided before the shell, it is a real 404 carrying the nearest not-found.tsx', async ({ page, request }) => {
  const shop = await page.goto('/gone')

  expect(shop?.status()).toBe(404)
  await shopNotFound(page)

  const elsewhere = await page.goto('/gone-elsewhere')

  expect(elsewhere?.status()).toBe(404)
  await rootNotFound(page)

  // A navigation to either is answered with the same page, as a payload.
  for (const [path, marker] of [['/gone', 'Nothing in the shop'], ['/gone-elsewhere', 'Nothing here']] as const) {
    const payload = await request.get(path, { headers: { 'X-RSC': '1' } })

    expect(payload.status()).toBe(404)
    expect(await payload.text()).toContain(marker)
  }
})

test('and a url no route owns is answered by the root one', async ({ page }) => {
  const response = await page.goto('/no-such-page-at-all')

  expect(response?.status()).toBe(404)
  await rootNotFound(page)
})
