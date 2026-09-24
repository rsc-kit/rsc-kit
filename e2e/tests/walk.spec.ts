import { test } from '@playwright/test'
import { hydrated, seeded, showing, slowCpu, tapLink } from './helpers'

// Home, a category, back to home, another category - and the url changed
// while the page did not, for every tap after, until a reload. A revealed page
// left the chain of the page it replaced on the wire. Found by walking the
// demo at random on a phone; so this walks at random, on a slow CPU, and
// checks every step.
test('a random walk: every tap shows the page its url names', async ({ page }) => {
  test.setTimeout(180_000)

  const seed = Number(process.env.WALK_SEED ?? 20260924)
  const random = seeded(seed)
  const steps: string[] = []

  await slowCpu(page)
  await page.goto('/')
  await hydrated(page)

  for (let i = 0; i < 40; i++) {
    const hrefs = await page
      .locator('a[data-rsc]:visible')
      .evaluateAll((links) => [...new Set(links.map((a) => a.getAttribute('href')!).filter((h) => h !== '/about'))])
    const href = hrefs[Math.floor(random() * hrefs.length)]!

    steps.push(href)
    await test.step(`${i + 1}. tap ${href}`, async () => {
      await tapLink(page, href)
      await showing(page, href).catch((error) => {
        throw new Error(`walk (seed ${seed}) stuck after: ${steps.join(' -> ')}\n${error}`)
      })
    })
    await page.waitForTimeout(150 + random() * 400)
  }
})
