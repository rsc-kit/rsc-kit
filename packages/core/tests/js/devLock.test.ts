import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimDevServer, recordDevServerUrl, releaseDevServer, secondDevServerMessage } from "../../src/devLock";

let dir: string;
const fresh = () => (dir = mkdtempSync(join(tmpdir(), "rsc-dev-lock-")));

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("one dev server per app", () => {
  test("the first claims it, a second running one is refused and named", () => {
    fresh();
    expect(claimDevServer(dir)).toBeNull();
    recordDevServerUrl(dir, "http://localhost:3000");

    // The parent of this test process is alive and is not this process.
    const held = claimDevServer(dir, process.ppid);

    expect(held).toEqual({ pid: process.pid, url: "http://localhost:3000" });
    expect(secondDevServerMessage("/app", held!)).toContain(`pid ${process.pid}, http://localhost:3000`);
  });

  test("a restart in the same process keeps its own lock", () => {
    fresh();
    expect(claimDevServer(dir)).toBeNull();
    expect(claimDevServer(dir)).toBeNull();
  });

  test("a lock left by a process that is gone is taken over", () => {
    fresh();
    writeFileSync(join(dir, "rsc-kit-dev.json"), JSON.stringify({ pid: 2 ** 22 + 12345 }));
    expect(claimDevServer(dir)).toBeNull();
    expect(JSON.parse(readFileSync(join(dir, "rsc-kit-dev.json"), "utf-8")).pid).toBe(process.pid);
  });

  test("only the holder releases it", () => {
    fresh();
    claimDevServer(dir);
    releaseDevServer(dir, process.ppid);
    expect(existsSync(join(dir, "rsc-kit-dev.json"))).toBe(true);
    releaseDevServer(dir);
    expect(existsSync(join(dir, "rsc-kit-dev.json"))).toBe(false);
  });

  test("an unreadable lock does not block a start", () => {
    fresh();
    writeFileSync(join(dir, "rsc-kit-dev.json"), "not json");
    expect(claimDevServer(dir)).toBeNull();
  });
});
