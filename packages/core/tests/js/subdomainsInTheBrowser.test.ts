/**
 * The router places a url with its own small copy of subdomainHref, since it
 * ships in the runtime every interactive page loads. The copy has to give the
 * same answer as the one the server and Link use.
 */

import { registerDom } from './dom'

registerDom()

import { describe, expect, test } from 'bun:test'
import { subdomainHref } from '../../src/hostRouting'
import { placed } from '../../src/js/navigate'

const globals = globalThis as Record<string, unknown>

describe("the router's copy of subdomainHref", () => {
  test('agrees with it, on the site and on the subdomain', () => {
    globals.__RSC_SITE_HOST__ = 'shop.test:8443'
    globals.__RSC_SUBDOMAINS__ = ['merchant']

    try {
      const hrefs = ['/merchant/orders', '/merchant', '/merchant?tab=1', '/merchant#top', '/merchants', '/pricing', '/', '//acme.com/x', '#top', 'https://acme.com']

      for (const host of ['shop.test', 'merchant.shop.test', 'other.shop.test']) {
        for (const href of hrefs) {
          expect(placed(href, host)).toBe(subdomainHref(href, ['merchant'], 'shop.test:8443', host))
        }
      }
    } finally {
      delete globals.__RSC_SITE_HOST__
      delete globals.__RSC_SUBDOMAINS__
    }
  })

  test('leaves every url alone when the build named none', () => {
    expect(placed('/merchant/orders', 'shop.test')).toBe('/merchant/orders')
  })
})
