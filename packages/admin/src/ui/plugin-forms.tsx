'use client'

import { useState } from 'react'
import Form from '@rsc-kit/core/form'
import { Check, Copy } from 'lucide-react'
import { Button } from '../components/ui/button.js'
import { Field, FieldDescription, FieldError, FieldLabel } from '../components/ui/field.js'
import { Input } from '../components/ui/input.js'

/** A manifest url, sent for review. Its problems land under the field. */
export function ManifestForm({ action }: { action: (form: FormData) => Promise<unknown> }) {
  return (
    <Form action={action}>
      {({ pending, error }) => (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Field data-invalid={!!error('manifest') || undefined} className="flex-1">
            <FieldLabel htmlFor="plugin-manifest" className="sr-only">
              Manifest url
            </FieldLabel>
            <Input id="plugin-manifest" name="manifest" type="url" required placeholder="https://plugin.example.com/manifest.json" aria-invalid={!!error('manifest') || undefined} />
            {error('manifest') ? <FieldError>{error('manifest')}</FieldError> : <FieldDescription>The plugin's manifest. You review what it asks for before anything is installed.</FieldDescription>}
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? 'Reading…' : 'Review'}
          </Button>
        </div>
      )}
    </Form>
  )
}

/** A button that runs one action: install, uninstall, done. */
export function ActionButton({
  action,
  label,
  busy,
  variant = 'default',
}: {
  action: () => Promise<unknown>
  label: string
  busy: string
  variant?: 'default' | 'outline' | 'destructive' | 'ghost'
}) {
  return (
    <Form action={action}>
      {({ pending }) => (
        <Button type="submit" variant={variant} size="sm" disabled={pending}>
          {pending ? busy : label}
        </Button>
      )}
    </Form>
  )
}

/** The secret, shown once, with a copy button. */
export function SecretField({ secret, installation }: { secret: string; installation: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="grid gap-2 text-sm">
      <div className="grid gap-1">
        <span className="text-muted-foreground">Installation</span>
        <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs break-all">{installation}</code>
      </div>
      <div className="grid gap-1">
        <span className="text-muted-foreground">Secret</span>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1 font-mono text-xs break-all">{secret}</code>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Copy the secret"
            onClick={() =>
              void navigator.clipboard.writeText(secret).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
      </div>
    </div>
  )
}
