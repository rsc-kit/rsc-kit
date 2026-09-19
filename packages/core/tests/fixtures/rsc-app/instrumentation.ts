// The process bootstrap. Evaluated before any page module - it is the
// generated entry's first import - and register() is awaited before the
// first render, action, query, api route or middleware check.
//
// What it records is what the tests assert: that a page module evaluating
// after this one can see it, that register() finished before a render read
// it, and that it ran once for the life of the process however many renders
// followed.

declare global {
  // eslint-disable-next-line no-var
  var __instrumentation: { evaluated: boolean; registered: number; ready: boolean }
}

globalThis.__instrumentation = { evaluated: true, registered: 0, ready: false }

export async function register() {
  globalThis.__instrumentation.registered += 1

  // Something genuinely asynchronous, so a render that did not wait would
  // observe ready === false.
  await new Promise((resolve) => setTimeout(resolve, 20))

  globalThis.__instrumentation.ready = true
}
