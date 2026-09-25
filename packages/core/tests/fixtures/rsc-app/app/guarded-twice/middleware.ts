import { redirect } from '../../../../../src/redirect'

// Several checks in one directory, as a list: run in the order written,
// stopping at the first refusal - the third never asked once the second has
// said no. What each was asked is recorded on the global, where a test in
// the same process can read the order.
const asked = (): string[] => ((globalThis as { __guardedTwice?: string[] }).__guardedTwice ??= [])

async function first() {
  asked().push('first')
}

async function second() {
  asked().push('second')

  redirect('/login')
}

async function third() {
  asked().push('third')
}

export default [first, second, third]
