import { Suspense } from 'react'
import { z } from 'zod'
import type { PageProps } from '@rsc-kit/core/route-schema'
import type { PageRefreshOn } from '@rsc-kit/core/section'
import Apps from './apps.section'

export const params = z.object({ team: z.string().min(1) })

/**
 * The page as a whole - its heading, the team's name - refreshes when the
 * team changes. Typed from the schema above: params.team is a string, parsed.
 */
export const refreshOn: PageRefreshOn<typeof params> = ({ params }) => [`team:${params.team}`]

// Synchronous, so the shell paints at once; the team is read under Suspense.
export default function TeamPage({ params: p }: PageProps<typeof params>) {
  return (
    <main>
      <Suspense fallback={<h1>Team</h1>}>
        <Team params={p} />
      </Suspense>
    </main>
  )
}

async function Team({ params }: { params: PageProps<typeof import('./page').params>['params'] }) {
  const { team } = await params

  return (
    <>
      <h1>Team {team}</h1>
      <Apps team={team} />
    </>
  )
}
