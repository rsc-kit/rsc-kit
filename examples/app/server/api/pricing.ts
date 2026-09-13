/**
 * Frozen at build time — see `prerender.routes` in vite.config.ts.
 *
 * The build fetches this once and writes the answer to .output/public, so no
 * handler runs per request and a CDN in front can hold it. Only safe because
 * the answer does not depend on who is asking: the build has no session, no
 * cookies and no query string to read.
 */
export default (): Response =>
  Response.json({ tiers: ['free', 'pro'], builtAt: new Date().toISOString() })
