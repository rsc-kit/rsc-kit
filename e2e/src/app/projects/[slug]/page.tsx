import { Suspense } from 'react'
import { cookies } from '@rsc-kit/core/request'
import { redirect } from '@rsc-kit/core/redirect'
import { renameProject } from '../../../actions'

// A page whose address is its name. Renamed, the old address redirects to the
// new one - from inside its Suspense boundary, as a page reading its record
// does. An action that renames it and re-renders the page it was called from
// reaches that redirect mid-render.
async function Project({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const current = (await cookies()).get('project')?.value ?? 'first'

  if (slug !== current) redirect(`/projects/${current}` as never)

  return (
    <>
      <h1 id="project">Project {slug}</h1>
      <form action={renameProject}>
        <input type="hidden" name="to" value={slug === 'first' ? 'second' : 'first'} />
        <button type="submit" id="rename">rename</button>
      </form>
    </>
  )
}

export default function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <main>
      <Suspense fallback={<p>loading…</p>}>
        <Project params={params} />
      </Suspense>
    </main>
  )
}
