import type { MetadataRoute } from '@rsc-kit/core/metadata'

// /robots.txt, stored at build. The sitemap url is made absolute with the
// root layout's metadataBase.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/account', '/dashboard'] }],
    sitemap: '/sitemap.xml',
  }
}
