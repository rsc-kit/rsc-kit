// An auth library imported at startup. It pulls in tsyringe through
// @peculiar/x509, and tsyringe refuses to load unless reflect-metadata ran
// first. The built server arranges that in a Nitro plugin; a command has to
// arrange for itself.
import '@simplewebauthn/server'

declare global {
  var __registered: boolean | undefined
}

// Switches for scripts/verify-commands.sh, which cannot otherwise make an
// import fail or take long: a bad environment refuses here, as env validation
// does, and a slow import is the app taking a while to load.
if (process.env.RSC_EXAMPLE_BAD_ENV) throw new Error('RSC_EXAMPLE_BAD_ENV: the environment is not valid')

if (process.env.RSC_EXAMPLE_SLOW_IMPORT) {
  console.log('example: loading slowly')

  for (const until = Date.now() + 1500; Date.now() < until; ) {
    // Busy on purpose: a signal that arrives now is handled only once the load returns control.
  }
}

export async function register() {
  globalThis.__registered = true
}
