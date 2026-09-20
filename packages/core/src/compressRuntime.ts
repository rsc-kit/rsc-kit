// The compressor, from whichever runtime has one.
//
// node:zlib on Node and Bun - imported once, lazily, so the host loads on a
// Worker (which has no zlib and needs none: the platform compresses) and
// simply answers uncompressed there. Not the web CompressionStream: neither
// runtime lets a caller flush it per chunk, and a streamed page held back
// in a compressor's buffer is a page that stopped streaming.

export interface Deflater {
  /** One buffer in, one out: for an answer known whole. */
  whole(bytes: Uint8Array): Promise<Uint8Array>;
  /** A stream through the compressor, every chunk flushed as it arrives. */
  stream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array>;
}

type Zlib = typeof import("node:zlib");

let loading: Promise<Deflater | null> | null = null;

function onWorkers(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

function deflaterFrom(zlib: Zlib): Deflater {
  return {
    whole(bytes) {
      return new Promise((resolve, reject) => {
        zlib.gzip(bytes, (error, out) => (error ? reject(error) : resolve(new Uint8Array(out))));
      });
    },

    stream(body) {
      const gz = zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH });
      const reader = body.getReader();

      return new ReadableStream<Uint8Array>({
        start(controller) {
          gz.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          gz.on("end", () => controller.close());
          gz.on("error", (error: Error) => controller.error(error));

          void (async () => {
            try {
              for (;;) {
                const { done, value } = await reader.read();

                if (done) break;

                // Back-pressure from the compressor: wait for drain rather
                // than queueing an unbounded amount in front of it.
                if (!gz.write(value)) await new Promise<void>((resolve) => gz.once("drain", resolve));
              }

              gz.end();
            } catch (error) {
              gz.destroy(error as Error);
            }
          })();
        },
        cancel(reason) {
          gz.destroy();

          return reader.cancel(reason);
        },
      });
    },
  };
}

/** The runtime's compressor, or null where there is none. */
export function deflate(): Promise<Deflater | null> {
  if (loading) return loading;

  loading = onWorkers()
    ? Promise.resolve(null)
    : import("node:zlib").then(
        (zlib) => deflaterFrom(zlib),
        () => null,
      );

  return loading;
}
