import { Suspense } from 'react'

// A dynamic root route: /acme/blog is a team's app. It matches every url of two
// segments, so it also matches the backend's /gitlab/connect - which is why the
// backend's prefixes are named in vite.config.ts (backendPaths) and not left to
// "a url nothing owns", which this page would otherwise own.
async function Title({ params }: { params: Promise<{ team: string; app: string }> }) {
  const { team, app } = await params

  return (
    <h1>
      {team}/{app}
    </h1>
  )
}

export default function TeamApp({ params }: { params: Promise<{ team: string; app: string }> }) {
  return (
    <main>
      <Suspense fallback={<h1>…</h1>}>
        <Title params={params} />
      </Suspense>
    </main>
  )
}
