// Read at module evaluation, not at render: this is the ordering claim.
// A page that configures a shared package at import time needs the
// instrumentation module to have run first, and only import order gives it.
const sawInstrumentationAtImport = globalThis.__instrumentation?.evaluated === true

export default function Instrumented() {
  const state = globalThis.__instrumentation

  return (
    <dl id="instrumented">
      <dt>evaluated before this page</dt>
      <dd>{String(sawInstrumentationAtImport)}</dd>
      <dt>register finished before render</dt>
      <dd>{String(state.ready)}</dd>
      <dt>register calls</dt>
      <dd>{state.registered}</dd>
    </dl>
  )
}
