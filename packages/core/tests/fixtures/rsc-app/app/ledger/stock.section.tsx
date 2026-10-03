import { section } from '@rsc-kit/core/section'

/** A region that says what it depends on, so a change anywhere refreshes it. */
export default section(
  'stock',
  async function Stock() {
    return <div id="stock">stock</div>
  },
  // Written the way anyone writes it: params arrive awaited.
  { refreshOn: ({ params }) => ['stock', `warehouse:${params.site ?? 'main'}`] },
)
