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

/**
 * A subdomain of the site that no route begins with is served by path, as
 * the site's own: a preview deployment under the production domain keeps
 * working. In development it is said, once per host - otherwise
 * merchant.example.test showed the home page and nothing said why.
 */
export function unroutedHostMessage(host: string, segment: string): string {
  return (
    `[rsc-kit] ${bareHost(host)} has no app/${segment}/ - served by path, as the site's own. ` +
    `Add app/${segment}/ to route the subdomain there.`
  );
}

const saidUnrouted = new Set<string>();

/** Says unroutedHostMessage once per host; what the dev server passes as onUnroutedHost. */
export function sayUnroutedHost(host: string, segment: string): void {
  const bare = bareHost(host);

  if (saidUnrouted.has(bare)) return;

  saidUnrouted.add(bare);
  console.warn(unroutedHostMessage(bare, segment));
}

/** `/merchant/orders?x=1` as `merchant` and `/orders?x=1`; null when the path has no first segment. */
function splitFirst(href: string): [string, string] | null {
  const match = /^\/([^/?#]+)(.*)$/.exec(href);

  if (!match) return null;

  const rest = match[2];

  return [match[1], rest === "" ? "/" : rest.startsWith("/") ? rest : "/" + rest];
}

/**
 * Where a root-relative href goes once rscKit({ subdomains }) has named the
 * directories served on their own host.
 *
 * A path under one is that subdomain's, whatever host it is written on:
 * `/merchant/orders` is `//merchant.<site>/orders` - the same string on the
 * server and in the browser, so an anchor hydrates as it was sent. Any other
 * root-relative path written on one of those subdomains is the site's, and
 * that one needs the current host, so it is only rewritten where `current`
 * is known. On a host that is neither the site nor one of those subdomains -
 * a preview, a platform's own name, localhost - nothing moves: it has no
 * subdomain to go to, and serves the folder by path. Everything else - `//`,
 * a full url, `#`, a relative path - is left as written.
 */
export function subdomainHref(
  href: string,
  subdomains: readonly string[],
  site: string | null | undefined,
  current?: string | null,
): string {
  if (!site || subdomains.length === 0 || !href.startsWith("/") || href.startsWith("//")) return href;

  const bare = bareHost(current);
  const siteBare = bareHost(site);
  const onLabel = bare !== "" && subdomains.some((label) => bare === `${label}.${siteBare}`);

  if (bare !== "" && !onLabel && bare.replace(/^www\./, "") !== siteBare) return href;

  const split = splitFirst(href);

  if (split && subdomains.includes(split[0])) return `//${split[0]}.${site}${split[1]}`;

  return onLabel ? `//${site}${href}` : href;
}

/**
 * The subdomain url a request on the site's own host is sent to, when its
 * path is under a directory rscKit({ subdomains }) names: one url per page,
 * so a session, a cache entry and a share card all agree on it. Null for
 * every other request, and for a host that is not the site's - localhost,
 * an address, a proxy's internal name - which keeps the path form, since
 * there is no subdomain of it to go to.
 */
export function subdomainRedirect(
  host: string | null | undefined,
  pathname: string,
  own: readonly string[],
  subdomains: readonly string[],
): string | null {
  if (subdomains.length === 0 || !host || !own.includes(bareHost(host))) return null;

  const split = splitFirst(pathname);

  if (!split || !subdomains.includes(split[0])) return null;

  return `${split[0]}.${host.replace(/^www\./i, "")}${split[1]}`;
}

/**
 * The site's host as a request on `host` would write it - the request's own
 * host on the site, the part after the label on one of its subdomains, port
 * kept - or null for a host that is neither.
 */
export function siteFromRequest(
  host: string | null | undefined,
  own: readonly string[],
  subdomains: readonly string[],
): string | null {
  if (!host) return null;

  const bare = bareHost(host);

  if (own.includes(bare)) return host.replace(/^www\./i, "");

  for (const label of subdomains) {
    if (bare.startsWith(label + ".") && own.includes(bare.slice(label.length + 1))) return host.slice(label.length + 1);
  }

  return null;
}
