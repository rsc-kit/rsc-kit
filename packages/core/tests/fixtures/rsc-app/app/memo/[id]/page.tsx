// Re-exported under the name the engine looks for: what a page does when its
// metadata comes from a library - export const generateMetadata = site.generateMetadata
// is the const form; this is the list form.
export { titled as generateMetadata } from './meta'

export default function MemoPage() {
  return <main id="memo">A memo</main>
}
