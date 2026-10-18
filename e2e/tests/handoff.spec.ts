import { expect, test, type Page } from '@playwright/test'
import { hydrated } from './helpers'

// A page that sends someone out of the app: to another site outright, or to a
// url the backend owns (named in backendPaths) that bounces on to another site,
// as an OAuth start does. Decided before the page's boundary (a 3xx, or
// X-RSC-Redirect on a navigation) or inside it (an error digest, after the
// shell was shown and pushed).
//
// The router used to follow the backend's url by fetching it as a payload. The
// backend bounced that to the other site, the browser refused the hop - a fetch
// cannot follow a redirect to another origin with the header it added - and the
// tap did nothing: the old page stayed, the url did not move. And a link on a
// page whose own redirect named the backend's url had that url fetched on
// sight, as a prefetch, which started the flow in the background.
//
// The other site is tests/standin.ts. The backend is the same stand-in, which
// the app on 4602 forwards /gitlab/connect to (RSC_BACKEND).
const OTHER_SITE = 'http://127.0.0.1:4610/oauth/authorize?state=1'

/** Every request the page makes for the backend's url as a payload. */
function payloadRequests(page: Page): string[] {
  const asked: string[] = []

  page.on('request', (request) => {
    if (request.url().includes('/gitlab/connect') && request.headers()['x-rsc']) asked.push(request.url())
  })

  return asked
}

/** Tap through to the redirecting page, land on the other site, and come Back. */
async function leaveAndReturn(page: Page, href: string): Promise<void> {
  const asked = payloadRequests(page)

  await page.goto('/handoff')
  await hydrated(page)
  await page.locator(`a[href="${href}"]`).tap()

  await expect(page).toHaveURL(OTHER_SITE)
  await expect(page.locator('h1')).toHaveText('gitlab sign in')
  expect(asked).toEqual([])

  // The url that redirected is not in history: Back would land on a page that
  // sends the visitor straight out again.
  await page.goBack()
  await expect(page).toHaveURL(/\/handoff$/)
  await expect(page.locator('h1:visible')).toHaveText('Handoff')
}

// Nothing behind this server: it is the whole application, as a Node or Bun
// host is. A redirect to another site is the client's alone to perform.
test.describe('to another site, from a server with no backend', () => {
  for (const when of ['early', 'late'] as const) {
    test(`a ${when} redirect leaves the app, and Back returns to the page it was tapped on`, async ({ page }) => {
      await leaveAndReturn(page, `/handoff/${when}/external`)
    })

    test(`a ${when} redirect met on a first visit goes the same way`, async ({ page }) => {
      await page.goto(`/handoff/${when}/external`)

      await expect(page).toHaveURL(OTHER_SITE)
      await expect(page.locator('h1')).toHaveText('gitlab sign in')
    })
  }
})

// The same build with a backend behind it, forwarding /gitlab to the stand-in.
test.describe("to the backend's url, which bounces to another site", () => {
  test.use({ baseURL: 'http://localhost:4602' })

  for (const when of ['early', 'late'] as const) {
    test(`a ${when} redirect leaves the app, and Back returns to the page it was tapped on`, async ({ page }) => {
      await leaveAndReturn(page, `/handoff/${when}/backend`)
    })

    test(`a ${when} redirect met on a first visit goes the same way`, async ({ page }) => {
      await page.goto(`/handoff/${when}/backend`)

      await expect(page).toHaveURL(OTHER_SITE)
      await expect(page.locator('h1')).toHaveText('gitlab sign in')
    })
  }
})
