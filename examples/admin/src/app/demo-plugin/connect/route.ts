import { connect } from '@/plugin-demo/reviews'

/** The plugin's settings form posts here: the installation id and secret the panel showed. */
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData()
  const installation = String(form.get('installation') ?? '').trim()
  const secret = String(form.get('secret') ?? '').trim()

  if (installation && secret) connect(installation, secret)

  return Response.redirect(new URL('/demo-plugin', request.url), 303)
}
