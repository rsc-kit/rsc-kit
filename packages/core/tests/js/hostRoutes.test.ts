// A host as a route segment, through the built engine.
//
// The apex keeps path routing; a subdomain of it contributes its label; a
// custom domain contributes the whole host. One rule, applied once at the top
// of the handler, so the api match, the page match and the stored answer all
// see the same path.

import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prerender } from "../../src/prerender";
import { prerenderedFrom, writeTo } from "../../src/files";
import { createRscHandler } from "../../src/host";
import { assertServerRuntime } from "./serverRuntime";

assertServerRuntime("hostRoutes.test.ts");

let handle: (request: Request) => Promise<Response | null>;
let manifest: { build: { hosts?: string[] } };

beforeAll(async () => {
  const { buildFixtureOnce, bundlePath } = await import("./goHost");

  await buildFixtureOnce();

  const engine: any = await import(bundlePath);

  manifest = engine.manifest();
  handle = createRscHandler({
    engine: { ...engine, manifest: engine.manifest },
    manifest: engine.manifest(),
  } as never);
});

const page = async (url: string, headers: Record<string, string> = {}) => {
  const res = await handle(new Request(url, { headers }));

  // React separates adjacent text nodes with a comment; read it as a visitor would.
  const html = ((await res?.text()) ?? "").replace(/<!--.*?-->/g, "");

  return { status: res?.status, html };
};

describe("the build knows the site's own hosts", () => {
  test("from the root layout's metadataBase and rscKit({ hosts }), www of each", () => {
    expect(manifest.build.hosts).toEqual([
      "app.test",
      "fixture.test",
      "internal.lb",
      "www.app.test",
      "www.fixture.test",
      "www.internal.lb",
      "www.x",
      "www.x.test",
      "x",
      "x.test",
    ]);
  });
});

describe("a request on the site's own host", () => {
  test("is routed by path, as before", async () => {
    const { status, html } = await page("https://fixture.test/admin");

    expect(status).toBe(200);
    expect(html).toContain('id="admin"');
  });

  test("and www is the site too, not a tenant called www", async () => {
    const { html } = await page("https://www.fixture.test/admin");

    expect(html).toContain('id="admin"');
  });
});

describe("a subdomain of the site", () => {
  test("reaches the directory of the same name", async () => {
    const { status, html } = await page("https://admin.fixture.test/");

    expect(status).toBe(200);
    expect(html).toContain('id="admin"');
  });

  test("and binds [domain] when no directory is named for it", async () => {
    const home = await page("https://acme.fixture.test/");
    const settings = await page("https://acme.fixture.test/settings");

    expect(home.html).toContain("Tenant acme<");
    expect(settings.html).toContain("Settings for acme<");
  });
});

describe("a custom domain", () => {
  test("binds [domain] to the whole host", async () => {
    const { html } = await page("https://acme.com/settings");

    expect(html).toContain("Settings for acme.com<");
  });

  test("is read through a proxy, from X-Forwarded-Host", async () => {
    const { html } = await page("https://internal.lb/settings", {
      "x-forwarded-host": "acme.com",
    });

    expect(html).toContain("Settings for acme.com<");
  });
});

describe("the visitor's url is untouched", () => {
  test("a path that exists only on the apex is not reachable on a tenant", async () => {
    // /admin on the tenant means /acme/admin, which nothing answers.
    // Nothing answers, and the handler says so the way it says it for any
    // unknown url: null, for the host in front of it to answer.
    const res = await handle(new Request("https://acme.fixture.test/admin"));

    expect(res).toBeNull();
  });
});

describe("a listed tenant is stored at build, one copy per host", () => {
  let out: string;

  beforeAll(async () => {
    const { bundlePath } = await import("./goHost");
    const engine: any = await import(bundlePath);
    const full = engine.manifest();

    out = mkdtempSync(join(tmpdir(), "host-prerender-"));
    // Only the tenant route: the fixture has a page that throws on purpose.
    await prerender({
      engine,
      write: writeTo(out),
      version: "build-1",
      manifest: {
        ...full,
        routes: full.routes.filter((r: any) =>
          r.component.startsWith("app/[domain]/page"),
        ),
      },
    });
  });

  test("generateStaticParams named the hosts, and each is a file", () => {
    expect(existsSync(join(out, "acme.html"))).toBe(true);
    expect(existsSync(join(out, "acme.com.html"))).toBe(true);
  });

  test("and a request on that host is answered from the file", async () => {
    const { bundlePath } = await import("./goHost");
    const engine: any = await import(bundlePath);
    const stored = createRscHandler({
      engine: { ...engine, manifest: engine.manifest },
      manifest: engine.manifest(),
      prerendered: prerenderedFrom(out),
    } as never);

    const res = await stored(new Request("https://acme.com/"));
    const html = ((await res?.text()) ?? "").replace(/<!--.*?-->/g, "");

    expect(html).toContain("Tenant acme.com<");
  });
});
