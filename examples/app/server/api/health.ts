/**
 * A web-standard handler: a Request in, a Response out.
 *
 * For callers that are not this app's own client — a webhook, an uptime check,
 * anything that cannot import a server function. Its own client should use a
 * query or a server action, which are typed and need no url.
 */
export default (request: Request): Response =>
  Response.json({ ok: true, method: request.method, at: new Date().toISOString() })
