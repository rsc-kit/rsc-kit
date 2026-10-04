import { section } from '@rsc-kit/core/section'

/**
 * The team's apps. A change to one app is also a change to this list - its
 * name, its status - so whatever changes an app says both:
 *
 *     changed(`app:${app.id}`, `team:${app.team}:apps`)
 *
 * The list watches the parent's name, an app's own page watches the app's,
 * and neither has to know about the other.
 */
export default section(
  'apps',
  async function Apps({ team }: { team: string }) {
    return <p id="apps">Apps of {team}</p>
  },
  { refreshOn: ({ team }) => [`team:${team}:apps`] },
)
