import { cookies } from '@rsc-kit/core/request'
import type { Tenant } from '@rsc-kit/press'
import type { PanelUser } from '@rsc-kit/press/admin'

/**
 * The example's stand-in for an app's auth. A real app answers these from
 * its session: the user it signed in, the teams they belong to, the one they
 * last chose - a Laravel app through rpc(), a JS app through its auth library.
 */
export const teams: Tenant[] = [
  { id: 'acme', name: 'Acme Inc', description: 'Enterprise' },
  { id: 'globex', name: 'Globex', description: 'Startup' },
  { id: 'initech', name: 'Initech', description: 'Free' },
]

export async function currentUser(): Promise<PanelUser | null> {
  return { name: 'Ada Lovelace', email: 'ada@example.com' }
}

/** The team in the visitor's cookie, or their first one. */
export async function currentTeam(): Promise<Tenant | null> {
  const id = (await cookies()).get('team')?.value

  return teams.find((team) => team.id === id) ?? teams[0] ?? null
}

/** Called by the panel's switcher, in a server action - which is what lets it set a cookie. */
export async function chooseTeam(id: string): Promise<void> {
  ;(await cookies()).set('team', id, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
}
