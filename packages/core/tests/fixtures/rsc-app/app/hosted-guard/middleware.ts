import { redirect } from '../../../../../src/redirect'

// A guard that asks the host, rather than deciding by itself.
//
// This is the shape authorization takes when the backend is another process:
// route.php's middleware() and can() have no equivalent outside Laravel, so
// the check lives here and the answer comes from wherever the session does.
//
// `!== true` rather than falsy, deliberately. A build has no visitor, and the
// host callable a prerender installs answers every name with placeholder data
// — truthy data. Treating that as permission would freeze this page into a
// file and serve it to everyone.
export default async function guard() {
  const allowed = await (globalThis as any).rpc('Auth.check')

  if (allowed !== true) redirect('/login')
}
