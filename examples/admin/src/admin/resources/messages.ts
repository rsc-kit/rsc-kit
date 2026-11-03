import * as z from 'zod'
import { Mail } from 'lucide-react'
import { defineResource, memorySource } from '@rsc-kit/press'

export interface Message {
  id: number
  name: string
  email: string
  message: string
}

/** The contact form's schema: the public form is drawn from it, and this resource lists what it sent. */
export const contactSchema = z.object({
  name: z.string().min(2),
  email: z.email(),
  message: z.string().min(10).max(2000),
})

/** One inbox for the site, not a team's: it is filled by visitors, who have none. */
export const inbox = memorySource<Message, z.infer<typeof contactSchema>>([], 'id', (id, values) => ({ id, ...values }))

export const messages = defineResource<Message>()({
  name: 'messages',
  key: 'id',
  title: 'name',
  icon: Mail,
  description: 'What visitors sent from the contact page.',
  source: inbox,
  table: (col) => [col.text('name').searchable(), col.text('email').searchable(), col.text('message')],
  form: contactSchema,
  readOnly: true,
})
