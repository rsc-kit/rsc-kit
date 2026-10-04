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

describe("a query read on a request's render", () => {
  // The server renders a hole per request, so it has the visitor's query:
  // useSearchParams() answers with it, and a client component reading it
  // renders on the server like any other. Before, the read was refused on
  // every request and the browser rendered it after a flash - a settings
  // form reading ?root= lost its server render. Only a render that may be
  // stored - the build - still refuses; fallbackReport.test.ts pins that.
  test("in a resumed hole: rendered with the query, nothing reported, nothing left to the browser", async () => {
    const postponed = JSON.parse(readFileSync(join(dir, "query-top.postponed.json"), "utf-8"));
    let html = "";

    const output = await reported(async () => {
      const { htmlStream } = (await withRequest(
        new Request("http://app.test/query-top?q=hello"),
        () => engine.handleRscResume("app/query-top/page", {}, LAYOUTS, ["app/loading"], {}, {}, postponed, undefined, "/query-top"),
      )) as { htmlStream: ReadableStream };

      html = await new Response(htmlStream).text();
    });

    expect(html).toContain("hello");
    expect(html).not.toContain("$RX(");
    expect(output).toBe("");
  });

  test("on a page rendered per request: rendered with the query, nothing reported", async () => {
    let html = "";

    const output = await reported(async () => {
      const { htmlStream } = (await withRequest(
        new Request("http://app.test/query?q=shoes"),
        () => engine.handleRscHtmlStream("app/query/page", {}, LAYOUTS, ["app/loading"], {}, {}, undefined, "/query"),
      )) as { htmlStream: ReadableStream };

      html = await new Response(htmlStream).text();
    });

    expect(html).toContain("shoes");
    expect(output).not.toContain("nothing closer than a loading.tsx");
  });
});
