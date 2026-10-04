import { section } from '@rsc-kit/core/section'

let renders = 0

// Passed by shorthand, `{ refreshOn }`, which the build must see as well.
const refreshOn = ['board']

/** The same for everyone who may see the ledger: one render per change answers every tab. */
export default section(
  'board',
  async function Board() {
    renders++

    return <div id="board">board render #{renders}</div>
  },
  { refreshOn, shared: true },
)
