/**
 * Resuming a shell stored for a whole pattern, for one url.
 *
 * The shell was rendered with params that never settled, and a
 * generateMetadata that read them was left out of it. The resume renders
 * the page for its real params - that is the hole it fills - and the
 * metadata the way the shell did, because a tree with a <title> the shell
 * had not got is a tree whose slots no longer match, and React then fills
 * nothing: a port's product pages came back as empty holes on every load.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prerender } from "../../src/prerender";
import { writeTo } from "../../src/files";
import { withRequest } from "../../src/request";
import { buildFixtureOnce, bundlePath } from "./goHost";
import { assertServerRuntime } from "./serverRuntime";

assertServerRuntime("patternResume.test.ts");

const LAYOUTS = [{ component: "app/layout", props: {} }];

let engine: any;
let dir: string;

beforeAll(async () => {
  await buildFixtureOnce();
  engine = await import(bundlePath);
  engine.installHostFn(async () => null);
  dir = mkdtempSync(join(tmpdir(), "rsc-pattern-resume-"));

  const manifest = engine.manifest();

  await prerender({
    engine,
    manifest: {
      ...manifest,
      routes: manifest.routes
        .filter((r: { component: string }) => r.component === "app/photo/[id]/page" || r.component === "app/gallery/[id]/page")
        .map((r: object) => ({ ...r, staticParams: false, clientJs: true })),
    },
    write: writeTo(dir),
  });
}, 180_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("a pattern shell, resumed for a url", () => {
  test("fills its holes with the page for that url", async () => {
    const postponed = JSON.parse(readFileSync(join(dir, "photo/_id_.postponed.json"), "utf-8"));
    const errors: string[] = [];
    const error = console.error;

    console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));

    try {
      const { htmlStream } = (await withRequest(new Request("http://app.test/photo/7"), () =>
        engine.handleRscResume("app/photo/[id]/page", { id: "7" }, LAYOUTS, ["app/loading"], {}, {}, postponed, undefined, "", "/photo/7"),
      )) as { htmlStream: ReadableStream };
      const html = await new Response(htmlStream).text();

      // The hole, filled with the page for id 7 - not left for the browser.
      expect(html).toMatch(/Full photo (<!-- -->)?7/);
      expect(errors.join("\n")).not.toContain("resumable slots");
    } finally {
      console.error = error;
    }
  });

  test("with the boundary inside the page, under a title read from the params", async () => {
    // The shape a product page has. The shell's head has no title for the
    // page; a resume that added one shifted every slot below it, and React
    // filled nothing - the port's product pages came back as empty holes.
    const postponed = JSON.parse(readFileSync(join(dir, "gallery/_id_.postponed.json"), "utf-8"));
    const errors: string[] = [];
    const error = console.error;

    console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));

    try {
      const { htmlStream } = (await withRequest(new Request("http://app.test/gallery/3"), () =>
        engine.handleRscResume("app/gallery/[id]/page", { id: "3" }, LAYOUTS, ["app/loading"], {}, {}, postponed, undefined, "", "/gallery/3"),
      )) as { htmlStream: ReadableStream };
      const html = await new Response(htmlStream).text();

      expect(html).toMatch(/Picture (<!-- -->)?3/);
      expect(errors.join("\n")).not.toContain("resumable slots");
    } finally {
      console.error = error;
    }
  });

  test("the shell itself has no title read from the params, and the resume adds none", async () => {
    const shell = readFileSync(join(dir, "photo/_id_.ppr.html"), "utf-8");

    expect(shell).not.toContain("Photo _");
    expect(shell).toContain("<title>RSC Docs</title>");
  });
});
