import { describe, expect, test } from 'bun:test'
import { inlineFlight, inlineFlightStart } from '../../src/inlineFlight'

const enc = new TextEncoder()

/** A stream whose chunks the test pushes when it chooses. */
function source() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) })

  return {
    stream,
    push: (text: string | Uint8Array) => controller.enqueue(typeof text === 'string' ? enc.encode(text) : text),
    close: () => controller.close(),
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the payload streamed into its document', () => {
  test('never lands between two pieces of one HTML flush', async () => {
    // React writes a flush in pieces that can end mid-tag, all in one task.
    const html = source()
    const flight = source()
    const text = new Response(inlineFlight(html.stream, flight.stream)).text()

    flight.push('0:"a"')
    html.push('<div cla')
    html.push('ss="x">one</div>')
    await tick()
    html.push('<p>two</p>')
    flight.push('1:"b"')
    html.close()
    flight.close()

    const out = await text

    // The split tag is whole: nothing was written between its two pieces.
    expect(out).toContain('<div class="x">one</div>')
    // Every chunk is there, in order, and the end marker is last.
    expect(out.indexOf('push("0:\\"a\\"")')).toBeLessThan(out.indexOf('push("1:\\"b\\"")'))
    expect(out).toEndWith('<script>self.__rsc_f.push(null)</script>')
    expect(out.replace(/<script>[^<]*<\/script>/g, '')).toBe('<div class="x">one</div><p>two</p>')
  })

  test('a slow hole streams its payload as it arrives, and ends once both have finished', async () => {
    const html = source()
    const flight = source()
    const chunks: string[] = []
    const reader = inlineFlight(html.stream, flight.stream).getReader()
    const read = (async () => {
      for (;;) {
        const { done, value } = await reader.read()

        if (done) return
        chunks.push(new TextDecoder().decode(value))
      }
    })()

    html.push('<main>shell</main>')
    flight.push('0:"shell"')
    await tick()
    await tick()

    // Out before the hole has resolved.
    expect(chunks.join('')).toContain('self.__rsc_f.push("0:\\"shell\\"")')
    expect(chunks.join('')).not.toContain('push(null)')

    html.close()
    flight.push('1:"hole"')
    flight.close()
    await read

    expect(chunks.join('')).toEndWith('<script>self.__rsc_f.push("1:\\"hole\\"")</script><script>self.__rsc_f.push(null)</script>')
  })

  test('nothing in the payload can close the script or open a comment', async () => {
    const html = source()
    const flight = source()
    const text = new Response(inlineFlight(html.stream, flight.stream)).text()

    flight.push('0:"</script><script>alert(1)</script><!--"')
    html.close()
    flight.close()

    const out = await text

    expect(out).not.toContain('</script><script>alert')
    expect(out).not.toContain('<!--')
    expect(out).toContain('\\u003c/script>')
  })

  test('bytes that are not text go as base64, and a character split across chunks survives', async () => {
    const html = source()
    const flight = source()
    const text = new Response(inlineFlight(html.stream, flight.stream)).text()
    const euro = enc.encode('€')

    flight.push(euro.slice(0, 1))
    flight.push(euro.slice(1))
    flight.push(new Uint8Array([0xff, 0xfe]))
    html.close()
    flight.close()

    const out = await text

    expect(out).toContain('self.__rsc_f.push("€")')
    expect(out).toContain('self.__rsc_f.push({b:"//4="})')
  })

  test('the declaration names the layouts, safely', () => {
    expect(inlineFlightStart('app/layout,app/(shop)/layout')).toBe(
      '<script>self.__rsc_f=self.__rsc_f||[];self.__rsc_l="app/layout,app/(shop)/layout"</script>',
    )
    expect(inlineFlightStart('</script>')).not.toContain('</script>"')
  })
})
