import { expect, test, type Page } from '@playwright/test'
import { hydrated } from './helpers'

// The app is built with contentSecurityPolicy: {} (vite.config.ts), enforced:
// no 'unsafe-inline', so every inline script and style the engine writes runs
// only by its hash or the response's nonce. One without either is a
// violation the browser reports, and a page that hydrates to its error
// boundary or not at all.
const cases: {
  what: string
  url: string
  served: string
  nonce: boolean
  crawler?: boolean
  then: (page: Page) => Promise<void>
}[] = [
  {
    what: 'a stored page, by hash alone, and an action on it',
    url: '/refusal',
    served: 'stored',
    nonce: false,
    then: async (page) => {
      await page.locator('#submit').click()
      await expect(page.locator('#form-error')).toHaveText('The queue is busy, try again in a minute')
    },
  },
  {
    what: 'a pattern shell and the holes resumed into it, by hash and nonce, and a navigation from it',
    url: '/c/clay/travel/two',
    served: 'shell',
    nonce: true,
    then: async (page) => {
      await expect(page.locator('#detail:visible')).toHaveText('Detail for two')
      await page.locator('a[href="/c/clay/travel/one"]').first().click()
      await expect(page.locator('#detail:visible')).toHaveText('Detail for one')
    },
  },
  {
    what: 'a page rendered whole for a crawler, by nonce',
    url: '/projects/first',
    served: 'rendered',
    nonce: true,
    crawler: true,
    then: async () => {},
  },
]

for (const c of cases) {
  test(`runs under the policy - ${c.what}`, async ({ browser }) => {
    const context = await browser.newContext(c.crawler ? { userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)' } : {})
    const page = await context.newPage()
    const violations: string[] = []

    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        ;((window as { __v?: string[] }).__v ??= []).push(`${e.violatedDirective}: ${e.sample || e.blockedURI}`)
      })
    })
    page.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violations.push(m.text())
    })

    const response = (await page.goto(c.url))!
    const policy = response.headers()['content-security-policy'] ?? ''

    expect(response.headers()['x-rsc-kit']).toBe(c.served)
    expect(policy).toMatch(/script-src 'self' '/)
    expect(policy.includes("'nonce-")).toBe(c.nonce)

    await hydrated(page)
    await c.then(page)

    violations.push(...((await page.evaluate(() => (window as { __v?: string[] }).__v)) ?? []))
    expect(violations).toEqual([])
    await context.close()
  })
}

test('a nonce is new for every response', async ({ request }) => {
  const nonceOf = async () => /'nonce-([^']+)'/.exec((await request.get('/c/clay/travel/two')).headers()['content-security-policy'] ?? '')?.[1]

  const [a, b] = [await nonceOf(), await nonceOf()]

  expect(a).toBeTruthy()
  expect(a).not.toBe(b)
})

// What the policy is for, and proof the checks above can fail: an inline
// script that is not the page's own is refused, and reported.
test('an injected inline script is refused', async ({ page }) => {
  await page.goto('/c/clay/travel/two')
  await hydrated(page)

  const outcome = await page.evaluate(
    () =>
      new Promise<{ ran: boolean; reported: string }>((resolve) => {
        document.addEventListener('securitypolicyviolation', (e) =>
          resolve({ ran: Boolean((window as { __injected?: boolean }).__injected), reported: e.violatedDirective }),
        )

        const script = document.createElement('script')

        script.textContent = 'window.__injected = true'
        document.body.append(script)
      }),
  )

  expect(outcome).toEqual({ ran: false, reported: 'script-src-elem' })
})
