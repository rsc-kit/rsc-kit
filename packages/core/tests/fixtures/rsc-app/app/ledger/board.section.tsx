import { section } from '@rsc-kit/core/section'

let renders = 0

/** The same for everyone who may see the ledger: one render per change answers every tab. */
export default section(
  'board',
  async function Board() {
    renders++

    return <div id="board">board render #{renders}</div>
  },
  { refreshOn: ['board'], shared: true },
)
