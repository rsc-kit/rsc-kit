// Ships no client runtime: rendered to HTML and nothing else. No React in the
// browser, no router, no Flight client.
export const clientJs = false

// Metadata on a route with no runtime, deliberately: the title effect that
// keeps a retained page's <title> from winning is a client component, and a
// client component here is refused by the build. So this page failing to build
// is the regression test — the guard that only adds it where there is a
// runtime has no other way to be checked.
export const metadata = { title: 'Plain' }

export default function PlainPage() {
  return (
    <main>
      <h1 id="plain">A page that ships no JavaScript</h1>
    </main>
  )
}
