import { Suspense } from 'react'
import { connection } from '@rsc-kit/core/request'
import type { Metadata } from '@rsc-kit/core/metadata'
import { Skeleton } from '@/components/ui/skeleton'
import { connected, told } from '@/plugin-demo/reviews'

export const metadata: Metadata = { title: 'Product reviews plugin' }

/** The plugin's own settings page - another company's, in real life. */
export default function PluginSettings() {
  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-6 p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Product reviews: settings</h1>
        <p className="text-sm text-muted-foreground">
          Paste the installation and secret your admin panel showed you. Until then, this plugin refuses its calls.
        </p>
      </div>
      <form method="post" action="/demo-plugin/connect" className="grid gap-3">
        <input name="installation" placeholder="Installation" required className="h-9 rounded-md border bg-transparent px-3 text-sm" />
        <input name="secret" placeholder="Secret" required className="h-9 rounded-md border bg-transparent px-3 font-mono text-sm" />
        <button type="submit" className="h-9 justify-self-start rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
          Connect
        </button>
      </form>
      <Suspense fallback={<Skeleton className="h-5 w-64" />}>
        <Status />
      </Suspense>
    </main>
  )
}

/** Which panels are connected, and what they last said: the plugin's live state, per request. */
async function Status() {
  await connection()

  const installations = connected()
  const heard = told()

  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p>{installations.length === 0 ? 'No panel connected yet.' : `Connected installations: ${installations.join(', ')}`}</p>
      {heard.length > 0 && <p>Last told: {heard.join(' · ')}</p>}
    </div>
  )
}
