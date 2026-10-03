import Orders from './orders.section'
import Stock from './stock.section'

/** What the page as a whole depends on: a change refreshes the page. */
export const tags = ['ledger']

export default function LedgerPage() {
  return (
    <main>
      <h1 id="ledger">Ledger</h1>
      <Orders />
      <Stock />
    </main>
  )
}
