/**
 * What each parallel slot is showing, when the server has re-rendered one.
 *
 * A slot is the only region of a page smaller than the page that the server
 * can name, so it is the unit an action can invalidate on its own — two tables
 * refresh apart from each other only if they are two slots.
 *
 * Empty is meaningful, and is the ordinary case: a slot with nothing stored
 * renders what the server sent with the page. Nothing is retained here the way
 * segments retain pages; a slot has one current value and replacing it is the
 * whole point.
 */

type Tree = unknown
type Listener = () => void

/**
 * Immutable, like the segment store and for the same reason:
 * useSyncExternalStore compares snapshots by identity, so returning a fresh
 * object per read reads as "changed every render" and loops until React gives
 * up. Every write replaces the entry; nothing is edited in place.
 */
interface SlotState {
  readonly tree: Tree
}

const slots = new Map<string, SlotState>()
const listeners = new Map<string, Set<Listener>>()

/** Shared by every slot that has never been written to, so identity is stable. */
const EMPTY: SlotState = { tree: undefined }

function notify(name: string): void {
  listeners.get(name)?.forEach((listener) => listener())
}

export function setSlot(name: string, tree: Tree): void {
  slots.set(name, { tree })
  notify(name)
}

export function subscribeToSlot(name: string, listener: Listener): () => void {
  const existing = listeners.get(name) ?? new Set<Listener>()

  existing.add(listener)
  listeners.set(name, existing)

  return () => {
    existing.delete(listener)
  }
}

export function getSlotState(name: string): SlotState {
  return slots.get(name) ?? EMPTY
}

/**
 * Forget every slot.
 *
 * A navigation replaces the page, and a slot rendered for the page you left
 * has no claim on the one you arrived at.
 */
export function clearSlots(): void {
  const names = [...slots.keys()]

  slots.clear()
  names.forEach(notify)
}
