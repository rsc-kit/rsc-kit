import type { GenerateMetadata } from '../../../../../../src/metadata'

// Written the way the metadata guide writes it: a typed const, not a
// function declaration. The build once read only the function form, and
// this page was titled by its layout.
export const generateMetadata: GenerateMetadata<{ id: string }> = async ({ params }) => {
  const { id } = await params

  return { title: `Note ${id}` }
}

export default function NotePage() {
  return <main id="note">A note</main>
}
