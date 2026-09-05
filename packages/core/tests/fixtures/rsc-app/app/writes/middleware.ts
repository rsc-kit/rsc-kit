import { cookies, responseHeaders } from '../../../../../src/request'

// Middleware runs before the render, which is also before the host has built a
// response — the one window in which a header can still be put on it.
export default async function middleware() {
  responseHeaders().set('X-Wrote', 'middleware')

  const jar = await cookies()

  jar.set('session', 'abc', { httpOnly: true })
  jar.set('locale', 'fr')
}
