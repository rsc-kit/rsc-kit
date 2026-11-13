/**
 * hostUrl's types: the host autocompletes to the top-level folders and takes
 * any string; the path is typed by what that host answers. Its own program
 * (hostUrlTypes.tsconfig.json), because the route union it registers would
 * clash with routeTypes.check.ts's.
 */
import { hostUrl } from '../../src/routes'
import type { HostFolder, Route } from '../../src/routes'

declare module '../../src/routes' {
  interface Register {
    routes: '/' | '/pricing' | '/merchant' | '/merchant/orders' | '/merchant/orders/[id]' | '/[domain]' | '/[domain]/settings'
  }
  interface RegisterApi {
    apis: '/api/orders'
  }
}

// A folder's subdomain: the pages under it, folder taken off.
const a: Route = hostUrl('merchant', '/orders')
hostUrl('merchant', '/')
hostUrl('merchant', '/orders/42')
hostUrl('merchant', '/orders?page=2')
// @ts-expect-error - the folder path is not the subdomain's
hostUrl('merchant', '/merchant/orders')
// @ts-expect-error - not a page under app/merchant
hostUrl('merchant', '/settings')

// Any other name is a tenant: the tenant tree's paths.
hostUrl('testbrand', '/settings')
hostUrl('acme.com', '/')
// @ts-expect-error - not a page in the tenant tree
hostUrl('acme.com', '/orders')

// The site itself.
// (Typed as Route: in an app with a tenant tree, /[domain] already makes any
// /segment a Route, so there is no wrong path to show here.)
hostUrl('/pricing')

// The folders are what autocompletes; [domain] is not one.
const folder: HostFolder = 'merchant'
const site: HostFolder = 'pricing'
// @ts-expect-error - a parameter is not a folder
const param: HostFolder = '[domain]'

void a; void folder; void site; void param
