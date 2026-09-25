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
 * this package's links, before the page has hydrated, is held. When
 * hydration commits - not when the runtime's script runs, which is
 * seconds earlier on a phone whose chunks are still downloading, and where
 * a click is nobody's yet - the last one held is navigated to. A click
 * held for three seconds with no runtime started is given to the browser
 * as a document load, so nothing is lost if the runtime never comes; one
 * held while the runtime is running waits for hydration, up to fifteen.
 *
 * Only this package's links, marked `data-rsc`: a plain anchor to a file, a
 * route.ts, a mailto or a foreign origin is not a page the router swaps in.
 */

/** Written into the bootstrap script, ahead of the runtime's import. No backticks: it lives in a template. */
export const EARLY_CLICKS =
  "(function(){var q=[],fq=[];function h(e){" +
  "if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;" +
  "var t=e.target;var a=t&&t.closest?t.closest('a[data-rsc]'):null;" +
  "if(!a||(a.target&&a.target!=='_self'))return;" +
  "var u;try{u=new URL(a.getAttribute('href'),location.href)}catch(x){return}" +
  "if(u.origin!==location.origin)return;" +
  "e.preventDefault();q.push(u.pathname+u.search+u.hash);a.setAttribute('data-pending','');" +
  // Given to the browser only when the runtime has not even started three
  // seconds after the tap - a script blocked, a chunk that failed. While it
  // is running, hydration is coming, and a phone's takes longer than three
  // seconds: a tap given up at three landed as a document load half a
  // second before the page would have handled it. Fifteen seconds is the
  // hard limit for a runtime that started and never finished.
  "setTimeout(function(){if(q.length&&!w.__rsc_hydrated&&!w.__rsc_navigate)location.href=q[q.length-1]},3000);" +
  "setTimeout(function(){if(q.length&&!w.__rsc_hydrated)location.href=q[q.length-1]},15000)}" +
  // A form submitted before hydration. React renders a form whose action
  // is a server action with $ACTION_ hidden fields so it posts natively
  // without a runtime - the page reloads with the action applied, which is
  // the right answer with no JavaScript and the wrong one with JavaScript
  // a second away: "Add to cart" on a product page reloaded the page when
  // tapped before the runtime hydrated. Held like a tap, and submitted
  // again once hydration commits, when React's own handler takes it.
  "function g(){var x=fq.pop();fq.length=0;if(x)HTMLFormElement.prototype.submit.call(x.f)}" +
  "function s(e){if(e.defaultPrevented)return;var f=e.target;" +
  "if(!f||f.tagName!=='FORM'||!f.querySelector('input[name^=\"$ACTION_\"]'))return;" +
  "e.preventDefault();fq.push({f:f,s:e.submitter||null});f.setAttribute('data-pending','');" +
  "setTimeout(function(){if(fq.length&&!w.__rsc_hydrated&&!w.__rsc_navigate)g()},3000);" +
  "setTimeout(function(){if(fq.length&&!w.__rsc_hydrated)g()},15000)}" +
  "var w=window;document.addEventListener('click',h,true);document.addEventListener('submit',s,true);" +
  "w.__rsc_early={q:q,fq:fq,stop:function(){document.removeEventListener('click',h,true);document.removeEventListener('submit',s,true)}}})();";

interface Early {
  q: string[];
  fq?: { f: HTMLFormElement; s: HTMLElement | null }[];
  stop(): void;
}

/**
 * Hand the clicks held before hydration to the router. The last one is the
 * page the visitor meant; the ones before it were on the way there. A form
 * held is submitted again, now that React's handler is on it - a tap on a
 * link after it wins, since the visitor left the form.
 */
export function replayEarlyClicks(navigate: (url: string) => Promise<void>): string | null {
  const early = (window as { __rsc_early?: Early }).__rsc_early;

  if (!early) return null;

  early.stop();

  const last = early.q[early.q.length - 1] ?? null;
  const form = early.fq?.[early.fq.length - 1] ?? null;

  early.q.length = 0;
  if (early.fq) early.fq.length = 0;

  if (last) {
    void navigate(last);
  } else if (form) {
    form.f.removeAttribute("data-pending");
    form.f.requestSubmit(form.s instanceof HTMLElement ? (form.s as HTMLElement) : undefined);
  }

  return last;
}

/**
 * Run once hydration has committed - now, if it already has, or when the
 * outermost client component's first effect says so. Before that a click
 * is nobody's: the listener above is still holding them, and React has no
 * fibers to dispatch to.
 */
export function afterHydration(fn: () => void): void {
  const w = window as { __rsc_hydrated?: boolean; __rsc_on_hydrated?: () => void };

  if (w.__rsc_hydrated) {
    fn();

    return;
  }

  w.__rsc_on_hydrated = () => {
    w.__rsc_on_hydrated = undefined;
    fn();
  };
}
