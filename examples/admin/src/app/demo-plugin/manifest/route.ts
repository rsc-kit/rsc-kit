import { manifest } from '@/plugin-demo/reviews'

export function GET(request: Request): Response {
  return Response.json(manifest(new URL(request.url).origin))
}
