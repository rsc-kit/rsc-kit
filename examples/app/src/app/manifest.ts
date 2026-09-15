import type { WebManifest } from '@rsc-kit/core/manifest-file'

// Beside the routes, like everything else about this app. Read at build time,
// so it is a literal rather than something computed.
export default {
  name: 'rsc-kit example',
  shortName: 'rsc-kit',
  themeColor: '#0b0b0c',
  backgroundColor: '#ffffff',
  // No icons listed: the build finds icon-*.png in this directory.
} satisfies WebManifest
