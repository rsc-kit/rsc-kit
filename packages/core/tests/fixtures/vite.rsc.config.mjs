// Vite config for the fixture app the JS suite builds.
//
// The build runs a project's own config and generates nothing, so the tests
// supply one the same way a real project does.
import { rscKit } from '../../src/vite.ts'

export default {
  // packageAlias has no default: the plugin assumes no particular host. Passing
  // it here is what lets the fixture import the client runtime by name while
  // the package is not installed in node_modules.
  //
  // prerender: false, because this app contains a route that throws on purpose
  // — app/throws-in-boundary — and the build refuses to finish with a route it
  // could not store. prerender.test.ts renders the fixture itself, with that
  // route filtered out for the ordinary cases and alone for the one that wants
  // the failure, so a build-time pass would be both duplicate and fatal.
  //
  // It got away with prerendering before only because it never happened: the
  // step looked for the rsc bundle at a path this build does not write to.
  plugins: [rscKit({ packageAlias: '@rsc-kit/core', prerender: false })],
}
