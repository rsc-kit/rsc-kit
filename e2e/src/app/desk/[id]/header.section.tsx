import { section } from '@rsc-kit/core/section'

let renders = 0

// Written the way the docs say: params passed through by the layout, read by
// the section. A refresh renders it with the page's props instead, which carry
// the same segments.
async function DeskHeader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  renders++

  return <header id="desk-header">desk {id} header render #{renders}</header>
}

const Header = section('header', DeskHeader, { refreshOn: ({ params }) => [`desk:${params.id}`] })

export default Header
