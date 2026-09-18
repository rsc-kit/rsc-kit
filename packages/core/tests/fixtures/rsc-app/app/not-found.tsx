// The page for a url nothing answers, rendered through the layout chain like
// any other - so a navigation to a missing route stays in the app.
export default function NotFound() {
  return (
    <main>
      <h1 id="not-found">Nothing here</h1>
      <p>That page does not exist.</p>
    </main>
  );
}
