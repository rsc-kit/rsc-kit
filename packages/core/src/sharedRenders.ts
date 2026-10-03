// One render of a shared section per change, however many tabs ask for it.
//
// A name moves; every tab showing a section that refreshes on it asks for
// that section within a moment of each other. For a section declared
// `shared` - the same for everyone allowed to see the page - those asks are
// for the same thing, and the first one's render answers the rest. Keyed on
// the change that triggered the ask (`stock@5`), so an answer is never older
// than the change it was asked for, and a refresh that is not about a change
// - refresh() by hand, an action's - is never shared at all.

/** How long one change's render is kept for tabs still arriving. */
export const SHARED_RENDER_MS = 10_000;

/** At most this many renders are held at once; the oldest is dropped first. */
const MAX_HELD = 500;

const held = new Map<string, { payload: Promise<string>; at: number }>();

/**
 * The render for `key`: the one already done or under way, or `render`'s.
 * A render that fails is not kept - the next tab tries again.
 */
export function shareRender(
  key: string,
  render: () => Promise<string>,
): Promise<string> {
  const now = Date.now();
  const found = held.get(key);

  if (found && now - found.at < SHARED_RENDER_MS) return found.payload;

  for (const [k, entry] of held)
    if (now - entry.at >= SHARED_RENDER_MS) held.delete(k);
  while (held.size >= MAX_HELD) held.delete(held.keys().next().value as string);

  const payload = render();

  held.set(key, { payload, at: now });
  payload.catch(() => {
    if (held.get(key)?.payload === payload) held.delete(key);
  });

  return payload;
}

/** For tests. */
export function resetSharedRenders(): void {
  held.clear();
}
