import { redirect } from '../../../../../src/redirect'

// The mechanism under test: a check that is not a component, run before
// anything at or below this directory renders.
export default async function guard() {
  redirect('/login')
}
