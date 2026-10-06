import { expect, test } from '@playwright/test'

const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

// A person is sent the shell at once; the title streams in after it.
test("a page's generateMetadata does not hold up its first byte", async () => {
  const started = performance.now()
  const response = await fetch('http://localhost:4600/c/clay/travel/two')
  const reader = response.body!.getReader()

  await reader.read()
  const first = performance.now() - started

  let html = ''
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) html += new TextDecoder().decode(chunk.value)

  // The lookup takes 300ms; the shell left long before it finished.
  expect(first).toBeLessThan(250)
  expect(html).toContain('<title>Product two</title>')
})

// Decided inside a boundary, after the status line: the page says so in the
// document instead, for a search engine that reads it.
test('a product that does not exist is noindex for a person', async ({ request }) => {
  const response = await request.get('/c/clay/travel/nope')

  expect(response.status()).toBe(200)
  expect(await response.text()).toContain('<meta name="robots" content="noindex">')
})

// A crawler is answered once the page has finished, so it reads the status
// the page decided and the title in <head>.
test('a crawler is told 404 for it, and reads the title in <head> of one that exists', async ({ request }) => {
  const missing = await request.get('/c/clay/travel/nope', { headers: { 'User-Agent': GOOGLEBOT } })

  expect(missing.status()).toBe(404)

  const found = await request.get('/c/clay/travel/two', { headers: { 'User-Agent': GOOGLEBOT } })
  const html = await found.text()

  expect(found.status()).toBe(200)
  expect(html.slice(0, html.indexOf('</head>'))).toContain('<title>Product two</title>')
  expect(html).not.toContain('noindex')
})
