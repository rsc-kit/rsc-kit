import Stock from './stock.section'
import { Restock } from './restock'
import type { Metadata } from '@rsc-kit/core/metadata'

export const metadata: Metadata = { title: 'Names' }

/**
 * Data that changes because of something outside the tab.
 *
 * /polling reads a value again on a timer; /live has the server push it.
 * Both need the tab to do the watching. Here the section names what it
 * depends on - the name 'stock' - and the webhook that changes the stock says
 * so. Every open tab showing the section refreshes it: open this page twice
 * and press the button in one.
 */
export default function TagsPage() {
  return (
    <main>
      <h1>A section refreshed by a webhook</h1>
      <p>
        The stock section declares <code>refreshOn: ['stock']</code>. The restock route - a supplier's webhook, here
        a button - calls <code>changed('stock')</code>, and the section refreshes in every tab that shows it.
        Nothing polls.
      </p>

      <Stock />
      <Restock />
    </main>
  )
}
