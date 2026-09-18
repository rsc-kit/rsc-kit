/**
 * The one rule a page-sized transition always wants.
 *
 * The browser's default for a view-transition group is to morph its box from
 * the old element's size to the new one's while cross-fading the snapshots.
 * For a segment that is the whole page that morph is never wanted: the old
 * snapshot holds everything below the fold, and as the box animates between
 * two page heights that content slides through the viewport - images the
 * visitor never scrolled to appear, then vanish. So the group and the image
 * pair do not animate; the cross-fade of old and new stays, and the app's own
 * CSS can shape or silence that too (see the view-transitions guide).
 *
 * Installed once, in the browser, when the boundary carries a class - so a
 * build without transitions ships none of this.
 */
export function viewTransitionStyle(className: string): string {
  return (
    `::view-transition-group(.${className}),` +
    `::view-transition-image-pair(.${className}){animation:none}`
  );
}

const ID = "rsc-kit-view-transition";

export function installViewTransitionStyle(className: string | null): void {
  if (!className || typeof document === "undefined") return;
  if (document.getElementById(ID)) return;

  const style = document.createElement("style");

  style.id = ID;
  style.textContent = viewTransitionStyle(className);
  document.head.appendChild(style);
}
