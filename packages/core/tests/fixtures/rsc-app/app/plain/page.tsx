// A page with nothing to hydrate. Nothing declared: whether it ships the
// runtime is decided by what is in its tree, and under the fixture's root
// layout - which renders <Nav> - that is the runtime. Rendered without that
// layout in the prerender tests, it is stored with no script at all.
//
// Metadata here on purpose: the title effect that keeps a retained page's
// <title> from winning is a client component, and it must only be added where
// there is a runtime to run it. A page stored without one that still renders
// correctly is that guard's regression test.
export const metadata = { title: 'Plain' }

export default function PlainPage() {
  return (
    <main>
      <h1 id="plain">A page that ships no JavaScript</h1>
    </main>
  )
}
