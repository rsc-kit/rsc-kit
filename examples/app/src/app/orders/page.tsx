import Orders from './orders.section'
import { AddOrder } from '../../components/AddOrder'
import type { Metadata } from '@rsc-kit/core/metadata'

export const metadata: Metadata = { title: 'Orders' }

export default function OrdersPage() {
  return (
    <>
      <h1>Orders</h1>
      <p>
        Adding an order re-renders the list alone. The heading, the form and
        everything else on this page stay exactly as they are — including
        anything half-typed.
      </p>

      <AddOrder />
      <Orders />
    </>
  )
}
