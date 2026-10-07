import { expect, test } from '@playwright/test'

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
