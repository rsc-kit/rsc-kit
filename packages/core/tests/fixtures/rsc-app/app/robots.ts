import type { MetadataRoute } from '../../../../src/metadata'

// Beside the root layout, the way Next has it.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/api/', '/guarded'] },
      { userAgent: 'GPTBot', disallow: '/', crawlDelay: 10 },
    ],
    sitemap: 'https://fixture.test/sitemap.xml',
  }
}
