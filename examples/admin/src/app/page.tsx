import Link from '@rsc-kit/core/Link'
import type { Metadata } from '@rsc-kit/core/metadata'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Home' }

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">@rsc-kit/press</h1>
      <p className="text-muted-foreground">
        A panel over three data sources: a per-team catalogue paged on the server, categories paged in the browser,
        and customers from a REST API.
      </p>
      <div className="flex gap-2">
        <Button nativeButton={false} render={<Link href="/admin" />}>
          Open the panel
        </Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/contact" />}>
          A public form
        </Button>
      </div>
    </main>
  )
}
