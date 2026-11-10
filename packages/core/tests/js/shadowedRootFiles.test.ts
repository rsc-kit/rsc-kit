import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shadowedRootFileMessage, shadowedRootFiles } from "../../src/shadowedRootFiles";

function project(app: Record<string, string>, pub: Record<string, string> | null) {
  const root = mkdtempSync(join(tmpdir(), "rsc-shadowed-"));
  const appDir = join(root, "resources/js/app");

  mkdirSync(appDir, { recursive: true });
  for (const [name, body] of Object.entries(app)) writeFileSync(join(appDir, name), body);

  if (pub) {
    mkdirSync(join(root, "public"));
    for (const [name, body] of Object.entries(pub)) writeFileSync(join(root, "public", name), body);
  }

  return { root, appDir, publicDir: join(root, "public") };
}

describe("a public/ file at a url the app answers", () => {
  test("Laravel's empty favicon.ico and its robots.txt hide the app's favicon and robots.ts", () => {
    const { root, appDir, publicDir } = project(
      { "favicon.ico": "icon", "robots.ts": "export default () => ({})", "page.tsx": "" },
      { "favicon.ico": "", "robots.txt": "User-agent: *\nDisallow:\n", "index.php": "" },
    );

    const found = shadowedRootFiles(appDir, publicDir);

    expect(found.map((f) => [f.url, f.empty])).toEqual([
      ["/favicon.ico", true],
      ["/robots.txt", false],
    ]);
    expect(found[1]!.appFile).toBe(join(appDir, "robots.ts"));

    const favicon = shadowedRootFileMessage(found[0]!, root);

    expect(favicon).toContain("public/favicon.ico is answered at /favicon.ico, not resources/js/app/favicon.ico");
    expect(favicon).toContain("It is empty");
    expect(favicon).toContain("Delete public/favicon.ico");
    expect(shadowedRootFileMessage(found[1]!, root)).not.toContain("empty");
  });

  test("a hand-written robots.txt beside the root layout counts too", () => {
    const { appDir, publicDir } = project({ "robots.txt": "User-agent: *" }, { "robots.txt": "x" });

    expect(shadowedRootFiles(appDir, publicDir).map((f) => f.url)).toEqual(["/robots.txt"]);
  });

  test("nothing when the app does not serve the url, or there is no public/", () => {
    expect(shadowedRootFiles(project({ "page.tsx": "" }, { "favicon.ico": "", "robots.txt": "x" }).appDir, "")).toEqual([]);

    const bare = project({ "favicon.ico": "icon" }, null);

    expect(shadowedRootFiles(bare.appDir, bare.publicDir)).toEqual([]);

    const unrelated = project({ "page.tsx": "" }, { "favicon.ico": "", "robots.txt": "x" });

    expect(shadowedRootFiles(unrelated.appDir, unrelated.publicDir)).toEqual([]);
  });
});
