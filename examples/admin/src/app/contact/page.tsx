import type { Metadata } from '@rsc-kit/core/metadata'
import { contact } from '@/forms/contact'

export const metadata: Metadata = { title: 'Contact' }

/** Reads nothing from the request, so the build stores this page; only sending it runs on the server. */
export default function ContactPage() {
  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-6 p-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Contact us</h1>
        <p className="text-muted-foreground">A blueprint from @rsc-kit/press/forms: the panel edits what it sends with the same form.</p>
      </div>
      <contact.Form />
    </main>
  )
}
