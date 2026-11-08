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

    // What a preview's edge would check: the deployment's fixed header (RSC_BACKEND_HEADERS).
    if (pathname === '/preview-token') return new Response(request.headers.get('x-preview-token') ?? 'none')

    // Reached only if the app handed a browser's host call on, which it must not.
    if (pathname === '/__rsc/host-call') return new Response('reached the backend')

    if (pathname === '/oauth/authorize') {
      return new Response('<!doctype html><h1>gitlab sign in</h1>', { headers: { 'content-type': 'text/html' } })
    }

    return new Response('not here', { status: 404 })
  },
})
