/**
 * A test host typed from an app's rsc-host.json, checked by the typechecker.
 *
 * What it pins: testChanges().host spreads into a typed TestHost - the case
 * a port hit, where it did not - and a handler still has to answer what the
 * backend would.
 *
 * Its own program (testHostTypes.tsconfig.json), because RscHostFunctions is
 * global: declared here, it would type every other file's test host too.
 */
import { testChanges, type TestHost } from '../../src/testHost'

declare global {
  interface RscHostFunctions {
    'Repos.list': { args: [team: string]; result: { id: number; name: string }[] }
  }
}

const changes = testChanges()

export const host: TestHost = {
  ...changes.host,
  'Repos.list': ({ args: [team] }) => [{ id: 1, name: team }],
}

export const wrong: TestHost = {
  ...changes.host,
  // @ts-expect-error a result the backend would not send
  'Repos.list': () => 'not a list',
}

changes.changed('team:1:repos')
