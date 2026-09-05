// Types the test suite needs that the packages themselves do not ship.
//
// react-server-dom-webpack has no published types, and the fixture imports a
// stylesheet the way an app does. Neither is worth loosening the whole
// tsconfig for.
declare module 'react-server-dom-webpack/client.edge'

declare module '*.css'

// A second copy of a module, loaded on purpose: the query string makes the
// bundler treat it as a different module, which is how the cross-bundle
// behaviour of the shared scope gets tested at all.
declare module '*?copy=2'
