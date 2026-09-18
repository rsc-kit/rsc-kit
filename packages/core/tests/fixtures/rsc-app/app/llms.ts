import type { MetadataRoute } from '../../../../src/metadata'

export default function llms(): MetadataRoute.Llms {
  return {
    title: 'Fixture',
    summary: 'A fixture app, described for a model.',
    details: 'One paragraph of detail.',
    sections: [{ title: 'Docs', links: [{ title: 'Pricing', url: 'https://fixture.test/pricing', description: 'What it costs' }] }],
  }
}
