import { describe, expect, test } from "bun:test";

import {
  hostPath,
  hostSegment,
  ownHosts,
  routableHost,
} from "../../src/hostRouting";

/**
 * A host is matched as a leading path segment - the subdomain of an own
 * host, or the whole host of any other - and the site's own hosts add none.
 */
const own = ownHosts("https://example.com");

describe("the segment a host contributes", () => {
  test("none for the site's own hosts, www included", () => {
    expect(hostSegment("example.com", own)).toBeNull();
    expect(hostSegment("www.example.com", own)).toBeNull();
    expect(hostSegment("EXAMPLE.COM:3000", own)).toBeNull();
  });

  test("the subdomain under an own host", () => {
    expect(hostSegment("admin.example.com", own)).toBe("admin");
    expect(hostSegment("acme.example.com:443", own)).toBe("acme");
    expect(hostSegment("a.b.example.com", own)).toBe("a.b");
  });

  test("the whole host for a custom domain", () => {
    expect(hostSegment("acme.com", own)).toBe("acme.com");
    expect(hostSegment("photos.acme.co.uk", own)).toBe("photos.acme.co.uk");
  });

  test("never for localhost, an ip, or a build that named no host", () => {
    expect(hostSegment("localhost:3000", own)).toBeNull();
    expect(hostSegment("127.0.0.1", own)).toBeNull();
    expect(hostSegment("[::1]:3000", own)).toBeNull();
    expect(hostSegment("acme.example.com", [])).toBeNull();
    expect(hostSegment(null, own)).toBeNull();
  });
});

describe("the path to match", () => {
  test("is the path itself on the site's own host", () => {
    expect(hostPath("example.com", "/admin/users", own)).toBe("/admin/users");
  });

  test("and the host's segment in front of it otherwise", () => {
    expect(hostPath("admin.example.com", "/users", own)).toBe("/admin/users");
    expect(hostPath("admin.example.com", "/", own)).toBe("/admin");
    expect(hostPath("acme.com", "/settings", own)).toBe("/acme.com/settings");
  });
});

describe("the site's own hosts", () => {
  test("come from metadataBase and the hosts option, with www of each", () => {
    expect(ownHosts("https://example.com")).toEqual([
      "example.com",
      "www.example.com",
    ]);
    expect(ownHosts(new URL("https://www.example.com/x"))).toEqual([
      "www.example.com",
    ]);
    expect(ownHosts(null, ["Example.org:8080", "app.example.org"])).toEqual([
      "app.example.org",
      "example.org",
      "www.app.example.org",
      "www.example.org",
    ]);
    expect(ownHosts("not a url")).toEqual([]);
  });
});

describe("whether a host's segment is one a route can begin with", () => {
  const seg = (type: string, value: string) => ({ type, value });

  test("yes for a host segment, whatever the host", () => {
    const routes = [{ segments: [seg("host", "domain")] }];

    expect(routableHost("acme", routes)).toBe(true);
    expect(routableHost("acme.com", routes)).toBe(true);
  });

  test("yes for a directory named for it, and only that name", () => {
    const routes = [
      { segments: [seg("static", "admin"), seg("static", "users")] },
    ];

    expect(routableHost("admin", routes)).toBe(true);
    expect(routableHost("acme", routes)).toBe(false);
  });

  test("no when nothing could - an app with a metadataBase and no tenant tree", () => {
    expect(
      routableHost("acme", [
        { segments: [] },
        { segments: [seg("static", "docs")] },
      ]),
    ).toBe(false);
  });
});
