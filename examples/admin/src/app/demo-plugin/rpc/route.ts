import { answer } from '@/plugin-demo/reviews'

export function POST(request: Request): Promise<Response> {
  return answer(request)
}
