import { section } from '@rsc-kit/core/section'

let renders = 0

/** A layout's region: the pages beside it are reached by their own urls, the header by its name. */
export default section(
  'header',
  async function DeskHeader({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params

    renders++

    return <header id="desk-header">desk {id} header render #{renders}</header>
  },
  { refreshOn: ({ params }) => [`desk:${params.id}`] },
)
