// Whose boundary caught a read, on a PPR resume.
//
// The built server resumes a stored shell per request, and a read the
// server cannot answer - useSearchParams() in a client component - is caught
// at the nearest Suspense. If that is the engine's loading.tsx boundary the
// server says so, once, because the whole segment is the fallback until the
// query arrives. If it is a boundary the developer wrote, there is nothing
// to say. On a resume React leaves server components out of the component
// stack, so a developer's <Suspense> at the top of a segment sits directly
// under the engine's segment boundary - and used to be reported as the
// engine's, on every request, with advice the app had already followed.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prerender } from "../../src/prerender";
import { writeTo } from "../../src/files";
import { withRequest } from "../../src/request";
import { buildFixtureOnce, bundlePath } from "./goHost";
import { assertServerRuntime } from "./serverRuntime";

assertServerRuntime("resumeReport.test.ts");

let engine: any;
let dir: string;
const LAYOUTS = [{ component: "app/layout", props: {} }];

/** Everything console.error printed while `run` ran, as one string. */
async function reported(run: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const original = console.error;

  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };

  try {
    await run();
  } finally {
    console.error = original;
  }

  return lines.join("\n");
}

beforeAll(async () => {
  await buildFixtureOnce();
  engine = await import(bundlePath);
  dir = mkdtempSync(join(tmpdir(), "rsc-resume-report-"));

  // The host the resumed render reads from; the build's probe never answers it.
  engine.installHostFn(async (name: string, ms: number) => {
    await new Promise((r) => setTimeout(r, ms));

    return { value: `${ms}ms` };
  });

  const manifest = engine.manifest();

  await prerender({
    engine,
    manifest: {
      ...manifest,
      routes: manifest.routes.filter((r: { component: string }) => r.component === "app/query-top/page"),
    },
    write: writeTo(dir),
  });
}, 180_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  engine?.installHostFn(async () => null);
});

describe("a read caught on a PPR resume", () => {
  test("under the developer's own <Suspense> at the top of the segment: nothing is reported", async () => {
    const postponed = JSON.parse(readFileSync(join(dir, "query-top.postponed.json"), "utf-8"));

    const output = await reported(async () => {
      const { htmlStream } = (await withRequest(
        new Request("http://app.test/query-top?q=hello"),
        () => engine.handleRscResume("app/query-top/page", {}, LAYOUTS, ["app/loading"], {}, {}, postponed, undefined, "/query-top"),
      )) as { htmlStream: ReadableStream };

      const html = await new Response(htmlStream).text();

      // The resume did reach the query read: the boundary it was caught at
      // is handed to the browser to retry ($RX), which is the designed path
      // for a read only the browser can answer.
      expect(html).toContain("$RX(");
    });

    // Not the one-line report, and not the raw error either: a read the
    // developer's boundary caught is the designed path, and a resume used
    // to print it as "[rsc-kit:resume] Error: useSearchParams() was read..."
    // on every request.
    expect(output).not.toContain("nothing closer than a loading.tsx");
    expect(output).not.toContain("[rsc-kit:resume]");
    expect(output).toBe("");
  });

  test("with nothing closer than the loading.tsx: one line, naming the reader", async () => {
    const output = await reported(async () => {
      const { htmlStream } = (await withRequest(
        new Request("http://app.test/query"),
        () => engine.handleRscHtmlStream("app/query/page", {}, LAYOUTS, ["app/loading"], {}, {}, undefined, "/query"),
      )) as { htmlStream: ReadableStream };

      await new Response(htmlStream).text();
    });

    expect(output).toContain("QueryReader: useSearchParams() was read on the server with nothing closer than a loading.tsx");
  });
});
