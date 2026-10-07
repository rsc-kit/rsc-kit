// The page's payload, streamed inside its own document.
//
// Hydrating server components needs the serialised tree as well as the HTML.
// It used to be a second request - and a second render of the whole page, its
// reads and its queries, a moment after the document's render had made exactly
// that tree. Now the render's payload is written into the document as it
// streams, a script per chunk between React's HTML, and the runtime reads it
// from there. One render per visit, nothing held anywhere, and the slow parts
// of the page stream in the payload the moment they do in the HTML.
//
// React writes its HTML in pieces that can end mid-tag, but always all the
// pieces of one flush in the same task. So a payload chunk is written on the
// next task, never between two pieces of one flush. (The rsc-html-stream
// package does the same.)
//
// Read in the browser by js/inlinePayload.ts.

const encoder = new TextEncoder();

/** The script that declares the payload is coming, and what the page is built from. */
export function inlineFlightStart(layouts: string): string {
  return `<script>self.__rsc_f=self.__rsc_f||[];self.__rsc_l=${script(layouts)}</script>`;
}

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
          controller.enqueue(encoder.encode(pending.join("")));
          pending = [];
        }
        if (flightDone && htmlDone) {
          closed = true;
          controller.enqueue(encoder.encode("<script>self.__rsc_f.push(null)</script>"));
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
          pending.push(`<script>self.__rsc_f.push(${chunk(value)})</script>`);
          later();
        }
        // A character split across the last two chunks would be held here.
        const tail = decoder.decode();

        if (tail) pending.push(`<script>self.__rsc_f.push(${script(tail)})</script>`);
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

      return `{b:${script(btoa(binary))}}`;
    }
  }
}

/** A string literal safe inside a <script>: no way to close the element or open a comment. */
function script(text: string): string {
  return JSON.stringify(text)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
