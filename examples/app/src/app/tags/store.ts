// The stock, in this process. What a database holds in a real app.
let left = 12
let restocked = 0

export function stockLeft(): { left: number; restocked: number } {
  return { left, restocked }
}

/** What a supplier's webhook would do: more arrived. */
export function restock(count = 5): void {
  left += count
  restocked++
}
