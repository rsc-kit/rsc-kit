import { DEFAULT_TRAP, TRAP_FIELD } from "./honeypotField.js";

/**
 * A field only a bot fills in. Put it inside a form that posts to a server
 * action - a `"use server"` function, or a Laravel or Go action - and a post
 * with it filled is answered as though it worked and dropped before the action
 * runs. Both fields are taken out of the form before the action sees it.
 *
 * Out of sight, out of the tab order, hidden from screen readers and not
 * autofilled, so a person never fills it. It stops the crudest spam, not a
 * determined one: pair it with a rate limit on the action.
 *
 * Plain markup, so it renders in a server component or a client one.
 */
export function Honeypot({ name = DEFAULT_TRAP }: { name?: string }) {
  return (
    <>
      <div
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}
      >
        <input type="text" name={name} tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <input type="hidden" name={TRAP_FIELD} value={name} />
    </>
  );
}

export default Honeypot;
