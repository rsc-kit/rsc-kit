import * as z from 'zod'
import Link from '@rsc-kit/core/Link'
import { defineBlock } from '@rsc-kit/press'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { contact } from '@/forms/contact'

/**
 * The kinds of block an editor builds pages from. Each is a schema for what
 * they fill in and a component that draws it - the app's own components, so
 * a page looks like the rest of the site.
 */
export const hero = defineBlock({
  name: 'hero',
  form: z.object({
    heading: z.string().min(3).max(80),
    lead: z.string().max(300).optional(),
    action: z.string().max(30).optional(),
    href: z.string().regex(/^\/[a-z0-9\-/]*$/, 'A path on this site, starting with /').optional(),
  }),
  fields: {
    lead: { type: 'textarea' },
    action: { label: 'Button', description: 'Its words. Left empty, there is no button.' },
    href: { label: 'Button goes to', description: 'A path on this site: /contact.' },
  },
  render: ({ data }) => (
    <section className="flex flex-col items-start gap-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{data.heading}</h1>
      {data.lead && <p className="max-w-2xl text-lg text-muted-foreground">{data.lead}</p>}
      {data.action && data.href && (
        <Button size="lg" nativeButton={false} render={<Link href={data.href as never} />}>
          {data.action}
        </Button>
      )}
    </section>
  ),
})

export const features = defineBlock({
  name: 'features',
  form: z.object({
    heading: z.string().max(80).optional(),
    first: z.string().min(1).max(60),
    firstText: z.string().max(200).optional(),
    second: z.string().max(60).optional(),
    secondText: z.string().max(200).optional(),
    third: z.string().max(60).optional(),
    thirdText: z.string().max(200).optional(),
  }),
  fields: {
    first: { label: 'First feature' },
    firstText: { type: 'textarea', label: 'Its description' },
    second: { label: 'Second feature' },
    secondText: { type: 'textarea', label: 'Its description' },
    third: { label: 'Third feature' },
    thirdText: { type: 'textarea', label: 'Its description' },
  },
  render: ({ data }) => {
    const items = [
      [data.first, data.firstText],
      [data.second, data.secondText],
      [data.third, data.thirdText],
    ].filter((item): item is [string, string | undefined] => Boolean(item[0]))

    return (
      <section className="flex flex-col gap-6 py-12">
        {data.heading && <h2 className="text-2xl font-semibold tracking-tight">{data.heading}</h2>}
        <div className="grid gap-4 sm:grid-cols-3">
          {items.map(([title, text]) => (
            <Card key={title}>
              <CardHeader>
                <CardTitle>{title}</CardTitle>
                {text && <CardDescription>{text}</CardDescription>}
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>
    )
  },
})

export const text = defineBlock({
  name: 'text',
  form: z.object({ heading: z.string().max(80).optional(), body: z.string().min(1).max(5000) }),
  fields: { body: { type: 'textarea' } },
  render: ({ data }) => (
    <section className="flex max-w-2xl flex-col gap-3 py-8">
      {data.heading && <h2 className="text-2xl font-semibold tracking-tight">{data.heading}</h2>}
      {/* A textarea submits its line breaks as \r\n, as the HTML spec says. */}
      {data.body.split(/(?:\r?\n){2,}/).map((paragraph, index) => (
        <p key={index} className="leading-7 text-muted-foreground">
          {paragraph}
        </p>
      ))}
    </section>
  ),
})

/** A public form as a block: the editor places it, the form is the code's. */
export const contactForm = defineBlock({
  name: 'contact-form',
  label: 'Contact form',
  form: z.object({ heading: z.string().max(80).optional() }),
  render: ({ data }) => (
    <section className="flex max-w-xl flex-col gap-6 py-12">
      {data.heading && <h2 className="text-2xl font-semibold tracking-tight">{data.heading}</h2>}
      <contact.Form />
    </section>
  ),
})
