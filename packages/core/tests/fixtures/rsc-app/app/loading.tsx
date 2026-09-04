// Root boundary: app/page's default export awaits rpc(), so it blocks before
// it can paint and needs a fallback.
export default function RootLoading() {
  return <div id="root-loading">Loading…</div>
}
