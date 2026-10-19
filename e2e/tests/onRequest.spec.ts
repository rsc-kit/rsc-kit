import { expect, test } from '@playwright/test'

// instrumentation.ts's onRequest(): told once a response is over - streamed to
// the end, or cut off by a visitor who left - on the real built server.
const served = async (request: import('@playwright/test').APIRequestContext, trace: string) =>
  (await (await request.get(`/api/served?trace=${trace}`)).json()) as Array<Record<string, unknown>>

test('a streamed page is reported after its last byte, without its query string', async ({ request }) => {
  const trace = `full-${Date.now()}`
  const response = await request.get('/slow?q=private', { headers: { 'x-trace': trace, cookie: 'session=1' } })

  expect(await response.text()).toContain('arrived')

  await expect.poll(() => served(request, trace)).toHaveLength(1)
  const [entry] = await served(request, trace)

  expect(entry).toMatchObject({ method: 'GET', pathname: '/slow', status: 200, aborted: false, headers: { 'x-trace': trace } })
  expect(entry.durationMs as number).toBeGreaterThanOrEqual(900)
  expect(JSON.stringify(entry)).not.toContain('private')
  expect(JSON.stringify(entry)).not.toContain('session')
})

test('a visitor who leaves mid-stream is reported as aborted', async ({ page, request }) => {
  const trace = `cut-${Date.now()}`
  await page.goto('/')

  await page.evaluate(async (trace) => {
    const controller = new AbortController()
    const response = await fetch('/slow', { headers: { 'x-trace': trace }, signal: controller.signal })
    const reader = response.body!.getReader()

    await reader.read()
    controller.abort()
  }, trace)

  await expect.poll(() => served(request, trace), { timeout: 5000 }).toHaveLength(1)
  const [entry] = await served(request, trace)

  expect(entry).toMatchObject({ pathname: '/slow', aborted: true })
  expect(entry.durationMs as number).toBeLessThan(900)
})

test('a page still renders and streams with onRequest in front of it', async ({ page }) => {
  await page.goto('/slow')

  await expect(page.locator('#late')).toHaveText('arrived')
})
