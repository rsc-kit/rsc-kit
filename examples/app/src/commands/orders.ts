import { listOrders } from '../orders'

export const description = 'Count the orders the pages share'

// No `register`: the app's register() is not called for this one.
export default async function (args: string[]) {
  console.log(`orders=${(await listOrders()).length} args=${JSON.stringify(args)} registered=${Boolean(globalThis.__registered)}`)
}
