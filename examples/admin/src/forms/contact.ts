import * as z from 'zod'
import { memorySource } from '@rsc-kit/press'
import { defineBlueprint } from '@rsc-kit/press/forms'
import { shadcn } from '@rsc-kit/press/shadcn'

export interface Message {
  id: number
  name: string
  email: string
  topic: 'question' | 'sales'
  company?: string
  message: string
}

export const contactSchema = z.object({
  name: z.string().min(2),
  email: z.email(),
  topic: z.enum(['question', 'sales']),
  // Asked only of sales enquiries, so optional to the schema.
  company: z.string().min(2).optional(),
  message: z.string().min(10).max(2000),
})

/** One inbox for the site, not a team's: it is filled by visitors, who have none. */
export const inbox = memorySource<Message, z.infer<typeof contactSchema>>([], 'id', (id, values) => ({ id, ...values }))

/**
 * One form, two places: the contact page sends it with <contact.Form />, and
 * the panel's messages resource edits what was sent with the same fields.
 * handle() is where an app stores it, mails it, or hands it to its backend
 * with rpc(); the panel saves through the resource's source.
 */
export const contact = defineBlueprint({
  name: 'contact',
  form: contactSchema,
  fields: {
    company: { visible: { when: 'topic', is: 'sales' } },
    message: { type: 'textarea', description: 'Ten characters at least.' },
  },
  theme: shadcn,
  submit: 'Send message',
  done: 'Thanks - your message is in the inbox at /admin/messages.',
  handle: async (values) => {
    await inbox.create(values, { tenant: null })
  },
})
