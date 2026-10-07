// The payload a document carries for itself - see ../inlineFlight.ts.
//
// The server writes each chunk of the render's payload into the document as a
// script, `self.__rsc_f.push(chunk)`, and a null once it has finished. This
// turns those into the stream the runtime decodes, as if it had fetched it:
// what arrived before the runtime ran, then each chunk as it is parsed.

interface Queue {
  push(chunk: unknown): number;
  length: number;
  [index: number]: unknown;
}

/**
 * The document's own payload as a response, or null when it carries none -
 * a page from a file the build wrote, a server that writes none - and the
 * runtime fetches it, as it always did.
 */
export function inlinePayload(): Response | null {
  const w = window as unknown as { __rsc_f?: Queue; __rsc_l?: string };
  const queue = w.__rsc_f;

  if (!queue || typeof queue.push !== "function") return null;

  const encoder = new TextEncoder();
  const bytes = (chunk: unknown): Uint8Array =>
    typeof chunk === "string"
      ? encoder.encode(chunk)
      : Uint8Array.from(atob((chunk as { b: string }).b), (c) => c.charCodeAt(0));

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let ended = false;
      const take = (chunk: unknown) => {
        if (ended) return;
        if (chunk === null) {
          ended = true;
          controller.close();

          return;
        }
        controller.enqueue(bytes(chunk));
      };

      for (let i = 0; i < queue.length; i++) take(queue[i]);
      queue.length = 0;
      queue.push = (chunk: unknown) => {
        take(chunk);

        return 0;
      };

      // A document cut off before the server's end marker: what arrived is
      // all there is, and the decoder is told so rather than left waiting.
      const finished = () => take(null);

      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", finished, { once: true });
      else finished();
    },
  });

  const headers: Record<string, string> = { "Content-Type": "text/x-component", "X-RSC-Segment-Depth": "0" };

  if (typeof w.__rsc_l === "string") headers["X-RSC-Layouts"] = w.__rsc_l;

  delete w.__rsc_l;

  return new Response(body, { headers });
}
