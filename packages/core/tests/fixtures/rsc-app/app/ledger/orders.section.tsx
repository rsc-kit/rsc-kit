import { section } from '@rsc-kit/core/section'

let renders = 0

/** A region a page can refresh on its own, without the page around it. */
export default section('orders', async function Orders() {
  renders++

  return <div id="orders">orders render #{renders}</div>
})
