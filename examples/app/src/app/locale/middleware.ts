import { cookies, headers } from '@rsc-kit/core/request'

// What middleware is for beyond refusing: deciding something about the request
// before anything renders. No library needed — a header is a header.
//
// Settling it here rather than redirecting: a redirect would have to land on a
// url that encodes the choice, and every such url is another route to write.
// Middleware runs before the host has an answer, so it can put the decision on
// the response instead and let the page render normally.
export default async function middleware() {
  const jar = await cookies()

  if (jar.get('locale')) return

  // `||`, not `??`: a client that sends `Accept-Language:` with nothing after
  // it yields '', which is a value ?? would keep and a cookie nobody wants.
  const offered = (await headers()).get('accept-language')?.slice(0, 2)

  jar.set('locale', offered || 'en', { sameSite: 'lax' })
}
