// Registers happy-dom exactly once.
//
// Bun runs every test file in one process and GlobalRegistrator throws on a
// second call, so whichever DOM-using suite loaded second used to fail the
// whole run. Importing this instead of calling register() directly keeps that
// from depending on file order.

import { GlobalRegistrator } from '@happy-dom/global-registrator'

let registered = false

export function registerDom(): void {
  if (registered) return

  registered = true
  // With no url the document is about:blank, whose origin is the string
  // "null" — enough for history.replaceState to set a path, but `new URL(path,
  // origin)` throws, so any code resolving a relative URL cannot be tested.
  GlobalRegistrator.register({ url: 'https://example.test/' })

  // Tells React it is inside a test renderer, so act() flushes effects and
  // state updates synchronously instead of warning and deferring.
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
}
