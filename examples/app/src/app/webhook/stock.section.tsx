import { section } from '@rsc-kit/core/section'
import { stockLeft } from './store'

/**
 * A region that names what it depends on. When anything says 'stock'
 * changed - here the restock webhook, in a real app a supplier's - every
 * open tab showing this refreshes it, with nothing polling.
 */
export default section(
  'stock',
  async function Stock() {
    const { left, restocked } = stockLeft()

    return (
      <p id="stock">
        <strong>{left}</strong> in stock
        {restocked > 0 && <small> — restocked {restocked} time{restocked === 1 ? '' : 's'}</small>}
      </p>
    )
  },
  { refreshOn: ['stock'] },
)
