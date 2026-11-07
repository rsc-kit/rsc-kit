import { Mail } from 'lucide-react'
import { defineResource } from '@rsc-kit/press'
import { contact, inbox } from '@/forms/contact'
import type { Message } from '@/forms/contact'

export type { Message }

/** What visitors sent from the contact page, edited with the contact page's own form. */
export const messages = defineResource<Message>()({
  name: 'messages',
  key: 'id',
  title: 'name',
  icon: Mail,
  description: 'What visitors sent from the contact page, edited with the same form.',
  source: inbox,
  table: (col) => [col.text('name').searchable(), col.text('email').searchable(), col.text('message')],
  form: contact,
})
