import { readFileSync, writeFileSync } from 'node:fs'
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
    what: "a stored page's own inline script and PageTransition, by hash, with no nonce to give",
    url: '/nonce',
    served: 'stored',
    nonce: false,
    then: async (page) => {
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      expect(await page.evaluate(() => document.querySelector('style[data-href^="rsc-kit-page-transition"]') !== null)).toBe(true)
    },
  },
  {
    what: "useNonce() in a shell's layout: a library's inline script by hash, and a style it inserts later by the holes' nonce",
    url: '/nonce/live',
    served: 'shell',
    nonce: true,
    then: async (page) => {
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--inserted').trim())).toBe('1')
      expect(await page.evaluate(() => (document.querySelector('style[data-href^="rsc-kit-page-transition"]') as HTMLStyleElement | null)?.sheet !== null)).toBe(true)
    },
  },
  {
    what: "useNonce() on a page rendered whole for a crawler: a library's inline script and PageTransition, by nonce",
    url: '/nonce/live',
    served: 'rendered',
    nonce: true,
    crawler: true,
    then: async (page) => {
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      await expect(page.locator('#nonce-page')).toHaveText('Live')
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

// `vite dev`, under the same policy, plus 'unsafe-eval' for React's development
// build. What dev adds to a page - Vite's client, the <style> it injects for a
// CSS update, its error overlay - runs too, by the nonce, so a refusal shows
// while you work and not first in production.
test('under vite dev, a page, a CSS update and the error overlay, with nothing refused', async ({ page }) => {
  const dev = 'http://localhost:4620'
  const css = new URL('../src/app/styles.css', import.meta.url)
  const pageFile = new URL('../src/app/projects/[slug]/page.tsx', import.meta.url)
  const [cssBefore, pageBefore] = [readFileSync(css, 'utf8'), readFileSync(pageFile, 'utf8')]
  const violations: string[] = []

  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      ;((window as { __v?: string[] }).__v ??= []).push(`${e.violatedDirective}: ${e.sample || e.blockedURI}`)
    })
  })
  page.on('console', (m) => {
    if (/Content Security Policy|unsafe-eval/i.test(m.text())) violations.push(m.text())
  })

  try {
    const response = (await page.goto(`${dev}/projects/first`))!
    const policy = response.headers()['content-security-policy'] ?? ''

    expect(policy).toMatch(/script-src 'self' 'unsafe-eval' 'nonce-/)
    await hydrated(page)

    writeFileSync(css, `${cssBefore}\nbody { --csp-probe: 1 }\n`)
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--csp-probe').trim())).toBe('1')

    writeFileSync(pageFile, `${pageBefore}\nexport const broken = (\n`)
    await expect(page.locator('vite-error-overlay')).toBeAttached()
  } finally {
    writeFileSync(css, cssBefore)
    writeFileSync(pageFile, pageBefore)
  }

  violations.push(...((await page.evaluate(() => (window as { __v?: string[] }).__v)) ?? []))
  expect(violations).toEqual([])
})

// The report this came from: under vite dev, PageTransition's style - which
// React inserts in the browser - had no nonce, and a library had none to give.
test('under vite dev, useNonce() and PageTransition, with nothing refused', async ({ page }) => {
  const violations: string[] = []

  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      ;((window as { __v?: string[] }).__v ??= []).push(`${e.violatedDirective}: ${e.sample || e.blockedURI}`)
    })
  })

  await page.goto('http://localhost:4620/nonce/live')
  await hydrated(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--inserted').trim())).toBe('1')

  violations.push(...((await page.evaluate(() => (window as { __v?: string[] }).__v)) ?? []))
  expect(violations).toEqual([])
})
