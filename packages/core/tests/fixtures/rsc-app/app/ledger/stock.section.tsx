import { section } from '@rsc-kit/core/section'

/** A region that says what it depends on, so a change anywhere refreshes it. */
export default section(
  'stock',
  async function Stock() {
    return <div id="stock">stock</div>
  },
  { refreshOn: async ({ params }) => ['stock', `warehouse:${(await (params as Promise<Record<string, string>>)).site ?? 'main'}`] },
)
