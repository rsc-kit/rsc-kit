// Vite config for the fixture app the JS suite builds.
//
// The build runs a project's own config and generates nothing, so the tests
// supply one the same way a real project does.
import { rscRoutes } from '../../src/vite.ts'

export default {
  // packageAlias has no default: the plugin assumes no particular host. Passing
  // it here is what lets the fixture import the client runtime by name while
  // the package is not installed in node_modules.
  plugins: [rscRoutes({ packageAlias: '@rsc-router/core' })],
}
