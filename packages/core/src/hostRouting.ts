/**
 * A host as a route segment.
 *
 * A request's host is matched the way Next matches one after a middleware
 * rewrite: prepended to the path. The difference is that the build can see
 * it. `admin.example.com/users` matches `app/admin/users/page.tsx`, the
 * same file `example.com/admin/users` reaches by path; `acme.example.com/`
 * matches `app/[domain]/page.tsx` with `domain = "acme"`; a custom domain,
 * `acme.com/`, matches the same file with `domain = "acme.com"`.
 *
 * What is prepended:
 *   - nothing, for the site's own hosts (metadataBase, `www.` of it, and any
 *     `hosts` named in rscKit()) - the apex keeps path routing, so an app
 *     adds tenants without moving a file;
 *   - the subdomain, for a host under an own one: `admin.example.com` ->
 *     `admin`, `a.b.example.com` -> `a.b`;
 *   - the whole host otherwise: `acme.com` -> `acme.com`.
 *
 * Off entirely when the build knows no own host: every request is then the
 * site's own, and nothing here changes a path.
 *
 * Pure, and the same function in the browser: a link to `/settings` on
 * `acme.example.com` is matched as `/acme/settings` on both sides, so the
 * payload the client asks for is the one the server would render.
 */

/** The host without a port, lower-cased; the form every comparison uses. */
export function bareHost(host: string | null | undefined): string {
  return (host ?? "").split(":")[0].toLowerCase();
}

/**
 * The segment a host contributes, or null for the site's own host.
 * `own` is the build's list, already bare and lower-case.
 */
export function hostSegment(
  host: string | null | undefined,
  own: readonly string[],
): string | null {
  const bare = bareHost(host);

  if (!bare || own.length === 0) return null;
  if (own.includes(bare)) return null;
  if (bare === "localhost" || /^[\d.]+$/.test(bare) || bare.startsWith("["))
    return null;

  for (const site of own) {
    if (bare.endsWith("." + site)) {
      const sub = bare.slice(0, -(site.length + 1));

      return sub === "www" ? null : sub;
    }
  }

  return bare;
}

/** The pathname to match, with the host's segment in front when it has one. */
export function hostPath(
  host: string | null | undefined,
  pathname: string,
  own: readonly string[],
): string {
  const segment = hostSegment(host, own);

  if (segment === null) return pathname;

  const rest = pathname === "/" ? "" : pathname;

  return "/" + segment + rest;
}

/**
 * The site's own hosts, from what the build was told. `www.` of each is
 * included, so `www.example.com` is never a tenant called `www`.
 */
export function ownHosts(
  metadataBase: string | URL | null | undefined,
  hosts: readonly string[] = [],
): string[] {
  const out = new Set<string>();

  if (metadataBase) {
    try {
      out.add(bareHost(new URL(String(metadataBase)).host));
    } catch {
      // Not a url the build could read; the option is checked elsewhere.
    }
  }

  for (const host of hosts) out.add(bareHost(host));

  for (const host of [...out]) {
    if (!host.startsWith("www.")) out.add("www." + host);
  }

  return [...out].filter(Boolean).sort();
}

/**
 * Whether a host's segment is one some route can begin with: a host segment
 * ([domain] at the top of app/), or a static directory of that name. Without
 * one, the host is treated as the site's own - so an app that declares a
 * metadataBase and has no tenant tree routes every host by path, and a
 * proxy that forwards to the app by an internal name is not turned into a
 * tenant called "internal".
 */
export function routableHost(
  segment: string,
  routes: readonly { segments: readonly { type: string; value: string }[] }[],
): boolean {
  for (const route of routes) {
    const first = route.segments[0];

    if (!first) continue;
    if (first.type === "host") return true;
    if (first.type === "static" && first.value === segment) return true;
  }

  return false;
}
