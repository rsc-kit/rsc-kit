import { afterEach, describe, expect, test } from 'bun:test'
import { hostUrl } from '../../src/routes'
import { siteHostOf } from '../../src/vite'

const g = globalThis as { __RSC_SITE_HOST__?: string | null }

afterEach(() => {
  delete g.__RSC_SITE_HOST__
})

describe('hostUrl', () => {
  test("a folder's subdomain, a tenant, a domain and the site, on the site's host", () => {
    g.__RSC_SITE_HOST__ = 'example.com'

    expect(hostUrl('merchant', '/orders')).toBe('//merchant.example.com/orders')
    expect(hostUrl('testbrand', '/settings?tab=billing')).toBe('//testbrand.example.com/settings?tab=billing')
    expect(hostUrl('acme.com', '/settings')).toBe('//acme.com/settings')
    expect(hostUrl('/pricing')).toBe('//example.com/pricing')
  })

  test('keeps the port the host was named with', () => {
    g.__RSC_SITE_HOST__ = 'localhost:8000'

    expect(hostUrl('merchant', '/')).toBe('//merchant.localhost:8000/')
  })

  test('with no site host named, a folder is its path and a domain still names itself', () => {
    expect(hostUrl('merchant', '/orders')).toBe('/merchant/orders')
    expect(hostUrl('merchant', '/')).toBe('/merchant')
    expect(hostUrl('merchant', '/?page=2')).toBe('/merchant?page=2')
    expect(hostUrl('acme.com', '/')).toBe('//acme.com/')
    expect(hostUrl('/pricing')).toBe('/pricing')
  })
})

describe('siteHostOf', () => {
  test('the first host as written, without www.', () => {
    expect(siteHostOf(null, ['www.Shop.test', 'other.test'])).toBe('shop.test')
    expect(siteHostOf(null, ['localhost:8000'])).toBe('localhost:8000')
  })

  test("a literal metadataBase's when no host is named, null when neither is", () => {
    expect(siteHostOf('https://example.com:8443/', [])).toBe('example.com:8443')
    expect(siteHostOf(null, [])).toBeNull()
    expect(siteHostOf('not a url', [])).toBeNull()
  })
})
