/**
 * A navigation cross-fades the page in place, the way Inertia's does.
 *
 * React's <ViewTransition> gives every top-level element of the segment its
 * own view-transition-name, so each becomes its own group - and a group,
 * left alone, morphs from where it was to where it is now: a heading
 * slides, an image the visitor never scrolled to travels through the
 * viewport. That is the right default for a component and the wrong one
 * for a page swap. So the group's own movement is switched off, and what is
 * left is the browser's two fades: old content fading out where it was, new
 * content fading in where it is. The layouts around the page are not part
 * of the swap and do not flicker.
 *
 * Only the class the build chose is touched. An app's own names
 * (`<ViewTransition name="hero">`) keep morphing, and the app's CSS shapes
 * or silences the fades through the same class; the guide says how.
 *
 * The root is left to React. It cancels the root's group when nothing
 * outside a boundary changed, and forcing the root back on from here - the
 * earlier shape of this - left a captured root with a hidden group: a dark
 * viewport, on the first navigation, until the fade ended.
 *
 * Installed once, in the browser, when the build was asked to animate.
 */
export function viewTransitionStyle(className: string): string {
  return `::view-transition-group(.${className}){animation:none}`;
}

const ID = "rsc-kit-view-transition";

export function installViewTransitionStyle(
  enabled: string | boolean | null,
): void {
  if (!enabled || typeof document === "undefined") return;
  if (document.getElementById(ID)) return;

  const style = document.createElement("style");

  style.id = ID;
  style.textContent = viewTransitionStyle(
    typeof enabled === "string" ? enabled : "rsc-navigation",
  );
  document.head.appendChild(style);
}
