/**
 * How many <Activity> boundaries the server put in this document.
 *
 * React marks each with a comment, <!--&--> to <!--/&-->; the opening ones
 * are counted.
 */
export function activityMarkersIn(container: Element | Document): number {
  if (typeof document === "undefined" || typeof document.createTreeWalker !== "function") return 1;

  const walker = document.createTreeWalker(container, 128 /* NodeFilter.SHOW_COMMENT */);
  let count = 0;

  while (walker.nextNode()) {
    if ((walker.currentNode as Comment).data === "&") count++;
  }

  return count;
}
