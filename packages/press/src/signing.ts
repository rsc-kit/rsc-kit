/**
 * How a panel and an installed plugin trust each other: every request the
 * panel sends is signed with the secret made when the plugin was installed,
 * and the plugin checks it before answering. Web Crypto only, so both ends
 * run anywhere - Bun, Node, a Worker.
 *
 *     x-rsc-admin-installation  which installation is calling: the plugin finds its secret by it
 *     x-rsc-admin-timestamp     seconds since the epoch, so a captured request cannot be replayed later
 *     x-rsc-admin-signature     sha256=<hex HMAC-SHA256 of "<timestamp>.<body>">
 *
 * A plugin's handler starts with verifyPluginRequest(); nothing it answers
 * is trusted by the panel either - see installable.ts.
 */

export const INSTALLATION_HEADER = 'x-rsc-admin-installation'
export const TIMESTAMP_HEADER = 'x-rsc-admin-timestamp'
export const SIGNATURE_HEADER = 'x-rsc-admin-signature'

const encoder = new TextEncoder()

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))

  return [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Equal without saying where they differ: a byte-by-byte compare leaks the signature by its timing. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let difference = 0

  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index)

  return difference === 0
}

/** A new installation's secret: 32 random bytes, hex. */
export function newSecret(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The headers that sign `body` for one installation. */
export async function signedHeaders(installation: string, secret: string, body: string, now = Date.now()): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(now / 1000))

  return {
    [INSTALLATION_HEADER]: installation,
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: `sha256=${await hmac(secret, `${timestamp}.${body}`)}`,
  }
}

export interface VerifiedRequest<Body = unknown> {
  installation: string
  body: Body
}

/**
 * For a plugin's endpoint: the request's body, once its signature is checked
 * against the secret its installation was given - or null, which the plugin
 * answers with a 401 and nothing else.
 *
 *     export async function POST(request: Request) {
 *       const verified = await verifyPluginRequest(request, (id) => secrets.get(id))
 *       if (!verified) return new Response(null, { status: 401 })
 *       ...
 *     }
 *
 * `secretOf` returning undefined - an installation the plugin never heard of,
 * or one uninstalled since - is a refusal too. Older than `tolerance`
 * seconds, either way, is a refusal: a replay.
 */
export async function verifyPluginRequest<Body = unknown>(
  request: Request,
  secretOf: (installation: string) => string | undefined | Promise<string | undefined>,
  { tolerance = 300, now = Date.now() }: { tolerance?: number; now?: number } = {},
): Promise<VerifiedRequest<Body> | null> {
  const installation = request.headers.get(INSTALLATION_HEADER)
  const timestamp = request.headers.get(TIMESTAMP_HEADER)
  const signature = request.headers.get(SIGNATURE_HEADER)

  if (!installation || !timestamp || !signature || !/^\d+$/.test(timestamp)) return null
  if (Math.abs(now / 1000 - Number(timestamp)) > tolerance) return null

  const secret = await secretOf(installation)

  // An empty secret signs as well as any: never one to accept.
  if (!secret) return null

  const body = await request.text()

  if (!same(signature, `sha256=${await hmac(secret, `${timestamp}.${body}`)}`)) return null

  try {
    return { installation, body: JSON.parse(body) as Body }
  } catch {
    return null
  }
}
