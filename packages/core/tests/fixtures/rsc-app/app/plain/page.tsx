// Ships no client runtime: rendered to HTML and nothing else. No React in the
// browser, no router, no Flight client.
export const clientJs = false

export default function PlainPage() {
  return (
    <main>
      <h1 id="plain">A page that ships no JavaScript</h1>
    </main>
  )
}
