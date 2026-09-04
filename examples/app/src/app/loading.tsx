// Shown while a page's own await is still outstanding. The build refuses to
// bundle a page that blocks before it can paint without one of these in its
// directory chain — a blank screen is not a loading state.
export default function Loading() {
  return <p className="muted">Loading…</p>
}
