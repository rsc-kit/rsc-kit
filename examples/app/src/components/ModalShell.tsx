'use client'

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * The chrome around an intercepted view: a backdrop, a close button, and the
 * Escape key.
 *
 * Closing is `history.back()` rather than a link to a fixed url. The modal was
 * opened by pushing a history entry over the page beneath, so going back is
 * both what the browser's own back button does and what returns to whatever
 * page it was opened over — a hardcoded destination is wrong the moment the
 * same modal is reachable from two places.
 *
 * The router recognises that as leaving an interception and empties the slot
 * without asking the server for anything: the page underneath never left.
 */
export function ModalShell({ children }: { children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // The only way to dismiss a dialog without a pointer.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') history.back()
    }

    window.addEventListener('keydown', onKey)
    close.current?.focus()

    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="modal" id="post-modal" onClick={() => history.back()}>
      {/* Clicks inside the dialog are not clicks on the backdrop. */}
      <article role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <button ref={close} className="modal-close" aria-label="Close" onClick={() => history.back()}>
          ×
        </button>
        {children}
      </article>
    </div>
  )
}
