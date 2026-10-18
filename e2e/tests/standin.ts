// A backend and another site, for tests/handoff.spec.ts: the app forwards
// /gitlab/connect here (RSC_BACKEND), and this answers as an OAuth start does -
// a 302 to a page on another origin, which sends no CORS headers.
const OTHER_SITE = 'http://127.0.0.1:4610'

Bun.serve({
  port: 4610,
  fetch(request) {
    const { pathname } = new URL(request.url)

    if (pathname === '/gitlab/connect') {
      return new Response(null, { status: 302, headers: { location: `${OTHER_SITE}/oauth/authorize?state=1` } })
    }

    if (pathname === '/oauth/authorize') {
      return new Response('<!doctype html><h1>gitlab sign in</h1>', { headers: { 'content-type': 'text/html' } })
    }

    return new Response('not here', { status: 404 })
  },
})
