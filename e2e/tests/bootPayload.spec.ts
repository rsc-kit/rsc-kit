import { expect, test } from '@playwright/test'
import { hydrated } from './helpers'

// The page's payload is asked for by the document, beside the runtime, not by
// the runtime after it has loaded: the request starts before the entry script
// has finished arriving, and there is exactly one of it.
test('the boot payload is requested once, by the document, alongside the runtime', async ({ page }) => {
  const started: { kind: 'payload' | 'entry'; at: number; done?: number }[] = []

  page.on('request', (r) => {
    const url = new URL(r.url())

    if (r.headers()['x-rsc'] === '1' && url.pathname === '/c/paper') started.push({ kind: 'payload', at: Date.now() })
    else if (/\/assets\/index-[^/]+\.js$/.test(url.pathname)) started.push({ kind: 'entry', at: Date.now() })
  })
  page.on('requestfinished', (r) => {
    if (/\/assets\/index-[^/]+\.js$/.test(new URL(r.url()).pathname)) {
      const entry = started.find((s) => s.kind === 'entry')

      if (entry) entry.done = Date.now()
    }
  })

  await page.goto('/c/paper')
  await hydrated(page)

  const payloads = started.filter((s) => s.kind === 'payload')
  const entry = started.find((s) => s.kind === 'entry')

  expect(payloads).toHaveLength(1)
  expect(entry?.done).toBeDefined()
  expect(payloads[0].at).toBeLessThanOrEqual(entry!.done!)
})
