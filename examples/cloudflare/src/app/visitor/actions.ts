'use server'

import { cookies } from '@rsc-kit/core/request'
import { revalidate } from '@rsc-kit/core/revalidate'

// A server action, run by the Worker: the cookie it sets rides on the answer,
// and the page is rendered again with it.
export async function countVisit(): Promise<void> {
  const jar = await cookies()
  const visits = Number(jar.get('visits')?.value ?? 0) + 1

  jar.set('visits', String(visits), { path: '/', httpOnly: true, sameSite: 'lax' })
  revalidate('page')
}
