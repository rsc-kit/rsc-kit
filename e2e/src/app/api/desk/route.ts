import { changed } from '@rsc-kit/core/changed'

// Something outside the page says the desk changed: a webhook, a job.
export async function POST(): Promise<Response> {
  await changed('desk:7')

  return new Response(null, { status: 204 })
}
