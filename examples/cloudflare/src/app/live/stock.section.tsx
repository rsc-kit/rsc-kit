import { connection } from '@rsc-kit/core/request'
import { section } from '@rsc-kit/core/section'
import { stockLeft } from '../../versions'

/** Refreshes in every open tab when the restock webhook says 'stock' changed. */
export default section(
  'stock',
  async function Stock() {
    // D1 is there per request, never at build: the build leaves this a hole.
    await connection()

    return (
      <p id="stock" className="mt-4">
        <strong>{await stockLeft()}</strong> in stock
      </p>
    )
  },
  { refreshOn: ['stock'] },
)
