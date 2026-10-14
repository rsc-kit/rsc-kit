import { addOrder, listOrders } from '../orders'

export const description = 'Add an order, after register()'
export const register = true

export default async function (args: string[]) {
  await addOrder(args[0] ?? 'seeded')

  console.log(`orders=${(await listOrders()).length} registered=${Boolean(globalThis.__registered)}`)
}
