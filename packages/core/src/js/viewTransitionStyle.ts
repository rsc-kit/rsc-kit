/**
 * A navigation fades the way Inertia's does: the whole viewport, nothing
 * else named.
 *
 * React's <ViewTransition> gives every top-level element of the segment its
 * own view-transition-name, so each becomes its own group and morphs from
 * where it was to where it is now - a heading slides, an image the visitor
 * never scrolled to travels through the viewport. The document root, which
 * the browser would otherwise cross-fade, is opted out. That is the right
 * default for a component; for a page swap it is the wrong one.
 *
 * So the generated names are switched off and the root switched back on,
 * from CSS - which leaves React deciding when a transition runs (it waits
 * for the new page to be ready before it commits) and the browser doing the
 * one thing wanted: cross-fade old viewport to new. An app's own names
 * (`<ViewTransition name="hero">`) are not touched, so shared elements still
 * morph. The old and new snapshots are `::view-transition-old(root)` and
 * `::view-transition-new(root)`; the guide says how to shape or silence them.
 *
 * Installed once, in the browser, when the build was asked to animate.
 */
export function viewTransitionStyle(): string {
  return (
    '[style*="view-transition-name: _t_"],[style*="view-transition-name:_t_"]' +
    "{view-transition-name:none!important}" +
    ":root{view-transition-name:root!important}"
  );
}

const ID = "rsc-kit-view-transition";

export function installViewTransitionStyle(
  enabled: string | boolean | null,
): void {
  if (!enabled || typeof document === "undefined") return;
  if (document.getElementById(ID)) return;

  const style = document.createElement("style");

  style.id = ID;
  style.textContent = viewTransitionStyle();
  document.head.appendChild(style);
}
