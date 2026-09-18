import type { MetadataRoute } from '../../../../src/metadata'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return [
    { url: 'https://fixture.test/', lastModified: new Date('2026-01-02T03:04:05Z'), changeFrequency: 'weekly', priority: 1 },
    { url: 'https://fixture.test/pricing?plan=a&b', alternates: { languages: { fr: 'https://fixture.test/fr/pricing' } } },
    { url: 'https://elsewhere.test/page', images: ['https://elsewhere.test/cover.png'] },
  ]
}
