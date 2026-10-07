import { cookies } from '@rsc-kit/core/request'

// Reads the visitor's cookies, as a layout's cart badge or sign-in state does.
// Rendered for a url no route owns, after the host has declined it - and it
// must still have the request to read from.
export default async function NotFound() {
  const signedIn = (await cookies()).get('signed-in')?.value ?? 'no'

  return (
    <main>
      <h1 id="not-found">Nothing here</h1>
      <p id="not-found-signed-in">signed in: {signedIn}</p>
    </main>
  )
}
