/**
 * A tap before the page can navigate.
 *
 * The document arrives, the bootstrap script starts the runtime, and on a
 * phone the runtime takes a while to arrive and hydrate - seconds, with a
 * tag manager or two on the main thread. A tap on a link in that window is
 * the browser's: a document load, of a page the router would have swapped
 * in. The port's "Sign in is slow from the home page, and sometimes a full
 * reload" was this, and only on a phone, where the window is wide.
 *
 * The first thing the bootstrap script does is listen: a click on one of
 * this package's links, before the router exists, is held. When the router
 * is wired, the last one held is navigated to. If the runtime never comes -
 * a chunk that failed, a script blocked - the browser gets the click back
 * after a few seconds, as a document load, so nothing is lost.
 *
 * Only this package's links, marked `data-rsc`: a plain anchor to a file, a
 * route.ts, a mailto or a foreign origin is not a page the router swaps in.
 */

/** Written into the bootstrap script, ahead of the runtime's import. No backticks: it lives in a template. */
export const EARLY_CLICKS =
  "(function(){var q=[];function h(e){" +
  "if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;" +
  "var t=e.target;var a=t&&t.closest?t.closest('a[data-rsc]'):null;" +
  "if(!a||(a.target&&a.target!=='_self'))return;" +
  "var u;try{u=new URL(a.getAttribute('href'),location.href)}catch(x){return}" +
  "if(u.origin!==location.origin)return;" +
  "e.preventDefault();q.push(u.pathname+u.search+u.hash);a.setAttribute('data-pending','')}" +
  "document.addEventListener('click',h,true);" +
  "var w=window;w.__rsc_early={q:q,stop:function(){document.removeEventListener('click',h,true)}};" +
  "setTimeout(function(){if(q.length&&!w.__rsc_navigate)location.href=q[q.length-1]},4000)})();";

interface Early {
  q: string[];
  stop(): void;
}

/**
 * Hand the clicks held before the router existed to it. The last one is the
 * page the visitor meant; the ones before it were on the way there.
 */
export function replayEarlyClicks(navigate: (url: string) => Promise<void>): string | null {
  const early = (window as { __rsc_early?: Early }).__rsc_early;

  if (!early) return null;

  early.stop();

  const last = early.q[early.q.length - 1] ?? null;

  early.q.length = 0;

  if (last) void navigate(last);

  return last;
}
