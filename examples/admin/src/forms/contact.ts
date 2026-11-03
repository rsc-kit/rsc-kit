import { defineForm } from '@rsc-kit/press/forms'
import { shadcn } from '@rsc-kit/press/shadcn'
import { contactSchema, inbox } from '@/admin/resources/messages'

/**
 * A form anyone may send, drawn from the same schema the panel lists its
 * messages with. handle() is where an app stores it, mails it, or hands it to
 * its backend with rpc().
 */
export const contact = defineForm({
  name: 'contact',
  form: contactSchema,
  fields: { message: { type: 'textarea', description: 'Ten characters at least.' } },
  theme: shadcn,
  submit: 'Send message',
  done: 'Thanks - your message is in the inbox at /admin/messages.',
  handle: async (values) => {
    await inbox.create(values, { tenant: null })
  },
})
