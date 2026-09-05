// The same app on Node, with no framework at all.
//
// Node has no `fetch` server, so this is the one entry that has to translate:
// an IncomingMessage in, a ServerResponse out, with a web Request and Response
// in between. Everything either side of that translation is identical to the
// Bun, Hono and Elysia entries — `rsc-kit/host` never learns which it is.
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createRscHandler } from '@rsc-kit/core/host'
import { assetsFrom, prerenderedFrom } from '@rsc-kit/core/files'
import * as engine from './build/dist/rsc/index.js'

const rsc = createRscHandler({
  engine,
  assets: assetsFrom('./build/public'),
  prerendered: prerenderedFrom('./build/static'),
})

// Node exits on an unhandled rejection; Bun logs one and carries on. That
// difference is reachable from outside: a malformed body posted to
// /_rsc/action fails inside React's Flight decoder, in a promise nobody
// awaits, so no try/catch in this file or in rsc-kit can see it — and on
// Node the process dies. Any Node server wants this; here it is the
// difference between a 500 and a denial of service.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandled rejection]', reason)
})

// #region adapter
const server = createServer(async (req, res) => {
  const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'

  const request = new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    // A server action posts binary. Streaming it rather than buffering keeps
    // an upload from being held twice, and `duplex` is required by the spec
    // for any request that carries a stream.
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit)

  // A framework does this for you; on bare node:http it is yours to do. Left
  // out, a handler that throws never writes a response and the socket simply
  // hangs until Node's requestTimeout closes it.
  let response: Response

  try {
    response = (await rsc(request)) ?? new Response('Not found', { status: 404 })
  } catch (error) {
    console.error('[rsc]', error)
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('Internal Server Error')

    return
  }

  res.writeHead(response.status, Object.fromEntries(response.headers))

  if (!response.body) {
    res.end()

    return
  }

  // Piped, not buffered. Reading it to a string first would hold the whole
  // page before sending any of it — which is exactly the shell-first streaming
  // the engine exists to do, thrown away in the last three lines.
  Readable.fromWeb(response.body as never).pipe(res)
})
// #endregion

server.listen(8795, () => console.log('node:http — http://localhost:8795'))
