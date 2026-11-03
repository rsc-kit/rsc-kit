import { site } from '@/site/pages'

// Every address no other route has: each is a page an editor built in the
// panel, read on every request, so a save is live on the next visit.
export const generateMetadata = site.generateMetadata

export default function SitePage({ params }: { params: Promise<{ path: string }> }) {
  return (
    <main className="mx-auto flex max-w-5xl flex-col px-6 py-8">
      <site.Page params={params} />
    </main>
  )
}
