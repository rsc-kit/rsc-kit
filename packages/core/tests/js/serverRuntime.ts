// A server suite asserts it has the runtime's fetch classes.
//
// Bun runs every test file in one process unless told to isolate, and the
// first DOM suite to load registers happy-dom, which replaces Response,
// Headers and Request with a browser's for everything after it. A browser's
// Headers may not carry Set-Cookie, so Response.json(body, { headers: {
// 'Set-Cookie': … } }) silently drops it - and the api classifier stored a
// cookie route, once per bare `bun test`, never under `bun run test`, which
// isolates. That was a phantom debugged three times. It is a message now.

/**
 * The runtime's Response, told apart from happy-dom's by behaviour rather
 * than identity - which would depend on which file loaded this first. A
 * browser's Headers drops Set-Cookie from an init; Bun's keeps it.
 */
function isRuntimeResponse(): boolean {
  try {
    return new Response(null, { headers: { 'Set-Cookie': 'probe=1' } }).headers.has('set-cookie')
  } catch {
    return false
  }
}

export function assertServerRuntime(suite: string): void {
  if (isRuntimeResponse()) return

  throw new Error(
    `${suite} is a server suite and is running against a browser's Response: a DOM suite loaded first in the ` +
      'same process and happy-dom replaced the fetch classes. Run the suite isolated, as package.json and CI do: ' +
      '`bun run test` (bun test --isolate).',
  )
}
