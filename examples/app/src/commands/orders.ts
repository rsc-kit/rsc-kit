import { listOrders } from '../orders'

export const description = 'Count the orders the pages share'

// No `register`: instrumentation.ts is not imported for this one, so neither
// its environment checks nor register() run.
export default async function (args: string[]) {
  console.log(`orders=${(await listOrders()).length} args=${JSON.stringify(args)} registered=${Boolean(globalThis.__registered)}`)
}
