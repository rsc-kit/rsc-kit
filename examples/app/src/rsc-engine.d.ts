// @generated — do not edit. Written by the RSC build.
declare module '*/dist/rsc/index.js' {
  import type { RscEngine } from '@rsc-kit/core/host'
  import type { PrerenderEngine } from '@rsc-kit/core/prerender'

  const engine: RscEngine & PrerenderEngine & Required<Pick<PrerenderEngine, 'manifest'>>

  export = engine
}
