// The page's payload, streamed inside its own document.
//
// Hydrating server components needs the serialised tree as well as the HTML.
// It used to be a second request - and a second render of the whole page, its
// reads and its queries, a moment after the document's render had made exactly
// that tree. Now the render's payload is written into the document as it
// streams, a block per chunk between React's HTML, and the runtime reads it
// from there. One render per visit, nothing held anywhere, and the slow parts
// of the page stream in the payload the moment they do in the HTML.
//
// A block is data, not code: `<script type="application/json" data-rsc>`,
// which a browser never runs and a Content-Security-Policy never judges. The
// chunks are the visitor's own data, so as scripts no policy short of
// 'unsafe-inline' or a nonce could allow them - and a nonce is impossible on
// a page a cache shares. READ_BLOCKS, in the boot script every page carries,
// hands each block to the runtime's queue as the parser finishes it.
//
// React writes its HTML in pieces that can end mid-tag, but always all the
// pieces of one flush in the same task. So a payload chunk is written on the
// next task, never between two pieces of one flush. (The rsc-html-stream
// package does the same.)
//
// Read in the browser by js/inlinePayload.ts.

const encoder = new TextEncoder();

/** One chunk of the payload, as data. */
const BLOCK = '<script type="application/json" data-rsc>';

/**
 * What ends every write that ends in a block. The reader takes a block once
 * the parser has moved past it - once it has a next sibling - since until
 * then its text may still be arriving. A block written just before the
 * stream waits on a slow hole would otherwise sit unread until the hole came.
 */
const PAST = "<!---->";

/** The block that declares the payload is coming, and what the page is built from. */
export function inlineFlightStart(layouts: string): string {
  return `<script type="application/json" data-rsc="l">${script(layouts)}</script>${PAST}`;
}

/**
 * Hands each block to `self.__rsc_f` once the parser has finished it, in
 * document order: the ones already parsed when it runs, then each one added
 * after. Part of the boot script, so it runs before the runtime that reads
 * the queue, and on every page: a page whose payload is a file has no blocks
 * and this does nothing. Stops at DOMContentLoaded, when the document - and
 * so the payload - is complete.
 */
export const READ_BLOCKS =
  "(function(){var d=document,p=[];" +
  "function r(){for(var s;(s=p[0])&&(s.nextSibling||d.readyState!=='loading');){p.shift();" +
  "var v=JSON.parse(s.textContent),q=self.__rsc_f=self.__rsc_f||[];" +
  "if(s.getAttribute('data-rsc')==='l')self.__rsc_l=v;else q.push(v)}}" +
  "function a(n){n.nodeName==='SCRIPT'&&n.hasAttribute('data-rsc')&&p.push(n)}" +
  "d.querySelectorAll('script[data-rsc]').forEach(a);" +
  "var o=new MutationObserver(function(m){for(var i=0;i<m.length;i++)m[i].addedNodes.forEach(a);r()});" +
  "o.observe(d,{childList:true,subtree:true});" +
  "d.addEventListener('DOMContentLoaded',function(){o.disconnect();r()});r()})();";

/**
 * The HTML with the payload interleaved, and an end marker once both have
 * finished. `prelude` - the declaration - goes after the first flush, never
 * ahead of the HTML: in front of the doctype it would put the page in quirks
 * mode.
 */
export function inlineFlight(
  html: ReadableStream<Uint8Array>,
  flight: ReadableStream<Uint8Array>,
  prelude = "",
): ReadableStream<Uint8Array> {
  const htmlReader = html.getReader();
  const flightReader = flight.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending: string[] = prelude ? [prelude] : [];
  let scheduled: ReturnType<typeof setTimeout> | null = null;
  let flightDone = false;
  let htmlDone = false;
  let closed = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const flush = () => {
        scheduled = null;

        if (closed) return;
        if (pending.length) {
          controller.enqueue(encoder.encode(pending.join("") + PAST));
          pending = [];
        }
        if (flightDone && htmlDone) {
          closed = true;
          controller.enqueue(encoder.encode(`${BLOCK}null</script>${PAST}`));
          controller.close();
        }
      };
      // After the task React is flushing in, so never between its pieces.
      const later = () => {
        scheduled ??= setTimeout(flush, 0);
      };

      const readHtml = async () => {
        for (;;) {
          const { done, value } = await htmlReader.read();

          if (done) break;
          if (!closed) controller.enqueue(value);
          // Anything the payload had waiting goes after this flush, not in it.
          if (pending.length) later();
        }
        htmlDone = true;
        later();
      };

      const readFlight = async () => {
        for (;;) {
          const { done, value } = await flightReader.read();

          if (done) break;
          pending.push(`${BLOCK}${chunk(value)}</script>`);
          later();
        }
        // A character split across the last two chunks would be held here.
        const tail = decoder.decode();

        if (tail) pending.push(`${BLOCK}${script(tail)}</script>`);
        flightDone = true;
        later();
      };

      const fail = (error: unknown) => {
        if (closed) return;
        closed = true;
        void htmlReader.cancel(error).catch(() => {});
        void flightReader.cancel(error).catch(() => {});
        controller.error(error);
      };

      readHtml().catch(fail);
      readFlight().catch(fail);
    },
    cancel(reason) {
      closed = true;
      if (scheduled) clearTimeout(scheduled);
      void htmlReader.cancel(reason).catch(() => {});
      void flightReader.cancel(reason).catch(() => {});
    },
  });

  // Text as a string, which compresses with the page. A chunk that is not
  // UTF-8 - a typed array in the payload - goes as base64.
  function chunk(value: Uint8Array): string {
    try {
      return script(decoder.decode(value, { stream: true }));
    } catch {
      let binary = "";

      for (const byte of value) binary += String.fromCharCode(byte);

      return `{"b":${script(btoa(binary))}}`;
    }
  }
}

/**
 * A JSON string safe inside a <script>: no way to close the element or open a
 * comment. JSON, because the reader parses it: a block is never run.
 */
function script(text: string): string {
  return JSON.stringify(text)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
