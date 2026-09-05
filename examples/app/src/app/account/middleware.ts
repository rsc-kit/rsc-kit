import { cookies, responseHeaders } from '@rsc-router/core/request'

// Middleware runs before anything below it renders, which is also before the
// host has built a response — so this is the one place left where a header or a
// cookie can still be put on it. A component runs after, while the response is
// already streaming, and writing from there throws rather than being dropped.
//
// The page below is frozen at build time and stays frozen: what is written here
// is per request, so neither costs the other anything.
export default async function middleware() {
  responseHeaders().set('X-Account-Section', 'yes')

  const jar = await cookies()

  if (!jar.get('seen-account')) {
    jar.set('seen-account', new Date().toISOString(), { httpOnly: true, sameSite: 'lax' })
  }
}
