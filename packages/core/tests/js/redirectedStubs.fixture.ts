// What the build generates for a backend action, standing in for it: the test
// replaces this module, so the component under test imports it as it would the
// real server-actions.generated.
import type { Redirected } from '../../src/js/errors'

export async function appsPause(_id: string): Promise<void | Redirected> {}
export async function invitesAccept(_token: string): Promise<string | Redirected> {
  return ''
}
