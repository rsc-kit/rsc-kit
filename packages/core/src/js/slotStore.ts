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

/** The depth of the segment each slot renders in, told by its boundary. */
const depths = new Map<string, number>()

export function subscribeToSlot(name: string, listener: Listener, depth?: number): () => void {
  if (depth !== undefined) depths.set(name, depth)

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
 * Forget the slots a navigation replaces.
 *
 * A navigation answered at a depth renders everything from that boundary
 * down, and a slot rendered for the page you left has no claim on the one you
 * arrived at. A slot of a layout above it is not part of the answer: that
 * layout stays mounted, and what an action last put in its slot is still
 * current. Emptied, the boundary fell back to the layout's first render, and
 * a team picker went back to the name from before the rename.
 *
 * With no depth, every slot - and a slot whose boundary never said where it
 * is goes either way.
 */
export function clearSlots(fromDepth = 0): void {
  const names = [...slots.keys()].filter((name) => (depths.get(name) ?? fromDepth) >= fromDepth)

  names.forEach((name) => slots.delete(name))
  names.forEach(notify)
}
