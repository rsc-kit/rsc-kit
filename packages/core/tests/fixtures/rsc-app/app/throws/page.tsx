// Throws at the top level with no error.tsx anywhere above it - a query
// against a column that is not there, say. What the visitor sees is the
// engine's default: the layouts, and an error page where the page was.
export default async function ThrowsPage() {
  await Promise.resolve()

  throw new Error('column "original_key" does not exist')
}
