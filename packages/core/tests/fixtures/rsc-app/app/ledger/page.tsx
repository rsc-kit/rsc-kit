import Orders from './orders.section'
import Stock from './stock.section'
import Board from './board.section'

/**
 * What the page as a whole depends on: a change refreshes the page.
 * Re-exported, not declared here - which the build must see as the same.
 */
export { refreshOn } from './names'

export default function LedgerPage() {
  return (
    <main>
      <h1 id="ledger">Ledger</h1>
      <Orders />
      <Stock />
      <Board />
    </main>
  )
}
