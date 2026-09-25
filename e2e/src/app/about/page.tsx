// No client component and nothing read from the request: stored at build and
// served with no runtime at all - no script in the page, none in its headers.
export default function About() {
  return (
    <main>
      <h1>About</h1>
      <p>A page that ships no JavaScript.</p>
      <a href="/">Store</a>
    </main>
  )
}
