import { subscribe } from '../../actions'

// A server-action form as React emits it: an action attribute of the page's
// own url and the action's id in hidden fields, so a browser with no runtime
// yet posts here.
export default function SubscribePage() {
  return (
    <form action={subscribe}>
      <input name="email" />
      <input name="then" />
      <button type="submit">Subscribe</button>
    </form>
  )
}
