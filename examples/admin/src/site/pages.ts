import { FileText } from 'lucide-react'
import { memorySource } from '@rsc-kit/press'
import { definePages } from '@rsc-kit/press/pages'
import type { PageRow, PageValues } from '@rsc-kit/press/pages'
import { contactForm, features, hero, picture, text } from './blocks'

const seed: PageRow[] = [
  {
    id: 1,
    title: 'Launch',
    slug: 'launch',
    description: 'A landing page built from blocks in the panel.',
    published: true,
    blocks: [
      {
        type: 'hero',
        data: { heading: 'Ship the admin with the app', lead: 'Pages, forms and panels from one package - edited at /admin/pages, live on the next visit.', action: 'Get in touch', href: '/contact' },
      },
      {
        type: 'features',
        data: {
          heading: 'What is in it',
          first: 'Panels',
          firstText: 'Resources over any data source.',
          second: 'Forms',
          secondText: 'Public forms from a schema.',
          third: 'Pages',
          thirdText: 'Built from blocks, by an editor.',
        },
      },
      { type: 'contact-form', data: { heading: 'Talk to us' } },
    ],
  },
  {
    id: 2,
    title: 'About',
    slug: 'about',
    published: true,
    blocks: [{ type: 'text', data: { heading: 'About', body: 'This page is a row in memory.\n\nEdit it in the panel, and reload.' } }],
  },
  { id: 3, title: 'Coming soon', slug: 'soon', published: false, blocks: [] },
]

/**
 * The site's pages. Kept in memory here; a real app keeps them in its
 * database, or behind rpc() in Laravel or Go - a source whose list() honours
 * filters: { slug }.
 */
export const site = definePages({
  blocks: [hero, features, text, picture, contactForm],
  source: memorySource<PageRow, PageValues>(seed, 'id', (id, values) => ({ id, ...values })),
  icon: FileText,
})
