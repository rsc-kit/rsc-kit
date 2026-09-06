import { redirect } from '../../../../../src/redirect'

// The question this whole file exists to answer: can a guard reach the backend?
//
// It is not a component and it runs before anything below it renders, so if
// rpc() works here, authorization can live in Go — which is what route.php's
// middleware() and can() do for Laravel.
export default async function guard() {
  const allowed = await (globalThis as any).rpc('Auth.check')

  if (!allowed) redirect('/login')
}
