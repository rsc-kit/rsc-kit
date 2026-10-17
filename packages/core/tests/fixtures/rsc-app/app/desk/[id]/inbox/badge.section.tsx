import { section } from '@rsc-kit/core/section'

/** A page's own region, beside the layout's: the nearer one is listed first. */
export default section('badge', async function Badge({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return <span id="inbox-badge">3 unread for desk {id}</span>
})
